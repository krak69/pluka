-- PLUKA V1 — Prétraitement du parcours à l'import GPX
-- File target: supabase/migrations/0021_course_preprocessing_job.sql
-- Référence : docs/engines/PLAN_ENGINE.md §8, §8.1, §9, §9.1, §62 ·
--             docs/01_ARCHITECTURE.md §22.1, §31 · docs/02_DATA_MODEL.md §6.8
--
-- POURQUOI
--
-- 0020 a créé `race_course_micro_segments` sans personne pour l'écrire. Cette
-- migration donne au worker son chemin d'écriture, et à la géométrie un état
-- de qualité.
--
-- §8.1, étape 11 : « persister / cacher le résultat prétraité avec sa version
-- de processeur ». L'écriture appartient donc à l'import, une fois — §62 :
-- « l'important est qu'il ne soit pas recomputé à chaque édition du Plan ».
--
-- L'ÉTAT DE QUALITÉ
--
-- §9 borne le raccordement d'un waypoint à 200 m et conclut « erreur /
-- validation requise avant Plan ». Avant le Plan, pas avant la géométrie : une
-- trace reste bonne même si un ravito a été pointé au mauvais endroit. Le job
-- persiste donc la géométrie, refuse d'en tirer des micro-segments, et le dit.
--
-- §9.1 gouverne la forme de ce refus : « il produit un état de qualité à
-- résoudre ». D'où deux colonnes, et non un silence.

begin;

-- ============================================================
-- 01. État de prétraitement d'une géométrie
-- ============================================================

create type public.course_preprocessing_status as enum ('pending', 'completed', 'blocked');

alter table public.race_course_geometries
  add column preprocessing_status public.course_preprocessing_status not null default 'pending',
  add column preprocessing_issue text,
  add column preprocessed_at timestamptz;

comment on column public.race_course_geometries.preprocessing_status is
  'Où en est le prétraitement de PLAN_ENGINE §8.1, étapes 5 à 9. `blocked` signale un état de qualité à résoudre avant tout Plan (§9, §9.1) — la géométrie, elle, reste valide.';

comment on column public.race_course_geometries.preprocessing_issue is
  'Motif lisible du blocage. Aucune donnée personnelle : c''est un fait de course (§60).';

-- ============================================================
-- 02. Écriture des micro-segments
-- ============================================================
-- Remplacement complet plutôt qu'ajout : les micro-segments d'une géométrie
-- forment un tout, et un rejeu de message pgmq doit rendre exactement le même
-- ensemble, pas un second exemplaire (01_ARCHITECTURE §22.1).
--
-- La suppression et l'insertion partagent la transaction de la fonction : à
-- aucun moment la géométrie n'est visible avec un prétraitement à moitié
-- réécrit (§31).

create or replace function private.persist_course_micro_segments(
  p_course_geometry_id uuid,
  p_preprocessing_version text,
  p_micro_segments jsonb
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

  update public.race_course_geometries
  set preprocessing_status = 'completed',
      preprocessing_issue = null,
      preprocessed_at = now()
  where id = p_course_geometry_id;

  return v_count;
end;
$$;

comment on function private.persist_course_micro_segments is
  'Remplace le prétraitement d''une géométrie et clôt son état de qualité, en une transaction (§8.1 étape 11, §31). Rejouable sans doublon (§22.1).';

/**
 * Blocage du prétraitement — §9, §9.1.
 *
 * Aucun micro-segment n'est écrit, et les précédents sont retirés : un Plan ne
 * doit pas continuer de s'appuyer sur un prétraitement qu'on sait faux.
 */
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
      preprocessed_at = now()
  where id = p_course_geometry_id;
end;
$$;

-- ============================================================
-- 03. Ce que le job doit lire
-- ============================================================
-- Le worker a besoin du référentiel de parcours au moment du prétraitement :
-- les waypoints à raccorder, et la chaîne de segments à laquelle rattacher
-- chaque micro-segment.
--
-- Une fonction plutôt que deux lectures PostgREST : elles doivent voir le même
-- état, et un waypoint ajouté entre les deux produirait une chaîne incohérente.

create or replace function public.get_course_preprocessing_input(p_race_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'waypoints', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'sortOrder', w.sort_order,
          'latitude', w.latitude,
          'longitude', w.longitude,
          'declaredDistanceMeters', round(w.distance_km * 1000)
        )
        order by w.sort_order
      )
      from public.race_waypoints w
      where w.race_id = p_race_id
    ), '[]'::jsonb),
    'segments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'sortOrder', s.sort_order,
          'fromWaypointId', s.from_waypoint_id,
          'toWaypointId', s.to_waypoint_id
        )
        order by s.sort_order
      )
      from public.race_segments s
      where s.race_id = p_race_id
    ), '[]'::jsonb),
    'official', jsonb_build_object(
      'distanceMeters', (
        select round(r.distance_km * 1000) from public.races r where r.id = p_race_id
      ),
      'elevationGainMeters', (
        select r.elevation_gain_m from public.races r where r.id = p_race_id
      )
    )
  );
$$;

comment on function public.get_course_preprocessing_input is
  'Référentiel de parcours vu d''un seul coup, pour que le prétraitement raisonne sur un état cohérent (§8.1 étapes 7 et 9).';

-- ============================================================
-- 04. Surface d'appel du worker
-- ============================================================
-- Le prétraitement n'appartient à aucune session : c'est le worker, sous clé
-- de service, qui l'exécute à l'import (§8). Les trois fonctions suivent donc
-- la convention de 0008 — préfixe `worker_`, `service_role` seul.
--
-- 03_PRIVACY_RLS §8 : elles écrivent hors RLS, et restent tenues de vérifier
-- ce qu'elles font — ici, que la géométrie visée existe.

create or replace function public.worker_persist_course_micro_segments(
  p_course_geometry_id uuid,
  p_preprocessing_version text,
  p_micro_segments jsonb
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.persist_course_micro_segments(
    p_course_geometry_id, p_preprocessing_version, p_micro_segments);
$$;

create or replace function public.worker_block_course_preprocessing(
  p_course_geometry_id uuid,
  p_issue text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.block_course_preprocessing(p_course_geometry_id, p_issue);
$$;

create or replace function public.worker_course_preprocessing_input(p_race_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_course_preprocessing_input(p_race_id);
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_persist_course_micro_segments(uuid, text, jsonb)',
    'public.worker_block_course_preprocessing(uuid, text)',
    'public.worker_course_preprocessing_input(uuid)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$do$;

comment on function public.worker_persist_course_micro_segments(uuid, text, jsonb) is
  'Surface d''appel du worker. Réservée à service_role : ces fonctions écrivent hors RLS (03_PRIVACY_RLS §8).';

revoke all on function public.get_course_preprocessing_input(uuid) from public, anon, authenticated;

revoke all on all functions in schema private from anon, authenticated;

commit;
