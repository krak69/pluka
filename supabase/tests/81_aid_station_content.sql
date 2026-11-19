-- PLUKA — Contenu des ravitaillements, note du coureur, boisson du ravito
-- Référence : migration 0110 · NUTRITION_ENGINE §31, §32 · 03_PRIVACY_RLS §42
--
-- 1. L'organisation éditrice et l'admin PLUKA disent ce que propose un point ;
--    un viewer, une autre organisation ou un coureur ne le peuvent pas.
-- 2. Le contenu se lit avec la course, même sans compte.
-- 3. La note du coureur est à lui seul ; un genre inconnu est refusé.
-- 4. « Je prends la boisson du ravito ici » vaut pour un point de sa course.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

-- ============================================================
-- 1. Saisie
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.set_race_aid_station_items('aaaaaaaa-0000-4000-8000-000000000022',
       '[{"kind": "water", "label": "Eau"}, {"kind": "sports_drink", "label": "Boisson d''effort"},
         {"kind": "other", "label": "Pain d''épices"}]'::jsonb) $$,
  'l''éditeur de l''organisation dit ce que propose le ravito'
);

select results_eq(
  $$ select kind, label from public.race_aid_station_items
     where race_waypoint_id = 'aaaaaaaa-0000-4000-8000-000000000022' order by sort_order $$,
  $$ values ('water', 'Eau'), ('sports_drink', 'Boisson d''effort'), ('other', 'Pain d''épices') $$,
  'le contenu est retenu, dans l''ordre'
);

select throws_ok(
  $$ select public.set_race_aid_station_items('aaaaaaaa-0000-4000-8000-000000000022',
       '[{"kind": "water", "label": "Eau"}, {"kind": "water", "label": "Eau plate"}]'::jsonb) $$,
  '23505',
  null,
  'un même genre une seule fois par point'
);

select throws_ok(
  $$ select public.set_race_aid_station_items('aaaaaaaa-0000-4000-8000-000000000022',
       '[{"kind": "biere", "label": "Bière"}]'::jsonb) $$,
  '23514',
  null,
  'un genre inconnu est refusé'
);

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ select public.set_race_aid_station_items('aaaaaaaa-0000-4000-8000-000000000022', '[]'::jsonb) $$,
  '42501',
  null,
  'un viewer de l''organisation ne modifie pas le ravito'
);

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select throws_ok(
  $$ select public.set_race_aid_station_items('aaaaaaaa-0000-4000-8000-000000000022', '[]'::jsonb) $$,
  '42501',
  null,
  'une autre organisation ne modifie pas le ravito'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.set_race_aid_station_items('aaaaaaaa-0000-4000-8000-000000000022', '[]'::jsonb) $$,
  '42501',
  null,
  'un coureur ne modifie pas le ravito'
);

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ select public.set_race_aid_station_items('aaaaaaaa-0000-4000-8000-000000000022',
       '[{"kind": "water", "label": "Eau"}, {"kind": "sports_drink", "label": "Boisson d''effort"}]'::jsonb) $$,
  'l''admin PLUKA saisit pour une course, d''après ses sources'
);

-- ============================================================
-- 2. Lecture publique
-- ============================================================

select pg_temp.act_as_anon();

select is(
  (select count(*)::int from public.race_aid_station_items
   where race_waypoint_id = 'aaaaaaaa-0000-4000-8000-000000000022'),
  2,
  'le contenu se lit avec la course, sans compte'
);

-- ============================================================
-- 3. La note du coureur
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.set_participant_aid_note('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', array['water', 'cola'], 'Eau et cola, d''après 2025') $$,
  'le coureur note ce qu''il sait du ravito'
);

select throws_ok(
  $$ select public.set_participant_aid_note('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', array['biere'], null) $$,
  '23514',
  null,
  'un genre inconnu est refusé dans la note'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(
  (select count(*)::int from public.participant_aid_notes),
  0,
  'un autre coureur ne lit pas la note'
);

select throws_ok(
  $$ select public.set_participant_aid_note('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000022', array['water'], null) $$,
  '42501',
  null,
  'un autre coureur n''écrit pas la note'
);

-- ============================================================
-- 4. La boisson du ravito
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.set_nutrition_aid_drink('aaaaaaaa-0000-4000-8000-000000000031',
       'aaaaaaaa-0000-4000-8000-000000000023', true) $$,
  '42501',
  null,
  'un point d''une autre course est refusé'
);

select * from finish();

rollback;
