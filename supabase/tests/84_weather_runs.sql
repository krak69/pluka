-- PLUKA — Conditions J-14 : runs, séries partagées, rafraîchissement
-- Référence : migration 0113 · WEATHER_CONDITIONS §6, §21, §28 à §34, §55, §88 à §94
--
-- 1. Le coureur demande un rafraîchissement de son Plan actif, dans la
--    fenêtre J-14, au plus une fois par tranche de 10 minutes ; un autre
--    coureur, un visiteur, un départ trop lointain : refusés.
-- 2. Les fonctions du worker ne s'ouvrent qu'à la clé de service.
-- 3. Un point sans coordonnées est placé sur la trace, à sa distance.
-- 4. Un run s'enregistre une fois ; le suivant rend l'ancien `stale` ; un
--    échec garde l'actif. Le coureur lit ses runs, pas ceux des autres.

begin;

create extension if not exists pgtap;

select plan(22);

\ir _personas.psql

-- Les personas portent déjà un run actif pour ce Plan (sans empreinte) :
-- le premier vrai run le fait passer `stale`. Les assertions de cycle de vie
-- portent sur les runs du test, reconnus à leur empreinte.
--
-- Le Plan de Runner A part dans cinq jours ; la course a une trace, du
-- départ (1 000 m) au col (2 000 m), et le col n'a pas de coordonnées.
update public.race_plans
set input_snapshot = jsonb_build_object('start_at', to_char(now() + interval '5 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
where id = 'aaaaaaaa-0000-4000-8000-000000000041';

insert into public.race_course_geometries
  (id, race_id, geometry, point_count, length_m, processor_version)
values (
  'aaaaaaaa-0000-4000-8000-000000000171', 'aaaaaaaa-0000-4000-8000-000000000013',
  extensions.st_geomfromtext('LINESTRING Z (6.80 45.90 1000, 6.90 45.95 2000)', 4326),
  2, 40000, 'test'
);
update public.races set current_course_geometry_id = 'aaaaaaaa-0000-4000-8000-000000000171'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

-- ============================================================
-- 1. Le coureur demande un rafraîchissement
-- ============================================================

select has_column('public', 'weather_forecast_runs', 'astronomy_version',
  'un run garde la version de l''astronomie');
select has_column('public', 'weather_forecast_points', 'distance_km',
  'un point garde sa distance');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select is(public.request_weather_refresh('aaaaaaaa-0000-4000-8000-000000000031'), 'queued',
  'le coureur demande un rafraîchissement de son Plan');
select is(public.request_weather_refresh('aaaaaaaa-0000-4000-8000-000000000031'), 'already_queued',
  'une seconde demande dans les 10 minutes ne crée rien');

reset role;

select is(
  (select count(*) from private.outbox_events
   where event_type = 'weather.refresh'
     and payload ->> 'racePlanId' = 'aaaaaaaa-0000-4000-8000-000000000041'),
  1::bigint,
  'une seule demande attend, pour la version active du Plan'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select public.request_weather_refresh('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '42501', null,
  'un autre coureur ne demande rien pour ce Plan'
);

reset role;
select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.request_weather_refresh('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '42501', null,
  'un visiteur ne demande rien'
);

reset role;
update public.race_plans
set input_snapshot = jsonb_build_object('start_at', to_char(now() + interval '20 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
where id = 'aaaaaaaa-0000-4000-8000-000000000041';

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.request_weather_refresh('aaaaaaaa-0000-4000-8000-000000000031') $$,
  '22023', 'OUTSIDE_WINDOW',
  '§6 : avant J-14, aucune prévision n''est demandée'
);

-- ============================================================
-- 2. Le worker seul
-- ============================================================

select throws_ok(
  $$ select public.worker_weather_race_plan('aaaaaaaa-0000-4000-8000-000000000041') $$,
  '42501', null,
  'le coureur n''ouvre pas les fonctions du worker'
);

reset role;
update public.race_plans
set input_snapshot = jsonb_build_object('start_at', to_char(now() + interval '5 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
where id = 'aaaaaaaa-0000-4000-8000-000000000041';
set local role service_role;

-- ============================================================
-- 3. La timeline, placée sur la trace
-- ============================================================

select is(
  (select public.worker_weather_race_plan('aaaaaaaa-0000-4000-8000-000000000041')
     -> 'points' -> 0 ->> 'positionSource'),
  'trace',
  '§21 : le col sans coordonnées est placé sur la trace'
);

select is(
  (select (public.worker_weather_race_plan('aaaaaaaa-0000-4000-8000-000000000041')
     -> 'points' -> 0 ->> 'altitudeM')::integer),
  2000,
  'à 40 km sur 40, le col prend l''altitude de la fin de la trace'
);

select is(
  (select round((public.worker_weather_race_plan('aaaaaaaa-0000-4000-8000-000000000041')
     -> 'points' -> 0 ->> 'latitude')::numeric, 2)),
  45.95::numeric,
  'et sa position'
);

-- ============================================================
-- 4. Séries et runs
-- ============================================================

select is(
  public.worker_save_weather_series(jsonb_build_array(jsonb_build_object(
    'raceWaypointId', 'aaaaaaaa-0000-4000-8000-000000000022',
    'provider', 'open-meteo', 'providerConfigVersion', 'open-meteo-1.0.0',
    'latitude', 45.95, 'longitude', 6.9, 'elevationM', 2000,
    'windowStart', '2026-09-12T05:00:00Z', 'windowEnd', '2026-09-19T06:00:00Z',
    'fetchedAt', '2026-09-10T08:00:00Z', 'providerModel', 'best_match',
    'series', '{"times": [1789200000], "temperatureC": [4]}'::jsonb
  ))),
  1,
  'le worker enregistre une série partagée'
);

select is(
  (select count(*) from public.worker_weather_series(
     array['aaaaaaaa-0000-4000-8000-000000000022']::uuid[], 'open-meteo-1.0.0')),
  1::bigint,
  'et la relit pour la version du fournisseur'
);

create temporary table weather_ids (label text primary key, id uuid) on commit drop;
grant all on weather_ids to service_role;

insert into weather_ids
select 'first', public.worker_record_weather_run(
  jsonb_build_object(
    'racePlanId', 'aaaaaaaa-0000-4000-8000-000000000041', 'timezone', 'Europe/Paris',
    'provider', 'open-meteo', 'providerModel', 'best_match',
    'providerConfigVersion', 'open-meteo-1.0.0', 'normalizerVersion', 'open-meteo-normalizer-1.0.0',
    'conditionsEngineVersion', 'conditions-engine-1.0.0', 'routePointsVersion', 'route-points-1.0.0',
    'astronomyVersion', 'astronomy-noaa-1.0.0', 'inputHash', repeat('a', 64),
    'fetchedAt', '2026-09-10T08:00:00Z', 'completeness', 'complete', 'failureCode', null,
    'inputSnapshot', '{"startAt": "2026-09-12T06:00:00Z"}'::jsonb
  ),
  jsonb_build_array(jsonb_build_object(
    'pointKey', 'wp-aaaaaaaa-0000-4000-8000-000000000022',
    'raceWaypointId', 'aaaaaaaa-0000-4000-8000-000000000022',
    'latitude', 45.95, 'longitude', 6.9, 'routeAltitudeM', 2000,
    'plannedDatetime', '2026-09-12T11:00:00Z', 'distanceKm', 40, 'elapsedSeconds', 18000,
    'temperatureC', 4, 'apparentTemperatureC', 1, 'windGustKmh', 45, 'weatherCode', 'rain',
    'fetchedAt', '2026-09-10T08:00:00Z'
  )),
  jsonb_build_array(jsonb_build_object(
    'startDatetime', '2026-09-12T04:00:00Z', 'endDatetime', '2026-09-12T05:05:00Z',
    'startElapsedSeconds', 0, 'endElapsedSeconds', 3900,
    'startPointKey', 'wp-a', 'endPointKey', 'wp-a', 'fromStart', true, 'untilFinish', false
  ))
);

select is(
  (select status::text || ':' || completeness_status::text || ':' || sampling_config_version
   from public.weather_forecast_runs where id = (select id from weather_ids where label = 'first')),
  'active:complete:route-points-1.0.0',
  'le run réussi est l''actif, avec sa couverture et ses versions'
);

select is(
  (select count(*) from public.weather_forecast_points
   where weather_run_id = (select id from weather_ids where label = 'first')
     and route_altitude_m = 2000 and distance_km = 40 and weather_code = 'rain'),
  1::bigint,
  'ses points gardent l''altitude du parcours, la distance et le ciel'
);

select is(
  (select condition_type::text || ':' || source::text || ':' || (summary ->> 'fromStart')
   from public.condition_periods where weather_run_id = (select id from weather_ids where label = 'first')),
  'night:astronomy:true',
  '§44 : la nuit du départ est enregistrée, d''origine astronomique'
);

select is(
  public.worker_record_weather_run(
    jsonb_build_object(
      'racePlanId', 'aaaaaaaa-0000-4000-8000-000000000041', 'timezone', 'Europe/Paris',
      'provider', 'open-meteo', 'providerConfigVersion', 'open-meteo-1.0.0',
      'normalizerVersion', 'n', 'conditionsEngineVersion', 'c', 'routePointsVersion', 'r',
      'astronomyVersion', 'a', 'inputHash', repeat('a', 64), 'fetchedAt', '2026-09-10T08:00:00Z',
      'completeness', 'complete'
    ), '[]'::jsonb, '[]'::jsonb),
  (select id from weather_ids where label = 'first'),
  '§89 : rejouer le même calcul rend le même run'
);

insert into weather_ids
select 'second', public.worker_record_weather_run(
  jsonb_build_object(
    'racePlanId', 'aaaaaaaa-0000-4000-8000-000000000041', 'timezone', 'Europe/Paris',
    'provider', 'open-meteo', 'providerConfigVersion', 'open-meteo-1.0.0',
    'normalizerVersion', 'n', 'conditionsEngineVersion', 'c', 'routePointsVersion', 'r',
    'astronomyVersion', 'a', 'inputHash', repeat('a', 64), 'fetchedAt', '2026-09-10T11:00:00Z',
    'completeness', 'partial'
  ), '[]'::jsonb, '[]'::jsonb);

select is(
  (select string_agg(status::text, ' ' order by fetched_at)
   from public.weather_forecast_runs
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041' and input_hash = repeat('a', 64)),
  'stale active',
  '§29 : une prévision plus récente devient l''active, l''ancienne reste'
);

select public.worker_record_weather_run(
  jsonb_build_object(
    'racePlanId', 'aaaaaaaa-0000-4000-8000-000000000041', 'timezone', 'Europe/Paris',
    'provider', 'open-meteo', 'providerConfigVersion', 'open-meteo-1.0.0',
    'normalizerVersion', 'n', 'conditionsEngineVersion', 'c', 'routePointsVersion', 'r',
    'astronomyVersion', 'a', 'inputHash', repeat('a', 64), 'fetchedAt', '2026-09-10T14:00:00Z',
    'completeness', 'failed', 'failureCode', 'provider_timeout'
  ), '[]'::jsonb, '[]'::jsonb);

select is(
  (select string_agg(status::text || coalesce(':' || failure_code, ''), ' ' order by fetched_at)
   from public.weather_forecast_runs
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041' and input_hash = repeat('a', 64)),
  'stale active failed:provider_timeout',
  '§90 : un échec est gardé pour le diagnostic, l''actif reste l''actif'
);

reset role;

-- ============================================================
-- 5. Chacun ses Conditions
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*) from public.weather_forecast_runs
   where race_plan_id = 'aaaaaaaa-0000-4000-8000-000000000041' and input_hash = repeat('a', 64)),
  3::bigint,
  'le coureur lit ses runs'
);

reset role;
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is_empty(
  $$ select 1 from public.weather_forecast_points
     where weather_run_id in (select id from public.weather_forecast_runs) $$,
  'un autre coureur ne lit aucun point'
);

select * from finish();

rollback;
