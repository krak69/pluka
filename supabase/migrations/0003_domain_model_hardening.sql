-- PLUKA — Domain model hardening after engine specifications
-- Migration: 0002_domain_model_hardening.sql
-- Date: 2026-09-04
--
-- This migration intentionally extends the initial schema instead of rewriting
-- 0001_initial_schema.sql. It aligns persistence with the frozen V1 specs for:
-- - Sources & Extraction
-- - Nutrition
-- - Weather Conditions
-- - Race Intelligence
-- - Entitlements / billing audit
--
-- Privacy/RLS policies remain in the subsequent dedicated migration.

begin;

-- ============================================================
-- 01. Enum extensions and new domain enums
-- ============================================================

-- Existing values remain valid for backward compatibility. New writes should
-- use the canonical sources defined by docs/04_ENTITLEMENTS.md.
alter type public.entitlement_source add value if not exists 'purchase';
alter type public.entitlement_source add value if not exists 'subscription';
alter type public.entitlement_source add value if not exists 'beta';
alter type public.entitlement_source add value if not exists 'support';
alter type public.entitlement_source add value if not exists 'migration';
alter type public.entitlement_source add value if not exists 'promotion';

alter type public.entitlement_status add value if not exists 'pending';

create type public.entitlement_scope_type as enum ('global', 'participant_race');
create type public.purchase_status as enum ('pending', 'paid', 'refunded', 'failed', 'cancelled');
create type public.nutrition_waypoint_origin as enum ('plan_waypoint', 'outing_waypoint', 'generated_checkpoint', 'manual');
create type public.nutrition_recalculation_status as enum ('proposed', 'applied', 'rejected');
create type public.weather_run_completeness as enum ('unknown', 'complete', 'partial');

-- ============================================================
-- 02. Sources & Extraction hardening
-- ============================================================

-- Immutable capture metadata known at snapshot creation time. Parser/chunker
-- versions remain in the private processing layer so snapshots stay immutable.
alter table public.source_snapshots
  add column content_type text,
  add column size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  add column final_url text,
  add column http_status smallint check (http_status is null or http_status between 100 and 599);

alter table public.fact_sources
  add column locator jsonb not null default '{}'::jsonb;

-- A snapshot can be parsed again by a newer parser. Blocks are therefore tied
-- to a concrete extraction run instead of directly being a single mutable set.
create table private.source_blocks (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  extraction_run_id uuid not null references private.extraction_runs(id) on delete cascade,
  block_index integer not null check (block_index >= 0),
  page_number integer check (page_number is null or page_number > 0),
  section_path jsonb not null default '[]'::jsonb,
  heading text,
  block_type text not null check (block_type in ('heading','paragraph','list','table','caption','other')),
  content text not null,
  locator jsonb not null default '{}'::jsonb,
  content_hash char(64) not null,
  created_at timestamptz not null default now(),
  unique (extraction_run_id, block_index)
);

-- Existing chunks were unique only by snapshot/index, which prevents a newer
-- parser/chunker from producing a second immutable chunk set for the same
-- snapshot. Keep legacy rows valid and scope new chunk sets to their parse run.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'private.source_chunks'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) like '%source_snapshot_id%'
      and pg_get_constraintdef(c.oid) like '%chunk_index%'
  loop
    execute format('alter table private.source_chunks drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table private.source_chunks
  add column parse_run_id uuid references private.extraction_runs(id) on delete cascade,
  add column section_path jsonb not null default '[]'::jsonb,
  add column locator jsonb not null default '{}'::jsonb,
  add column chunker_version text,
  add column embedding_version text;

create unique index ux_private_source_chunks_run_index
  on private.source_chunks(parse_run_id, chunk_index)
  where parse_run_id is not null;

create unique index ux_private_source_chunks_legacy_index
  on private.source_chunks(source_snapshot_id, chunk_index)
  where parse_run_id is null;

create table private.source_chunk_blocks (
  source_chunk_id uuid not null references private.source_chunks(id) on delete cascade,
  source_block_id uuid not null references private.source_blocks(id) on delete cascade,
  sort_order smallint not null check (sort_order >= 0),
  primary key (source_chunk_id, source_block_id),
  unique (source_chunk_id, sort_order)
);

alter table private.extraction_runs
  add column engine_version text,
  add column parser_version text,
  add column chunker_version text,
  add column prompt_version text,
  add column estimated_cost_usd numeric(12,6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  add column error_code text;

-- Extend candidate lifecycle without relying on a guessed generated constraint
-- name. The DO block only removes the legacy status CHECK containing the
-- original status vocabulary.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'private.fact_candidates'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
      and pg_get_constraintdef(oid) like '%detected%'
      and pg_get_constraintdef(oid) like '%accepted%'
      and pg_get_constraintdef(oid) like '%rejected%'
  loop
    execute format('alter table private.fact_candidates drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table private.fact_candidates
  add column confidence_label text check (confidence_label is null or confidence_label in ('high','medium','low')),
  add column notes text,
  add constraint fact_candidates_status_check
    check (status in ('detected','needs_review','accepted','rejected','duplicate','conflict'));

create table private.fact_candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references private.fact_candidates(id) on delete cascade,
  source_chunk_id uuid references private.source_chunks(id) on delete set null,
  source_block_id uuid references private.source_blocks(id) on delete set null,
  page_number integer check (page_number is null or page_number > 0),
  section_path jsonb not null default '[]'::jsonb,
  locator jsonb not null default '{}'::jsonb,
  excerpt text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  check (source_chunk_id is not null or source_block_id is not null)
);

alter table private.conflict_reports
  add column resolution_note text,
  add column resolved_fact_version_id uuid references public.race_fact_versions(id) on delete set null;

create index ix_private_source_blocks_snapshot
  on private.source_blocks(source_snapshot_id, extraction_run_id, block_index);
create index ix_private_source_chunk_blocks_block
  on private.source_chunk_blocks(source_block_id);
create index ix_private_candidate_evidence_candidate
  on private.fact_candidate_evidence(candidate_id, is_primary desc);
create index ix_private_extraction_runs_snapshot_type
  on private.extraction_runs(source_snapshot_id, run_type, started_at desc);

-- ============================================================
-- 03. Entitlements, beta grants and billing audit
-- ============================================================

alter table public.entitlements
  add column scope_type public.entitlement_scope_type;

update public.entitlements
set scope_type = case
  when kind = 'plus' then 'global'::public.entitlement_scope_type
  else 'participant_race'::public.entitlement_scope_type
end
where scope_type is null;

alter table public.entitlements
  alter column scope_type set not null,
  add column revoked_at timestamptz,
  add column revoke_reason text,
  add column revoked_by_user_id uuid references public.users(id) on delete set null;

-- Preserve legacy revoked rows created before revoked_at existed.
update public.entitlements
set revoked_at = coalesce(updated_at, created_at, now())
where status = 'revoked' and revoked_at is null;

alter table public.entitlements
  add constraint entitlements_scope_type_check check (
    (kind = 'plus' and scope_type = 'global')
    or (kind in ('race_pass','organizer_included') and scope_type = 'participant_race')
  ),
  add constraint entitlements_revocation_check check (
    status <> 'revoked' or revoked_at is not null
  );

comment on column public.entitlements.scope_type is 'Commercial scope resolved server-side. Free remains implicit.';
comment on column public.entitlements.revoke_reason is 'Internal audited reason. Never used as a client authorization source.';

-- Beta is deliberately a separate temporary grant. This keeps the three
-- commercial entitlement kinds stable while supporting global or race-scoped
-- test access as allowed by docs/04_ENTITLEMENTS.md.
create table public.beta_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  scope_type public.entitlement_scope_type not null,
  participant_race_id uuid references public.participant_races(id) on delete cascade,
  status public.entitlement_status not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason text,
  created_by_user_id uuid references public.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (
    (scope_type = 'global' and participant_race_id is null)
    or (scope_type = 'participant_race' and participant_race_id is not null)
  ),
  check (status <> 'revoked' or revoked_at is not null)
);

create unique index ux_beta_access_global_active
  on public.beta_access_grants(user_id)
  where scope_type = 'global' and status = 'active';

create unique index ux_beta_access_race_active
  on public.beta_access_grants(user_id, participant_race_id)
  where scope_type = 'participant_race' and status = 'active';

-- Commercial transaction history is separate from the resulting entitlement.
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_key text not null,
  participant_race_id uuid references public.participant_races(id) on delete set null,
  provider text not null,
  status public.purchase_status not null default 'pending',
  amount_minor integer check (amount_minor is null or amount_minor >= 0),
  currency char(3),
  provider_checkout_reference text,
  provider_payment_reference text,
  provider_customer_reference text,
  entitlement_id uuid references public.entitlements(id) on delete set null,
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (product_key <> ''),
  check (currency is null or currency = upper(currency)),
  check (status <> 'paid' or paid_at is not null),
  check (status <> 'refunded' or (refunded_at is not null and paid_at is not null))
);

create unique index ux_purchases_provider_checkout
  on public.purchases(provider, provider_checkout_reference)
  where provider_checkout_reference is not null;

create unique index ux_purchases_provider_payment
  on public.purchases(provider, provider_payment_reference)
  where provider_payment_reference is not null;

-- Quota usage is a ledger, not a mutable counter. Deleting an Outing does not
-- automatically restore a consumed Race Pass / Organizer Included slot.
create table public.entitlement_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  entitlement_id uuid not null references public.entitlements(id) on delete cascade,
  capability text not null,
  participant_race_id uuid references public.participant_races(id) on delete set null,
  outing_id uuid references public.outings(id) on delete set null,
  usage_key text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (capability <> ''),
  check (usage_key <> ''),
  unique (user_id, capability, usage_key)
);

create index ix_entitlement_usage_entitlement_capability
  on public.entitlement_usage(entitlement_id, capability, occurred_at desc);
create index ix_entitlement_usage_participant_race
  on public.entitlement_usage(participant_race_id, capability)
  where participant_race_id is not null;

-- Private webhook receipt ledger for idempotent billing processing.
create table private.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text,
  payload_hash char(64),
  status text not null default 'received' check (status in ('received','processed','failed','ignored')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index ix_private_billing_webhook_status
  on private.billing_webhook_events(status, received_at);

-- ============================================================
-- 04. Nutrition reproducibility and recalculation proposals
-- ============================================================

alter table public.nutrition_plans
  add column engine_config_version text,
  add column input_snapshot jsonb not null default '{}'::jsonb,
  add column input_hash char(64),
  add column generated_at timestamptz,
  add column confirmed_at timestamptz;

update public.nutrition_plans
set generated_at = created_at
where generated_at is null;

alter table public.nutrition_plans
  alter column generated_at set default now(),
  alter column generated_at set not null;

alter table public.nutrition_waypoints
  add column origin public.nutrition_waypoint_origin,
  add column stable_key text,
  add column is_customized boolean not null default false,
  add column is_locked boolean not null default false,
  add column distance_km numeric(8,3) check (distance_km is null or distance_km >= 0),
  add column latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  add column longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  add column route_altitude_m integer;

update public.nutrition_waypoints
set origin = case
  when plan_waypoint_id is not null then 'plan_waypoint'::public.nutrition_waypoint_origin
  when outing_waypoint_id is not null then 'outing_waypoint'::public.nutrition_waypoint_origin
  else 'generated_checkpoint'::public.nutrition_waypoint_origin
end
where origin is null;

update public.nutrition_waypoints
set stable_key = 'legacy:' || id::text
where stable_key is null;

alter table public.nutrition_waypoints
  alter column origin set not null,
  alter column stable_key set not null,
  add constraint nutrition_waypoints_origin_link_check check (
    (origin = 'plan_waypoint' and plan_waypoint_id is not null and outing_waypoint_id is null)
    or (origin = 'outing_waypoint' and outing_waypoint_id is not null and plan_waypoint_id is null)
    or (origin in ('generated_checkpoint','manual') and plan_waypoint_id is null and outing_waypoint_id is null)
  );

create unique index ux_nutrition_waypoints_stable_key
  on public.nutrition_waypoints(nutrition_plan_id, stable_key);

alter table public.nutrition_waypoint_items
  add column product_label_snapshot text,
  add column product_snapshot jsonb not null default '{}'::jsonb,
  add column is_customized boolean not null default false;

create table public.nutrition_recalculations (
  id uuid primary key default gen_random_uuid(),
  nutrition_plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  status public.nutrition_recalculation_status not null default 'proposed',
  trigger_reason text not null,
  source_condition_proposal_id uuid references public.condition_proposals(id) on delete set null,
  engine_version text not null,
  engine_config_version text,
  input_hash char(64),
  before_snapshot jsonb not null,
  proposed_snapshot jsonb not null,
  diff_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz,
  check (trigger_reason <> ''),
  check (status <> 'applied' or applied_at is not null),
  check (status = 'proposed' or decided_at is not null)
);

create index ix_nutrition_recalculations_plan_status
  on public.nutrition_recalculations(nutrition_plan_id, status, created_at desc);

-- ============================================================
-- 05. Weather Conditions reproducibility
-- ============================================================

alter table public.weather_forecast_runs
  add column conditions_engine_version text,
  add column conditions_config_version text,
  add column provider_config_version text,
  add column sampling_config_version text,
  add column normalizer_version text,
  add column input_snapshot jsonb not null default '{}'::jsonb,
  add column completeness_status public.weather_run_completeness not null default 'unknown',
  add column failure_code text;

comment on column public.weather_forecast_runs.conditions_config_version is 'May be null for point-by-point forecast runs created before automatic condition detection is enabled.';
comment on column public.weather_forecast_runs.completeness_status is 'Completeness of normalized point coverage; independent from active/stale/failed lifecycle status.';

-- ============================================================
-- 06. Race Intelligence Beta persistence hardening
-- ============================================================

alter table public.race_intelligence_runs
  add column config_version text,
  add column calibration_version text,
  add column input_hash char(64),
  add column readiness jsonb not null default '{}'::jsonb,
  add column primary_performance_provider public.enrichment_provider;

comment on column public.race_intelligence_runs.calibration_version is 'Required before production mode; may be null in beta.';
comment on column public.race_intelligence_runs.input_snapshot is 'Organizer-safe aggregate input summary only. Individual inputs belong in private.race_intelligence_run_members.';

alter table public.race_intelligence_waypoint_flows
  add column modeled_count integer check (modeled_count is null or modeled_count >= 0),
  add column coverage_pct numeric(5,2) check (coverage_pct is null or coverage_pct between 0 and 100);

alter table public.race_intelligence_weather_exposures
  add column expected_exposed_count numeric(10,2) check (expected_exposed_count is null or expected_exposed_count >= 0),
  add column lower_exposed_count integer check (lower_exposed_count is null or lower_exposed_count >= 0),
  add column upper_exposed_count integer check (upper_exposed_count is null or upper_exposed_count >= 0),
  add column modeled_participant_count integer check (modeled_participant_count is null or modeled_participant_count >= 0),
  add column coverage_pct numeric(5,2) check (coverage_pct is null or coverage_pct between 0 and 100),
  add constraint race_intelligence_weather_exposure_range_check check (
    upper_exposed_count is null
    or lower_exposed_count is null
    or upper_exposed_count >= lower_exposed_count
  );

create table private.race_intelligence_run_members (
  run_id uuid not null references public.race_intelligence_runs(id) on delete cascade,
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  signal_type text not null check (signal_type in ('plan','performance','generic')),
  race_plan_id uuid references public.race_plans(id) on delete set null,
  performance_signal_id uuid references private.participant_performance_signals(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (run_id, participant_race_id),
  check (
    (signal_type = 'plan' and race_plan_id is not null and performance_signal_id is null)
    or (signal_type = 'performance' and performance_signal_id is not null and race_plan_id is null)
    or (signal_type = 'generic' and race_plan_id is null and performance_signal_id is null)
  )
);

create index ix_private_ri_run_members_run
  on private.race_intelligence_run_members(run_id, signal_type);
create index ix_private_ri_run_members_participant
  on private.race_intelligence_run_members(participant_race_id);

-- ============================================================
-- 07. Supporting indexes / mutable timestamp triggers
-- ============================================================

create index ix_weather_runs_input_hash
  on public.weather_forecast_runs(input_hash)
  where input_hash is not null;

create index ix_ri_runs_race_status_completed
  on public.race_intelligence_runs(race_id, status, completed_at desc);

create index ix_ri_weather_exposure_run_time
  on public.race_intelligence_weather_exposures(run_id, start_datetime, end_datetime);

create index ix_purchases_user_created
  on public.purchases(user_id, created_at desc);

create trigger trg_beta_access_grants_updated_at
before update on public.beta_access_grants
for each row execute function private.set_updated_at();

create trigger trg_purchases_updated_at
before update on public.purchases
for each row execute function private.set_updated_at();

-- ============================================================
-- 08. Secure-by-default for newly introduced objects
-- ============================================================

alter table public.beta_access_grants enable row level security;
alter table public.purchases enable row level security;
alter table public.entitlement_usage enable row level security;
alter table public.nutrition_recalculations enable row level security;

revoke all on private.source_blocks from public, anon, authenticated;
revoke all on private.source_chunk_blocks from public, anon, authenticated;
revoke all on private.fact_candidate_evidence from public, anon, authenticated;
revoke all on private.billing_webhook_events from public, anon, authenticated;
revoke all on private.race_intelligence_run_members from public, anon, authenticated;

-- ============================================================
-- 09. Documentation comments for critical invariants
-- ============================================================

comment on table public.entitlement_usage is 'Idempotent usage ledger for quota-bearing entitlements. Deleting the linked Outing must not automatically restore consumed quota.';
comment on table public.nutrition_recalculations is 'Persistent before/proposed/diff object. A proposed recalculation never mutates the active Nutrition strategy until explicitly applied.';
comment on table private.fact_candidate_evidence is 'Multiple exact evidence references for an extraction candidate. Candidates remain non-authoritative until human publication workflow.';
comment on table private.race_intelligence_run_members is 'Private reproducibility inputs for Race Intelligence. Never exposed to organizer clients and intentionally contains no derived individual ETA.';

commit;
