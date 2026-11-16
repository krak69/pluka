-- PLUKA — Sacs de la Préparation
-- Référence : migration 0095 · docs/00_PRODUCT_SPEC.md §14.4 · docs/03_PRIVACY_RLS.md §38
--
-- 1. Un sac par rôle : accepter deux fois la même suggestion ne crée qu'un sac.
-- 2. Le bon point pour le bon sac : drop bag là où l'organisation l'accepte,
--    assistance à un point d'assistance, rien pour départ et arrivée, jamais
--    le point d'une autre course.
-- 3. Un point retiré détache le sac sans faire échouer la réécriture.
-- 4. Sacs et suggestions écartées sont privés : ni un autre coureur ni
--    l'organisation ne les voient.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

-- Un point d'assistance, et un drop bag accepté au col.
insert into public.race_waypoints (id, race_id, name, waypoint_type, distance_km, sort_order)
values ('aaaaaaaa-0000-4000-8000-000000000024', 'aaaaaaaa-0000-4000-8000-000000000013',
        'Base vie', 'assistance', 60, 3);

update public.race_waypoints set drop_bag_allowed = true
where id = 'aaaaaaaa-0000-4000-8000-000000000022';

-- ============================================================
-- 1. Un sac par rôle
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'start', 'Sac de départ') $$,
  'le coureur crée son sac de départ'
);

select throws_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'start', 'Sac de départ') $$,
  '23505',
  null,
  'un second sac de départ est refusé'
);

select lives_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'other', 'Sac voiture'),
            ('aaaaaaaa-0000-4000-8000-000000000031', 'other', 'Sac de nuit') $$,
  'les sacs « autres » restent libres'
);

-- ============================================================
-- 2. Le bon point pour le bon sac
-- ============================================================

select lives_ok(
  $$ insert into public.bags (id, participant_race_id, bag_type, name, race_waypoint_id)
     values ('aaaaaaaa-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000031',
             'drop_bag', 'Drop bag · Col du Test', 'aaaaaaaa-0000-4000-8000-000000000022') $$,
  'un drop bag se rattache à un point qui l''accepte'
);

select throws_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name, race_waypoint_id)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'drop_bag', 'Drop bag · Base vie',
             'aaaaaaaa-0000-4000-8000-000000000024') $$,
  '23514',
  null,
  'un drop bag est refusé là où l''organisation n''en accepte pas'
);

select lives_ok(
  $$ insert into public.bags (id, participant_race_id, bag_type, name, race_waypoint_id)
     values ('aaaaaaaa-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-000000000031',
             'assistance', 'Sac d''assistance', 'aaaaaaaa-0000-4000-8000-000000000024') $$,
  'un sac d''assistance se rattache à un point d''assistance'
);

select throws_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name, race_waypoint_id)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'assistance', 'Sac d''assistance',
             'aaaaaaaa-0000-4000-8000-000000000022') $$,
  '23514',
  null,
  'un sac d''assistance est refusé hors d''un point d''assistance'
);

select throws_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name, race_waypoint_id)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'finish', 'Sac d''arrivée',
             'aaaaaaaa-0000-4000-8000-000000000022') $$,
  '23514',
  null,
  'un sac d''arrivée ne se rattache à aucun point'
);

select throws_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name, race_waypoint_id)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'drop_bag', 'Drop bag',
             'aaaaaaaa-0000-4000-8000-000000000023') $$,
  '23514',
  null,
  'le point d''une autre course est refusé'
);

-- ============================================================
-- 4. Privé
-- ============================================================

insert into public.bag_suggestion_dismissals (participant_race_id, suggestion_key)
values ('aaaaaaaa-0000-4000-8000-000000000031', 'finish');

select throws_ok(
  $$ insert into public.bag_suggestion_dismissals (participant_race_id, suggestion_key)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'nimporte') $$,
  '23514',
  null,
  'une clé qui ne nomme aucune suggestion est refusée'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(
  (select count(*)::int from public.bags) + (select count(*)::int from public.bag_suggestion_dismissals),
  0,
  'un autre coureur ne voit ni les sacs ni les suggestions écartées'
);

select throws_ok(
  $$ insert into public.bags (participant_race_id, bag_type, name)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'finish', 'Sac d''arrivée') $$,
  '42501',
  null,
  'un autre coureur ne crée pas de sac sur la participation de Runner A'
);

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is(
  (select count(*)::int from public.bags) + (select count(*)::int from public.bag_suggestion_dismissals),
  0,
  'l''owner de l''organisation ne voit pas les sacs de ses participants'
);

-- ============================================================
-- 3. Un point retiré détache le sac
-- ============================================================

reset role;

delete from public.race_waypoints where id = 'aaaaaaaa-0000-4000-8000-000000000024';

select is(
  (select race_waypoint_id from public.bags where id = 'aaaaaaaa-0000-4000-8000-0000000000b2'),
  null,
  'le sac d''assistance reste, détaché du point retiré'
);

select * from finish();

rollback;
