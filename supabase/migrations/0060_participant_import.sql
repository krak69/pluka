-- PLUKA V1 — Participants : l'import d'une liste
-- File target: supabase/migrations/0060_participant_import.sql
-- Référence : docs/00_PRODUCT_SPEC.md §29.1 · docs/03_PRIVACY_RLS.md §28, §58 à §62
--
-- POURQUOI
--
-- Le parcours est : fichier → colonnes → vérification → import (02_DATA_MODEL §20.1).
-- Le domaine lit le fichier et juge chaque ligne ; ces fonctions gardent le geste,
-- et portent l'écriture en une transaction.
--
-- CE QUI PROTÈGE LES COUREURS
--
--   - seuls un owner ou un admin importent : ces lignes sont des données
--     personnelles, et ce n'est pas un droit de viewer ou d'editor (§59) ;
--   - sexe, date de naissance, nationalité et indices vont dans le schéma `private`,
--     qu'aucune organisation ne relit : ils servent à des agrégats futurs, jamais à
--     une lecture nominale (§28, §62, AGENTS §67). ITRA et UTMB restent distincts ;
--   - le fichier n'est pas conservé, et les lignes sont vidées une fois importées :
--     aucune copie de ces données ne reste dans la table de travail ;
--   - la liste ne montre l'e-mail qu'à qui peut inviter, et jamais de préparation.

begin;

-- Le fichier n'est pas stocké : il n'y a pas de chemin à garder.
alter table public.participant_imports alter column storage_path drop not null;

create table private.participant_demographics (
  participant_race_id uuid primary key references public.participant_races(id) on delete cascade,
  sex text check (sex in ('female', 'male', 'other')),
  birth_date date,
  nationality text check (char_length(nationality) <= 60),
  created_at timestamptz not null default now()
);

comment on table private.participant_demographics is
  'Données déclaratives d''un import, pour des agrégats à venir. Service only : aucune lecture nominale par une organisation (03_PRIVACY_RLS §28).';

create or replace function private.assert_can_import_participants(p_edition_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.user_can_manage_edition(p_edition_id, 'admin') or private.is_pluka_admin()) then
    raise exception 'import réservé à un owner ou un admin' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_can_import_participants(uuid) from public, anon;
grant execute on function private.assert_can_import_participants(uuid) to authenticated;

/* Créer l'import : le fichier est déjà lu, ses lignes arrivent telles quelles. */
create function public.create_participant_import(
  p_edition_id uuid,
  p_file_name text,
  p_headers jsonb,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_import_id uuid;
begin
  perform private.assert_can_import_participants(p_edition_id);

  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_headers) is distinct from 'array' then
    raise exception 'fichier illisible' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'TOO_MANY_ROWS' using errcode = '22023';
  end if;

  v_organization_id := private.organization_of_edition(p_edition_id);

  insert into public.participant_imports (organization_id, edition_id, status, mapping, created_by_user_id)
  values (v_organization_id, p_edition_id, 'mapping',
          jsonb_build_object('fileName', left(p_file_name, 255), 'headers', p_headers),
          (select auth.uid()))
  returning id into v_import_id;

  insert into public.participant_import_rows (import_id, row_number, raw_data, status)
  select v_import_id, ordinality::integer, item, 'pending'
  from jsonb_array_elements(p_rows) with ordinality as t(item, ordinality);

  perform private.record_audit(
    'participant_import.create', 'participant_imports', v_import_id,
    jsonb_build_object('rows', jsonb_array_length(p_rows))
  );

  return v_import_id;
end;
$$;

/* Le verdict du domaine sur chaque ligne, une fois les colonnes choisies. */
create function public.validate_participant_import(
  p_import_id uuid,
  p_mapping jsonb,
  p_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.participant_imports;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id for update;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  if v_import.status not in ('mapping', 'validating') then
    raise exception 'import déjà terminé' using errcode = '55000';
  end if;

  update public.participant_import_rows r set
    status = (item ->> 'status')::public.import_row_status,
    mapped_data = coalesce(item -> 'mapped', '{}'::jsonb),
    error_message = item ->> 'error'
  from jsonb_array_elements(p_rows) as t(item)
  where r.import_id = p_import_id and r.row_number = (item ->> 'rowNumber')::integer;

  update public.participant_imports i
  set status = 'validating',
      mapping = i.mapping || jsonb_build_object('columns', p_mapping)
  where i.id = p_import_id;
end;
$$;

/*
 * Importer : une transaction, rejouable sans effet. Une ligne déjà présente
 * (même épreuve, même adresse) ne crée rien : ce n'est pas une erreur, c'est un
 * fichier repris.
 */
create function public.commit_participant_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.participant_imports;
  v_row public.participant_import_rows;
  v_data jsonb;
  v_race_id uuid;
  v_email extensions.citext;
  v_wave_id uuid;
  v_participant_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id for update;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  if v_import.status <> 'validating' then
    raise exception 'import non prêt' using errcode = '55000';
  end if;

  for v_row in
    select * from public.participant_import_rows r
    where r.import_id = p_import_id and r.status = 'valid'
    order by r.row_number
  loop
    v_data := v_row.mapped_data;
    v_race_id := (v_data ->> 'raceId')::uuid;
    v_email := (v_data ->> 'email')::extensions.citext;

    if not exists (
      select 1 from public.races r where r.id = v_race_id and r.edition_id = v_import.edition_id
    ) then
      raise exception 'épreuve hors de cette édition' using errcode = '22023';
    end if;

    if exists (
      select 1 from public.participant_races pr
      -- Sous `search_path = ''`, `=` compare en texte : la casse se retire à la main.
      where pr.race_id = v_race_id and lower(pr.invite_email::text) = lower(v_email::text)
    ) then
      update public.participant_import_rows r set status = 'skipped',
        error_message = 'Déjà dans la liste.'
      where r.id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select w.id into v_wave_id from public.race_start_waves w
    where w.race_id = v_race_id and lower(w.name) = lower(v_data ->> 'wave');

    insert into public.participant_races
      (race_id, invite_email, first_name_snapshot, last_name_snapshot, registration_source,
       bib_number, start_wave_id)
    values
      (v_race_id, v_email, v_data ->> 'firstName', v_data ->> 'lastName', 'organizer_import',
       nullif(v_data ->> 'bib', ''), v_wave_id)
    returning id into v_participant_id;

    if coalesce(v_data ->> 'sex', v_data ->> 'birthDate', v_data ->> 'nationality') is not null then
      insert into private.participant_demographics (participant_race_id, sex, birth_date, nationality)
      values (v_participant_id, v_data ->> 'sex', (v_data ->> 'birthDate')::date, v_data ->> 'nationality');
    end if;

    -- Deux fournisseurs, deux lignes : jamais un indice commun (AGENTS §18).
    if (v_data ->> 'itraIndex') is not null then
      insert into private.participant_performance_signals
        (participant_race_id, provider, provider_identifier, value)
      values (v_participant_id, 'itra', v_data ->> 'itraId', (v_data ->> 'itraIndex')::numeric);
    end if;
    if (v_data ->> 'utmbIndex') is not null then
      insert into private.participant_performance_signals
        (participant_race_id, provider, provider_identifier, value)
      values (v_participant_id, 'utmb', v_data ->> 'utmbId', (v_data ->> 'utmbIndex')::numeric);
    end if;

    update public.participant_import_rows r
    set status = 'imported', participant_race_id = v_participant_id
    where r.id = v_row.id;
    v_created := v_created + 1;
  end loop;

  -- Les données de la ligne ont rejoint leur place : elles ne restent pas ici.
  update public.participant_import_rows r
  set raw_data = '{}'::jsonb, mapped_data = '{}'::jsonb
  where r.import_id = p_import_id;

  update public.participant_imports i set status = 'imported' where i.id = p_import_id;

  perform private.record_audit(
    'participant_import.commit', 'participant_imports', p_import_id,
    jsonb_build_object('created', v_created, 'skipped', v_skipped)
  );

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

/* Abandonner : rien n'est gardé du fichier. */
create function public.discard_participant_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.participant_imports;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id for update;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  if v_import.status = 'imported' then
    raise exception 'import déjà terminé' using errcode = '55000';
  end if;

  delete from public.participant_import_rows r where r.import_id = p_import_id;
  update public.participant_imports i set status = 'failed' where i.id = p_import_id;

  perform private.record_audit(
    'participant_import.discard', 'participant_imports', p_import_id, '{}'::jsonb
  );
end;
$$;

/* L'état d'un import pour son assistant : les colonnes, un aperçu, les exceptions. */
create function public.get_participant_import(p_import_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_import public.participant_imports;
begin
  select * into v_import from public.participant_imports i where i.id = p_import_id;
  if not found then
    raise exception 'import introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_import.edition_id);

  return jsonb_build_object(
    'id', v_import.id,
    'editionId', v_import.edition_id,
    'status', v_import.status,
    'fileName', v_import.mapping ->> 'fileName',
    'headers', coalesce(v_import.mapping -> 'headers', '[]'::jsonb),
    'columns', coalesce(v_import.mapping -> 'columns', '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('rowNumber', r.row_number, 'data', r.raw_data) order by r.row_number)
      from public.participant_import_rows r where r.import_id = p_import_id
    ), '[]'::jsonb),
    'counts', coalesce((
      select jsonb_object_agg(t.status, t.n)
      from (
        select r.status, count(*)::integer as n
        from public.participant_import_rows r where r.import_id = p_import_id group by r.status
      ) t
    ), '{}'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rowNumber', e.row_number, 'status', e.status, 'message', e.error_message
      ) order by e.row_number)
      from (
        select r.row_number, r.status, r.error_message
        from public.participant_import_rows r
        where r.import_id = p_import_id and r.error_message is not null
        order by r.row_number limit 100
      ) e
    ), '[]'::jsonb)
  );
end;
$$;

/*
 * La liste d'une édition (§28, AC-B2B-PART-05). Une lecture construite, pas une
 * ligne de table : ni compte, ni préparation, ni signal. L'e-mail n'est rendu
 * qu'à qui peut inviter.
 */
create function public.list_edition_participants(p_edition_id uuid, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_see_contact boolean;
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'liste réservée à l''organisation de la course' using errcode = '42501';
  end if;

  v_can_see_contact := private.user_can_manage_edition(p_edition_id, 'admin') or private.is_pluka_admin();

  return jsonb_build_object(
    'total', (
      select count(*)::integer from public.participant_races pr
      join public.races r on r.id = pr.race_id where r.edition_id = p_edition_id
    ),
    'participants', coalesce((
      select jsonb_agg(p.payload order by p.sort_name)
      from (
        select lower(coalesce(pr.last_name_snapshot, '') || ' ' || coalesce(pr.first_name_snapshot, '')) as sort_name,
          jsonb_build_object(
            'id', pr.id,
            'firstName', pr.first_name_snapshot,
            'lastName', pr.last_name_snapshot,
            'email', case when v_can_see_contact then pr.invite_email::text end,
            'bib', pr.bib_number,
            'raceName', r.name,
            'waveName', w.name,
            'activated', pr.user_id is not null
          ) as payload
        from public.participant_races pr
        join public.races r on r.id = pr.race_id
        left join public.race_start_waves w on w.id = pr.start_wave_id
        where r.edition_id = p_edition_id
        order by lower(coalesce(pr.last_name_snapshot, '')), lower(coalesce(pr.first_name_snapshot, ''))
        limit least(greatest(p_limit, 1), 2000)
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_participant_import(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.validate_participant_import(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.commit_participant_import(uuid) from public, anon;
revoke all on function public.discard_participant_import(uuid) from public, anon;
revoke all on function public.get_participant_import(uuid) from public, anon;
revoke all on function public.list_edition_participants(uuid, integer) from public, anon;
grant execute on function public.create_participant_import(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.validate_participant_import(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.commit_participant_import(uuid) to authenticated;
grant execute on function public.discard_participant_import(uuid) to authenticated;
grant execute on function public.get_participant_import(uuid) to authenticated;
grant execute on function public.list_edition_participants(uuid, integer) to authenticated;

commit;
