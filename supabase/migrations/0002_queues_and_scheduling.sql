-- PLUKA V1 — Queues, scheduling et support de l'outbox
-- File target: supabase/migrations/0002_queues_and_scheduling.sql
-- Architecture reference: docs/01_ARCHITECTURE.md §22 (jobs asynchrones), §23 (événements)
--
-- IMPORTANT
-- - pgmq et pg_cron sont des extensions gérées par la plateforme Supabase.
--   En local (supabase start) elles sont disponibles directement.
--   Sur un projet distant, vérifier qu'elles sont activables : si l'application de cette
--   migration échoue, les activer une fois via Dashboard > Database > Extensions, puis
--   rejouer. Ne PAS contourner en créant les queues à la main hors migration.
-- - Les queues sont groupées par domaine, pas une par type de job. Un worker peut consommer
--   plusieurs queues ; l'architecture §43 prévoit de les séparer plus tard si nécessaire.

begin;

-- ============================================================
-- 00. Extensions
-- ============================================================

create extension if not exists pgmq;
create extension if not exists pg_cron;

-- ============================================================
-- 01. Queues métier
-- ============================================================
-- Mapping avec les types de jobs de l'architecture §22 :
--
--   pluka_sources     source.ingest, source.extract, source.reindex
--   pluka_geo         gpx.process
--   pluka_plan        plan.recompute, nutrition.recompute, assistance.refresh
--   pluka_weather     weather.refresh, weather.remap
--   pluka_participants participant.import, participant.enrich
--   pluka_insights    question.rollup, organizer-brief.generate, race-intelligence.compute
--   pluka_analytics   analytics.rollup
--   pluka_email       email.send
--   pluka_racepack    racepack.build

do $$
declare
  q text;
  queues text[] := array[
    'pluka_sources',
    'pluka_geo',
    'pluka_plan',
    'pluka_weather',
    'pluka_participants',
    'pluka_insights',
    'pluka_analytics',
    'pluka_email',
    'pluka_racepack'
  ];
begin
  foreach q in array queues loop
    if not exists (select 1 from pgmq.list_queues() where queue_name = q) then
      perform pgmq.create(q);
    end if;
  end loop;
end
$$;

-- ============================================================
-- 02. Frontière de sécurité
-- ============================================================
-- Les queues ne sont jamais accessibles depuis le navigateur.
-- Seuls le worker et les services serveur (service_role) y touchent.

revoke all on schema pgmq from anon, authenticated;
revoke all on all tables in schema pgmq from anon, authenticated;
revoke all on all functions in schema pgmq from anon, authenticated;
revoke all on all sequences in schema pgmq from anon, authenticated;

revoke all on schema cron from anon, authenticated;

-- ============================================================
-- 03. Support du dispatcher outbox
-- ============================================================
-- private.outbox_events est créée en 0001. Le dispatcher lit les événements
-- 'pending' devenus disponibles, dans l'ordre de création. Cet index sert
-- exactement cette lecture et rien d'autre.

create index if not exists ix_outbox_events_dispatch
  on private.outbox_events (available_at, created_at)
  where status = 'pending';

create index if not exists ix_outbox_events_retry
  on private.outbox_events (status, available_at)
  where status = 'failed';

-- ============================================================
-- 04. Planification
-- ============================================================
-- Aucun job cron n'est planifié à ce stade. Les jobs récurrents
-- (weather.refresh, question.rollup, analytics.rollup, organizer-brief.generate)
-- seront ajoutés par les migrations de leurs lots respectifs, avec leur
-- fenêtre et leur idempotence documentées.
--
-- Rappel : un cron ne déclenche jamais un traitement long directement.
-- Il enfile un message pgmq que le worker consomme.

commit;
