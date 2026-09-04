-- PLUKA — Per-point weather traceability
-- Migration: 0004_weather_point_traceability.sql
--
-- Aligns persistence with WEATHER_CONDITIONS.md §26 (NormalizedWeatherPoint) and
-- 02_DATA_MODEL.md §18.3.
--
-- Rationale
-- A forecast run may query the provider in several calls, or obtain only part of its
-- points — this is exactly what 0003 introduced as completeness_status = 'partial'.
-- Without per-point timestamps, two values displayed side by side can originate from
-- different provider issuances with no way to tell. That breaks the core rule:
-- a weather value is never displayed without its exact origin.
--
-- Semantics after this migration
--   weather_forecast_runs.forecast_issued_at   reference value for the run
--   weather_forecast_runs.fetched_at           reference value for the run
--   weather_forecast_points.forecast_issued_at authoritative for this value
--   weather_forecast_points.fetched_at         authoritative for this value
--
-- Neither column ever enters input_hash (WEATHER_CONDITIONS.md §30).

begin;

-- ============================================================
-- 01. New columns
-- ============================================================

-- Nullable: some providers do not expose their issuance time. A null must stay null
-- and must never be silently replaced by an estimate.
alter table public.weather_forecast_points
  add column forecast_issued_at timestamptz;

-- Added nullable first so existing rows can be backfilled from their run before the
-- NOT NULL constraint is applied.
alter table public.weather_forecast_points
  add column fetched_at timestamptz;

-- ============================================================
-- 02. Backfill from the parent run
-- ============================================================
-- Existing rows predate per-point tracking. The run value is the best available
-- approximation and is, for single-call runs, the exact value.

update public.weather_forecast_points p
set
  forecast_issued_at = r.forecast_issued_at,
  fetched_at = r.fetched_at
from public.weather_forecast_runs r
where p.weather_run_id = r.id
  and p.fetched_at is null;

-- ============================================================
-- 03. Constraints
-- ============================================================

alter table public.weather_forecast_points
  alter column fetched_at set not null;

-- A forecast cannot be issued after it was fetched.
alter table public.weather_forecast_points
  add constraint ck_weather_points_issued_before_fetched
  check (forecast_issued_at is null or forecast_issued_at <= fetched_at);

-- ============================================================
-- 04. Indexes
-- ============================================================
-- Supports staleness checks and refresh decisions scoped to a run.

create index ix_weather_points_run_fetched
  on public.weather_forecast_points (weather_run_id, fetched_at desc);

-- ============================================================
-- 05. Documented invariants
-- ============================================================

comment on column public.weather_forecast_points.forecast_issued_at is
  'Provider issuance time for THIS point. Authoritative over the run value. Null when the provider does not expose it; never estimated.';

comment on column public.weather_forecast_points.fetched_at is
  'Retrieval time for THIS point. Authoritative over the run value. A partial or multi-call run yields points with differing values.';

comment on column public.weather_forecast_runs.forecast_issued_at is
  'Reference value for the run: oldest issuance among obtained points. Per-point origin lives on weather_forecast_points.';

comment on column public.weather_forecast_runs.fetched_at is
  'Reference value for the run: most recent retrieval among obtained points. Per-point origin lives on weather_forecast_points.';

commit;
