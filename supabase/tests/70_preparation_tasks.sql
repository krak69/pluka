-- PLUKA — Préparation · À faire
-- Référence : migration 0097 · docs/00_PRODUCT_SPEC.md §14.5 · docs/03_PRIVACY_RLS.md §36
--
-- 1. Une ligne par suggestion : cocher deux fois ne crée pas deux tâches.
-- 2. Une suggestion est une tâche PLUKA, et seule une suggestion s'écarte.
-- 3. Les tâches restent privées : ni un autre coureur ni l'organisation ne
--    les voient, ni ne les cochent.

begin;

create extension if not exists pgtap;

select plan(10);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

-- ============================================================
-- 1. Une ligne par suggestion
-- ============================================================

select lives_ok(
  $$ insert into public.tasks (participant_race_id, title, origin, suggestion_key, completed_at)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Charger la trace sur ta montre', 'pluka',
             'gpx', now())
     on conflict (participant_race_id, suggestion_key) do update set completed_at = excluded.completed_at $$,
  'le coureur coche une suggestion'
);

select lives_ok(
  $$ insert into public.tasks (participant_race_id, title, origin, suggestion_key, dismissed_at)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Charger la trace sur ta montre', 'pluka',
             'gpx', now())
     on conflict (participant_race_id, suggestion_key) do update set dismissed_at = excluded.dismissed_at $$,
  'écarter la même suggestion met à jour sa ligne'
);

select is(
  (select count(*)::int from public.tasks where suggestion_key = 'gpx'),
  1,
  'une seule ligne pour la suggestion'
);

-- ============================================================
-- 2. Suggestion et tâche du coureur
-- ============================================================

select throws_ok(
  $$ insert into public.tasks (participant_race_id, title, origin, suggestion_key)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Inventée', 'pluka', 'nimporte') $$,
  '23514',
  null,
  'une clé qui ne nomme aucune suggestion est refusée'
);

select throws_ok(
  $$ insert into public.tasks (participant_race_id, title, origin, suggestion_key)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Construire ton Plan', 'personal', 'plan') $$,
  '23514',
  null,
  'une suggestion n''est pas une tâche du coureur'
);

select throws_ok(
  $$ insert into public.tasks (participant_race_id, title, dismissed_at)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Acheter des piles', now()) $$,
  '23514',
  null,
  'une tâche du coureur ne s''écarte pas, elle se supprime'
);

select throws_ok(
  $$ insert into public.tasks (participant_race_id, title)
     values ('aaaaaaaa-0000-4000-8000-000000000031', '   ') $$,
  '23514',
  null,
  'un titre vide est refusé'
);

-- ============================================================
-- 3. Privé
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(
  (select count(*)::int from public.tasks),
  0,
  'un autre coureur ne voit pas les tâches de Runner A'
);

select throws_ok(
  $$ insert into public.tasks (participant_race_id, title, origin, suggestion_key)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Construire ton Plan', 'pluka', 'plan') $$,
  '42501',
  null,
  'un autre coureur ne coche pas de suggestion sur la participation de Runner A'
);

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is(
  (select count(*)::int from public.tasks),
  0,
  'l''owner de l''organisation ne voit pas les tâches de ses participants'
);

select * from finish();

rollback;
