-- PLUKA V1 — PostgreSQL / Supabase canonical schema
-- File target: supabase/migrations/0001_initial_schema.sql
-- Product reference: docs/00_PRODUCT_SPEC.md
-- Data model reference: docs/02_DATA_MODEL.md
-- Date: 2026-09-03
--
-- IMPORTANT
-- - This migration defines the canonical V1 data structures, constraints and indexes.
-- - RLS is ENABLED at the end of this migration but policies are intentionally NOT
--   defined here. Policies belong to docs/03_PRIVACY_RLS.md and a dedicated migration.
-- - Until the RLS policy migration is applied, client roles are intentionally denied.
-- - Demo values from the prototype are never business rules.
-- - Repere PLUKA and Race Intelligence computation algorithms are not specified here.

begin;

-- ============================================================
-- 00. Schemas & extensions
-- ============================================================

create schema if not exists private;
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists vector with schema extensions;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- ============================================================
-- 01. Enumerations
-- ============================================================

create type public.platform_role as enum ('user', 'pluka_admin');
create type public.organization_status as enum ('prospect', 'active', 'suspended', 'archived');
create type public.organization_member_role as enum ('owner', 'admin', 'editor', 'viewer');
create type public.sport_type as enum ('trail', 'road_running', 'cycling', 'triathlon', 'other');
create type public.management_status as enum ('community', 'pluka_managed', 'organizer_managed');
create type public.record_status as enum ('draft', 'published', 'archived');
create type public.edition_status as enum ('draft', 'published', 'completed', 'cancelled', 'archived');
create type public.race_status as enum ('draft', 'published', 'completed', 'cancelled', 'archived');
create type public.race_visibility as enum ('private', 'unlisted', 'public');
create type public.waypoint_type as enum ('start', 'aid_station', 'water', 'checkpoint', 'cutoff', 'assistance', 'summit', 'pass', 'finish', 'other');
create type public.segment_type as enum ('official_section', 'computed_section', 'weather_virtual');
create type public.cutoff_type as enum ('hard', 'soft');
create type public.equipment_category as enum ('mandatory_safety', 'clothing', 'hydration', 'nutrition', 'electronics', 'navigation', 'accessory', 'other');
create type public.requirement_type as enum ('mandatory', 'conditional', 'recommended');
create type public.source_type as enum ('url', 'pdf', 'gpx', 'file', 'manual', 'organizer_input');
create type public.source_status as enum ('uploaded', 'processing', 'ready', 'failed', 'archived');
create type public.fact_category as enum ('general', 'start', 'bib', 'course', 'gpx', 'aid', 'cutoff', 'equipment', 'assistance', 'bag', 'transport', 'safety', 'withdrawal', 'rules', 'contact', 'weather', 'other');
create type public.trust_level as enum ('community', 'pluka_validated', 'official');
create type public.fact_workflow_status as enum ('draft', 'validated', 'published', 'rejected', 'superseded');
create type public.notice_type as enum ('information', 'safety', 'equipment', 'weather', 'route_change', 'start_change', 'transport', 'cancellation', 'other');
create type public.notice_severity as enum ('info', 'important', 'critical');
create type public.registration_source as enum ('direct', 'organizer_import', 'organizer_invitation', 'admin');
create type public.participant_race_status as enum ('active', 'finished', 'dns', 'dnf', 'archived');
create type public.preparation_state as enum ('to_prepare', 'preparing', 'ready', 'completed', 'dns', 'dnf');
create type public.assistance_status as enum ('to_define', 'autonomous', 'enabled');
create type public.entitlement_kind as enum ('race_pass', 'plus', 'organizer_included');
create type public.entitlement_source as enum ('checkout', 'organization', 'admin', 'promo');
create type public.entitlement_status as enum ('active', 'expired', 'revoked');
create type public.plan_status as enum ('active', 'superseded', 'archived');
create type public.cutoff_margin_status as enum ('comfortable', 'watch', 'critical', 'beyond');
create type public.plan_dependency_type as enum ('course_fact', 'cutoff', 'equipment', 'assistance', 'waypoint', 'rule', 'other');
create type public.change_severity as enum ('info', 'important', 'critical');
create type public.change_impact_status as enum ('pending', 'seen', 'reviewed', 'not_applicable');
create type public.task_origin as enum ('personal', 'pluka', 'official_change', 'nutrition', 'conditions');
create type public.equipment_status as enum ('planned', 'packed', 'missing', 'not_needed');
create type public.equipment_origin as enum ('official_requirement', 'personal', 'pluka_suggestion', 'conditions');
create type public.bag_type as enum ('start', 'drop_bag', 'assistance', 'finish', 'other');
create type public.bag_item_type as enum ('equipment', 'nutrition', 'free_text');
create type public.nutrition_product_category as enum ('gel', 'drink', 'bar', 'chew', 'solid', 'salty', 'generic_aid', 'other');
create type public.nutrition_product_status as enum ('draft', 'validated', 'archived');
create type public.nutrition_condition_type as enum ('hot', 'cold', 'night');
create type public.condition_range_source as enum ('manual', 'weather_proposal', 'strategy_template');
create type public.nutrition_action as enum ('consume', 'refill', 'carry');
create type public.assistant_status as enum ('active', 'inactive');
create type public.assistance_item_type as enum ('bag', 'equipment', 'nutrition', 'instruction', 'other');
create type public.outing_status as enum ('draft', 'planned', 'completed', 'cancelled', 'archived');
create type public.outing_point_type as enum ('start', 'water', 'aid', 'summit', 'pass', 'other', 'finish');
create type public.template_type as enum ('nutrition_strategy', 'bag', 'preparation', 'other');
create type public.weather_scope as enum ('race_plan', 'outing');
create type public.weather_run_status as enum ('active', 'stale', 'failed');
create type public.detected_condition_type as enum ('heat', 'cold', 'cold_wind', 'rain', 'night', 'other');
create type public.condition_source as enum ('weather', 'astronomy');
create type public.proposal_target_module as enum ('nutrition', 'preparation');
create type public.proposal_status as enum ('pending', 'applied', 'dismissed', 'expired');
create type public.community_category as enum ('preparation', 'race', 'logistics', 'equipment_nutrition', 'assistance', 'review', 'other');
create type public.community_content_status as enum ('published', 'hidden', 'deleted');
create type public.reaction_type as enum ('useful');
create type public.report_reason as enum ('spam', 'abuse', 'misinformation', 'privacy', 'other');
create type public.report_status as enum ('open', 'reviewed', 'resolved', 'dismissed');
create type public.result_status as enum ('finisher', 'dnf', 'cutoff', 'dns');
create type public.overall_feeling as enum ('very_good', 'good', 'difficult', 'very_difficult');
create type public.plan_accuracy as enum ('realistic', 'optimistic', 'prudent', 'not_relevant');
create type public.feedback_rating as enum ('worked', 'partial', 'failed', 'not_used');
create type public.nutrition_feedback as enum ('adapted', 'adjust', 'not_followed');
create type public.import_status as enum ('uploaded', 'mapping', 'validating', 'imported', 'failed');
create type public.import_row_status as enum ('pending', 'valid', 'error', 'imported', 'skipped');
create type public.enrichment_provider as enum ('itra', 'utmb');
create type public.enrichment_match_status as enum ('pending', 'matched', 'review', 'unmatched', 'ignored');
create type public.invitation_status as enum ('pending', 'sent', 'opened', 'activated', 'expired', 'revoked');
create type public.message_role as enum ('user', 'assistant', 'system');
create type public.race_intelligence_mode as enum ('demo', 'beta', 'production');
create type public.race_intelligence_status as enum ('queued', 'running', 'completed', 'failed');
create type public.coverage_label as enum ('limited', 'partial', 'good');
create type public.dispersion_label as enum ('low', 'medium', 'high');
create type public.sensitivity_label as enum ('normal', 'watch', 'high');
create type public.attention_level as enum ('todo', 'verify', 'know');
create type public.profile_comfort as enum ('low', 'medium', 'high');
create type public.long_distance_experience as enum ('none', 'up_to_30k', '30_60k', '60_100k', '100k_plus');

-- ============================================================
-- 02. Identity & persistent runner profile
-- ============================================================

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  first_name text,
  last_name text,
  avatar_url text,
  locale varchar(10) not null default 'fr-FR',
  timezone varchar(64) not null default 'Europe/Paris',
  platform_role public.platform_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'Profil applicatif lie a Supabase Auth.';

create table public.trail_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  representative_effort_label text,
  representative_effort_date date,
  representative_distance_km numeric(7,2) check (representative_distance_km is null or representative_distance_km > 0),
  representative_elevation_gain_m integer check (representative_elevation_gain_m is null or representative_elevation_gain_m >= 0),
  representative_duration_seconds integer check (representative_duration_seconds is null or representative_duration_seconds > 0),
  fallback_trail_pace_seconds_per_km integer check (fallback_trail_pace_seconds_per_km is null or fallback_trail_pace_seconds_per_km > 0),
  weekly_distance_km numeric(6,1) check (weekly_distance_km is null or weekly_distance_km >= 0),
  weekly_elevation_gain_m integer check (weekly_elevation_gain_m is null or weekly_elevation_gain_m >= 0),
  climb_comfort public.profile_comfort,
  descent_comfort public.profile_comfort,
  long_distance_experience public.long_distance_experience,
  profile_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.trail_profiles is 'Profil trailer persistant et compact, sans donnees physiologiques de coaching.';

-- ============================================================
-- 03. Organizations, events, editions, races
-- ============================================================

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  website_url text,
  contact_email extensions.citext,
  status public.organization_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.organization_member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  official_website_url text,
  logo_url text,
  country_code char(2),
  city text,
  sport_type public.sport_type not null default 'trail',
  management_status public.management_status not null default 'pluka_managed',
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  year smallint not null check (year between 2000 and 2200),
  slug text not null,
  start_date date not null,
  end_date date,
  status public.edition_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, year),
  unique (event_id, slug),
  check (end_date is null or end_date >= start_date)
);

create table public.event_partners (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  name text not null,
  category text,
  logo_url text,
  website_url text,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.races (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  distance_km numeric(7,2) not null check (distance_km > 0),
  elevation_gain_m integer check (elevation_gain_m is null or elevation_gain_m >= 0),
  elevation_loss_m integer check (elevation_loss_m is null or elevation_loss_m >= 0),
  start_datetime timestamptz not null,
  cutoff_datetime timestamptz,
  timezone varchar(64) not null default 'Europe/Paris',
  start_location_name text,
  finish_location_name text,
  status public.race_status not null default 'draft',
  public_visibility public.race_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, slug),
  check (cutoff_datetime is null or cutoff_datetime > start_datetime)
);

create table public.race_start_waves (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  name text not null,
  start_datetime timestamptz not null,
  sort_order smallint not null default 0,
  max_participants integer check (max_participants is null or max_participants > 0),
  fact_id uuid,
  unique (race_id, sort_order)
);

create table public.race_waypoints (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  name text not null,
  waypoint_type public.waypoint_type not null,
  distance_km numeric(7,2) not null check (distance_km >= 0),
  latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  altitude_m integer,
  elevation_gain_cumulative_m integer check (elevation_gain_cumulative_m is null or elevation_gain_cumulative_m >= 0),
  elevation_loss_cumulative_m integer check (elevation_loss_cumulative_m is null or elevation_loss_cumulative_m >= 0),
  gpx_offset_m integer check (gpx_offset_m is null or gpx_offset_m >= 0),
  sort_order smallint not null,
  fact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (race_id, sort_order)
);

create table public.race_segments (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  from_waypoint_id uuid not null references public.race_waypoints(id) on delete restrict,
  to_waypoint_id uuid not null references public.race_waypoints(id) on delete restrict,
  segment_type public.segment_type not null default 'official_section',
  distance_km numeric(7,2) not null check (distance_km > 0),
  elevation_gain_m integer check (elevation_gain_m is null or elevation_gain_m >= 0),
  elevation_loss_m integer check (elevation_loss_m is null or elevation_loss_m >= 0),
  min_altitude_m integer,
  max_altitude_m integer,
  average_grade_pct numeric(6,2),
  technicality_level smallint check (technicality_level is null or technicality_level between 1 and 5),
  sort_order smallint not null,
  unique (race_id, sort_order),
  check (from_waypoint_id <> to_waypoint_id)
);

-- ============================================================
-- 04. Sources, snapshots, stable facts, immutable versions
-- ============================================================

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  source_type public.source_type not null,
  title text not null,
  url text,
  storage_path text,
  declared_published_at timestamptz,
  imported_at timestamptz not null default now(),
  status public.source_status not null default 'uploaded',
  created_by_user_id uuid references public.users(id) on delete set null,
  current_snapshot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (url is not null or storage_path is not null or source_type in ('manual', 'organizer_input'))
);

create table public.source_race_scopes (
  source_id uuid not null references public.sources(id) on delete cascade,
  race_id uuid not null references public.races(id) on delete cascade,
  primary key (source_id, race_id)
);

create table public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content_hash char(64) not null,
  snapshot_storage_path text,
  retrieved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (source_id, version_number),
  unique (source_id, content_hash)
);

alter table public.sources
  add constraint fk_sources_current_snapshot
  foreign key (current_snapshot_id) references public.source_snapshots(id) on delete set null;

create table public.race_facts (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  category public.fact_category not null,
  fact_key text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (race_id, fact_key)
);

create table public.race_fact_versions (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.race_facts(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  value_text text,
  value_number numeric,
  unit text,
  value_json jsonb,
  trust_level public.trust_level not null default 'community',
  workflow_status public.fact_workflow_status not null default 'draft',
  supersedes_version_id uuid references public.race_fact_versions(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  validated_by_user_id uuid references public.users(id) on delete set null,
  validated_by_organization_id uuid references public.organizations(id) on delete set null,
  validated_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (fact_id, version_number),
  check (num_nonnulls(value_text, value_number, value_json) >= 1),
  check (trust_level <> 'official' or validated_by_organization_id is not null),
  check (workflow_status <> 'published' or published_at is not null)
);

alter table public.race_facts
  add constraint fk_race_facts_current_version
  foreign key (current_version_id) references public.race_fact_versions(id) on delete set null;

create table public.fact_sources (
  id uuid primary key default gen_random_uuid(),
  fact_version_id uuid not null references public.race_fact_versions(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  source_snapshot_id uuid not null references public.source_snapshots(id) on delete restrict,
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end > 0),
  section_label text,
  article_label text,
  excerpt text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  check (page_end is null or page_start is null or page_end >= page_start)
);

create unique index ux_fact_sources_primary on public.fact_sources(fact_version_id) where is_primary;

create table public.race_course_geometries (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  source_snapshot_id uuid references public.source_snapshots(id) on delete set null,
  version_number integer not null default 1 check (version_number > 0),
  geometry extensions.geometry(LineStringZ, 4326) not null,
  simplified_geometry extensions.geometry(LineString, 4326),
  point_count integer not null check (point_count > 1),
  length_m numeric(12,2) check (length_m is null or length_m > 0),
  processor_version text not null,
  processed_at timestamptz not null default now(),
  unique (race_id, version_number)
);

alter table public.races add column gpx_source_id uuid references public.sources(id) on delete set null;
alter table public.races add column current_course_geometry_id uuid references public.race_course_geometries(id) on delete set null;

-- Resolve deferred fact references on race structures.
alter table public.race_start_waves add constraint fk_race_start_waves_fact foreign key (fact_id) references public.race_facts(id) on delete set null;
alter table public.race_waypoints add constraint fk_race_waypoints_fact foreign key (fact_id) references public.race_facts(id) on delete set null;

create table public.race_cutoffs (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  race_waypoint_id uuid not null references public.race_waypoints(id) on delete restrict,
  cutoff_datetime timestamptz not null,
  cutoff_type public.cutoff_type not null default 'hard',
  description text,
  fact_id uuid references public.race_facts(id) on delete restrict,
  unique (race_id, race_waypoint_id, cutoff_type)
);

create table public.race_assistance_rules (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  race_waypoint_id uuid references public.race_waypoints(id) on delete restrict,
  allowed boolean not null,
  zone_description text,
  access_notes text,
  parking_notes text,
  fact_id uuid references public.race_facts(id) on delete restrict
);

create unique index ux_race_assistance_rule_waypoint
  on public.race_assistance_rules(race_id, race_waypoint_id)
  where race_waypoint_id is not null;

create table public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category public.equipment_category not null,
  canonical_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.race_equipment_requirements (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  equipment_item_id uuid not null references public.equipment_items(id) on delete restrict,
  requirement_type public.requirement_type not null,
  description text,
  condition_text text,
  fact_id uuid references public.race_facts(id) on delete restrict,
  unique (race_id, equipment_item_id, requirement_type)
);

create table public.race_notices (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  notice_type public.notice_type not null,
  trust_level public.trust_level not null default 'pluka_validated',
  severity public.notice_severity not null default 'info',
  title text not null,
  body text not null,
  linked_fact_version_id uuid references public.race_fact_versions(id) on delete set null,
  published_by_user_id uuid references public.users(id) on delete set null,
  published_by_organization_id uuid references public.organizations(id) on delete set null,
  effective_from timestamptz,
  effective_until timestamptz,
  published_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_from is null or effective_until > effective_from),
  check (trust_level <> 'community'),
  check (trust_level <> 'official' or published_by_organization_id is not null),
  check (published_by_organization_id is not null or linked_fact_version_id is not null)
);

-- ============================================================
-- 05. Participant race context, settings & entitlements
-- ============================================================

create table public.participant_races (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  invite_email extensions.citext,
  first_name_snapshot text,
  last_name_snapshot text,
  registration_source public.registration_source not null default 'direct',
  external_registration_id text,
  bib_number text,
  start_wave_id uuid references public.race_start_waves(id) on delete set null,
  personal_start_datetime timestamptz,
  status public.participant_race_status not null default 'active',
  preparation_state public.preparation_state not null default 'to_prepare',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or invite_email is not null)
);

create unique index ux_participant_race_user
  on public.participant_races(race_id, user_id)
  where user_id is not null;
create unique index ux_participant_race_external
  on public.participant_races(race_id, external_registration_id)
  where external_registration_id is not null;
create unique index ux_participant_race_unclaimed_email
  on public.participant_races(race_id, invite_email)
  where user_id is null and invite_email is not null;

create table public.participant_race_settings (
  participant_race_id uuid primary key references public.participant_races(id) on delete cascade,
  target_duration_seconds integer check (target_duration_seconds is null or target_duration_seconds > 0),
  assistance_status public.assistance_status not null default 'to_define',
  nutrition_enabled boolean not null default false,
  nutrition_waypoints_visible boolean not null default true,
  repere_visible boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on column public.participant_race_settings.repere_visible is 'UI-only feature flag. No production Repere algorithm is specified by this schema.';

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  kind public.entitlement_kind not null,
  source public.entitlement_source not null,
  status public.entitlement_status not null default 'active',
  user_id uuid references public.users(id) on delete cascade,
  participant_race_id uuid references public.participant_races(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (
    (kind = 'plus' and user_id is not null and participant_race_id is null)
    or (kind = 'race_pass' and participant_race_id is not null)
    or (kind = 'organizer_included' and participant_race_id is not null and organization_id is not null)
  )
);

create unique index ux_active_plus_entitlement
  on public.entitlements(user_id)
  where kind = 'plus' and status = 'active';
create unique index ux_active_race_pass_entitlement
  on public.entitlements(participant_race_id)
  where kind = 'race_pass' and status = 'active';
create unique index ux_active_organizer_entitlement
  on public.entitlements(participant_race_id)
  where kind = 'organizer_included' and status = 'active';

-- ============================================================
-- 06. Race Plan and fact dependencies
-- ============================================================

create table public.race_plans (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  version integer not null check (version > 0),
  status public.plan_status not null default 'active',
  engine_version text not null,
  initial_target_duration_seconds integer not null check (initial_target_duration_seconds > 0),
  target_duration_seconds integer not null check (target_duration_seconds > 0),
  planned_finish_datetime timestamptz,
  input_snapshot jsonb not null default '{}'::jsonb,
  input_hash char(64),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_race_id, version)
);

create unique index ux_active_race_plan
  on public.race_plans(participant_race_id)
  where status = 'active';

create table public.plan_waypoints (
  id uuid primary key default gen_random_uuid(),
  race_plan_id uuid not null references public.race_plans(id) on delete cascade,
  race_waypoint_id uuid not null references public.race_waypoints(id) on delete restrict,
  planned_elapsed_seconds integer not null check (planned_elapsed_seconds >= 0),
  planned_arrival_at timestamptz,
  stop_duration_seconds integer not null default 0 check (stop_duration_seconds >= 0),
  is_locked boolean not null default false,
  locked_elapsed_seconds integer check (locked_elapsed_seconds is null or locked_elapsed_seconds >= 0),
  manual_note text,
  sort_order smallint not null,
  unique (race_plan_id, race_waypoint_id),
  unique (race_plan_id, sort_order)
);

create table public.plan_segments (
  id uuid primary key default gen_random_uuid(),
  race_plan_id uuid not null references public.race_plans(id) on delete cascade,
  race_segment_id uuid not null references public.race_segments(id) on delete restrict,
  initial_duration_seconds integer not null check (initial_duration_seconds > 0),
  planned_duration_seconds integer not null check (planned_duration_seconds > 0),
  manual_override boolean not null default false,
  sort_order smallint not null,
  unique (race_plan_id, race_segment_id),
  unique (race_plan_id, sort_order)
);

create table public.plan_cutoff_statuses (
  id uuid primary key default gen_random_uuid(),
  race_plan_id uuid not null references public.race_plans(id) on delete cascade,
  race_cutoff_id uuid not null references public.race_cutoffs(id) on delete restrict,
  plan_waypoint_id uuid not null references public.plan_waypoints(id) on delete cascade,
  margin_seconds integer not null,
  status public.cutoff_margin_status not null,
  calculated_at timestamptz not null default now(),
  unique (race_plan_id, race_cutoff_id)
);

create table public.plan_version_dependencies (
  id uuid primary key default gen_random_uuid(),
  race_plan_id uuid not null references public.race_plans(id) on delete cascade,
  race_fact_version_id uuid not null references public.race_fact_versions(id) on delete restrict,
  dependency_type public.plan_dependency_type not null,
  dependency_key text,
  created_at timestamptz not null default now(),
  unique (race_plan_id, race_fact_version_id, dependency_type, dependency_key)
);

-- ============================================================
-- 07. Official changes & participant impact
-- ============================================================

create table public.race_change_events (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  fact_id uuid not null references public.race_facts(id) on delete cascade,
  from_version_id uuid references public.race_fact_versions(id) on delete set null,
  to_version_id uuid not null references public.race_fact_versions(id) on delete restrict,
  severity public.change_severity not null default 'info',
  title text not null,
  summary text,
  published_by_user_id uuid references public.users(id) on delete set null,
  published_by_organization_id uuid references public.organizations(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (from_version_id is null or from_version_id <> to_version_id)
);

create table public.participant_change_impacts (
  id uuid primary key default gen_random_uuid(),
  change_event_id uuid not null references public.race_change_events(id) on delete cascade,
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  impacted_module text not null check (impacted_module in ('plan','preparation','nutrition','assistance','course','conditions')),
  status public.change_impact_status not null default 'pending',
  seen_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (change_event_id, participant_race_id, impacted_module)
);

-- ============================================================
-- 08. Preparation: tasks, equipment, bags
-- ============================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  completed_at timestamptz,
  origin public.task_origin not null default 'personal',
  source_change_event_id uuid references public.race_change_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participant_equipment (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  equipment_item_id uuid references public.equipment_items(id) on delete restrict,
  custom_label text,
  source_requirement_id uuid references public.race_equipment_requirements(id) on delete set null,
  origin public.equipment_origin not null default 'personal',
  status public.equipment_status not null default 'planned',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((equipment_item_id is not null)::int + (custom_label is not null)::int = 1)
);

create unique index ux_participant_equipment_canonical
  on public.participant_equipment(participant_race_id, equipment_item_id)
  where equipment_item_id is not null;

create table public.bags (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  bag_type public.bag_type not null,
  name text not null,
  race_waypoint_id uuid references public.race_waypoints(id) on delete set null,
  assigned_assistant_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 09. Personal outings
-- ============================================================

create table public.outings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  linked_participant_race_id uuid references public.participant_races(id) on delete set null,
  name text not null,
  status public.outing_status not null default 'draft',
  planned_start_datetime timestamptz,
  timezone varchar(64) not null default 'Europe/Paris',
  planned_duration_seconds integer check (planned_duration_seconds is null or planned_duration_seconds > 0),
  distance_km numeric(7,2) check (distance_km is null or distance_km > 0),
  elevation_gain_m integer check (elevation_gain_m is null or elevation_gain_m >= 0),
  elevation_loss_m integer check (elevation_loss_m is null or elevation_loss_m >= 0),
  gpx_storage_path text,
  geometry extensions.geometry(LineStringZ, 4326),
  simplified_geometry extensions.geometry(LineString, 4326),
  manual_conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outing_waypoints (
  id uuid primary key default gen_random_uuid(),
  outing_id uuid not null references public.outings(id) on delete cascade,
  name text not null,
  point_type public.outing_point_type not null default 'other',
  distance_km numeric(7,2) not null check (distance_km >= 0),
  latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  altitude_m integer,
  planned_elapsed_seconds integer check (planned_elapsed_seconds is null or planned_elapsed_seconds >= 0),
  planned_arrival_at timestamptz,
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  unique (outing_id, sort_order)
);

create table public.outing_equipment (
  id uuid primary key default gen_random_uuid(),
  outing_id uuid not null references public.outings(id) on delete cascade,
  equipment_item_id uuid references public.equipment_items(id) on delete restrict,
  custom_label text,
  status public.equipment_status not null default 'planned',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((equipment_item_id is not null)::int + (custom_label is not null)::int = 1)
);

create table public.outing_feedback (
  outing_id uuid primary key references public.outings(id) on delete cascade,
  actual_duration_seconds integer check (actual_duration_seconds is null or actual_duration_seconds > 0),
  overall_feeling public.overall_feeling,
  nutrition_feedback public.nutrition_feedback,
  equipment_feedback text,
  notes text,
  proposed_race_changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 10. Nutrition catalogue, strategy & aid station content
-- ============================================================

create table public.nutrition_products (
  id uuid primary key default gen_random_uuid(),
  brand text,
  name text not null,
  variant text,
  category public.nutrition_product_category not null,
  serving_label text,
  serving_quantity numeric(8,2),
  serving_unit text,
  carbs_g numeric(7,2) not null default 0 check (carbs_g >= 0),
  sodium_mg integer not null default 0 check (sodium_mg >= 0),
  caffeine_mg integer not null default 0 check (caffeine_mg >= 0),
  hydration_ml integer not null default 0 check (hydration_ml >= 0),
  calories_kcal integer check (calories_kcal is null or calories_kcal >= 0),
  source_url text,
  status public.nutrition_product_status not null default 'draft',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_nutrition_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  nutrition_product_id uuid references public.nutrition_products(id) on delete set null,
  custom_brand text,
  custom_name text,
  custom_serving_label text,
  custom_carbs_g numeric(7,2) check (custom_carbs_g is null or custom_carbs_g >= 0),
  custom_sodium_mg integer check (custom_sodium_mg is null or custom_sodium_mg >= 0),
  custom_caffeine_mg integer check (custom_caffeine_mg is null or custom_caffeine_mg >= 0),
  custom_hydration_ml integer check (custom_hydration_ml is null or custom_hydration_ml >= 0),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nutrition_product_id is not null or custom_name is not null)
);

create unique index ux_user_nutrition_product_canonical
  on public.user_nutrition_products(user_id, nutrition_product_id)
  where nutrition_product_id is not null;

create table public.race_aid_station_items (
  id uuid primary key default gen_random_uuid(),
  race_waypoint_id uuid not null references public.race_waypoints(id) on delete cascade,
  nutrition_product_id uuid references public.nutrition_products(id) on delete set null,
  label text not null,
  estimated_portion_label text,
  availability_notes text,
  fact_id uuid references public.race_facts(id) on delete set null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table public.nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  race_plan_id uuid references public.race_plans(id) on delete cascade,
  outing_id uuid references public.outings(id) on delete cascade,
  carbs_target_g_per_hour numeric(6,2) not null check (carbs_target_g_per_hour >= 0),
  hydration_target_ml_per_hour integer not null check (hydration_target_ml_per_hour >= 0),
  sodium_target_mg_per_hour integer not null check (sodium_target_mg_per_hour >= 0),
  caffeine_target_total_mg integer check (caffeine_target_total_mg is null or caffeine_target_total_mg >= 0),
  reserve_percent numeric(5,2) not null default 0 check (reserve_percent >= 0 and reserve_percent <= 100),
  enabled boolean not null default true,
  engine_version text not null,
  last_recalculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((race_plan_id is not null)::int + (outing_id is not null)::int = 1)
);

create unique index ux_nutrition_plan_race_plan on public.nutrition_plans(race_plan_id) where race_plan_id is not null;
create unique index ux_nutrition_plan_outing on public.nutrition_plans(outing_id) where outing_id is not null;

create table public.nutrition_conditions (
  id uuid primary key default gen_random_uuid(),
  nutrition_plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  condition_type public.nutrition_condition_type not null,
  label text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.nutrition_condition_ranges (
  id uuid primary key default gen_random_uuid(),
  nutrition_condition_id uuid not null references public.nutrition_conditions(id) on delete cascade,
  source public.condition_range_source not null default 'manual',
  source_condition_period_id uuid,
  start_elapsed_seconds integer not null check (start_elapsed_seconds >= 0),
  end_elapsed_seconds integer not null check (end_elapsed_seconds > start_elapsed_seconds),
  carbs_target_g_per_hour numeric(6,2) check (carbs_target_g_per_hour is null or carbs_target_g_per_hour >= 0),
  hydration_target_ml_per_hour integer check (hydration_target_ml_per_hour is null or hydration_target_ml_per_hour >= 0),
  sodium_target_mg_per_hour integer check (sodium_target_mg_per_hour is null or sodium_target_mg_per_hour >= 0),
  caffeine_distribution_weight numeric(5,2) not null default 1 check (caffeine_distribution_weight >= 0),
  created_at timestamptz not null default now()
);

create table public.nutrition_waypoints (
  id uuid primary key default gen_random_uuid(),
  nutrition_plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  plan_waypoint_id uuid references public.plan_waypoints(id) on delete set null,
  outing_waypoint_id uuid references public.outing_waypoints(id) on delete set null,
  label text not null,
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  planned_at timestamptz,
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  unique (nutrition_plan_id, sort_order),
  check ((plan_waypoint_id is not null)::int + (outing_waypoint_id is not null)::int <= 1)
);

create table public.nutrition_waypoint_items (
  id uuid primary key default gen_random_uuid(),
  nutrition_waypoint_id uuid not null references public.nutrition_waypoints(id) on delete cascade,
  user_nutrition_product_id uuid references public.user_nutrition_products(id) on delete set null,
  generic_label text,
  action public.nutrition_action not null,
  quantity numeric(8,2) not null default 1 check (quantity > 0),
  unit text,
  carbs_g numeric(7,2) not null default 0 check (carbs_g >= 0),
  sodium_mg integer not null default 0 check (sodium_mg >= 0),
  caffeine_mg integer not null default 0 check (caffeine_mg >= 0),
  hydration_ml integer not null default 0 check (hydration_ml >= 0),
  estimated boolean not null default false,
  created_at timestamptz not null default now(),
  check (user_nutrition_product_id is not null or generic_label is not null)
);

-- ============================================================
-- 11. Bags content (after nutrition refs exist)
-- ============================================================

create table public.bag_items (
  id uuid primary key default gen_random_uuid(),
  bag_id uuid not null references public.bags(id) on delete cascade,
  item_type public.bag_item_type not null,
  equipment_item_id uuid references public.equipment_items(id) on delete set null,
  user_nutrition_product_id uuid references public.user_nutrition_products(id) on delete set null,
  label text,
  quantity numeric(8,2) not null default 1 check (quantity > 0),
  unit text,
  checked boolean not null default false,
  created_at timestamptz not null default now(),
  check (
    (item_type = 'equipment' and equipment_item_id is not null)
    or (item_type = 'nutrition' and user_nutrition_product_id is not null)
    or (item_type = 'free_text' and label is not null)
  )
);

-- ============================================================
-- 12. Assistance & private share
-- ============================================================

create table public.race_assistants (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  first_name text not null,
  last_name text,
  phone text,
  email extensions.citext,
  status public.assistant_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bags
  add constraint fk_bags_assigned_assistant
  foreign key (assigned_assistant_id) references public.race_assistants(id) on delete set null;

create table public.assistance_assignments (
  id uuid primary key default gen_random_uuid(),
  assistant_id uuid not null references public.race_assistants(id) on delete cascade,
  race_waypoint_id uuid not null references public.race_waypoints(id) on delete restrict,
  plan_waypoint_id uuid references public.plan_waypoints(id) on delete set null,
  planned_at timestamptz,
  window_before_minutes integer not null default 0 check (window_before_minutes >= 0),
  window_after_minutes integer not null default 0 check (window_after_minutes >= 0),
  instructions text,
  access_notes text,
  parking_notes text,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assistant_id, race_waypoint_id)
);

create table public.assistance_items (
  id uuid primary key default gen_random_uuid(),
  assistance_assignment_id uuid not null references public.assistance_assignments(id) on delete cascade,
  item_type public.assistance_item_type not null,
  source_bag_item_id uuid references public.bag_items(id) on delete set null,
  source_nutrition_waypoint_item_id uuid references public.nutrition_waypoint_items(id) on delete set null,
  label text not null,
  quantity numeric(8,2) not null default 1 check (quantity > 0),
  unit text,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.assistant_access_tokens (
  id uuid primary key default gen_random_uuid(),
  assistant_id uuid not null references public.race_assistants(id) on delete cascade,
  token_hash char(64) not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);

create unique index ux_active_assistant_token
  on public.assistant_access_tokens(assistant_id)
  where revoked_at is null;

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  first_name text not null,
  last_name text,
  phone text not null,
  relationship_label text,
  explicit_consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 13. Library / reusable assets
-- ============================================================

create table public.library_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  template_type public.template_type not null,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 14. Weather / Conditions (participant & outing)
-- ============================================================

create table public.weather_forecast_runs (
  id uuid primary key default gen_random_uuid(),
  scope public.weather_scope not null,
  race_plan_id uuid references public.race_plans(id) on delete cascade,
  outing_id uuid references public.outings(id) on delete cascade,
  provider text not null,
  provider_model text,
  forecast_issued_at timestamptz,
  fetched_at timestamptz not null default now(),
  timezone varchar(64) not null,
  input_hash char(64),
  status public.weather_run_status not null default 'active',
  created_at timestamptz not null default now(),
  check (
    (scope = 'race_plan' and race_plan_id is not null and outing_id is null)
    or (scope = 'outing' and outing_id is not null and race_plan_id is null)
  )
);

create table public.weather_forecast_points (
  id uuid primary key default gen_random_uuid(),
  weather_run_id uuid not null references public.weather_forecast_runs(id) on delete cascade,
  point_key text not null,
  race_waypoint_id uuid references public.race_waypoints(id) on delete set null,
  outing_waypoint_id uuid references public.outing_waypoints(id) on delete set null,
  virtual_segment_id uuid references public.race_segments(id) on delete set null,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  route_altitude_m integer,
  planned_datetime timestamptz not null,
  temperature_c numeric(5,2),
  apparent_temperature_c numeric(5,2),
  precipitation_probability_pct numeric(5,2) check (precipitation_probability_pct is null or precipitation_probability_pct between 0 and 100),
  precipitation_amount_mm numeric(7,2) check (precipitation_amount_mm is null or precipitation_amount_mm >= 0),
  wind_speed_kmh numeric(7,2) check (wind_speed_kmh is null or wind_speed_kmh >= 0),
  wind_gust_kmh numeric(7,2) check (wind_gust_kmh is null or wind_gust_kmh >= 0),
  wind_direction_deg smallint check (wind_direction_deg is null or wind_direction_deg between 0 and 359),
  weather_code text,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  unique (weather_run_id, point_key)
);

create table public.condition_periods (
  id uuid primary key default gen_random_uuid(),
  weather_run_id uuid not null references public.weather_forecast_runs(id) on delete cascade,
  condition_type public.detected_condition_type not null,
  source public.condition_source not null,
  label text,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  start_elapsed_seconds integer check (start_elapsed_seconds is null or start_elapsed_seconds >= 0),
  end_elapsed_seconds integer check (end_elapsed_seconds is null or end_elapsed_seconds >= 0),
  start_point_key text,
  end_point_key text,
  severity smallint check (severity is null or severity between 1 and 3),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (end_datetime > start_datetime),
  check (end_elapsed_seconds is null or start_elapsed_seconds is null or end_elapsed_seconds > start_elapsed_seconds)
);

alter table public.nutrition_condition_ranges
  add constraint fk_nutrition_range_condition_period
  foreign key (source_condition_period_id) references public.condition_periods(id) on delete set null;

create table public.condition_proposals (
  id uuid primary key default gen_random_uuid(),
  condition_period_id uuid not null references public.condition_periods(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  participant_race_id uuid references public.participant_races(id) on delete cascade,
  outing_id uuid references public.outings(id) on delete cascade,
  target_module public.proposal_target_module not null,
  status public.proposal_status not null default 'pending',
  before_payload jsonb not null default '{}'::jsonb,
  proposed_payload jsonb not null default '{}'::jsonb,
  impact_payload jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((participant_race_id is not null)::int + (outing_id is not null)::int = 1)
);

-- ============================================================
-- 15. Community & post-race
-- ============================================================

create table public.community_threads (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete restrict,
  race_id uuid references public.races(id) on delete set null,
  author_user_id uuid not null references public.users(id) on delete cascade,
  category public.community_category not null,
  title text not null,
  body text not null,
  linked_waypoint_id uuid references public.race_waypoints(id) on delete set null,
  linked_segment_id uuid references public.race_segments(id) on delete set null,
  status public.community_content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.community_threads(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  status public.community_content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  thread_id uuid references public.community_threads(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  reaction_type public.reaction_type not null default 'useful',
  created_at timestamptz not null default now(),
  check ((thread_id is not null)::int + (post_id is not null)::int = 1)
);

create unique index ux_community_reaction_thread
  on public.community_reactions(user_id, thread_id, reaction_type)
  where thread_id is not null;
create unique index ux_community_reaction_post
  on public.community_reactions(user_id, post_id, reaction_type)
  where post_id is not null;

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.users(id) on delete cascade,
  thread_id uuid references public.community_threads(id) on delete set null,
  post_id uuid references public.community_posts(id) on delete set null,
  reason public.report_reason not null,
  details text,
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((thread_id is not null)::int + (post_id is not null)::int = 1)
);

create table public.post_race_reviews (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null unique references public.participant_races(id) on delete cascade,
  result_status public.result_status not null,
  actual_duration_seconds integer check (actual_duration_seconds is null or actual_duration_seconds > 0),
  overall_feeling public.overall_feeling,
  plan_accuracy public.plan_accuracy,
  nutrition_feedback public.nutrition_feedback,
  assistance_feedback public.feedback_rating,
  equipment_feedback text,
  repeat_same_text text,
  change_text text,
  private_note text,
  pluka_helpfulness smallint check (pluka_helpfulness is null or pluka_helpfulness between 1 and 5),
  pluka_feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_race_review_publications (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.post_race_reviews(id) on delete cascade,
  is_published boolean not null default false,
  show_first_name boolean not null default true,
  show_finish_time boolean not null default false,
  published_advice_text text,
  linked_waypoint_id uuid references public.race_waypoints(id) on delete set null,
  linked_segment_id uuid references public.race_segments(id) on delete set null,
  community_thread_id uuid references public.community_threads(id) on delete set null,
  published_at timestamptz,
  published_author_name text,
  published_result_status public.result_status,
  published_actual_duration_seconds integer,
  published_overall_feeling public.overall_feeling,
  published_plan_accuracy public.plan_accuracy,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 16. Organizer participant import, enrichment & invitations
-- ============================================================

create table public.participant_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  edition_id uuid not null references public.editions(id) on delete restrict,
  storage_path text not null,
  status public.import_status not null default 'uploaded',
  mapping jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participant_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.participant_imports(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  raw_data jsonb not null,
  mapped_data jsonb,
  status public.import_row_status not null default 'pending',
  error_message text,
  participant_race_id uuid references public.participant_races(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create table public.enrichment_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  race_id uuid not null references public.races(id) on delete restrict,
  provider public.enrichment_provider not null,
  storage_path text not null,
  status public.import_status not null default 'uploaded',
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.enrichment_import_rows (
  id uuid primary key default gen_random_uuid(),
  enrichment_import_id uuid not null references public.enrichment_imports(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  raw_data jsonb not null,
  match_status public.enrichment_match_status not null default 'pending',
  matched_participant_race_id uuid references public.participant_races(id) on delete set null,
  candidate_matches jsonb not null default '[]'::jsonb,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (enrichment_import_id, row_number)
);

create table public.participant_invitations (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  email extensions.citext not null,
  token_hash char(64) not null unique,
  status public.invitation_status not null default 'pending',
  sent_at timestamptz,
  opened_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 17. Ask PLUKA
-- ============================================================

create table public.pluka_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  participant_race_id uuid references public.participant_races(id) on delete cascade,
  outing_id uuid references public.outings(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((participant_race_id is not null)::int + (outing_id is not null)::int <= 1)
);

create table public.pluka_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.pluka_conversations(id) on delete cascade,
  role public.message_role not null,
  content text not null,
  theme text,
  normalized_question text,
  created_at timestamptz not null default now()
);

create table public.pluka_answer_sources (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.pluka_messages(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  source_snapshot_id uuid references public.source_snapshots(id) on delete set null,
  fact_version_id uuid references public.race_fact_versions(id) on delete set null,
  weather_forecast_point_id uuid references public.weather_forecast_points(id) on delete set null,
  relevance_score numeric(5,4) check (relevance_score is null or relevance_score between 0 and 1),
  citation_order smallint not null default 0,
  created_at timestamptz not null default now(),
  check (num_nonnulls(source_id, source_snapshot_id, fact_version_id, weather_forecast_point_id) >= 1)
);

-- ============================================================
-- 18. Race Intelligence aggregate outputs (beta / derived only)
-- ============================================================

create table public.race_intelligence_runs (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  mode public.race_intelligence_mode not null default 'demo',
  status public.race_intelligence_status not null default 'queued',
  algorithm_version text,
  coverage_pct numeric(5,2) check (coverage_pct is null or coverage_pct between 0 and 100),
  coverage_label public.coverage_label,
  participant_count integer check (participant_count is null or participant_count >= 0),
  usable_signal_count integer check (usable_signal_count is null or usable_signal_count >= 0),
  pluka_plan_count integer check (pluka_plan_count is null or pluka_plan_count >= 0),
  generic_estimate_count integer check (generic_estimate_count is null or generic_estimate_count >= 0),
  input_snapshot jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.race_intelligence_runs is 'Sorties agregees uniquement. Le moteur mathematique reel doit etre specifie dans engines/RACE_INTELLIGENCE.md avant mode production.';

create table public.race_intelligence_wave_summaries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.race_intelligence_runs(id) on delete cascade,
  start_wave_id uuid not null references public.race_start_waves(id) on delete cascade,
  participant_count integer not null check (participant_count >= 10),
  coverage_pct numeric(5,2) check (coverage_pct is null or coverage_pct between 0 and 100),
  dispersion_label public.dispersion_label,
  metrics jsonb not null default '{}'::jsonb,
  unique (run_id, start_wave_id)
);

create table public.race_intelligence_waypoint_flows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.race_intelligence_runs(id) on delete cascade,
  race_waypoint_id uuid not null references public.race_waypoints(id) on delete cascade,
  time_bucket_start timestamptz not null,
  bucket_minutes smallint not null default 30 check (bucket_minutes between 5 and 180),
  expected_count integer not null check (expected_count >= 0),
  lower_estimate integer check (lower_estimate is null or lower_estimate >= 0),
  upper_estimate integer check (upper_estimate is null or upper_estimate >= 0),
  wave_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, race_waypoint_id, time_bucket_start, bucket_minutes),
  check (upper_estimate is null or lower_estimate is null or upper_estimate >= lower_estimate)
);

create table public.race_intelligence_cutoff_summaries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.race_intelligence_runs(id) on delete cascade,
  race_cutoff_id uuid not null references public.race_cutoffs(id) on delete cascade,
  sensitivity public.sensitivity_label not null default 'normal',
  participant_count integer not null check (participant_count >= 10),
  margin_buckets jsonb not null default '{}'::jsonb,
  wave_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, race_cutoff_id)
);

create table public.race_intelligence_weather_exposures (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.race_intelligence_runs(id) on delete cascade,
  race_waypoint_id uuid references public.race_waypoints(id) on delete set null,
  race_segment_id uuid references public.race_segments(id) on delete set null,
  condition_type public.detected_condition_type not null,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  expected_exposed_pct numeric(5,2) not null check (expected_exposed_pct between 0 and 100),
  wave_breakdown jsonb not null default '{}'::jsonb,
  weather_summary jsonb not null default '{}'::jsonb,
  provider text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_datetime > start_datetime),
  check ((race_waypoint_id is not null)::int + (race_segment_id is not null)::int >= 1)
);

-- ============================================================
-- 19. Organizer insights, adoption & brief
-- ============================================================

create table public.question_insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  theme text not null,
  normalized_question text,
  participant_count integer not null check (participant_count >= 10),
  official_answer_available boolean not null default false,
  official_answer_fact_id uuid references public.race_facts(id) on delete set null,
  generated_at timestamptz not null default now(),
  check (window_end > window_start)
);

create table public.organization_adoption_snapshots (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  invited_count integer not null default 0 check (invited_count >= 0),
  activated_count integer not null default 0 check (activated_count >= 0),
  plan_count integer not null default 0 check (plan_count >= 0),
  nutrition_count integer not null default 0 check (nutrition_count >= 0),
  assistance_count integer not null default 0 check (assistance_count >= 0),
  metadata jsonb not null default '{}'::jsonb
);

create table public.organizer_briefs (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  race_id uuid references public.races(id) on delete cascade,
  generated_at timestamptz not null default now(),
  period_label text,
  content jsonb not null,
  share_token_hash char(64) unique,
  share_expires_at timestamptz,
  revoked_at timestamptz,
  created_by_run_id uuid references public.race_intelligence_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  check (share_expires_at is null or share_expires_at > generated_at)
);

-- ============================================================
-- 20. Private technical / worker tables
-- ============================================================

create table private.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  race_id uuid references public.races(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  page_start integer,
  page_end integer,
  section_label text,
  content text not null,
  content_hash char(64) not null,
  embedding extensions.vector(1536),
  embedding_model text,
  created_at timestamptz not null default now(),
  unique (source_snapshot_id, chunk_index)
);

create table private.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  job_type text not null default 'source-ingest',
  status text not null check (status in ('queued','running','completed','failed','cancelled')),
  idempotency_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table private.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  run_type text not null check (run_type in ('text_extract','embedding','fact_extract')),
  provider text,
  model text,
  schema_version text,
  status text not null check (status in ('running','completed','failed')),
  input_hash char(64),
  output_json jsonb,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

create table private.fact_candidates (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references private.extraction_runs(id) on delete cascade,
  race_id uuid not null references public.races(id) on delete cascade,
  source_chunk_id uuid references private.source_chunks(id) on delete set null,
  category public.fact_category not null,
  fact_key text not null,
  value_text text,
  value_number numeric,
  unit text,
  value_json jsonb,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  status text not null default 'detected' check (status in ('detected','accepted','rejected','conflict')),
  matched_fact_id uuid references public.race_facts(id) on delete set null,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(value_text, value_number, value_json) >= 1)
);

create table private.conflict_reports (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  fact_key text not null,
  existing_fact_id uuid references public.race_facts(id) on delete set null,
  candidate_id uuid references private.fact_candidates(id) on delete set null,
  conflict_type text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by_user_id uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.participant_performance_signals (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  provider public.enrichment_provider not null,
  provider_identifier text,
  value numeric,
  category text,
  source_enrichment_row_id uuid references public.enrichment_import_rows(id) on delete set null,
  matched_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (participant_race_id, provider)
);

comment on table private.participant_performance_signals is 'Signal individuel technique pour calculs agreges. Ne doit pas devenir un leaderboard organisateur.';

create table private.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_id uuid references public.users(id) on delete set null,
  participant_race_id uuid references public.participant_races(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  race_id uuid references public.races(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table private.audit_logs (
  id bigserial primary key,
  actor_user_id uuid references public.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  status text not null default 'pending' check (status in ('pending','processing','published','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 21. Structural indexes
-- ============================================================

create index ix_event_partners_edition on public.event_partners(edition_id, sort_order);
create index ix_races_edition on public.races(edition_id);
create index ix_race_waypoints_race_distance on public.race_waypoints(race_id, distance_km);
create index ix_race_segments_race on public.race_segments(race_id, sort_order);
create index ix_sources_edition on public.sources(edition_id);
create index ix_source_snapshots_source on public.source_snapshots(source_id, version_number desc);
create index ix_race_facts_race_category on public.race_facts(race_id, category);
create index ix_fact_versions_fact_status on public.race_fact_versions(fact_id, workflow_status, version_number desc);
create index ix_fact_sources_snapshot on public.fact_sources(source_snapshot_id);
create index ix_race_notices_active on public.race_notices(race_id, published_at desc) where archived_at is null;
create index ix_participant_races_user on public.participant_races(user_id, created_at desc) where user_id is not null;
create index ix_participant_races_race on public.participant_races(race_id, start_wave_id);
create index ix_entitlements_user_active on public.entitlements(user_id, kind, ends_at) where status = 'active';
create index ix_race_plans_participant on public.race_plans(participant_race_id, version desc);
create index ix_plan_waypoints_plan_time on public.plan_waypoints(race_plan_id, planned_elapsed_seconds);
create index ix_plan_dependencies_fact_version on public.plan_version_dependencies(race_fact_version_id);
create index ix_change_impacts_participant on public.participant_change_impacts(participant_race_id, status);
create index ix_tasks_participant_due on public.tasks(participant_race_id, due_at) where completed_at is null;
create index ix_outings_user_date on public.outings(user_id, planned_start_datetime desc);
create index ix_outings_linked_race on public.outings(linked_participant_race_id) where linked_participant_race_id is not null;
create index ix_nutrition_waypoints_plan_time on public.nutrition_waypoints(nutrition_plan_id, elapsed_seconds);
create index ix_assistance_assignments_assistant on public.assistance_assignments(assistant_id, sort_order);
create index ix_weather_runs_race_plan on public.weather_forecast_runs(race_plan_id, fetched_at desc) where race_plan_id is not null;
create index ix_weather_runs_outing on public.weather_forecast_runs(outing_id, fetched_at desc) where outing_id is not null;
create index ix_weather_points_run_time on public.weather_forecast_points(weather_run_id, planned_datetime);
create index ix_condition_periods_run_time on public.condition_periods(weather_run_id, start_datetime, end_datetime);
create index ix_community_threads_race on public.community_threads(race_id, created_at desc) where race_id is not null;
create index ix_import_rows_import_status on public.participant_import_rows(import_id, status);
create index ix_enrichment_rows_import_status on public.enrichment_import_rows(enrichment_import_id, match_status);
create index ix_messages_conversation on public.pluka_messages(conversation_id, created_at);
create index ix_ri_runs_race_completed on public.race_intelligence_runs(race_id, completed_at desc);
create index ix_ri_flows_waypoint_time on public.race_intelligence_waypoint_flows(race_waypoint_id, time_bucket_start);
create index ix_question_insights_race_window on public.question_insight_snapshots(race_id, window_end desc);
create index ix_adoption_snapshots_race_time on public.organization_adoption_snapshots(race_id, snapshot_at desc);
create index ix_private_source_chunks_embedding on private.source_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index ix_private_analytics_race_time on private.analytics_events(race_id, created_at desc) where race_id is not null;

-- ============================================================
-- 22. Integrity helpers & triggers
-- ============================================================

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.protect_source_snapshot_immutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'source_snapshots are immutable';
end;
$$;

create trigger trg_source_snapshot_immutable_update
before update or delete on public.source_snapshots
for each row execute function private.protect_source_snapshot_immutable();

create or replace function private.protect_fact_version_payload()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.fact_id is distinct from old.fact_id
     or new.version_number is distinct from old.version_number
     or new.value_text is distinct from old.value_text
     or new.value_number is distinct from old.value_number
     or new.unit is distinct from old.unit
     or new.value_json is distinct from old.value_json
     or new.supersedes_version_id is distinct from old.supersedes_version_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'race_fact_versions payload is immutable; create a new version instead';
  end if;
  return new;
end;
$$;

create trigger trg_fact_version_payload_immutable
before update on public.race_fact_versions
for each row execute function private.protect_fact_version_payload();

create or replace function private.guard_current_fact_version()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_fact_id uuid;
begin
  if new.current_version_id is null then
    return new;
  end if;
  select fact_id into v_fact_id from public.race_fact_versions where id = new.current_version_id;
  if v_fact_id is distinct from new.id then
    raise exception 'current_version_id must belong to the same race_fact';
  end if;
  return new;
end;
$$;

create trigger trg_guard_current_fact_version
before insert or update of current_version_id on public.race_facts
for each row execute function private.guard_current_fact_version();

create or replace function private.guard_current_source_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_source_id uuid;
begin
  if new.current_snapshot_id is null then
    return new;
  end if;
  select source_id into v_source_id from public.source_snapshots where id = new.current_snapshot_id;
  if v_source_id is distinct from new.id then
    raise exception 'current_snapshot_id must belong to the same source';
  end if;
  return new;
end;
$$;

create trigger trg_guard_current_source_snapshot
before insert or update of current_snapshot_id on public.sources
for each row execute function private.guard_current_source_snapshot();

-- Mutable tables with updated_at.
create trigger trg_users_updated_at before update on public.users for each row execute function private.set_updated_at();
create trigger trg_trail_profiles_updated_at before update on public.trail_profiles for each row execute function private.set_updated_at();
create trigger trg_organizations_updated_at before update on public.organizations for each row execute function private.set_updated_at();
create trigger trg_events_updated_at before update on public.events for each row execute function private.set_updated_at();
create trigger trg_editions_updated_at before update on public.editions for each row execute function private.set_updated_at();
create trigger trg_event_partners_updated_at before update on public.event_partners for each row execute function private.set_updated_at();
create trigger trg_races_updated_at before update on public.races for each row execute function private.set_updated_at();
create trigger trg_race_waypoints_updated_at before update on public.race_waypoints for each row execute function private.set_updated_at();
create trigger trg_sources_updated_at before update on public.sources for each row execute function private.set_updated_at();
create trigger trg_equipment_items_updated_at before update on public.equipment_items for each row execute function private.set_updated_at();
create trigger trg_participant_races_updated_at before update on public.participant_races for each row execute function private.set_updated_at();
create trigger trg_entitlements_updated_at before update on public.entitlements for each row execute function private.set_updated_at();
create trigger trg_race_plans_updated_at before update on public.race_plans for each row execute function private.set_updated_at();
create trigger trg_tasks_updated_at before update on public.tasks for each row execute function private.set_updated_at();
create trigger trg_participant_equipment_updated_at before update on public.participant_equipment for each row execute function private.set_updated_at();
create trigger trg_bags_updated_at before update on public.bags for each row execute function private.set_updated_at();
create trigger trg_outings_updated_at before update on public.outings for each row execute function private.set_updated_at();
create trigger trg_outing_equipment_updated_at before update on public.outing_equipment for each row execute function private.set_updated_at();
create trigger trg_outing_feedback_updated_at before update on public.outing_feedback for each row execute function private.set_updated_at();
create trigger trg_nutrition_products_updated_at before update on public.nutrition_products for each row execute function private.set_updated_at();
create trigger trg_user_nutrition_products_updated_at before update on public.user_nutrition_products for each row execute function private.set_updated_at();
create trigger trg_nutrition_plans_updated_at before update on public.nutrition_plans for each row execute function private.set_updated_at();
create trigger trg_race_assistants_updated_at before update on public.race_assistants for each row execute function private.set_updated_at();
create trigger trg_assistance_assignments_updated_at before update on public.assistance_assignments for each row execute function private.set_updated_at();
create trigger trg_emergency_contacts_updated_at before update on public.emergency_contacts for each row execute function private.set_updated_at();
create trigger trg_library_templates_updated_at before update on public.library_templates for each row execute function private.set_updated_at();
create trigger trg_community_threads_updated_at before update on public.community_threads for each row execute function private.set_updated_at();
create trigger trg_community_posts_updated_at before update on public.community_posts for each row execute function private.set_updated_at();
create trigger trg_post_race_reviews_updated_at before update on public.post_race_reviews for each row execute function private.set_updated_at();
create trigger trg_participant_imports_updated_at before update on public.participant_imports for each row execute function private.set_updated_at();
create trigger trg_enrichment_imports_updated_at before update on public.enrichment_imports for each row execute function private.set_updated_at();
create trigger trg_participant_invitations_updated_at before update on public.participant_invitations for each row execute function private.set_updated_at();
create trigger trg_pluka_conversations_updated_at before update on public.pluka_conversations for each row execute function private.set_updated_at();

-- Auth profile bootstrap. V1 assumes email-based accounts.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.email is null then
    raise exception 'PLUKA V1 requires an email address';
  end if;

  insert into public.users (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ============================================================
-- 23. RLS secure-by-default boundary
-- ============================================================

-- Policies are defined in a subsequent migration after docs/03_PRIVACY_RLS.md.
-- Enabling RLS now means authenticated/anon clients have no access until that
-- policy migration is intentionally applied.

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename not in ('spatial_ref_sys')
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end;
$$;

-- Service/private technical data is not exposed through the public schema.
revoke all on all tables in schema private from anon, authenticated;
revoke all on all sequences in schema private from anon, authenticated;
revoke all on all functions in schema private from anon, authenticated;

commit;
