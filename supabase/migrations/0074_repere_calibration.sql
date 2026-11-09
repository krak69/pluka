-- PLUKA V1 — Repère PLUKA : les couples de calibrage
-- File target: supabase/migrations/0074_repere_calibration.sql
-- Référence : docs/engines/REPERE_PLUKA.md §5, §6
--
-- POURQUOI
--
-- Le Repère V0 n'est pas calibré. Il faut des couples : un effort de référence,
-- puis le temps réellement couru sur une course plus tard. Deux sources :
--
-- - le coureur les donne lui-même, depuis ses courses passées : « deux courses
--   que tu as faites ». C'est ce qui permet de calibrer sans attendre une
--   saison ;
-- - un Repère affiché (0070) suivi d'un temps d'arrivée déclaré après course.
--
-- CONFIDENTIALITÉ
--
-- Les couples sont au coureur : lui seul les lit, les ajoute, les supprime.
-- Le rapport de calibrage reçoit des échantillons **sans identité** — ni
-- compte, ni course, ni date absolue — et n'en affiche que des agrégats. Jamais
-- l'organisation (AGENTS §19).

begin;

create table public.repere_calibration_pairs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  reference_distance_km numeric(7,2) not null check (reference_distance_km > 0),
  reference_elevation_gain_m integer not null check (reference_elevation_gain_m >= 0),
  reference_duration_seconds integer not null check (reference_duration_seconds > 0),
  reference_date date not null,
  course_distance_km numeric(7,2) not null check (course_distance_km > 0),
  course_elevation_gain_m integer not null check (course_elevation_gain_m >= 0),
  course_duration_seconds integer not null check (course_duration_seconds > 0),
  course_date date not null,
  created_at timestamptz not null default now(),
  -- La référence précède la course : c'est elle qui aurait servi à viser.
  check (reference_date <= course_date)
);

create index ix_repere_calibration_pairs_user
  on public.repere_calibration_pairs(user_id, created_at desc);

alter table public.repere_calibration_pairs enable row level security;
revoke all on public.repere_calibration_pairs from public, anon, authenticated;
grant select, insert, delete on public.repere_calibration_pairs to authenticated;

create policy repere_calibration_pairs__select__owner on public.repere_calibration_pairs
  for select to authenticated using (user_id = (select auth.uid()));
create policy repere_calibration_pairs__insert__owner on public.repere_calibration_pairs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy repere_calibration_pairs__delete__owner on public.repere_calibration_pairs
  for delete to authenticated using (user_id = (select auth.uid()));

comment on table public.repere_calibration_pairs is
  'Couples (effort de référence, course courue ensuite) donnés par le coureur pour calibrer le Repère (0074). Au coureur seul.';

/*
 * Échantillons anonymes pour le rapport de calibrage : ni compte, ni course,
 * ni date absolue — l'écart en mois entre la référence et la course suffit au
 * moteur. Réservé à un `pluka_admin`.
 */
create function public.admin_repere_calibration_samples()
returns table (
  source text,
  reference_distance_km numeric,
  reference_elevation_gain_m integer,
  reference_duration_seconds integer,
  months_before integer,
  course_distance_km numeric,
  course_elevation_gain_m integer,
  actual_duration_seconds integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_repere_calibration_samples');

  return query
  select
    'declared'::text,
    p.reference_distance_km,
    p.reference_elevation_gain_m,
    p.reference_duration_seconds,
    ((extract(year from age(p.course_date, p.reference_date)) * 12)
      + extract(month from age(p.course_date, p.reference_date)))::integer,
    p.course_distance_km,
    p.course_elevation_gain_m,
    p.course_duration_seconds
  from public.repere_calibration_pairs p
  union all
  -- Le dernier Repère d'une participation tiré d'une sortie, suivi d'une arrivée.
  select
    'estimate'::text,
    (e.input -> 'reference' ->> 'distanceKm')::numeric,
    (e.input -> 'reference' ->> 'elevationGainM')::integer,
    (e.input -> 'reference' ->> 'durationSeconds')::integer,
    case
      when e.input -> 'reference' ->> 'date' is null then 0
      else ((extract(year from age(r.start_datetime::date, (e.input -> 'reference' ->> 'date')::date)) * 12)
        + extract(month from age(r.start_datetime::date, (e.input -> 'reference' ->> 'date')::date)))::integer
    end,
    (e.input -> 'course' ->> 'distanceKm')::numeric,
    (e.input -> 'course' ->> 'elevationGainM')::integer,
    v.actual_duration_seconds
  from (
    select distinct on (re.participant_race_id) re.*
    from public.repere_estimates re
    where re.reference_kind = 'effort' and re.outcome = 'range'
    order by re.participant_race_id, re.created_at desc
  ) e
  join public.post_race_reviews v on v.participant_race_id = e.participant_race_id
  join public.participant_races pr on pr.id = e.participant_race_id
  join public.races r on r.id = pr.race_id
  where v.result_status = 'finisher' and v.actual_duration_seconds is not null;
end;
$$;

revoke all on function public.admin_repere_calibration_samples() from public, anon;
grant execute on function public.admin_repere_calibration_samples() to authenticated;

commit;
