-- PLUKA — Persistance et versionnement du Plan
-- Référence : docs/engines/PLAN_ENGINE.md §8.1, §25, §36, §37, §38 ·
--             docs/03_PRIVACY_RLS.md §31, §33, §120 · AGENTS.md §26
--
-- §36 : « le modèle canonique persiste plusieurs race_plans pour une
-- participation. Une seule version est active. »
--
-- §37 énumère la confirmation comme un tout — nouvelle version, ancienne
-- archivée, dépendances de faits enregistrées — et la fonction de 0020 le fait
-- en une transaction. Ce fichier vérifie qu'elle tient ses trois promesses :
-- la chaîne de versions, l'unicité de la version active, et le refus d'écrire
-- sur la participation d'un autre.
--
-- La dernière compte autant que les deux premières. AGENTS §26 : « le fait
-- d'utiliser service_role ne dispense pas des règles métier. » La propriété est
-- donc revérifiée dans la fonction, pas seulement dans le use case.

begin;

create extension if not exists pgtap;

select plan(29);

\ir _personas.psql

-- ============================================================
-- Le monde de ce fichier
-- ============================================================
-- Le parcours d'Org A reçoit ce qui manque à un Plan : un segment, une
-- géométrie, ses micro-segments prétraités et une barrière.

insert into public.race_segments
  (id, race_id, from_waypoint_id, to_waypoint_id, distance_km, sort_order)
values
  ('cccccccc-1000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   'aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000022', 40, 0);

insert into public.race_course_geometries
  (id, race_id, version_number, geometry, point_count, processor_version)
values
  ('cccccccc-1000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013', 1,
   extensions.ST_GeomFromText('LINESTRINGZ(6.0 45.0 1000, 6.1 45.1 1400)', 4326), 2, 'gpx-1.0.0');

update public.races
set current_course_geometry_id = 'cccccccc-1000-4000-8000-000000000002'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

insert into public.race_course_micro_segments
  (race_id, course_geometry_id, race_segment_id, sort_order, distance_m,
   elevation_delta_m, elevation_gain_m, elevation_loss_m, raw_grade, model_grade,
   progress, preprocessing_version)
values
  ('aaaaaaaa-0000-4000-8000-000000000013', 'cccccccc-1000-4000-8000-000000000002',
   'cccccccc-1000-4000-8000-000000000001', 0, 20000, 400, 400, 0, 0.02, 0.02, 0.25,
   'plan-preprocessing-1.0.0'),
  ('aaaaaaaa-0000-4000-8000-000000000013', 'cccccccc-1000-4000-8000-000000000002',
   'cccccccc-1000-4000-8000-000000000001', 1, 20000, 0, 0, 0, 0, 0, 0.75,
   'plan-preprocessing-1.0.0');

insert into public.race_cutoffs
  (id, race_id, race_waypoint_id, cutoff_datetime, basis)
values
  ('cccccccc-1000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000013',
   'aaaaaaaa-0000-4000-8000-000000000022', '2026-06-20T16:00:00Z', 'departure');

-- ============================================================
-- 1. La barrière sait à quoi elle se compare (§25)
-- ============================================================

select is(
  (select basis::text from public.race_cutoffs
   where id = 'cccccccc-1000-4000-8000-000000000003'),
  'departure',
  'BARRIÈRE — une barrière de sortie de ravito se déclare comme telle (§25)'
);

select is(
  (select count(*) from public.race_cutoffs where basis = 'arrival'),
  0::bigint,
  'BARRIÈRE — aucune autre barrière dans cette fixture, le défaut n''est pas testé à vide'
);

-- ============================================================
-- 2. Confirmation d'un Plan (§37)
-- ============================================================
-- Runner A possède déjà un Plan actif, venu des personas : la première
-- confirmation doit donc l'archiver.

select is(
  (select count(*) from public.race_plans
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' and status = 'active'),
  1::bigint,
  'VERSION — un Plan actif existe avant la confirmation'
);

select lives_ok(
  $$ select public.persist_race_plan(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '11111111-1111-4111-8111-111111111111',
       jsonb_build_object(
         'engine_version', 'plan-v1.0.0',
         'initial_target_duration_seconds', 43200,
         'target_duration_seconds', 43200,
         'planned_finish_datetime', '2026-06-20T16:00:00Z',
         'input_hash', repeat('c', 64),
         'input_snapshot', jsonb_build_object('mode', 'rebalance_to_target')
       ),
       jsonb_build_array(
         jsonb_build_object(
           'race_waypoint_id', 'aaaaaaaa-0000-4000-8000-000000000021',
           'planned_elapsed_seconds', 0, 'planned_arrival_at', '2026-06-20T04:00:00Z',
           'stop_duration_seconds', 0, 'stop_origin', 'default',
           'is_locked', false, 'locked_elapsed_seconds', null, 'sort_order', 0),
         jsonb_build_object(
           'race_waypoint_id', 'aaaaaaaa-0000-4000-8000-000000000022',
           'planned_elapsed_seconds', 42600, 'planned_arrival_at', '2026-06-20T15:50:00Z',
           'stop_duration_seconds', 600, 'stop_origin', 'manual',
           'is_locked', true, 'locked_elapsed_seconds', 42600, 'sort_order', 1)
       ),
       jsonb_build_array(
         jsonb_build_object(
           'race_segment_id', 'cccccccc-1000-4000-8000-000000000001',
           'initial_duration_seconds', 42600, 'planned_duration_seconds', 42600,
           'manual_override', false, 'sort_order', 0)
       ),
       jsonb_build_array(
         jsonb_build_object(
           'race_cutoff_id', 'cccccccc-1000-4000-8000-000000000003',
           'race_waypoint_id', 'aaaaaaaa-0000-4000-8000-000000000022',
           'margin_seconds', -600, 'status', 'beyond')
       ),
       jsonb_build_array(
         jsonb_build_object(
           'race_fact_version_id', 'aaaaaaaa-0000-4000-8000-000000000094',
           'dependency_type', 'cutoff', 'dependency_key', 'veste-impermeable')
       )
     ) $$,
  'VERSION — la confirmation écrit les cinq tables en une transaction (§37)'
);

select is(
  (select count(*) from public.race_plans
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' and status = 'active'),
  1::bigint,
  'VERSION — une seule version reste active (§36, ux_active_race_plan)'
);

select is(
  (select version from public.race_plans
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' and status = 'active'),
  2,
  'VERSION — la nouvelle version suit la précédente'
);

select is(
  (select status::text from public.race_plans
   where id = 'aaaaaaaa-0000-4000-8000-000000000041'),
  'superseded',
  'VERSION — l''ancienne est archivée, pas supprimée (§36)'
);

select results_eq(
  $$ select version, status::text from public.race_plans
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
     order by version $$,
  $$ values (1, 'superseded'), (2, 'active') $$,
  'VERSION — la chaîne historique est participant_race_id + version (§36)'
);

-- ============================================================
-- 3. Ce que la version porte (§38)
-- ============================================================

select is(
  (select count(*) from public.plan_waypoints pw
   join public.race_plans rp on rp.id = pw.race_plan_id
   where rp.participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
     and rp.status = 'active'),
  2::bigint,
  'PLAN — les waypoints sont écrits (§38.2)'
);

select is(
  (select stop_origin::text from public.plan_waypoints pw
   join public.race_plans rp on rp.id = pw.race_plan_id
   where rp.status = 'active'
     and pw.race_waypoint_id = 'aaaaaaaa-0000-4000-8000-000000000022'),
  'manual',
  'PLAN — l''origine de l''arrêt survit au rechargement (§21.6)'
);

select is(
  (select locked_elapsed_seconds from public.plan_waypoints pw
   join public.race_plans rp on rp.id = pw.race_plan_id
   where rp.status = 'active'
     and pw.race_waypoint_id = 'aaaaaaaa-0000-4000-8000-000000000022'),
  42600,
  'PLAN — l''ancre du coureur est conservée (§21.4)'
);

select is(
  (select count(*) from public.plan_segments ps
   join public.race_plans rp on rp.id = ps.race_plan_id
   where rp.participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
     and rp.status = 'active'),
  1::bigint,
  'PLAN — les segments sont écrits (§38.3)'
);

-- §38.4 : la marge appartient au Plan, et son `plan_waypoint_id` est résolu par
-- la fonction — l'appelant ne peut pas le connaître, la ligne vient de naître.
select is(
  (select pcs.status::text
   from public.plan_cutoff_statuses pcs
   join public.race_plans rp on rp.id = pcs.race_plan_id
   where rp.status = 'active'),
  'beyond',
  'PLAN — la marge de barrière est écrite avec son statut (§38.4)'
);

select isnt_empty(
  $$ select pcs.id
     from public.plan_cutoff_statuses pcs
     join public.plan_waypoints pw on pw.id = pcs.plan_waypoint_id
     where pw.race_waypoint_id = 'aaaaaaaa-0000-4000-8000-000000000022' $$,
  'PLAN — elle pointe le waypoint de Plan que la fonction vient de créer'
);

-- §38.5 : « le service de domaine rattache au Plan les versions exactes des
-- RaceFacts dont l'entrée dépend. » C'est ce que l'Impact Analyzer relit.
select results_eq(
  $$ select pvd.race_fact_version_id::text, pvd.dependency_type::text
     from public.plan_version_dependencies pvd
     join public.race_plans rp on rp.id = pvd.race_plan_id
     where rp.status = 'active' $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000094', 'cutoff') $$,
  'IMPACT — les dépendances de faits sont rattachées à la version (§38.5)'
);

select isnt_empty(
  $$ select rp.id
     from public.race_plans rp
     join public.plan_version_dependencies d on d.race_plan_id = rp.id
     where rp.participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'
       and rp.status = 'active'
       and d.race_fact_version_id = 'aaaaaaaa-0000-4000-8000-000000000094' $$,
  'IMPACT — la jointure exacte que analyze_change_impact exécute trouve ce Plan (0016)'
);

-- ============================================================
-- 4. La fonction refuse ce que le use case refuserait (AGENTS §26)
-- ============================================================

select throws_ok(
  $$ select public.persist_race_plan(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '22222222-2222-4222-8222-222222222222',
       '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) $$,
  '42501', null,
  'PROPRIÉTÉ — un autre coureur ne confirme pas le Plan de Runner A (§120)'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.persist_race_plan(
       'aaaaaaaa-0000-4000-8000-000000000031',
       '11111111-1111-4111-8111-111111111111',
       '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) $$,
  '42501', null,
  'SESSION — l''identité vient du claim, pas du paramètre (03_PRIVACY_RLS §11)'
);

reset role;

-- ============================================================
-- 5. Aucune écriture directe depuis le client (§33)
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.race_plans
       (participant_race_id, version, engine_version,
        initial_target_duration_seconds, target_duration_seconds)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 99, 'maison', 1, 1) $$,
  '42501', null,
  'ÉCRITURE — un coureur ne fabrique pas un Plan depuis le client (§33)'
);

select throws_ok(
  $$ update public.plan_segments set planned_duration_seconds = 1 $$,
  '42501', null,
  'ÉCRITURE — ni ne réécrit une durée de segment'
);

select throws_ok(
  $$ insert into public.plan_version_dependencies
       (race_plan_id, race_fact_version_id, dependency_type)
     values ('aaaaaaaa-0000-4000-8000-000000000041',
             'aaaaaaaa-0000-4000-8000-000000000094', 'cutoff') $$,
  '42501', null,
  'ÉCRITURE — ni ne se déclare dépendant d''une autre version de fait (§39)'
);

select throws_ok(
  $$ insert into public.race_course_micro_segments
       (race_id, course_geometry_id, race_segment_id, sort_order, distance_m,
        elevation_delta_m, elevation_gain_m, elevation_loss_m, raw_grade,
        model_grade, progress, preprocessing_version)
     values ('aaaaaaaa-0000-4000-8000-000000000013',
             'cccccccc-1000-4000-8000-000000000002',
             'cccccccc-1000-4000-8000-000000000001', 9, 100, 0, 0, 0, 0, 0, 0.5, 'x') $$,
  '42501', null,
  'ÉCRITURE — le prétraitement est un traitement serveur (§8)'
);

-- Le coureur lit en revanche son Plan et le parcours prétraité.
select isnt_empty(
  $$ select id from public.race_plans
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  'LECTURE — Runner A lit ses versions de Plan (§31)'
);

select is(
  (select count(*) from public.race_course_micro_segments),
  2::bigint,
  'LECTURE — et les micro-segments de sa course publique (§18)'
);

reset role;

-- ============================================================
-- 6. Le prétraitement suit la visibilité de la course
-- ============================================================

select pg_temp.act_as_anon();

select is(
  (select count(*) from public.race_course_micro_segments),
  2::bigint,
  'LECTURE — anon lit le prétraitement d''une course publique, comme ses segments (§18)'
);

reset role;

-- Le même prétraitement, posé sur la course *privée* d'Org A. Sans cette
-- seconde moitié, l'assertion suivante passerait sur une base vide (§136).
insert into public.race_waypoints
  (id, race_id, name, waypoint_type, distance_km, sort_order)
values
  ('cccccccc-1000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-000000000014',
   'Arrivée privée', 'finish', 20, 2);

insert into public.race_segments
  (id, race_id, from_waypoint_id, to_waypoint_id, distance_km, sort_order)
values
  ('cccccccc-1000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000014',
   'aaaaaaaa-0000-4000-8000-000000000023', 'cccccccc-1000-4000-8000-000000000010', 20, 0);

insert into public.race_course_geometries
  (id, race_id, version_number, geometry, point_count, processor_version)
values
  ('cccccccc-1000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000014', 1,
   extensions.ST_GeomFromText('LINESTRINGZ(6.0 45.0 900, 6.05 45.05 950)', 4326), 2, 'gpx-1.0.0');

insert into public.race_course_micro_segments
  (race_id, course_geometry_id, race_segment_id, sort_order, distance_m,
   elevation_delta_m, elevation_gain_m, elevation_loss_m, raw_grade, model_grade,
   progress, preprocessing_version)
values
  ('aaaaaaaa-0000-4000-8000-000000000014', 'cccccccc-1000-4000-8000-000000000012',
   'cccccccc-1000-4000-8000-000000000011', 0, 20000, 50, 50, 0, 0.0025, 0.0025, 0.5,
   'plan-preprocessing-1.0.0');

select pg_temp.act_as_anon();

select is(
  (select count(*) from public.race_course_micro_segments
   where race_id = 'aaaaaaaa-0000-4000-8000-000000000014'),
  0::bigint,
  'LECTURE — rien du prétraitement d''une course privée, qui existe pourtant (§17)'
);

reset role;

-- ============================================================
-- 7. L'organisation reste aveugle au Plan (§31)
-- ============================================================
-- Le Plan qu'on vient de confirmer ne change rien à cette règle.

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Owner : aucun Plan, y compris la version qu''on vient d''écrire (§31)');
select is_empty($$ select id from public.plan_waypoints $$,
  'PRIVACY — ni ses temps de passage');
select is_empty($$ select id from public.plan_version_dependencies $$,
  'PRIVACY — ni ses dépendances de faits');

reset role;

select * from finish();

rollback;
