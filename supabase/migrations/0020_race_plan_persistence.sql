-- PLUKA V1 — Persistance du Plan de course
-- File target: supabase/migrations/0020_race_plan_persistence.sql
-- Référence : docs/engines/PLAN_ENGINE.md §8.1, §12, §21.6, §36, §37, §38, §39 ·
--             docs/02_DATA_MODEL.md §11 · docs/01_ARCHITECTURE.md §31 ·
--             docs/03_PRIVACY_RLS.md §31, §33
--
-- POURQUOI UNE FONCTION SQL
--
-- Confirmer un Plan écrit cinq tables et en archive une sixième ligne :
-- superseder la version active, créer la nouvelle, ses waypoints, ses segments,
-- ses marges de barrière et ses dépendances de faits. §37 énumère ces étapes
-- comme un tout, et 01_ARCHITECTURE §31 rappelle que PostgREST n'exécute qu'une
-- instruction par appel. Les découper laisserait des Plans sans waypoints, ou
-- deux versions actives sur la même participation.
--
-- CE QUE LA FONCTION NE FAIT PAS
--
-- Elle ne calcule rien. §38 : « le moteur pur ne connaît pas ces tables », et
-- la réciproque tient aussi — la base ne rejoue pas le solveur. Elle reçoit un
-- résultat déjà calculé et le range.
--
-- DEUX MANQUES DU MODÈLE, COMBLÉS ICI
--
-- 1. `race_course_micro_segments` : §8.1, étape 11, demande de « persister /
--    cacher le résultat prétraité avec sa version de processeur ». Sans cette
--    table, le moteur devrait reconstruire les micro-segments à chaque
--    recalcul, ce que §8 et §62 refusent explicitement.
--
-- 2. `plan_waypoints.stop_origin` : le moteur distingue l'arrêt que PLUKA
--    propose de celui que le coureur impose (§21.6, « restauration du stop de
--    référence »). Sans la colonne, un rechargement perdrait la distinction et
--    le mode dérive se comporterait comme un rééquilibrage.
--
-- 3. `race_cutoffs.basis` : §25 exige que « chaque cutoff précise son basis »,
--    `arrival` ou `departure`. `cutoff_type` dit `hard` / `soft`, ce qui est
--    une autre question. Sans la colonne, une barrière posée à la sortie d'un
--    ravito serait comparée à l'arrivée seule, et offrirait au coureur la durée
--    de son arrêt en marge fictive.

begin;

-- ============================================================
-- 01. Origine d'un arrêt
-- ============================================================

create type public.plan_stop_origin as enum ('default', 'manual');

alter table public.plan_waypoints
  add column stop_origin public.plan_stop_origin not null default 'default';

comment on column public.plan_waypoints.stop_origin is
  'Arrêt proposé par PLUKA ou imposé par le coureur (PLAN_ENGINE §21.6). La proposition de référence ne compte que les « default » ; un « manual » est une contrainte, au même titre qu''un override.';

-- ============================================================
-- 01 bis. Référence temporelle d'une barrière
-- ============================================================
-- §25 : « planned_reference = arrival_time si basis = arrival, departure_time
-- si basis = departure ». Le défaut est `arrival`, qui est le comportement
-- implicite d'avant cette migration : aucune barrière existante ne change de
-- sens.

create type public.cutoff_basis as enum ('arrival', 'departure');

alter table public.race_cutoffs
  add column basis public.cutoff_basis not null default 'arrival';

comment on column public.race_cutoffs.basis is
  'Instant auquel la barrière se compare (PLAN_ENGINE §25). `departure` vaut arrivée + arrêt : une barrière de sortie de ravito ne se compare pas à l''arrivée seule.';

-- ============================================================
-- 02. Micro-segments prétraités
-- ============================================================
-- §8.1, étapes 5 à 9 : ré-échantillonnage, micro-segments d'environ 100 m,
-- coupure forcée aux waypoints. Le résultat appartient à une version de
-- géométrie et à une version de processeur : deux prétraitements différents du
-- même parcours restent distincts et comparables.

create table public.race_course_micro_segments (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  course_geometry_id uuid not null references public.race_course_geometries(id) on delete cascade,
  race_segment_id uuid not null references public.race_segments(id) on delete cascade,
  sort_order integer not null check (sort_order >= 0),
  distance_m numeric(10,3) not null check (distance_m > 0),
  elevation_delta_m numeric(9,3) not null,
  elevation_gain_m numeric(9,3) not null check (elevation_gain_m >= 0),
  elevation_loss_m numeric(9,3) not null check (elevation_loss_m >= 0),
  raw_grade numeric(8,6) not null,
  model_grade numeric(8,6) not null check (model_grade between -0.4 and 0.4),
  progress numeric(9,8) not null check (progress >= 0 and progress <= 1),
  technicality text check (
    technicality is null
    or technicality in ('smooth', 'standard', 'technical', 'very_technical')
  ),
  preprocessing_version text not null check (preprocessing_version <> ''),
  created_at timestamptz not null default now(),
  unique (course_geometry_id, sort_order)
);

create index ix_micro_segments_geometry
  on public.race_course_micro_segments (course_geometry_id, sort_order);
create index ix_micro_segments_race_segment
  on public.race_course_micro_segments (race_segment_id);

comment on column public.race_course_micro_segments.model_grade is
  'Pente bornée à ±40 % (PLAN_ENGINE §11.2). `raw_grade` conserve la pente réelle : le modèle est capé, la donnée ne l''est pas.';

comment on column public.race_course_micro_segments.technicality is
  'Classes de PLAN_ENGINE §12. Nulle tant qu''aucune correspondance validée ne relie `race_segments.technicality_level` (1 à 5) à ces quatre classes — §12.1 : « le moteur n''invente pas une technicité ».';

alter table public.race_course_micro_segments enable row level security;

grant select on public.race_course_micro_segments to anon, authenticated;

-- §18 de 03_PRIVACY_RLS : la lecture d'une table de référentiel remonte
-- toujours jusqu'à `races`. Même règle que `race_segments`, à la lettre.
create policy race_course_micro_segments__select__race_readable
  on public.race_course_micro_segments
  for select to anon, authenticated
  using (private.user_can_read_race(race_id));

comment on policy race_course_micro_segments__select__race_readable
  on public.race_course_micro_segments is
  'Suit la visibilité de la Race, comme race_segments. Aucun verbe d''écriture n''est accordé : le prétraitement est un traitement serveur (§8).';

-- ============================================================
-- 03. Confirmation d'un Plan
-- ============================================================
-- §37 : « à confirmation utilisateur — autorisation vérifiée, input canonique
-- reconstruit serveur, calcul définitif serveur, nouvelle version persistée,
-- ancienne version archivée, dépendances de faits persistées. »

create or replace function private.persist_race_plan(
  p_participant_race_id uuid,
  p_actor_user_id uuid,
  p_summary jsonb,
  p_waypoints jsonb,
  p_segments jsonb,
  p_cutoff_statuses jsonb,
  p_dependencies jsonb
)
returns table (race_plan_id uuid, version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := (select auth.uid());
  v_owner uuid;
  v_version integer;
  v_plan_id uuid;
begin
  -- 03_PRIVACY_RLS §11 : l'identité vient du claim, jamais d'un paramètre. Un
  -- traitement serveur légitime agit sans session — `auth.uid()` y est nul — et
  -- reste responsable de ses propres vérifications (§8).
  if v_session is not null and v_session <> p_actor_user_id then
    raise exception 'plan actor mismatch' using errcode = '42501';
  end if;

  select pr.user_id into v_owner
  from public.participant_races pr
  where pr.id = p_participant_race_id;

  -- AGENTS §26 : `service_role` contourne la RLS, pas la règle métier. La
  -- propriété est donc revérifiée ici, quel que soit l'appelant.
  if v_owner is null or v_owner <> p_actor_user_id then
    raise exception 'plan participation not owned by actor' using errcode = '42501';
  end if;

  -- §36 : « le modèle canonique persiste plusieurs race_plans pour une
  -- participation. Une seule version est active. » L'ancienne est archivée
  -- avant l'insertion, sinon `ux_active_race_plan` refuserait la nouvelle.
  update public.race_plans
  set status = 'superseded'
  where participant_race_id = p_participant_race_id and status = 'active';

  select coalesce(max(rp.version), 0) + 1 into v_version
  from public.race_plans rp
  where rp.participant_race_id = p_participant_race_id;

  insert into public.race_plans (
    participant_race_id, version, status, engine_version,
    initial_target_duration_seconds, target_duration_seconds,
    planned_finish_datetime, input_snapshot, input_hash
  )
  values (
    p_participant_race_id,
    v_version,
    'active',
    p_summary ->> 'engine_version',
    (p_summary ->> 'initial_target_duration_seconds')::integer,
    (p_summary ->> 'target_duration_seconds')::integer,
    (p_summary ->> 'planned_finish_datetime')::timestamptz,
    coalesce(p_summary -> 'input_snapshot', '{}'::jsonb),
    p_summary ->> 'input_hash'
  )
  returning id into v_plan_id;

  insert into public.plan_waypoints (
    race_plan_id, race_waypoint_id, planned_elapsed_seconds, planned_arrival_at,
    stop_duration_seconds, stop_origin, is_locked, locked_elapsed_seconds, sort_order
  )
  select
    v_plan_id,
    (entry ->> 'race_waypoint_id')::uuid,
    (entry ->> 'planned_elapsed_seconds')::integer,
    (entry ->> 'planned_arrival_at')::timestamptz,
    (entry ->> 'stop_duration_seconds')::integer,
    (entry ->> 'stop_origin')::public.plan_stop_origin,
    (entry ->> 'is_locked')::boolean,
    nullif(entry ->> 'locked_elapsed_seconds', '')::integer,
    (entry ->> 'sort_order')::smallint
  from jsonb_array_elements(p_waypoints) as entry;

  insert into public.plan_segments (
    race_plan_id, race_segment_id, initial_duration_seconds,
    planned_duration_seconds, manual_override, sort_order
  )
  select
    v_plan_id,
    (entry ->> 'race_segment_id')::uuid,
    (entry ->> 'initial_duration_seconds')::integer,
    (entry ->> 'planned_duration_seconds')::integer,
    (entry ->> 'manual_override')::boolean,
    (entry ->> 'sort_order')::smallint
  from jsonb_array_elements(p_segments) as entry;

  -- §38.4 : les marges appartiennent au Plan. Le `plan_waypoint_id` est résolu
  -- ici plutôt que transmis : il vient d'être créé, l'appelant ne le connaît
  -- pas.
  insert into public.plan_cutoff_statuses (
    race_plan_id, race_cutoff_id, plan_waypoint_id, margin_seconds, status
  )
  select
    v_plan_id,
    (entry ->> 'race_cutoff_id')::uuid,
    pw.id,
    (entry ->> 'margin_seconds')::integer,
    (entry ->> 'status')::public.cutoff_margin_status
  from jsonb_array_elements(p_cutoff_statuses) as entry
  join public.plan_waypoints pw
    on pw.race_plan_id = v_plan_id
   and pw.race_waypoint_id = (entry ->> 'race_waypoint_id')::uuid;

  -- §38.5 : « le service de domaine rattache au Plan les versions exactes des
  -- RaceFacts dont l'entrée dépend. Le moteur ne choisit pas les sources. »
  -- C'est ce que l'Impact Analyzer relit pour savoir quels Plans un changement
  -- officiel concerne (§39, migration 0016).
  insert into public.plan_version_dependencies (
    race_plan_id, race_fact_version_id, dependency_type, dependency_key
  )
  select distinct
    v_plan_id,
    (entry ->> 'race_fact_version_id')::uuid,
    (entry ->> 'dependency_type')::public.plan_dependency_type,
    nullif(entry ->> 'dependency_key', '')
  from jsonb_array_elements(p_dependencies) as entry
  on conflict do nothing;

  return query select v_plan_id, v_version;
end;
$$;

create or replace function public.persist_race_plan(
  p_participant_race_id uuid,
  p_actor_user_id uuid,
  p_summary jsonb,
  p_waypoints jsonb,
  p_segments jsonb,
  p_cutoff_statuses jsonb,
  p_dependencies jsonb
)
returns table (race_plan_id uuid, version integer)
language sql
security definer
set search_path = ''
as $$
  select * from private.persist_race_plan(
    p_participant_race_id, p_actor_user_id, p_summary, p_waypoints,
    p_segments, p_cutoff_statuses, p_dependencies);
$$;

-- ============================================================
-- 04. Dépendances de faits d'une course
-- ============================================================
-- §38.5 : le domaine rattache « les versions exactes des RaceFacts dont
-- l'entrée dépend ». Les barrières et les waypoints portent un `fact_id` ; la
-- version courante de ce fact est celle dont le Plan dépendra.
--
-- Une fonction plutôt qu'une jointure PostgREST : `race_waypoints.fact_id` n'a
-- pas de contrainte de clé étrangère, donc aucune relation à embarquer.

create or replace function public.list_plan_fact_dependencies(p_race_id uuid)
returns table (
  race_fact_version_id uuid,
  dependency_type public.plan_dependency_type,
  dependency_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct f.current_version_id, 'cutoff'::public.plan_dependency_type, f.fact_key
  from public.race_cutoffs c
  join public.race_facts f on f.id = c.fact_id
  where c.race_id = p_race_id and f.current_version_id is not null

  union

  select distinct f.current_version_id, 'waypoint'::public.plan_dependency_type, f.fact_key
  from public.race_waypoints w
  join public.race_facts f on f.id = w.fact_id
  where w.race_id = p_race_id and f.current_version_id is not null;
$$;

-- ============================================================
-- 05. Surface applicative
-- ============================================================
-- Accordées à `authenticated` : ce sont des actes du coureur sur sa propre
-- participation, et la fonction revérifie la propriété. `service_role` les
-- atteint de toute façon, et reste tenu par la même vérification.

do $do$
declare
  f text;
  signatures text[] := array[
    'public.persist_race_plan(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)',
    'public.list_plan_fact_dependencies(uuid)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$do$;

revoke all on all functions in schema private from anon, authenticated;

commit;
