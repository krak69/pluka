-- PLUKA V1 — Participants : la vague d'un fichier, tant qu'elle n'est pas déclarée
-- File target: supabase/migrations/0061_participant_declared_wave.sql
-- Référence : docs/00_PRODUCT_SPEC.md §29.1 · docs/02_DATA_MODEL.md §20.1
--
-- POURQUOI
--
-- Une vague officielle porte une heure de départ, celle du Plan du coureur : un
-- fichier, qui n'a qu'un nom, ne peut pas en créer une sans inventer cette heure.
-- Le nom est donc gardé tel qu'écrit, à part de `start_wave_id`, et se rattache
-- dès que la vague du même nom existe sur l'épreuve. L'organisation le voit avant
-- de confirmer : une vague inconnue n'est ni une erreur, ni un silence.

begin;

-- Aucun grant de colonne : comme le reste de la liste, elle sort par une fonction.
alter table public.participant_races
  add column declared_wave_name text
    check (char_length(declared_wave_name) between 1 and 120);

comment on column public.participant_races.declared_wave_name is
  'Vague écrite dans un fichier importé, sans vague officielle correspondante. Vide dès que start_wave_id est posé.';

create function private.attach_declared_wave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.participant_races pr
  set start_wave_id = new.id, declared_wave_name = null
  where pr.race_id = new.race_id
    and pr.start_wave_id is null
    and lower(pr.declared_wave_name) = lower(new.name);
  return null;
end;
$$;

revoke all on function private.attach_declared_wave() from public, anon, authenticated;

create trigger trg_race_start_waves_attach_declared
  after insert or update of name on public.race_start_waves
  for each row execute function private.attach_declared_wave();

create or replace function public.commit_participant_import(p_import_id uuid)
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
       bib_number, start_wave_id, declared_wave_name)
    values
      (v_race_id, v_email, v_data ->> 'firstName', v_data ->> 'lastName', 'organizer_import',
       nullif(v_data ->> 'bib', ''), v_wave_id,
       case when v_wave_id is null then left(nullif(v_data ->> 'wave', ''), 120) end)
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

/*
 * L'état d'un import pour son assistant. Les vagues inconnues se calculent ici,
 * avec la comparaison de l'import : ce que l'organisation lit est ce qui se passera.
 */
create or replace function public.get_participant_import(p_import_id uuid)
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
    ), '[]'::jsonb),
    'unknownWaves', (
      with unknown as (
        select race.name as race_name, min(r.mapped_data ->> 'wave') as wave, count(*)::integer as n
        from public.participant_import_rows r
        join public.races race
          on race.id::text = r.mapped_data ->> 'raceId' and race.edition_id = v_import.edition_id
        where r.import_id = p_import_id
          and r.status = 'valid'
          and nullif(r.mapped_data ->> 'wave', '') is not null
          and not exists (
            select 1 from public.race_start_waves w
            where w.race_id = race.id and lower(w.name) = lower(r.mapped_data ->> 'wave')
          )
        group by race.id, race.name, lower(r.mapped_data ->> 'wave')
      ), shown as (
        -- Une colonne mal choisie donnerait une vague par ligne : l'écran en montre 20.
        select u.race_name, u.wave, u.n from unknown u order by u.race_name, lower(u.wave) limit 20
      )
      select jsonb_build_object(
        'rows', coalesce((select sum(u.n)::integer from unknown u), 0),
        'groups', (select count(*)::integer from unknown),
        'shown', coalesce((
          select jsonb_agg(jsonb_build_object('raceName', s.race_name, 'wave', s.wave, 'rows', s.n)
                           order by s.race_name, lower(s.wave))
          from shown s
        ), '[]'::jsonb)
      )
    )
  );
end;
$$;

create or replace function public.list_edition_participants(p_edition_id uuid, p_limit integer default 500)
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
            'declaredWaveName', pr.declared_wave_name,
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

commit;
