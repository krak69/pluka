-- PLUKA — Checklist de matériel du coureur
-- Référence : migration 0091 · docs/00_PRODUCT_SPEC.md §14.1, §14.2, §14.3 ·
--             docs/03_PRIVACY_RLS.md §37 · docs/04_ENTITLEMENTS.md §45
--
-- 1. Le coureur coche le matériel officiel de sa course, et lui seul.
-- 2. Un fact d'une autre course, ou qui n'est pas du matériel, est refusé.
-- 3. Une ligne officielle porte un fact ; une ligne personnelle n'en porte pas.
-- 4. Un autre coureur et l'organisation ne voient pas la checklist.

begin;

create extension if not exists pgtap;

select plan(12);

\ir _personas.psql

-- Deux pièces de matériel sur l'épreuve de Runner A, une sur une autre course,
-- et une information qui n'est pas du matériel.
insert into public.race_facts (id, race_id, category, fact_key) values
  ('eeeeeeee-0000-4000-8000-000000000a01', 'aaaaaaaa-0000-4000-8000-000000000013', 'equipment', 'equipment.frontale'),
  ('eeeeeeee-0000-4000-8000-000000000a02', 'aaaaaaaa-0000-4000-8000-000000000013', 'equipment', 'equipment.veste'),
  ('eeeeeeee-0000-4000-8000-000000000a03', 'bbbbbbbb-0000-4000-8000-000000000013', 'equipment', 'equipment.frontale'),
  ('eeeeeeee-0000-4000-8000-000000000a04', 'aaaaaaaa-0000-4000-8000-000000000013', 'start', 'start.time');

-- ============================================================
-- 1. Le coureur coche son matériel officiel
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ insert into public.participant_equipment (participant_race_id, race_fact_id, origin, status)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000a01',
             'official_requirement', 'packed') $$,
  'le coureur coche une pièce officielle de sa course'
);

select lives_ok(
  $$ insert into public.participant_equipment (participant_race_id, race_fact_id, origin, status)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000a01',
             'official_requirement', 'planned')
     on conflict (participant_race_id, race_fact_id) do update set status = excluded.status $$,
  'recocher la même pièce met son état à jour'
);

select is(
  (select count(*)::int from public.participant_equipment
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
     and race_fact_id = 'eeeeeeee-0000-4000-8000-000000000a01'),
  1,
  'une pièce officielle n''a qu''une ligne par participation'
);

-- ============================================================
-- 2. Ce qui n'est pas son matériel est refusé
-- ============================================================

select throws_ok(
  $$ insert into public.participant_equipment (participant_race_id, race_fact_id, origin)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000a03',
             'official_requirement') $$,
  '23514',
  null,
  'une pièce d''une autre course est refusée'
);

select throws_ok(
  $$ insert into public.participant_equipment (participant_race_id, race_fact_id, origin)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000a04',
             'official_requirement') $$,
  '23514',
  null,
  'une information qui n''est pas du matériel est refusée'
);

-- ============================================================
-- 3. Officiel et personnel ne se confondent pas
-- ============================================================

select throws_ok(
  $$ insert into public.participant_equipment (participant_race_id, custom_label, origin)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Frontale de secours', 'official_requirement') $$,
  '23514',
  null,
  'une ligne personnelle ne peut pas se dire officielle'
);

select throws_ok(
  $$ insert into public.participant_equipment (participant_race_id, race_fact_id, custom_label, origin)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000a02',
             'Veste', 'official_requirement') $$,
  '23514',
  null,
  'une ligne ne porte pas à la fois un fact et un intitulé libre'
);

select lives_ok(
  $$ insert into public.participant_equipment (participant_race_id, custom_label, origin, status)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Bâtons', 'personal', 'packed') $$,
  'le coureur ajoute une pièce personnelle'
);

select throws_ok(
  $$ insert into public.participant_equipment (participant_race_id, custom_label, origin)
     values ('aaaaaaaa-0000-4000-8000-000000000031', '   ', 'personal') $$,
  '23514',
  null,
  'un intitulé vide est refusé'
);

reset role;

-- ============================================================
-- 4. Personne d'autre ne voit la checklist
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*)::int from public.participant_equipment
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  0,
  'un autre coureur ne voit pas la checklist de Runner A'
);
select throws_ok(
  $$ insert into public.participant_equipment (participant_race_id, custom_label, origin)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Intrus', 'personal') $$,
  '42501',
  null,
  'un autre coureur ne peut rien écrire dans la checklist de Runner A'
);
reset role;

-- §37 : l'organisation connaît ses exigences, pas ce que le coureur a coché.
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*)::int from public.participant_equipment
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  0,
  'le propriétaire de l''organisation ne voit pas la checklist d''un participant'
);
reset role;

select * from finish();
rollback;
