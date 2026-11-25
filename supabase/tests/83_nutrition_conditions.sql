-- PLUKA — Temps chaud, temps froid, nuit
-- Référence : migration 0112 · NUTRITION_ENGINE §13 à §19, §24, §14 bis
--
-- 1. Le coureur enregistre ses conditions : cibles propres, plages, caféine.
-- 2. Chaud et froid en même temps, deux plages d'un même type qui se
--    recouvrent, une plage sans fin, une cible sur la nuit : refusés.
-- 3. Un autre coureur ne lit ni n'écrit rien.
-- 4. L'export du compte contient les conditions.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '[{"type": "hot", "enabled": true, "hydration": 650, "carbs": null, "sodium": null,
          "ranges": [{"start": 3600, "end": 7200}, {"start": 10800, "end": 14400}]},
         {"type": "night", "enabled": true, "ranges": [{"start": 0, "end": 5400}]}]'::jsonb,
       'night') $$,
  'le coureur enregistre ses plages chaudes et nocturnes'
);

select is(
  (select string_agg(c.condition_type || ':' || coalesce(c.hydration_ml_per_hour::text, '-')
                     || ':' || r.start_elapsed_seconds || '-' || r.end_elapsed_seconds,
                     ' ' order by c.condition_type, r.start_elapsed_seconds)
   from public.nutrition_conditions c
   join public.nutrition_condition_ranges r on r.nutrition_condition_id = c.id
   where c.nutrition_plan_id = 'aaaaaaaa-0000-4000-8000-000000000051'),
  'hot:650:3600-7200 hot:650:10800-14400 night:-:0-5400',
  'les cibles du coureur et ses plages sont enregistrées'
);

select is(
  (select caffeine_spread from public.nutrition_plans
   where id = 'aaaaaaaa-0000-4000-8000-000000000051'),
  'night',
  'la répartition de la caféine est enregistrée'
);

select lives_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '[{"type": "cold", "ranges": [{"start": 0, "end": 1800}]}]'::jsonb, 'auto') $$,
  'enregistrer de nouveau remplace les conditions'
);

select is(
  (select string_agg(c.condition_type::text, ' ')
   from public.nutrition_conditions c
   where c.nutrition_plan_id = 'aaaaaaaa-0000-4000-8000-000000000051'),
  'cold',
  'les anciennes conditions sont remplacées'
);

select throws_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '[{"type": "hot", "ranges": [{"start": 3600, "end": 7200}]},
         {"type": "cold", "ranges": [{"start": 5400, "end": 9000}]}]'::jsonb, 'auto') $$,
  '22023',
  'HOT_COLD_OVERLAP',
  '§17 : chaud et froid sur le même intervalle sont refusés'
);

select lives_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '[{"type": "hot", "ranges": [{"start": 3600, "end": 7200}]},
         {"type": "cold", "enabled": false, "ranges": [{"start": 5400, "end": 9000}]}]'::jsonb,
       'auto') $$,
  'une condition désactivée garde ses plages sans entrer en conflit'
);

select throws_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '[{"type": "hot", "ranges": [{"start": 3600, "end": 7200}, {"start": 7000, "end": 8000}]}]'::jsonb,
       'auto') $$,
  '22023',
  null,
  'deux plages chaudes qui se recouvrent sont refusées'
);

select throws_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '[{"type": "night", "ranges": [{"start": 7200, "end": 3600}]}]'::jsonb, 'auto') $$,
  '22023',
  null,
  '§68 : une plage finit après son début'
);

select throws_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '[{"type": "night", "hydration": 400, "ranges": []}]'::jsonb, 'auto') $$,
  '22023',
  null,
  '§16 : la nuit ne porte aucune cible'
);

select throws_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031', '[]'::jsonb, 'beaucoup') $$,
  '22023',
  null,
  'une répartition de caféine inconnue est refusée'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.save_nutrition_conditions(
       'aaaaaaaa-0000-4000-8000-000000000031', '[]'::jsonb, 'auto') $$,
  '42501',
  null,
  'un autre coureur ne modifie pas les conditions'
);

select is_empty(
  $$ select id from public.nutrition_conditions $$,
  'un autre coureur ne lit pas les conditions'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select is(
  (select jsonb_path_query_first(
            public.export_my_data(),
            '$.participations[*].plans[*].nutrition[*].conditions[*].condition_type')
          #>> '{}'),
  'hot',
  'l''export du compte contient les conditions'
);

select * from finish();

rollback;
