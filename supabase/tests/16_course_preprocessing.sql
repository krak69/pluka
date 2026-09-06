-- PLUKA — Prétraitement du parcours : écriture, rejeu, état de qualité
-- Référence : docs/engines/PLAN_ENGINE.md §8, §8.1, §9, §9.1, §62 ·
--             docs/01_ARCHITECTURE.md §22.1, §31 · docs/03_PRIVACY_RLS.md §8, §18
--
-- §8.1, étape 11 : « persister / cacher le résultat prétraité avec sa version
-- de processeur ». Les fonctions de 0021 en sont le chemin d'écriture, et ce
-- fichier vérifie leurs trois propriétés :
--
--   1. rejouer remplace, jamais ne duplique (§22.1) ;
--   2. un blocage retire les micro-segments et enregistre son motif (§9.1) ;
--   3. rien de tout cela n'est atteignable depuis une session client (§8).
--
-- La deuxième mérite qu'on s'y arrête. §9 conclut « erreur / validation requise
-- avant Plan » : avant le Plan, pas avant la géométrie. Un Plan ne doit pas
-- continuer de s'appuyer sur un prétraitement qu'on sait faux, mais la trace,
-- elle, reste bonne.

begin;

create extension if not exists pgtap;

select plan(23);

\ir _personas.psql

-- ============================================================
-- Le monde de ce fichier
-- ============================================================

insert into public.race_segments
  (id, race_id, from_waypoint_id, to_waypoint_id, distance_km, sort_order)
values
  ('dddddddd-2000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   'aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000022', 40, 0);

insert into public.race_course_geometries
  (id, race_id, version_number, geometry, point_count, processor_version)
values
  ('dddddddd-2000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013', 1,
   extensions.ST_GeomFromText('LINESTRINGZ(6.0 45.0 1000, 6.1 45.1 1400)', 4326), 2, 'gpx-1.0.0');

-- ============================================================
-- 1. État initial d'une géométrie fraîchement importée
-- ============================================================

select is(
  (select preprocessing_status::text from public.race_course_geometries
   where id = 'dddddddd-2000-4000-8000-000000000002'),
  'pending',
  'ÉTAT — une géométrie naît sans prétraitement (§8.1, étape 11)'
);

select is(
  (select preprocessed_at from public.race_course_geometries
   where id = 'dddddddd-2000-4000-8000-000000000002'),
  null::timestamptz,
  'ÉTAT — et sans date de prétraitement'
);

-- ============================================================
-- 2. Le référentiel que le job lit (§8.1, étapes 7 et 9)
-- ============================================================

select is(
  jsonb_array_length(
    public.get_course_preprocessing_input('aaaaaaaa-0000-4000-8000-000000000013') -> 'waypoints'
  ),
  2,
  'RÉFÉRENTIEL — les waypoints à raccorder remontent'
);

select is(
  jsonb_array_length(
    public.get_course_preprocessing_input('aaaaaaaa-0000-4000-8000-000000000013') -> 'segments'
  ),
  1,
  'RÉFÉRENTIEL — la chaîne de segments aussi'
);

select is(
  (public.get_course_preprocessing_input('aaaaaaaa-0000-4000-8000-000000000013')
     -> 'waypoints' -> 0 ->> 'declaredDistanceMeters'),
  '0',
  'RÉFÉRENTIEL — la distance officielle est rendue en mètres, pas en kilomètres'
);

select is(
  (public.get_course_preprocessing_input('aaaaaaaa-0000-4000-8000-000000000013')
     -> 'official' ->> 'distanceMeters'),
  '80000',
  'RÉFÉRENTIEL — la distance officielle de la course alimente les contrôles de §9'
);

-- Une course sans référentiel rend des tableaux vides plutôt que null : le job
-- doit pouvoir décider de se mettre de côté, pas planter.
select is(
  jsonb_array_length(
    public.get_course_preprocessing_input('bbbbbbbb-0000-4000-8000-000000000013') -> 'segments'
  ),
  0,
  'RÉFÉRENTIEL — une course sans segment rend un tableau vide, jamais null'
);

-- ============================================================
-- 3. Écriture des micro-segments (§8.1, étape 11)
-- ============================================================

select is(
  private.persist_course_micro_segments(
    'dddddddd-2000-4000-8000-000000000002',
    'plan-preprocessing-1.0.0',
    jsonb_build_array(
      jsonb_build_object(
        'race_segment_id', 'dddddddd-2000-4000-8000-000000000001', 'sort_order', 0,
        'distance_m', 100, 'elevation_delta_m', 5, 'elevation_gain_m', 5,
        'elevation_loss_m', 0, 'raw_grade', 0.05, 'model_grade', 0.05,
        'progress', 0.25, 'technicality', null),
      jsonb_build_object(
        'race_segment_id', 'dddddddd-2000-4000-8000-000000000001', 'sort_order', 1,
        'distance_m', 100, 'elevation_delta_m', -5, 'elevation_gain_m', 0,
        'elevation_loss_m', 5, 'raw_grade', -0.05, 'model_grade', -0.05,
        'progress', 0.75, 'technicality', 'technical')
    )
  ),
  2,
  'ÉCRITURE — les micro-segments sont écrits et comptés'
);

select is(
  (select preprocessing_status::text from public.race_course_geometries
   where id = 'dddddddd-2000-4000-8000-000000000002'),
  'completed',
  'ÉTAT — la géométrie passe à « completed » dans la même transaction (§31)'
);

select is(
  (select preprocessing_version from public.race_course_micro_segments
   where course_geometry_id = 'dddddddd-2000-4000-8000-000000000002' and sort_order = 0),
  'plan-preprocessing-1.0.0',
  'ÉCRITURE — chaque micro-segment porte sa version de prétraitement (§8.1, étape 11)'
);

select is(
  (select technicality from public.race_course_micro_segments
   where course_geometry_id = 'dddddddd-2000-4000-8000-000000000002' and sort_order = 1),
  'technical',
  'ÉCRITURE — la technicité est transmise telle quelle quand elle existe (§12)'
);

select is(
  (select technicality from public.race_course_micro_segments
   where course_geometry_id = 'dddddddd-2000-4000-8000-000000000002' and sort_order = 0),
  null::text,
  'ÉCRITURE — et reste nulle sinon : le moteur n''invente pas (§12.1)'
);

-- ============================================================
-- 4. Rejeu (§22.1)
-- ============================================================
-- « Un retry ne doit pas créer deux versions identiques. » Le remplacement
-- complet le garantit sans que l'appelant ait à s'en soucier.

select is(
  private.persist_course_micro_segments(
    'dddddddd-2000-4000-8000-000000000002',
    'plan-preprocessing-1.0.0',
    jsonb_build_array(
      jsonb_build_object(
        'race_segment_id', 'dddddddd-2000-4000-8000-000000000001', 'sort_order', 0,
        'distance_m', 100, 'elevation_delta_m', 5, 'elevation_gain_m', 5,
        'elevation_loss_m', 0, 'raw_grade', 0.05, 'model_grade', 0.05,
        'progress', 0.25, 'technicality', null),
      jsonb_build_object(
        'race_segment_id', 'dddddddd-2000-4000-8000-000000000001', 'sort_order', 1,
        'distance_m', 100, 'elevation_delta_m', -5, 'elevation_gain_m', 0,
        'elevation_loss_m', 5, 'raw_grade', -0.05, 'model_grade', -0.05,
        'progress', 0.75, 'technicality', 'technical')
    )
  ),
  2,
  'REJEU — le même prétraitement réécrit le même nombre de micro-segments'
);

select is(
  (select count(*) from public.race_course_micro_segments
   where course_geometry_id = 'dddddddd-2000-4000-8000-000000000002'),
  2::bigint,
  'REJEU — et il n''en reste toujours que deux, pas quatre (§22.1)'
);

-- Un prétraitement plus fin remplace le précédent : la géométrie ne porte
-- jamais deux découpages à la fois.
select is(
  private.persist_course_micro_segments(
    'dddddddd-2000-4000-8000-000000000002',
    'plan-preprocessing-1.1.0',
    jsonb_build_array(
      jsonb_build_object(
        'race_segment_id', 'dddddddd-2000-4000-8000-000000000001', 'sort_order', 0,
        'distance_m', 200, 'elevation_delta_m', 0, 'elevation_gain_m', 5,
        'elevation_loss_m', 5, 'raw_grade', 0, 'model_grade', 0,
        'progress', 0.5, 'technicality', null)
    )
  ),
  1,
  'REJEU — un nouveau découpage remplace l''ancien'
);

select is(
  (select count(*) from public.race_course_micro_segments
   where course_geometry_id = 'dddddddd-2000-4000-8000-000000000002'),
  1::bigint,
  'REJEU — la géométrie ne porte jamais deux découpages à la fois'
);

-- ============================================================
-- 5. Blocage (§9, §9.1)
-- ============================================================

select lives_ok(
  $$ select private.block_course_preprocessing(
       'dddddddd-2000-4000-8000-000000000002',
       'le waypoint est à 340 m de la trace (maximum 200 m)') $$,
  'BLOCAGE — un état de qualité s''enregistre (§9.1)'
);

select is(
  (select preprocessing_status::text from public.race_course_geometries
   where id = 'dddddddd-2000-4000-8000-000000000002'),
  'blocked',
  'BLOCAGE — la géométrie le porte'
);

select is(
  (select count(*) from public.race_course_micro_segments
   where course_geometry_id = 'dddddddd-2000-4000-8000-000000000002'),
  0::bigint,
  'BLOCAGE — les micro-segments sont retirés : un Plan ne s''appuie pas sur un prétraitement faux'
);

select isnt_empty(
  $$ select id from public.race_course_geometries
     where id = 'dddddddd-2000-4000-8000-000000000002' $$,
  'BLOCAGE — la géométrie, elle, survit : §9 bloque le Plan, pas l''import'
);

select throws_ok(
  $$ select private.persist_course_micro_segments(
       'dddddddd-2000-4000-8000-000000000099', 'x', '[]'::jsonb) $$,
  'P0002', null,
  'ÉCRITURE — une géométrie inconnue est refusée, pas ignorée'
);

-- ============================================================
-- 6. Aucune session client n'atteint le prétraitement (§8, §33)
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.worker_persist_course_micro_segments(
       'dddddddd-2000-4000-8000-000000000002', 'x', '[]'::jsonb) $$,
  '42501', null,
  'ÉCRITURE — la surface worker est réservée à service_role (03_PRIVACY_RLS §8)'
);

select throws_ok(
  $$ select public.get_course_preprocessing_input('aaaaaaaa-0000-4000-8000-000000000013') $$,
  '42501', null,
  'LECTURE — le référentiel de prétraitement n''est pas une lecture client'
);

reset role;

select * from finish();

rollback;
