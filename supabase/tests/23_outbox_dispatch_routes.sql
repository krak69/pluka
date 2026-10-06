-- PLUKA — Routes du dispatcher d'outbox
-- Référence : docs/01_ARCHITECTURE.md §22 · migrations 0008, 0014, 0015, 0025, 0034
--
-- 0025 a réécrit le dispatcher et perdu deux routes sans qu'aucun test ne le
-- voie : chaque famille d'événement est donc vérifiée ici, de l'outbox à sa
-- file. Une redéfinition future qui en oublie une échoue ici.

begin;

create extension if not exists pgtap;

select plan(7);

-- Isoler la suite : seuls nos événements sont en attente pendant le test.
update private.outbox_events set available_at = now() + interval '1 day' where status = 'pending';

insert into private.outbox_events (event_type, payload, idempotency_key) values
  ('gpx.uploaded',                  '{"probe": "gpx"}',    'probe:gpx'),
  ('course.waypoints.changed',      '{"probe": "course"}', 'probe:course'),
  ('source.uploaded',               '{"probe": "source"}', 'probe:source'),
  ('race.changed',                  '{"probe": "race"}',   'probe:race'),
  ('email.organization_invitation', '{"probe": "email"}',  'probe:email'),
  ('inconnu.evenement',             '{"probe": "none"}',   'probe:none');

select is(private.dispatch_outbox_events(50), 5, 'OUTBOX-01 — cinq evenements routes, l''inconnu non');

select is(
  (select count(*) from pgmq.q_pluka_geo where message->>'probe' in ('gpx', 'course')),
  2::bigint,
  'OUTBOX-02 — gpx.% et course.% vont a pluka_geo'
);

select is(
  (select count(*) from pgmq.q_pluka_sources where message->>'probe' = 'source'),
  1::bigint,
  'OUTBOX-03 — source.% va a pluka_sources'
);

select is(
  (select count(*) from pgmq.q_pluka_plan where message->>'probe' = 'race'),
  1::bigint,
  'OUTBOX-04 — race.% va a pluka_plan (0014, perdu en 0025)'
);

select is(
  (select count(*) from pgmq.q_pluka_email where message->>'probe' = 'email'),
  1::bigint,
  'OUTBOX-05 — email.% va a pluka_email (0015, perdu en 0025)'
);

select is(
  (select status from private.outbox_events where idempotency_key = 'probe:none'),
  'failed',
  'OUTBOX-06 — un evenement sans destination reste visible, marque failed'
);

select is(
  (select count(*) from private.outbox_events
    where idempotency_key like 'probe:%' and status = 'published'),
  5::bigint,
  'OUTBOX-07 — les evenements routes sont marques publies'
);

select * from finish();

rollback;
