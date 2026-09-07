-- PLUKA V1 — Dénivelé mesuré et contrôles qualité persistés
-- File target: supabase/migrations/0026_course_quality_persisted.sql
-- Référence : docs/engines/PLAN_ENGINE.md §9, §9.1, §8.1 · docs/01_ARCHITECTURE.md §31
--
-- POURQUOI
--
-- §9 pose cinq contrôles qualité. Deux comparent la trace aux valeurs
-- officielles :
--
--   | Distance GPX vs officielle | > 10 % | Warning qualité |
--   | D+ GPX vs officiel         | > 15 % | Warning qualité |
--
-- Le moteur les calcule bel et bien — `qualityWarnings` dans
-- `preprocessing.ts` — mais le worker les envoyait en logs :
--
--     for (const warning of course.warnings) {
--       ports.logger.warn('qualité de parcours', { … });
--     }
--
-- §9.1 demande autre chose : « il produit un état de qualité à résoudre ». Une
-- ligne de journal n'est pas un état. Elle n'est ni relisable par un écran, ni
-- opposable à qui doit corriger le référentiel, et elle disparaît avec la
-- rotation des logs.
--
-- Le second contrôle était en outre impossible à reconstituer après coup :
-- `race_course_geometries` enregistrait la longueur mesurée, jamais le
-- dénivelé. Comparer le D+ GPX au D+ officiel demandait une valeur que
-- personne n'avait gardée — et §9.1 interdit de l'inventer.
--
-- CE QUE CETTE MIGRATION AJOUTE
--
-- Trois colonnes et deux paramètres. Le dénivelé mesuré rejoint la géométrie,
-- où il est un fait de la trace au même titre que sa longueur ; les warnings
-- rejoignent le prétraitement, qui les produit.
--
-- Le D- suit le D+ : les deux sortent du même calcul de profil, `races` déclare
-- les deux, et n'en garder qu'un rendrait la géométrie asymétrique avec ce à
-- quoi on la compare.
--
-- SIGNATURES REMPLACÉES
--
-- Les fonctions sont supprimées puis recréées plutôt qu'étendues : ajouter un
-- paramètre à un `create or replace` crée une surcharge, et l'ancienne
-- continuerait d'être appelée par les enveloppes `worker_*` — silencieusement,
-- sans jamais écrire les nouvelles colonnes.

begin;

-- ============================================================
-- 01. Ce que la trace mesure, et ce que le prétraitement constate
-- ============================================================

alter table public.race_course_geometries
  add column elevation_gain_m integer
    check (elevation_gain_m is null or elevation_gain_m >= 0),
  add column elevation_loss_m integer
    check (elevation_loss_m is null or elevation_loss_m >= 0),
  add column preprocessing_warnings jsonb not null default '[]'::jsonb;

comment on column public.race_course_geometries.elevation_gain_m is
  'D+ mesuré sur la trace lissée (PLAN_ENGINE §8.1, étape 4). Ce que §9 compare au D+ officiel — sans lui, le contrôle « D+ GPX vs officiel > 15 % » ne peut pas être constaté après coup.';

comment on column public.race_course_geometries.preprocessing_warnings is
  'Contrôles qualité de §9 tels que le moteur les a rendus : un tableau d''objets `{code, level, message}`. §9.1 en fait « un état de qualité à résoudre » — donc une donnée, pas une ligne de journal.';

-- ============================================================
-- 02. Persistance d'une géométrie : le dénivelé avec le reste
-- ============================================================

drop function if exists public.worker_persist_race_geometry(
  uuid, uuid, text, integer, numeric, text, text);
drop function if exists private.persist_race_geometry(
  uuid, uuid, text, integer, numeric, text, text);

create or replace function private.persist_race_geometry(
  p_race_id uuid,
  p_source_snapshot_id uuid,
  p_geometry_ewkt text,
  p_point_count integer,
  p_length_m numeric,
  p_elevation_gain_m integer,
  p_elevation_loss_m integer,
  p_processor_version text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_geometry_id uuid;
  v_version integer;
begin
  -- Rejouer un job déjà terminé ne crée pas une seconde version : c'est la
  -- garantie d'idempotence attendue de §22.1 quand un message pgmq revient.
  select g.id into v_geometry_id
  from public.race_course_geometries g
  join private.ingestion_jobs j on j.source_snapshot_id = g.source_snapshot_id
  where g.race_id = p_race_id
    and j.idempotency_key = p_idempotency_key
    and j.status = 'completed';

  if v_geometry_id is not null then
    return v_geometry_id;
  end if;

  select coalesce(max(g.version_number), 0) + 1 into v_version
  from public.race_course_geometries g
  where g.race_id = p_race_id;

  insert into public.race_course_geometries
    (race_id, source_snapshot_id, version_number, geometry, simplified_geometry,
     point_count, length_m, elevation_gain_m, elevation_loss_m, processor_version)
  values (
    p_race_id,
    p_source_snapshot_id,
    v_version,
    extensions.ST_GeomFromEWKT(p_geometry_ewkt),
    extensions.ST_Force2D(extensions.ST_GeomFromEWKT(p_geometry_ewkt)),
    p_point_count,
    p_length_m,
    p_elevation_gain_m,
    p_elevation_loss_m,
    p_processor_version
  )
  returning id into v_geometry_id;

  -- 02_DATA_MODEL §6.8 : la race pointe vers sa géométrie courante, et
  -- l'historique reste conservé.
  update public.races
  set current_course_geometry_id = v_geometry_id
  where id = p_race_id;

  update private.ingestion_jobs
  set status = 'completed', completed_at = now(), last_error = null
  where idempotency_key = p_idempotency_key;

  return v_geometry_id;
end;
$$;

comment on function private.persist_race_geometry is
  'Version de géométrie, pointeur de course et clôture de job dans une seule transaction (§31). Rejouable sans créer de doublon (§22.1). Le dénivelé mesuré y est enregistré : §9 le compare au D+ officiel.';

create or replace function public.worker_persist_race_geometry(
  p_race_id uuid,
  p_source_snapshot_id uuid,
  p_geometry_ewkt text,
  p_point_count integer,
  p_length_m numeric,
  p_elevation_gain_m integer,
  p_elevation_loss_m integer,
  p_processor_version text,
  p_idempotency_key text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.persist_race_geometry(
    p_race_id, p_source_snapshot_id, p_geometry_ewkt, p_point_count, p_length_m,
    p_elevation_gain_m, p_elevation_loss_m, p_processor_version, p_idempotency_key
  );
$$;

revoke all on function public.worker_persist_race_geometry(
  uuid, uuid, text, integer, numeric, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.worker_persist_race_geometry(
  uuid, uuid, text, integer, numeric, integer, integer, text, text) to service_role;

-- ============================================================
-- 03. Prétraitement : les warnings avec les micro-segments
-- ============================================================

drop function if exists public.worker_persist_course_micro_segments(uuid, text, jsonb);
drop function if exists private.persist_course_micro_segments(uuid, text, jsonb);

create or replace function private.persist_course_micro_segments(
  p_course_geometry_id uuid,
  p_preprocessing_version text,
  p_micro_segments jsonb,
  p_warnings jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_race_id uuid;
  v_count integer;
begin
  select g.race_id into v_race_id
  from public.race_course_geometries g
  where g.id = p_course_geometry_id;

  if v_race_id is null then
    raise exception 'unknown course geometry' using errcode = 'P0002';
  end if;

  delete from public.race_course_micro_segments
  where course_geometry_id = p_course_geometry_id;

  insert into public.race_course_micro_segments (
    race_id, course_geometry_id, race_segment_id, sort_order, distance_m,
    elevation_delta_m, elevation_gain_m, elevation_loss_m, raw_grade, model_grade,
    progress, technicality, preprocessing_version
  )
  select
    v_race_id,
    p_course_geometry_id,
    (entry ->> 'race_segment_id')::uuid,
    (entry ->> 'sort_order')::integer,
    (entry ->> 'distance_m')::numeric,
    (entry ->> 'elevation_delta_m')::numeric,
    (entry ->> 'elevation_gain_m')::numeric,
    (entry ->> 'elevation_loss_m')::numeric,
    (entry ->> 'raw_grade')::numeric,
    (entry ->> 'model_grade')::numeric,
    (entry ->> 'progress')::numeric,
    nullif(entry ->> 'technicality', ''),
    p_preprocessing_version
  from jsonb_array_elements(p_micro_segments) as entry;

  get diagnostics v_count = row_count;

  -- Les warnings remplacent les précédents : ils décrivent ce prétraitement-ci,
  -- pas l'historique de la géométrie. Un référentiel corrigé qui ne diverge
  -- plus doit laisser la liste vide (§9.1).
  update public.race_course_geometries
  set preprocessing_status = 'completed',
      preprocessing_issue = null,
      preprocessing_warnings = coalesce(p_warnings, '[]'::jsonb),
      preprocessed_at = now()
  where id = p_course_geometry_id;

  return v_count;
end;
$$;

comment on function private.persist_course_micro_segments is
  'Remplace le prétraitement d''une géométrie, ses contrôles qualité de §9 et son état, en une transaction (§8.1 étape 11, §31). Rejouable sans doublon (§22.1).';

create or replace function public.worker_persist_course_micro_segments(
  p_course_geometry_id uuid,
  p_preprocessing_version text,
  p_micro_segments jsonb,
  p_warnings jsonb default '[]'::jsonb
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.persist_course_micro_segments(
    p_course_geometry_id, p_preprocessing_version, p_micro_segments, p_warnings);
$$;

revoke all on function public.worker_persist_course_micro_segments(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.worker_persist_course_micro_segments(uuid, text, jsonb, jsonb)
  to service_role;

-- ============================================================
-- 04. Un blocage efface les warnings du prétraitement précédent
-- ============================================================
-- Aucun contrôle n'a été calculé cette fois-ci : laisser les précédents
-- laisserait croire qu'ils décrivent l'état courant.

create or replace function private.block_course_preprocessing(
  p_course_geometry_id uuid,
  p_issue text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.race_course_micro_segments
  where course_geometry_id = p_course_geometry_id;

  update public.race_course_geometries
  set preprocessing_status = 'blocked',
      preprocessing_issue = p_issue,
      preprocessing_warnings = '[]'::jsonb,
      preprocessed_at = now()
  where id = p_course_geometry_id;
end;
$$;

-- ============================================================
-- 05. Ce que l'écran de l'épreuve en lit
-- ============================================================
-- 0023 rendait la longueur mesurée face à la distance officielle. Il lui
-- manquait le dénivelé, et les warnings n'existaient pas.

create or replace function public.get_race_gpx_import(p_race_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_race public.races;
  v_result jsonb;
begin
  if (select auth.uid()) is not null and not (
    private.user_can_manage_race(p_race_id, 'editor') or private.is_pluka_admin()
  ) then
    raise exception 'action non autorisée sur cette épreuve'
      using errcode = '42501';
  end if;

  select * into v_race from public.races r where r.id = p_race_id;

  if v_race.id is null then
    raise exception 'épreuve introuvable' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'raceId', v_race.id,
    'officialDistanceMeters', round(v_race.distance_km * 1000),
    'officialElevationGainMeters', v_race.elevation_gain_m,
    'source', (
      select jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'status', s.status,
        'importedAt', s.imported_at
      )
      from public.sources s
      where s.id = v_race.gpx_source_id
    ),
    'snapshot', (
      select jsonb_build_object(
        'id', sn.id,
        'versionNumber', sn.version_number,
        'contentHash', sn.content_hash,
        'retrievedAt', sn.retrieved_at
      )
      from public.source_snapshots sn
      join public.sources s on s.id = v_race.gpx_source_id
      where sn.id = s.current_snapshot_id
    ),
    'job', (
      select jsonb_build_object(
        'status', j.status,
        'attempts', j.attempts,
        'maxAttempts', j.max_attempts,
        'lastError', j.last_error,
        'startedAt', j.started_at,
        'completedAt', j.completed_at
      )
      from private.ingestion_jobs j
      join public.sources s on s.id = v_race.gpx_source_id
      where j.source_snapshot_id = s.current_snapshot_id
        and j.job_type = 'gpx.process'
    ),
    'geometry', (
      select jsonb_build_object(
        'id', g.id,
        'versionNumber', g.version_number,
        'pointCount', g.point_count,
        'lengthMeters', g.length_m,
        -- §9 : le mesuré, face au déclaré ci-dessus.
        'elevationGainMeters', g.elevation_gain_m,
        'elevationLossMeters', g.elevation_loss_m,
        'processorVersion', g.processor_version,
        'processedAt', g.processed_at,
        'preprocessingStatus', g.preprocessing_status,
        'preprocessingIssue', g.preprocessing_issue,
        'preprocessingWarnings', g.preprocessing_warnings,
        'preprocessedAt', g.preprocessed_at,
        'microSegmentCount', (
          select count(*)
          from public.race_course_micro_segments m
          where m.course_geometry_id = g.id
        )
      )
      from public.race_course_geometries g
      where g.id = v_race.current_course_geometry_id
    )
  ) into v_result;

  return v_result;
end;
$$;

commit;
