-- PLUKA V1 — Participants : compléter, corriger, retirer
-- File target: supabase/migrations/0064_participant_corrections.sql
-- Référence : docs/00_PRODUCT_SPEC.md §29.1 · docs/02_DATA_MODEL.md §20.1 · AC-B2B-PART-09 à 11
--
-- POURQUOI
--
-- Dossard et vague arrivent souvent au dernier moment : un fichier repris doit
-- compléter les présents, plus seulement les sauter. Trois règles le gardent sûr :
--
--   - l'épreuve et l'e-mail reconnaissent un participant, jamais un doublon ;
--   - une case vide n'efface rien : un export partiel ne vide pas la liste ;
--   - une correction à la main gagne sur le fichier : ce geste est le plus récent
--     et le plus sûr, et la vérification le dit avant l'import.
--
-- La vérification et l'import passent par la même fonction : ce qui est annoncé
-- est ce qui se fait.
--
-- Le retrait reprend `archived`, déjà « hors circulation » pour les notifications.
-- Il est refusé à un participant rattaché à un compte : sa participation et sa
-- préparation sont les siennes, l'organisation ne les sort pas.

begin;

-- Aucun grant de colonne : comme le reste de la liste, elles restent côté serveur.
alter table public.participant_races
  add column bib_set_manually boolean not null default false,
  add column wave_set_manually boolean not null default false;

create function private.participant_import_effect(
  p_race_id uuid,
  p_email text,
  p_bib text,
  p_wave text,
  out participant_id uuid,
  out effect text,
  out apply_bib boolean,
  out apply_wave boolean,
  out kept boolean,
  out wave_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.participant_race_status;
  v_bib text;
  v_wave text;
  v_bib_manual boolean;
  v_wave_manual boolean;
begin
  apply_bib := false;
  apply_wave := false;
  kept := false;

  select w.id into wave_id from public.race_start_waves w
  where w.race_id = p_race_id and lower(w.name) = lower(p_wave)
  order by w.sort_order limit 1;

  select pr.id, pr.status, pr.bib_number, coalesce(w.name, pr.declared_wave_name),
         pr.bib_set_manually, pr.wave_set_manually
  into participant_id, v_status, v_bib, v_wave, v_bib_manual, v_wave_manual
  from public.participant_races pr
  left join public.race_start_waves w on w.id = pr.start_wave_id
  -- Sous `search_path = ''`, `=` compare en texte : la casse se retire à la main.
  where pr.race_id = p_race_id and lower(pr.invite_email::text) = lower(p_email)
  limit 1;

  if participant_id is null then
    effect := 'new';
    return;
  end if;

  if v_status = 'archived' then
    effect := 'withdrawn';
    return;
  end if;

  if p_bib is not null and p_bib is distinct from v_bib then
    if v_bib_manual then kept := true; else apply_bib := true; end if;
  end if;

  if p_wave is not null and lower(p_wave) is distinct from lower(v_wave) then
    if v_wave_manual then kept := true; else apply_wave := true; end if;
  end if;

  effect := case when apply_bib or apply_wave then 'updated' else 'unchanged' end;
end;
$$;

revoke all on function private.participant_import_effect(uuid, text, text, text)
  from public, anon, authenticated;

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
  v_bib text;
  v_wave text;
  v_effect record;
  v_participant_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_kept integer := 0;
  v_withdrawn integer := 0;
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
    v_bib := nullif(v_data ->> 'bib', '');
    v_wave := nullif(v_data ->> 'wave', '');

    if not exists (
      select 1 from public.races r where r.id = v_race_id and r.edition_id = v_import.edition_id
    ) then
      raise exception 'épreuve hors de cette édition' using errcode = '22023';
    end if;

    select * into v_effect
    from private.participant_import_effect(v_race_id, v_email::text, v_bib, v_wave);

    if v_effect.effect = 'withdrawn' then
      update public.participant_import_rows r
      set status = 'skipped', participant_race_id = v_effect.participant_id,
        error_message = 'Retiré de la liste : un fichier ne le rétablit pas.'
      where r.id = v_row.id;
      v_withdrawn := v_withdrawn + 1;
      continue;
    end if;

    if v_effect.effect = 'new' then
      insert into public.participant_races
        (race_id, invite_email, first_name_snapshot, last_name_snapshot, registration_source,
         bib_number, start_wave_id, declared_wave_name)
      values
        (v_race_id, v_email, v_data ->> 'firstName', v_data ->> 'lastName', 'organizer_import',
         v_bib, v_effect.wave_id,
         case when v_effect.wave_id is null then left(v_wave, 120) end)
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
      continue;
    end if;

    -- Présent : seuls dossard et vague bougent, et seulement ce que le fichier apporte.
    if v_effect.apply_bib then
      update public.participant_races pr set bib_number = v_bib
      where pr.id = v_effect.participant_id;
    end if;
    if v_effect.apply_wave then
      update public.participant_races pr
      set start_wave_id = v_effect.wave_id,
        declared_wave_name = case when v_effect.wave_id is null then left(v_wave, 120) end
      where pr.id = v_effect.participant_id;
    end if;

    if v_effect.kept then
      v_kept := v_kept + 1;
    end if;

    if v_effect.effect = 'updated' then
      update public.participant_import_rows r
      set status = 'imported', participant_race_id = v_effect.participant_id,
        error_message = case when v_effect.kept then 'Correction à la main gardée.' end
      where r.id = v_row.id;
      v_updated := v_updated + 1;
    else
      update public.participant_import_rows r
      set status = 'skipped', participant_race_id = v_effect.participant_id,
        error_message = case when v_effect.kept then 'Correction à la main gardée.' else 'Déjà dans la liste.' end
      where r.id = v_row.id;
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- Les données de la ligne ont rejoint leur place : elles ne restent pas ici.
  update public.participant_import_rows r
  set raw_data = '{}'::jsonb, mapped_data = '{}'::jsonb
  where r.import_id = p_import_id;

  update public.participant_imports i set status = 'imported' where i.id = p_import_id;

  perform private.record_audit(
    'participant_import.commit', 'participant_imports', p_import_id,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped,
      'kept', v_kept, 'withdrawn', v_withdrawn)
  );

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped,
    'kept', v_kept, 'withdrawn', v_withdrawn);
end;
$$;

/*
 * L'état d'un import pour son assistant. Effets et vagues inconnues se calculent
 * avec la fonction de l'import : ce que l'organisation lit est ce qui se passera.
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

  return (
    with planned as materialized (
      select race.id as race_id, race.name as race_name, r.mapped_data ->> 'wave' as wave, e.*
      from public.participant_import_rows r
      join public.races race
        on race.id::text = r.mapped_data ->> 'raceId' and race.edition_id = v_import.edition_id
      cross join lateral private.participant_import_effect(
        race.id, r.mapped_data ->> 'email',
        nullif(r.mapped_data ->> 'bib', ''), nullif(r.mapped_data ->> 'wave', '')
      ) e
      where r.import_id = p_import_id and r.status = 'valid'
    ), unknown as (
      select p.race_name, min(p.wave) as wave, count(*)::integer as n
      from planned p
      where nullif(p.wave, '') is not null
        and p.wave_id is null
        and (p.effect = 'new' or p.apply_wave)
      group by p.race_id, p.race_name, lower(p.wave)
    ), shown as (
      -- Une colonne mal choisie donnerait une vague par ligne : l'écran en montre 20.
      select u.race_name, u.wave, u.n from unknown u order by u.race_name, lower(u.wave) limit 20
    )
    select jsonb_build_object(
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
          order by r.status = 'error' desc, r.row_number limit 100
        ) e
      ), '[]'::jsonb),
      'effects', jsonb_build_object(
        'created', (select count(*)::integer from planned p where p.effect = 'new'),
        'updated', (select count(*)::integer from planned p where p.effect = 'updated'),
        'unchanged', (select count(*)::integer from planned p where p.effect = 'unchanged'),
        'kept', (select count(*)::integer from planned p where p.kept),
        'withdrawn', (select count(*)::integer from planned p where p.effect = 'withdrawn')
      ),
      'unknownWaves', jsonb_build_object(
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

/* La liste : les présents d'un côté, les retirés de l'autre, hors des comptes. */
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

  return (
    with edition_participants as (
      select pr.id, pr.first_name_snapshot, pr.last_name_snapshot, pr.invite_email, pr.bib_number,
        pr.declared_wave_name, pr.user_id, r.name as race_name, w.name as wave_name,
        pr.bib_number is not null
          and count(*) over (partition by pr.race_id, pr.bib_number) > 1 as bib_conflict
      from public.participant_races pr
      join public.races r on r.id = pr.race_id
      left join public.race_start_waves w on w.id = pr.start_wave_id
      where r.edition_id = p_edition_id and pr.status <> 'archived'
    ), listed as (
      select lower(coalesce(e.last_name_snapshot, '') || ' ' || coalesce(e.first_name_snapshot, '')) as sort_name,
        e.bib_conflict as to_check,
        jsonb_build_object(
          'id', e.id,
          'firstName', e.first_name_snapshot,
          'lastName', e.last_name_snapshot,
          'email', case when v_can_see_contact then e.invite_email::text end,
          'bib', e.bib_number,
          'raceName', e.race_name,
          'waveName', e.wave_name,
          'declaredWaveName', e.declared_wave_name,
          'bibConflict', e.bib_conflict,
          'activated', e.user_id is not null
        ) as payload
      from edition_participants e
      order by e.bib_conflict desc,
        lower(coalesce(e.last_name_snapshot, '')), lower(coalesce(e.first_name_snapshot, ''))
      limit least(greatest(p_limit, 1), 2000)
    )
    select jsonb_build_object(
      'total', (select count(*)::integer from edition_participants),
      'toCheck', jsonb_build_object(
        'bibs', (select count(*)::integer from edition_participants e where e.bib_conflict)
      ),
      'pendingWaves', (select count(*)::integer from edition_participants e where e.declared_wave_name is not null),
      'participants', coalesce((
        select jsonb_agg(l.payload order by l.to_check desc, l.sort_name) from listed l
      ), '[]'::jsonb),
      'withdrawn', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'firstName', t.first_name_snapshot, 'lastName', t.last_name_snapshot,
          'bib', t.bib_number, 'raceName', t.race_name
        ) order by lower(coalesce(t.last_name_snapshot, '')))
        from (
          select pr.id, pr.first_name_snapshot, pr.last_name_snapshot, pr.bib_number, r.name as race_name
          from public.participant_races pr
          join public.races r on r.id = pr.race_id
          where r.edition_id = p_edition_id and pr.status = 'archived' and pr.user_id is null
          order by lower(coalesce(pr.last_name_snapshot, ''))
          limit 500
        ) t
      ), '[]'::jsonb)
    )
  );
end;
$$;

/*
 * Corriger à la main. Vider un champ n'est pas une correction : il redevient à
 * la main du prochain fichier, le dossard attendu pouvant arriver plus tard.
 */
create function public.correct_participant_registration(
  p_participant_race_id uuid,
  p_bib text,
  p_wave text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_race_id uuid;
  v_status public.participant_race_status;
  v_current_bib text;
  v_current_wave text;
  v_bib text := nullif(btrim(p_bib), '');
  v_wave text := nullif(btrim(p_wave), '');
  v_wave_id uuid;
begin
  select r.edition_id, pr.race_id, pr.status, pr.bib_number, coalesce(w.name, pr.declared_wave_name)
  into v_edition_id, v_race_id, v_status, v_current_bib, v_current_wave
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  left join public.race_start_waves w on w.id = pr.start_wave_id
  where pr.id = p_participant_race_id
  for update of pr;

  if not found then
    raise exception 'participant introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_edition_id);

  if v_status = 'archived' then
    raise exception 'participant retiré' using errcode = '55000';
  end if;
  if char_length(v_bib) > 30 or char_length(v_wave) > 120 then
    raise exception 'valeur trop longue' using errcode = '22023';
  end if;

  if v_bib is distinct from v_current_bib then
    update public.participant_races pr
    set bib_number = v_bib, bib_set_manually = v_bib is not null
    where pr.id = p_participant_race_id;
  end if;

  if lower(v_wave) is distinct from lower(v_current_wave) then
    select w.id into v_wave_id from public.race_start_waves w
    where w.race_id = v_race_id and lower(w.name) = lower(v_wave)
    order by w.sort_order limit 1;

    update public.participant_races pr
    set start_wave_id = v_wave_id,
      declared_wave_name = case when v_wave_id is null then v_wave end,
      wave_set_manually = v_wave is not null
    where pr.id = p_participant_race_id;
  end if;

  -- Aucune valeur au journal : l'action et l'identifiant suffisent (AGENTS §62).
  perform private.record_audit(
    'participant.correct', 'participant_races', p_participant_race_id, '{}'::jsonb
  );
end;
$$;

/* Retirer ou rétablir : un statut qui garde la trace, jamais un effacement. */
create function public.set_participant_withdrawn(
  p_participant_race_id uuid,
  p_withdrawn boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_status public.participant_race_status;
  v_user_id uuid;
begin
  select r.edition_id, pr.status, pr.user_id into v_edition_id, v_status, v_user_id
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  where pr.id = p_participant_race_id
  for update of pr;

  if not found then
    raise exception 'participant introuvable' using errcode = 'P0002';
  end if;
  perform private.assert_can_import_participants(v_edition_id);

  if v_user_id is not null then
    raise exception 'participant rattaché à un compte' using errcode = '55000';
  end if;
  if v_status <> (case when p_withdrawn then 'active' else 'archived' end)::public.participant_race_status then
    raise exception 'statut incompatible' using errcode = '55000';
  end if;

  update public.participant_races pr
  set status = (case when p_withdrawn then 'archived' else 'active' end)::public.participant_race_status
  where pr.id = p_participant_race_id;

  perform private.record_audit(
    case when p_withdrawn then 'participant.withdraw' else 'participant.restore' end,
    'participant_races', p_participant_race_id, '{}'::jsonb
  );
end;
$$;

revoke all on function public.correct_participant_registration(uuid, text, text) from public, anon;
revoke all on function public.set_participant_withdrawn(uuid, boolean) from public, anon;
grant execute on function public.correct_participant_registration(uuid, text, text) to authenticated;
grant execute on function public.set_participant_withdrawn(uuid, boolean) to authenticated;

commit;
