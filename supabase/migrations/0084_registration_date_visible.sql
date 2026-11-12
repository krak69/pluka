-- PLUKA V1 — La date d'inscription, visible
-- File target: supabase/migrations/0084_registration_date_visible.sql
-- Référence : docs/00_PRODUCT_SPEC.md §6.5.3 · docs/03_PRIVACY_RLS.md §104 · 0083
--
-- POURQUOI
--
-- La date d'inscription décide du tarif early bird. L'organisation doit voir
-- celle qu'elle a transmise, et le support PLUKA celle qui s'applique à un
-- coureur (décision du 2026-11-12).
--
-- Chaque ligne porte la date de référence et son origine, calculées ici une
-- seule fois : `verified` quand un import l'a apportée (`registered_on`),
-- `declared` sinon, le jour de création de la participation lu dans le fuseau
-- de l'épreuve. Ce que l'écran affiche est ce que le tarif utilisera.
--
-- Une lecture nominative par un admin PLUKA s'inscrit au journal d'audit
-- (§104). La liste cesse donc d'être `stable` : elle peut écrire ce journal.

begin;

create or replace function private.registration_reference(p_registered_on date, p_created_at timestamptz, p_timezone text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when p_registered_on is not null
      then jsonb_build_object('day', p_registered_on, 'origin', 'verified')
    else jsonb_build_object('day', (p_created_at at time zone p_timezone)::date, 'origin', 'declared')
  end
$$;

revoke all on function private.registration_reference(date, timestamptz, text)
  from public, anon, authenticated;

create or replace function public.list_edition_participants(p_edition_id uuid, p_limit integer default 500)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_can_see_contact boolean;
  v_member boolean;
begin
  v_member := private.user_can_manage_edition(p_edition_id, 'viewer');
  if not (v_member or private.is_pluka_admin()) then
    raise exception 'liste réservée à l''organisation de la course' using errcode = '42501';
  end if;

  -- Le support lit une liste nominative : la lecture laisse une trace (§104).
  if not v_member then
    perform private.record_audit('edition_participants.read', 'editions', p_edition_id);
  end if;

  v_can_see_contact := private.user_can_manage_edition(p_edition_id, 'admin') or private.is_pluka_admin();

  return (
    with edition_participants as (
      select pr.id, pr.race_id, pr.first_name_snapshot, pr.last_name_snapshot, pr.invite_email,
        pr.bib_number, pr.declared_wave_name, pr.user_id, r.name as race_name, w.name as wave_name,
        private.registration_reference(pr.registered_on, pr.created_at, r.timezone) as registration,
        pr.bib_number is not null
          and count(*) over (partition by pr.race_id, pr.bib_number) > 1 as bib_conflict
      from public.participant_races pr
      join public.races r on r.id = pr.race_id
      left join public.race_start_waves w on w.id = pr.start_wave_id
      where r.edition_id = p_edition_id and pr.status <> 'archived'
    ), wave_choices as (
      select c.race_id, c.name, bool_or(c.official) as official, min(c.sort_order) as sort_order
      from (
        select w.race_id, w.name, true as official, w.sort_order
        from public.race_start_waves w
        join public.races r on r.id = w.race_id
        where r.edition_id = p_edition_id
        union all
        select e.race_id, e.declared_wave_name, false, null
        from edition_participants e
        where e.declared_wave_name is not null
      ) c
      group by c.race_id, c.name
    ), wave_options as (
      -- Une colonne mal choisie donnerait une vague par ligne : chaque liste s'arrête à 50.
      select o.race_id, o.name, o.official,
        row_number() over (
          partition by o.race_id order by o.official desc, o.sort_order, lower(o.name)
        ) as position
      from wave_choices o
    ), listed as (
      select lower(coalesce(e.last_name_snapshot, '') || ' ' || coalesce(e.first_name_snapshot, '')) as sort_name,
        e.bib_conflict as to_check,
        jsonb_build_object(
          'id', e.id,
          'raceId', e.race_id,
          'firstName', e.first_name_snapshot,
          'lastName', e.last_name_snapshot,
          'email', case when v_can_see_contact then e.invite_email::text end,
          'bib', e.bib_number,
          'raceName', e.race_name,
          'waveName', e.wave_name,
          'declaredWaveName', e.declared_wave_name,
          'bibConflict', e.bib_conflict,
          'activated', e.user_id is not null,
          'registration', e.registration
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
      'waveOptions', coalesce((
        select jsonb_agg(jsonb_build_object('raceId', o.race_id, 'name', o.name, 'official', o.official)
                         order by o.race_id, o.position)
        from wave_options o
        where o.position <= 50
      ), '[]'::jsonb),
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
 * Les courses d'un coureur, pour le support : où il est inscrit, depuis
 * quand, et sur quelle base le tarif early bird se calcule. Rien de sa
 * préparation (§104) : ni Plan, ni objectif, ni Nutrition.
 */
create function public.admin_list_user_participations(p_user_id uuid)
returns table (
  participant_race_id uuid,
  event_name text,
  edition_year integer,
  race_name text,
  race_start timestamptz,
  race_timezone text,
  registration jsonb,
  registration_source text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_pluka_admin('admin_list_user_participations');
  perform private.record_audit('user_participations.read', 'users', p_user_id);

  return query
  select pr.id, ev.name, ed.year::integer, r.name, r.start_datetime, r.timezone::text,
    private.registration_reference(pr.registered_on, pr.created_at, r.timezone),
    pr.registration_source::text, pr.status::text
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events ev on ev.id = ed.event_id
  where pr.user_id = p_user_id
  order by r.start_datetime desc;
end;
$$;

revoke all on function public.admin_list_user_participations(uuid) from public, anon;
grant execute on function public.admin_list_user_participations(uuid) to authenticated;

comment on function public.admin_list_user_participations(uuid) is
  'Courses d''un utilisateur et date d''inscription de référence, pour le support. Aucune donnée de préparation. Écrit dans le journal d''audit (§104).';

commit;
