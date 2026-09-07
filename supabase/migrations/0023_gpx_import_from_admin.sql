-- PLUKA V1 — Import GPX depuis l'administration : dépôt du fichier et état du traitement
-- File target: supabase/migrations/0023_gpx_import_from_admin.sql
-- Référence : docs/01_ARCHITECTURE.md §9, §15, §22.1, §22.2 ·
--             docs/03_PRIVACY_RLS.md §8, §84 · docs/engines/PLAN_ENGINE.md §8, §9, §9.1
--
-- POURQUOI
--
-- 0008 a construit toute la chaîne d'ingestion — bucket, `enqueue_race_gpx`,
-- outbox, worker — et 0021 le prétraitement. Il manquait les deux extrémités
-- côté écran :
--
--   1. personne ne peut déposer de fichier ;
--   2. personne ne peut savoir où en est le traitement.
--
-- Sans la première, aucune épreuve n'a de géométrie ; sans géométrie, pas de
-- micro-segments, donc pas de Plan.
--
-- 01. LE DÉPÔT : UNE POLICY, PAS UNE CLÉ DE SERVICE
--
-- 0008 note « aucune policy storage pour anon / authenticated : le bucket
-- n'est atteint que par le worker et les Route Handlers, sous clé de
-- service ». C'était vrai quand aucun écran ne déposait de fichier.
--
-- Faire porter le dépôt par une clé de service dans `apps/admin` reviendrait à
-- contourner la RLS pour écrire, puis à réimplémenter l'autorisation dans
-- l'application — exactement ce que 03_PRIVACY_RLS §8 refuse, et ce que le
-- test de frontière de cette application interdit. La policy fait mieux : elle
-- laisse l'administrateur écrire sous sa propre session, et c'est la base qui
-- décide.
--
-- La policy dérive l'épreuve du chemin de l'objet. Le chemin devient donc une
-- donnée d'autorisation, et sa forme est contrainte :
--
--     races/<race_id>/gpx/<content_hash>.gpx
--
-- Un chemin qui ne s'y conforme pas — forme invalide, ou identifiant d'une
-- épreuve qui n'existe pas — ne résout aucune épreuve, et n'est écrivable par
-- personne, `pluka_admin` compris. C'est délibéré : sans cette borne, le
-- statut plateforme ouvrirait le bucket entier.
--
-- 02. L'ÉTAT : UNE FONCTION, PARCE QUE LE JOURNAL EST DANS `private`
--
-- `private.ingestion_jobs` porte le statut, les tentatives et l'erreur, et le
-- schéma `private` n'est jamais exposé au client (02_DATA_MODEL §25). L'état
-- du traitement sort donc par une fonction `security definer`, qui porte la
-- même garde que `enqueue_race_gpx` : lire où en est un import est une
-- opération d'administration de course, pas une lecture publique.
--
-- Elle rend aussi ce que §9 permet de constater sans rien recalculer : la
-- longueur mesurée face à la distance officielle, et l'état de qualité de §9.1
-- tel que 0021 le persiste. Le D+ mesuré n'y est pas — `race_course_geometries`
-- ne le stocke pas, et l'inventer ici serait pire que de ne rien dire.

begin;

-- ============================================================
-- 01. Épreuve visée par un objet du bucket
-- ============================================================

create or replace function private.race_of_source_object(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folders text[];
  v_race_id uuid;
begin
  v_folders := storage.foldername(p_name);

  -- `races/<race_id>/gpx/<fichier>` : trois dossiers, le second est l'épreuve.
  if array_length(v_folders, 1) is distinct from 3 then return null; end if;
  if v_folders[1] <> 'races' or v_folders[3] <> 'gpx' then return null; end if;

  -- Un identifiant mal formé n'est pas une erreur de la policy : c'est un
  -- chemin qui ne désigne aucune épreuve, donc un refus.
  begin
    v_race_id := v_folders[2]::uuid;
  exception when others then
    return null;
  end;

  -- L'épreuve doit exister. Sans cette lecture, `is_pluka_admin()` suffirait à
  -- écrire sous n'importe quel identifiant bien formé, y compris celui d'une
  -- épreuve qui n'existe pas : le bucket accumulerait des fichiers que
  -- `enqueue_race_gpx` refuserait ensuite d'enfiler, sans que rien ne les
  -- rattache à quoi que ce soit.
  return (select r.id from public.races r where r.id = v_race_id);
end;
$$;

comment on function private.race_of_source_object(text) is
  'Épreuve désignée par le chemin d''un objet de `race-sources`, ou null si le chemin n''en désigne aucune — forme invalide comme épreuve inexistante. Le chemin est une donnée d''autorisation : voir les policies du bucket.';

-- ============================================================
-- 02. Dépôt d'un GPX dans `race-sources`
-- ============================================================
-- Même autorité que les policies d'écriture du référentiel (0005, 0007) et que
-- la garde de `enqueue_race_gpx` : `editor` de l'organisation gestionnaire, ou
-- `pluka_admin`. Trois barrières superposées, aucune ne délègue à l'autre.
--
-- Aucun `select` n'est accordé : l'application dépose, elle ne relit pas les
-- fichiers. Le worker les télécharge sous clé de service, et une URL signée
-- reste le seul chemin de lecture (§84).
--
-- Aucun `delete` non plus. Un GPX déposé est la source d'une géométrie
-- persistée et d'un snapshot référencé : l'effacer laisserait une géométrie
-- sans provenance.

create policy race_sources__insert__course_editor
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'race-sources'
    and private.race_of_source_object(name) is not null
    and (
      private.user_can_manage_race(private.race_of_source_object(name), 'editor')
      or private.is_pluka_admin()
    )
  );

-- Le chemin dérive du hash du contenu : redéposer le même fichier réécrit le
-- même objet. L'`update` rend ce second dépôt inoffensif au lieu d'échouer sur
-- un objet déjà là.
create policy race_sources__update__course_editor
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'race-sources'
    and private.race_of_source_object(name) is not null
    and (
      private.user_can_manage_race(private.race_of_source_object(name), 'editor')
      or private.is_pluka_admin()
    )
  )
  with check (
    bucket_id = 'race-sources'
    and private.race_of_source_object(name) is not null
    and (
      private.user_can_manage_race(private.race_of_source_object(name), 'editor')
      or private.is_pluka_admin()
    )
  );

comment on policy race_sources__insert__course_editor on storage.objects is
  'Dépôt d''un GPX par qui a le droit de modifier le contenu de course. Le chemin `races/<race_id>/gpx/<hash>.gpx` porte l''épreuve : un chemin qui n''en désigne aucune — hors forme, ou épreuve inexistante — n''est écrivable par personne, `pluka_admin` compris.';

-- ============================================================
-- 03. État de l'import d'une épreuve
-- ============================================================

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
  -- Même garde que `enqueue_race_gpx` (0008), et pour la même raison : sans
  -- session — worker, test d'intégration — l'appelant est `service_role`, tenu
  -- de vérifier lui-même ce qu'il fait (03_PRIVACY_RLS §8).
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
    -- Ce que l'épreuve déclare, pour que §9 puisse être constaté sans que
    -- l'appelant aille le chercher ailleurs.
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
    -- Le job vit dans `private` : c'est la seule raison d'être `security
    -- definer`. Il porte « en attente / terminé / en erreur ».
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
        'processorVersion', g.processor_version,
        'processedAt', g.processed_at,
        -- §9.1 : « il produit un état de qualité à résoudre ».
        'preprocessingStatus', g.preprocessing_status,
        'preprocessingIssue', g.preprocessing_issue,
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

comment on function public.get_race_gpx_import(uuid) is
  'Où en est l''import GPX d''une épreuve : source, snapshot, job d''ingestion, géométrie et état de prétraitement (§9.1). `security definer` parce que `private.ingestion_jobs` n''est jamais exposé au client (02_DATA_MODEL §25) ; même garde que `enqueue_race_gpx`.';

revoke all on function public.get_race_gpx_import(uuid) from public, anon;
grant execute on function public.get_race_gpx_import(uuid) to authenticated, service_role;

commit;
