-- PLUKA — Avertir d'une annulation et de sa levée
-- Référence : docs/00_PRODUCT_SPEC.md §4.1, migrations 0067 et 0068

begin;

create extension if not exists pgtap;

select plan(9);

\ir _personas.psql

insert into auth.users (id, email) values
  ('cccccccc-1111-4111-8111-000000000001', 'runner-c@test.pluka'),
  ('cccccccc-1111-4111-8111-000000000002', 'runner-d@test.pluka'),
  ('cccccccc-1111-4111-8111-000000000003', 'runner-e@test.pluka');

insert into public.participant_races (id, race_id, user_id, bib_number, status) values
  -- Actif, sans ligne de réglages : averti.
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-1111-4111-8111-000000000001', '201', 'active'),
  -- Actif, notifications coupées : averti quand même, information de sécurité.
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-1111-4111-8111-000000000002', '202', 'active'),
  -- Retiré de la liste : plus concerné.
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-1111-4111-8111-000000000003', '203', 'archived');

insert into public.participant_races (id, race_id, status, invite_email) values
  -- Importé, jamais activé : pas de compte, pas d'email.
  ('cccccccc-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000013',
   'active', 'import@example.com');

insert into public.participant_race_settings (participant_race_id, notifications_enabled)
values ('cccccccc-0000-4000-8000-000000000002', false);

update public.races set status = 'cancelled'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

select results_eq(
  $$ select participant_race_id from private.notification_deliveries
     where kind = 'race_cancelled'
       and participant_race_id::text like 'cccccccc-%'
     order by participant_race_id $$,
  $$ values ('cccccccc-0000-4000-8000-000000000001'::uuid),
            ('cccccccc-0000-4000-8000-000000000002'::uuid) $$,
  'AC-COURSE-07 — l''annulation avertit les actifs activés, notifications coupées comprises'
);

select is(
  (select count(*)::integer from private.outbox_events
   where event_type = 'email.send' and payload ->> 'kind' = 'race_cancelled'),
  (select count(*)::integer from private.notification_deliveries
   where kind = 'race_cancelled'),
  'AC-COURSE-07 — la demande d''envoi part dans la même transaction'
);

select is(
  (select r.race_name from private.notification_deliveries d,
     lateral private.claim_notification_delivery(d.id) r
   where d.kind = 'race_cancelled'
     and d.participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  (select name from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000013'),
  'AC-COURSE-07 — une livraison sans changement officiel se réclame'
);

update public.races set status = 'published'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

select results_eq(
  $$ select participant_race_id from private.notification_deliveries
     where kind = 'race_reinstated'
       and participant_race_id::text like 'cccccccc-%'
     order by participant_race_id $$,
  $$ values ('cccccccc-0000-4000-8000-000000000001'::uuid),
            ('cccccccc-0000-4000-8000-000000000002'::uuid) $$,
  'AC-COURSE-07 — le rétablissement avertit les mêmes personnes'
);

update public.races set status = 'cancelled'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';
update public.races set status = 'published'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

select is(
  (select count(*)::integer from private.notification_deliveries
   where kind = 'race_reinstated'
     and participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  2,
  'AC-COURSE-07 — un second rétablissement est un second avis'
);

-- Le désarchivage ramène à `cancelled` sans rien annoncer.
update public.races set status = 'cancelled'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';
update public.races set status = 'archived'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

select is(
  (select count(*)::integer from private.notification_deliveries
   where kind = 'race_cancelled'
     and participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  3,
  'AC-COURSE-07 — trois annulations, trois avis'
);

update public.races set status = 'cancelled'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

select is(
  (select count(*)::integer from private.notification_deliveries
   where kind = 'race_cancelled'
     and participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  3,
  'AC-COURSE-07 — un désarchivage n''écrit à personne'
);

select throws_ok(
  $$ insert into private.notification_deliveries
       (kind, participant_race_id, idempotency_key)
     values ('race_cancelled', 'cccccccc-0000-4000-8000-000000000001', 'sans-sujet') $$,
  '23514',
  null,
  'AC-COURSE-07 — une livraison porte toujours son sujet'
);

select is(
  (select count(*)::integer from pg_trigger
   where tgname = 'race_reinstated_notifies'),
  0,
  'AC-COURSE-07 — un seul trigger annonce le statut d''une course'
);

select * from finish();
rollback;
