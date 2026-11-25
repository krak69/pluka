-- PLUKA — Conditions J-14 : runs, séries partagées, rafraîchissement
-- File target: supabase/migrations/0113_weather_runs.sql
-- Référence : WEATHER_CONDITIONS §6, §17, §28 à §34, §55, §88 à §94, §102 ;
-- décisions du 2026-11-25 (Open-Meteo, points clés du Plan, mode économe).
--
-- CE QUE CETTE MIGRATION FAIT
--
-- 1. Un run porte ses versions (moteur, points, astronomie, fournisseur,
--    lecture), sa complétude et son code d'échec (§55, §102). Un seul run
--    actif par version de Plan ; un même calcul n'est jamais enregistré deux
--    fois.
-- 2. Un point de run garde sa distance et son temps écoulé (affichage, nuit).
-- 3. Les séries horaires du fournisseur sont partagées par point de course,
--    dans le schéma privé (§93, §94) : tous les coureurs d'une course passent
--    aux mêmes points, un seul appel les sert tous. Le run de chaque coureur
--    est une projection de ces séries sur ses heures de passage (§34).
-- 4. Le dispatcher route `weather.%` vers `pluka_weather` (créée en 0002).
-- 5. Le coureur demande un rafraîchissement : propriété, Plan actif, fenêtre
--    J-14 et au plus une demande par Plan toutes les 10 minutes. Ses droits
--    (Race Pass, PLUKA+) sont revérifiés par le worker avant tout appel au
--    fournisseur : l'app ne porte pas de clé de service (01_ARCHITECTURE §9).
-- 6. Le worker lit la timeline d'un Plan, lit et écrit les séries, enregistre
--    le run, ses points et ses nuits.
--
-- CE QU'ELLE NE FAIT PAS
--
-- Elle ne couvre pas les sorties (scope `outing`) : elles viendront avec
-- leur propre timeline. Elle ne détecte ni chaleur, ni froid, ni pluie : la
-- détection attend ses seuils versionnés (§38, §39).

begin;

-- ============================================================
-- 1. Runs : versions, complétude, échec
-- ============================================================

-- 0003 a posé les versions du §102 (moteur, config, fournisseur,
-- échantillonnage, lecture), `input_snapshot`, `completeness_status` et
-- `failure_code`. Il manque la version de l'astronomie, qui calcule la Nuit.
alter table public.weather_forecast_runs
  add column astronomy_version text;

comment on column public.weather_forecast_runs.sampling_config_version is
  'Version de la sélection des points météo (route-points-*, WEATHER_CONDITIONS §18 à §20).';
comment on column public.weather_forecast_runs.astronomy_version is
  'Version du calcul astronomique de la Nuit (WEATHER_CONDITIONS §46).';

-- Un run produit par le moteur porte toutes ses versions ; les colonnes
-- restent nulles pour un run antérieur (il n'en existe pas à ce jour).
alter table public.weather_forecast_runs
  add constraint ck_weather_runs_versions check (
    conditions_engine_version is null
    or (sampling_config_version is not null and astronomy_version is not null
        and provider_config_version is not null and normalizer_version is not null)
  );

-- §55 : un run échoué le dit, et dit pourquoi, par un code court.
alter table public.weather_forecast_runs
  add constraint ck_weather_runs_failure check (
    (status = 'failed') = (failure_code is not null)
    and (failure_code is null or failure_code ~ '^[a-z_]{1,40}$')
  );

-- §29 : un seul run actif par version de Plan ; les autres restent, `stale`.
create unique index ux_weather_runs_active_plan
  on public.weather_forecast_runs (race_plan_id)
  where status = 'active' and race_plan_id is not null;

-- §89 : un même calcul (même entrée, mêmes séries) n'est enregistré qu'une fois.
create unique index ux_weather_runs_plan_hash_fetch
  on public.weather_forecast_runs (race_plan_id, input_hash, fetched_at)
  where race_plan_id is not null and input_hash is not null;

-- ============================================================
-- 2. Points : distance et temps écoulé
-- ============================================================

alter table public.weather_forecast_points
  add column distance_km numeric(7,2) check (distance_km is null or distance_km >= 0),
  add column elapsed_seconds integer check (elapsed_seconds is null or elapsed_seconds >= 0);

comment on column public.weather_forecast_points.weather_code is
  'Taxonomie PLUKA du ciel (WEATHER_CONDITIONS §56), indépendante du fournisseur ; le code du fournisseur reste dans provider_payload.';

-- ============================================================
-- 3. Séries horaires partagées par point de course (§93, §94)
-- ============================================================

create table private.weather_series (
  race_waypoint_id uuid not null references public.race_waypoints(id) on delete cascade,
  provider text not null,
  provider_config_version text not null,
  -- La position demandée : une trace modifiée change la position, donc la série.
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  elevation_m integer,
  window_start timestamptz not null,
  window_end timestamptz not null,
  fetched_at timestamptz not null,
  provider_model text,
  -- Séries horaires normalisées (packages/weather, `HourlySeries`).
  series jsonb not null check (jsonb_typeof(series) = 'object'),
  primary key (race_waypoint_id, provider_config_version),
  check (window_end > window_start)
);

comment on table private.weather_series is
  'Cache technique des séries du fournisseur, partagé entre coureurs d''une même course (WEATHER_CONDITIONS §93, §94). Jamais affiché : le coureur lit son run.';

alter table private.weather_series enable row level security;
revoke all on table private.weather_series from public, anon, authenticated;

-- ============================================================
-- 4. Dispatcher : la route météo
-- ============================================================

create or replace function private.dispatch_outbox_events(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_queue text;
  v_dispatched integer := 0;
begin
  for v_event in
    select id, event_type, payload
    from private.outbox_events
    where status = 'pending' and available_at <= now()
    order by created_at
    limit p_limit
    for update skip locked
  loop
    -- Groupement par domaine, pas une queue par type de job (0002). Toute
    -- redéfinition future doit garder ces lignes : le test pgTAP 23 les
    -- vérifie une à une.
    v_queue := case
      when v_event.event_type like 'gpx.%' then 'pluka_geo'
      -- Le référentiel de parcours nourrit le même prétraitement que le GPX (0025).
      when v_event.event_type like 'course.%' then 'pluka_geo'
      when v_event.event_type like 'source.%' then 'pluka_sources'
      -- §44 : un changement de course descend vers les objets dépendants (0014).
      when v_event.event_type like 'race.%' then 'pluka_plan'
      -- §46 et 0033 : notifications et invitations d'équipe (0015).
      when v_event.event_type like 'email.%' then 'pluka_email'
      -- §28.1 : le webhook de paiement, vérifié et appliqué par le worker (0089).
      when v_event.event_type like 'billing.%' then 'pluka_billing'
      -- WEATHER_CONDITIONS §88 : les prévisions, hors de toute requête (0113).
      when v_event.event_type like 'weather.%' then 'pluka_weather'
      else null
    end;

    if v_queue is null then
      -- Un événement sans destination n'est pas une panne du dispatcher :
      -- il est marqué et laissé visible, plutôt que réessayé en boucle.
      update private.outbox_events
      set status = 'failed',
          attempts = attempts + 1,
          last_error = 'aucune queue pour ' || v_event.event_type
      where id = v_event.id;
      continue;
    end if;

    perform pgmq.send(v_queue, v_event.payload);

    update private.outbox_events
    set status = 'published', published_at = now(), attempts = attempts + 1
    where id = v_event.id;

    v_dispatched := v_dispatched + 1;
  end loop;

  return v_dispatched;
end;
$$;

-- ============================================================
-- 5. Le coureur demande un rafraîchissement
-- ============================================================

/*
 * Rend `queued`, ou `already_queued` si une demande pour ce Plan attend déjà
 * dans la même tranche de 10 minutes. Refuse : sans session (42501), une
 * course d'un autre (42501), sans Plan actif (P0002, NO_PLAN), sans heure de
 * départ (22023, NO_START), hors de la fenêtre J-14 (22023, OUTSIDE_WINDOW).
 *
 * La fraîcheur fine (§32) et les droits se décident ailleurs : le domaine ne
 * demande qu'une prévision trop ancienne, et le worker revérifie les droits
 * avant tout appel au fournisseur.
 */
create or replace function public.request_weather_refresh(p_participant_race_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_owner uuid;
  v_timezone text;
  v_plan uuid;
  v_start timestamptz;
  v_days integer;
  v_key text;
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  select pr.user_id, r.timezone into v_owner, v_timezone
  from public.participant_races pr
  join public.races r on r.id = pr.race_id
  where pr.id = p_participant_race_id;

  if v_owner is null or v_owner <> v_user then
    raise exception 'course inaccessible' using errcode = '42501';
  end if;

  select rp.id, nullif(rp.input_snapshot ->> 'start_at', '')::timestamptz
  into v_plan, v_start
  from public.race_plans rp
  where rp.participant_race_id = p_participant_race_id and rp.status = 'active';

  if v_plan is null then
    raise exception 'NO_PLAN' using errcode = 'P0002';
  end if;
  if v_start is null then
    raise exception 'NO_START' using errcode = '22023';
  end if;

  -- §6 : 0 <= jours avant le départ <= 14, en jours du fuseau de la course.
  v_days := (v_start at time zone v_timezone)::date - (now() at time zone v_timezone)::date;
  if v_days < 0 or v_days > 14 then
    raise exception 'OUTSIDE_WINDOW' using errcode = '22023';
  end if;

  v_key := 'weather.refresh:' || v_plan::text || ':'
    || floor(extract(epoch from now()) / 600)::bigint::text;

  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'weather.refresh',
    'race_plan',
    v_plan,
    jsonb_build_object(
      'racePlanId', v_plan,
      'participantRaceId', p_participant_race_id,
      'idempotencyKey', v_key
    ),
    v_key
  )
  on conflict (idempotency_key) do nothing;

  return case when found then 'queued' else 'already_queued' end;
end;
$$;

-- ============================================================
-- 6. Le worker
-- ============================================================

/*
 * La timeline d'un Plan, pour le moteur Conditions (§15). Un point sans
 * coordonnées officielles est placé sur la vraie trace, à sa distance (§21) :
 * la trace est projetée en Web Mercator, qui garde les proportions
 * localement, interpolée avec son altitude, puis ramenée en latitude et
 * longitude. Rend null pour un Plan inconnu.
 */
create or replace function public.worker_weather_race_plan(p_race_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select rp.id, rp.participant_race_id, rp.status::text as status,
           nullif(rp.input_snapshot ->> 'start_at', '') as start_at,
           pr.user_id, r.id as race_id, r.timezone,
           r.current_course_geometry_id as geometry_id
    from public.race_plans rp
    join public.participant_races pr on pr.id = rp.participant_race_id
    join public.races r on r.id = pr.race_id
    where rp.id = p_race_plan_id
  ),
  trace as (
    select g.id, g.version_number,
           extensions.st_transform(g.geometry, 3857) as mercator
    from public.race_course_geometries g
    join plan on plan.geometry_id = g.id
  ),
  course as (
    select max(w.distance_km) as length_km
    from public.race_waypoints w
    join plan on plan.race_id = w.race_id
  ),
  steps as (
    select pw.sort_order, pw.planned_elapsed_seconds, pw.stop_duration_seconds,
           w.id, w.name, w.waypoint_type::text as kind, w.distance_km,
           w.latitude, w.longitude, w.altitude_m,
           (select s.id from public.race_segments s
            where s.from_waypoint_id = w.id order by s.sort_order limit 1) as next_segment_id,
           case
             when trace.mercator is null or coalesce(course.length_km, 0) <= 0 then null
             else extensions.st_transform(
               extensions.st_lineinterpolatepoint(
                 trace.mercator,
                 least(1, greatest(0, w.distance_km / course.length_km))::double precision
               ),
               4326
             )
           end as on_trace
    from public.plan_waypoints pw
    join public.race_waypoints w on w.id = pw.race_waypoint_id
    cross join plan
    left join trace on true
    cross join course
    where pw.race_plan_id = plan.id
  )
  select jsonb_build_object(
    'racePlanId', plan.id,
    'participantRaceId', plan.participant_race_id,
    'userId', plan.user_id,
    'raceId', plan.race_id,
    'status', plan.status,
    'startAt', plan.start_at,
    'timezone', plan.timezone,
    'geometryKey', (select t.id::text || ':' || t.version_number::text from trace t),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'kind', s.kind,
        'label', s.name,
        'distanceKm', s.distance_km,
        'latitude', coalesce(s.latitude, round(extensions.st_y(s.on_trace)::numeric, 6)),
        'longitude', coalesce(s.longitude, round(extensions.st_x(s.on_trace)::numeric, 6)),
        'altitudeM', coalesce(s.altitude_m, round(extensions.st_z(s.on_trace))::integer),
        'positionSource', case
          when s.latitude is not null and s.longitude is not null then 'official'
          when s.on_trace is not null then 'trace'
          else null
        end,
        'elapsedSeconds', s.planned_elapsed_seconds,
        'departureElapsedSeconds', s.planned_elapsed_seconds + s.stop_duration_seconds,
        'nextSegmentId', s.next_segment_id
      ) order by s.sort_order)
      from steps s
    ), '[]'::jsonb)
  )
  from plan;
$$;

/* Les séries en cache de points de course, pour une version de fournisseur. */
create or replace function public.worker_weather_series(
  p_race_waypoint_ids uuid[],
  p_provider_config_version text
)
returns table (
  race_waypoint_id uuid,
  latitude numeric,
  longitude numeric,
  elevation_m integer,
  window_start timestamptz,
  window_end timestamptz,
  fetched_at timestamptz,
  provider_model text,
  series jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.race_waypoint_id, s.latitude, s.longitude, s.elevation_m,
         s.window_start, s.window_end, s.fetched_at, s.provider_model, s.series
  from private.weather_series s
  where s.race_waypoint_id = any (p_race_waypoint_ids)
    and s.provider_config_version = p_provider_config_version;
$$;

/*
 * Enregistre des séries fraîches : chaque point de course garde la plus
 * récente, une série plus ancienne n'écrase jamais une plus récente.
 */
create or replace function public.worker_save_weather_series(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'séries attendues en liste' using errcode = '22023';
  end if;

  insert into private.weather_series
    (race_waypoint_id, provider, provider_config_version, latitude, longitude, elevation_m,
     window_start, window_end, fetched_at, provider_model, series)
  select (row ->> 'raceWaypointId')::uuid,
         row ->> 'provider',
         row ->> 'providerConfigVersion',
         (row ->> 'latitude')::numeric,
         (row ->> 'longitude')::numeric,
         (row ->> 'elevationM')::integer,
         (row ->> 'windowStart')::timestamptz,
         (row ->> 'windowEnd')::timestamptz,
         (row ->> 'fetchedAt')::timestamptz,
         row ->> 'providerModel',
         row -> 'series'
  from jsonb_array_elements(p_rows) as row
  on conflict (race_waypoint_id, provider_config_version) do update
  set provider = excluded.provider,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      elevation_m = excluded.elevation_m,
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      fetched_at = excluded.fetched_at,
      provider_model = excluded.provider_model,
      series = excluded.series
  where private.weather_series.fetched_at <= excluded.fetched_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/*
 * Enregistre un run, ses points et ses nuits (§28, §29, §44).
 *
 * - Rejouer le même calcul (même Plan, même empreinte, mêmes séries) rend le
 *   run existant (§89).
 * - Un Plan qui n'est plus actif ne reçoit plus de run : la nouvelle version
 *   aura le sien. Rend null.
 * - Un run réussi devient l'actif ; l'ancien passe `stale`, conservé.
 * - Un run échoué est conservé pour le diagnostic, sans point ; l'actif reste
 *   l'actif (§90 : jamais de Conditions tirées d'un run échoué).
 */
create or replace function public.worker_record_weather_run(
  p_run jsonb,
  p_points jsonb,
  p_periods jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid := (p_run ->> 'racePlanId')::uuid;
  v_hash text := p_run ->> 'inputHash';
  v_fetched timestamptz := (p_run ->> 'fetchedAt')::timestamptz;
  v_failed boolean := (p_run ->> 'completeness') = 'failed';
  v_completeness text := p_run ->> 'completeness';
  v_run uuid;
begin
  -- Deux enregistrements concurrents pour un même Plan passent l'un après l'autre.
  perform pg_advisory_xact_lock(hashtextextended('weather_run:' || v_plan::text, 0));

  if not exists (
    select 1 from public.race_plans where id = v_plan and status = 'active'
  ) then
    return null;
  end if;

  select id into v_run
  from public.weather_forecast_runs
  where race_plan_id = v_plan and input_hash = v_hash and fetched_at = v_fetched;
  if v_run is not null then
    return v_run;
  end if;

  if not v_failed then
    update public.weather_forecast_runs
    set status = 'stale'
    where race_plan_id = v_plan and status = 'active';
  end if;

  insert into public.weather_forecast_runs
    (scope, race_plan_id, provider, provider_model, forecast_issued_at, fetched_at, timezone,
     input_hash, status, conditions_engine_version, sampling_config_version, astronomy_version,
     provider_config_version, normalizer_version, input_snapshot, completeness_status,
     failure_code)
  values (
    'race_plan', v_plan, p_run ->> 'provider', p_run ->> 'providerModel',
    nullif(p_run ->> 'forecastIssuedAt', '')::timestamptz, v_fetched, p_run ->> 'timezone',
    v_hash, case when v_failed then 'failed' else 'active' end::public.weather_run_status,
    p_run ->> 'conditionsEngineVersion', p_run ->> 'routePointsVersion',
    p_run ->> 'astronomyVersion', p_run ->> 'providerConfigVersion',
    p_run ->> 'normalizerVersion', coalesce(p_run -> 'inputSnapshot', '{}'::jsonb),
    -- Un run échoué n'a pas de couverture : elle reste inconnue, l'échec a son code.
    case when v_completeness in ('complete', 'partial') then v_completeness else 'unknown' end
      ::public.weather_run_completeness,
    case when v_failed then coalesce(nullif(p_run ->> 'failureCode', ''), 'provider_failed') end
  )
  returning id into v_run;

  if v_failed then
    return v_run;
  end if;

  insert into public.weather_forecast_points
    (weather_run_id, point_key, race_waypoint_id, latitude, longitude, route_altitude_m,
     planned_datetime, distance_km, elapsed_seconds, temperature_c, apparent_temperature_c,
     precipitation_probability_pct, precipitation_amount_mm, wind_speed_kmh, wind_gust_kmh,
     wind_direction_deg, weather_code, provider_payload, forecast_issued_at, fetched_at)
  select v_run,
         point ->> 'pointKey',
         nullif(point ->> 'raceWaypointId', '')::uuid,
         (point ->> 'latitude')::numeric,
         (point ->> 'longitude')::numeric,
         (point ->> 'routeAltitudeM')::integer,
         (point ->> 'plannedDatetime')::timestamptz,
         (point ->> 'distanceKm')::numeric,
         (point ->> 'elapsedSeconds')::integer,
         (point ->> 'temperatureC')::numeric,
         (point ->> 'apparentTemperatureC')::numeric,
         (point ->> 'precipitationProbabilityPct')::numeric,
         (point ->> 'precipitationAmountMm')::numeric,
         (point ->> 'windSpeedKmh')::numeric,
         (point ->> 'windGustKmh')::numeric,
         (point ->> 'windDirectionDeg')::smallint,
         point ->> 'weatherCode',
         point -> 'providerPayload',
         nullif(point ->> 'forecastIssuedAt', '')::timestamptz,
         (point ->> 'fetchedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) as point;

  insert into public.condition_periods
    (weather_run_id, condition_type, source, start_datetime, end_datetime,
     start_elapsed_seconds, end_elapsed_seconds, start_point_key, end_point_key, summary)
  select v_run, 'night', 'astronomy',
         (period ->> 'startDatetime')::timestamptz,
         (period ->> 'endDatetime')::timestamptz,
         (period ->> 'startElapsedSeconds')::integer,
         (period ->> 'endElapsedSeconds')::integer,
         period ->> 'startPointKey',
         period ->> 'endPointKey',
         jsonb_build_object(
           'fromStart', coalesce((period ->> 'fromStart')::boolean, false),
           'untilFinish', coalesce((period ->> 'untilFinish')::boolean, false)
         )
  from jsonb_array_elements(coalesce(p_periods, '[]'::jsonb)) as period;

  return v_run;
end;
$$;

-- ============================================================
-- 7. Droits d'exécution, fonction par fonction
-- ============================================================

revoke all on function public.request_weather_refresh(uuid) from public, anon;
grant execute on function public.request_weather_refresh(uuid) to authenticated;

revoke all on function public.worker_weather_race_plan(uuid) from public, anon, authenticated;
revoke all on function public.worker_weather_series(uuid[], text) from public, anon, authenticated;
revoke all on function public.worker_save_weather_series(jsonb) from public, anon, authenticated;
revoke all on function public.worker_record_weather_run(jsonb, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.worker_weather_race_plan(uuid) to service_role;
grant execute on function public.worker_weather_series(uuid[], text) to service_role;
grant execute on function public.worker_save_weather_series(jsonb) to service_role;
grant execute on function public.worker_record_weather_run(jsonb, jsonb, jsonb) to service_role;

commit;
