-- PLUKA V1 — Rattrapage du dénivelé mesuré sur les géométries d'avant 0026
-- File target: supabase/migrations/0027_geometry_elevation_backfill.sql
-- Référence : docs/engines/PLAN_ENGINE.md §9, §9.1 · docs/02_DATA_MODEL.md §6.8
--
-- POURQUOI
--
-- 0026 a ajouté `elevation_gain_m` et `elevation_loss_m` à
-- `race_course_geometries`. Un `add column` ne remplit pas les lignes
-- existantes : toute géométrie persistée avant la migration porte NULL, et le
-- contrôle « D+ GPX vs officiel > 15 % » de §9 reste inconstatable sur elle.
--
-- Redéposer le GPX ne suffit pas : `enqueue_race_gpx` est idempotent par
-- (épreuve, empreinte), et le job de ces géométries est `completed`. Le même
-- fichier ne produit donc aucun nouveau traitement.
--
-- LÀ OÙ LE RATTRAPAGE SE GREFFE
--
-- `course.waypoints.changed` relit déjà le GPX et le repasse dans `processGpx`
-- pour rejouer l'étape 9 de §8.1. La mesure est donc entre ses mains, sans
-- lecture ni calcul supplémentaire. C'est le seul chemin qui la reconstitue à
-- l'identique.
--
-- DEUX BORNES
--
-- 1. Le rattrapage ne touche que `elevation_gain_m is null`. Une géométrie
--    déjà mesurée n'est jamais réécrite — même par une valeur qui serait
--    identique : le `where` est la garantie, pas la comparaison.
--
-- 2. Aucune version de géométrie n'est créée, et `version_number`,
--    `processed_at`, `geometry` et le pointeur de course ne bougent pas. La
--    trace n'a pas changé ; seule une mesure manquante est comblée.
--
-- CE QUE CETTE FONCTION NE FAIT PAS
--
-- Elle ne dérive rien de la géométrie stockée. Le D+ ne se recalcule pas en
-- SQL depuis la `LINESTRING Z` : PostGIS rendrait la somme des dénivelés du
-- tracé brut, quand `processGpx` mesure sur l'altitude lissée par la fenêtre
-- de 50 m de §8.1, étape 4. Les deux valeurs diffèrent, et seule la seconde
-- est celle à laquelle §9 compare. Les deux nombres arrivent donc en
-- paramètres, calculés par le moteur.

begin;

-- ============================================================
-- 01. Combler une mesure absente
-- ============================================================

create or replace function private.backfill_geometry_elevation(
  p_course_geometry_id uuid,
  p_elevation_gain_m integer,
  p_elevation_loss_m integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filled boolean;
begin
  update public.race_course_geometries
  set elevation_gain_m = p_elevation_gain_m,
      elevation_loss_m = p_elevation_loss_m
  where id = p_course_geometry_id
    -- La borne du rattrapage. Elle rend l'opération sûre à rejouer, et
    -- inoffensive sur une géométrie déjà mesurée.
    and elevation_gain_m is null;

  get diagnostics v_filled = row_count;

  return v_filled;
end;
$$;

comment on function private.backfill_geometry_elevation(uuid, integer, integer) is
  'Comble le dénivelé d''une géométrie qui n''en a pas — lignes d''avant 0026. Ne réécrit jamais une mesure existante, ne crée aucune version, et ne dérive rien de la géométrie stockée : les valeurs viennent de `processGpx`.';

create or replace function public.worker_backfill_geometry_elevation(
  p_course_geometry_id uuid,
  p_elevation_gain_m integer,
  p_elevation_loss_m integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.backfill_geometry_elevation(
    p_course_geometry_id, p_elevation_gain_m, p_elevation_loss_m);
$$;

revoke all on function public.worker_backfill_geometry_elevation(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.worker_backfill_geometry_elevation(uuid, integer, integer)
  to service_role;

-- ============================================================
-- 02. Le worker doit savoir s'il y a quelque chose à combler
-- ============================================================
-- Sans cette information, la relance tenterait l'écriture à chaque passage.
-- Elle serait sans effet — le `where` y veille — mais le journal ne
-- distinguerait plus un rattrapage réel d'un appel pour rien.

create or replace function public.worker_race_course_source(p_race_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'courseGeometryId', g.id,
    'storagePath', sn.snapshot_storage_path,
    'needsElevation', g.elevation_gain_m is null
  )
  from public.races r
  join public.race_course_geometries g on g.id = r.current_course_geometry_id
  join public.source_snapshots sn on sn.id = g.source_snapshot_id
  where r.id = p_race_id;
$$;

comment on function public.worker_race_course_source(uuid) is
  'Géométrie courante d''une épreuve, chemin du GPX dont elle provient, et si sa mesure de dénivelé manque encore (0027). Le prétraitement repart du fichier : la trace normalisée n''est pas persistée point par point (0008).';

commit;
