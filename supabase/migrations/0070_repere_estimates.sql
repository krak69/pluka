-- PLUKA V1 — Repère PLUKA : les estimations affichées
-- File target: supabase/migrations/0070_repere_estimates.sql
-- Référence : docs/engines/REPERE_PLUKA.md §5, §6 · docs/03_PRIVACY_RLS.md
--
-- POURQUOI
--
-- Le Repère V0 n'est pas calibré. Pour le calibrer, chaque plage affichée est
-- gardée avec ses entrées et sa version : le temps réel déclaré après la course
-- (`post_race_reviews.actual_duration_seconds`) dira si elle visait juste.
--
-- CONFIDENTIALITÉ
--
-- Une donnée de préparation du coureur : lui seul la lit et l'écrit. Aucune
-- policy pour l'organisation, même avec Organizer Included (AGENTS §19). Une
-- estimation ne se modifie pas : une nouvelle demande écrit une nouvelle ligne.

begin;

create table public.repere_estimates (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  config_version text not null,
  reference_kind text not null check (reference_kind in ('effort', 'pace')),
  -- Les entrées telles que le moteur les a lues : référence et course visée.
  input jsonb not null,
  outcome text not null check (outcome in (
    'range', 'course_elevation_unknown', 'reference_too_short', 'too_far',
    'reference_too_old', 'implausible_reference'
  )),
  low_seconds integer check (low_seconds is null or low_seconds > 0),
  central_seconds integer check (central_seconds is null or central_seconds > 0),
  high_seconds integer check (high_seconds is null or high_seconds > 0),
  created_at timestamptz not null default now(),
  check (
    (outcome = 'range' and low_seconds < high_seconds
      and central_seconds between low_seconds and high_seconds)
    or (outcome <> 'range' and low_seconds is null and central_seconds is null
      and high_seconds is null)
  )
);

create index ix_repere_estimates_participant
  on public.repere_estimates(participant_race_id, created_at desc);

alter table public.repere_estimates enable row level security;
revoke all on public.repere_estimates from public, anon, authenticated;
grant select, insert on public.repere_estimates to authenticated;

create policy repere_estimates__select__owner on public.repere_estimates
  for select to authenticated
  using (private.user_owns_participant_race(participant_race_id));

create policy repere_estimates__insert__owner on public.repere_estimates
  for insert to authenticated
  with check (private.user_owns_participant_race(participant_race_id));

comment on table public.repere_estimates is
  'Repères PLUKA affichés au coureur, pour le calibrage (REPERE_PLUKA §5). Lecture et écriture par le coureur seul ; jamais l''organisation.';

commit;
