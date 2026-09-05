-- PLUKA V1 — Ingestion GPX : stockage, outbox et persistance de géométrie
-- File target: supabase/migrations/0008_gpx_ingestion.sql
-- Référence : docs/01_ARCHITECTURE.md §15, §22, §22.1, §22.2, §31 ·
--             docs/02_DATA_MODEL.md §6.8, §7.1, §7.2 · docs/03_PRIVACY_RLS.md §84
--
-- POURQUOI DES FONCTIONS PLUTÔT QUE DES REQUÊTES
--
-- §22.2 décrit l'outbox comme une garantie transactionnelle :
--
--     transaction : update … + insert outbox_event ; commit
--     dispatcher  : outbox_event → pgmq
--
-- Elle ne tient que si la mutation et l'événement partagent la même
-- transaction. PostgREST envoie une instruction par appel : deux requêtes
-- successives laisseraient une fenêtre où le GPX est enregistré sans que le
-- worker puisse jamais le traiter — ou l'inverse.
--
-- D'où trois fonctions, chacune atomique par construction. C'est le cas que
-- §31 vise explicitement : « utiliser une transaction PostgreSQL lorsque
-- plusieurs écritures doivent réussir ensemble ».

begin;

-- ============================================================
-- 01. Bucket de stockage
-- ============================================================
-- 03_PRIVACY_RLS §84 : `race-sources` est privé. Les fichiers sortent par des
-- URLs signées produites côté serveur, jamais par une lecture directe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'race-sources',
  'race-sources',
  false,
  52428800,
  array['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream']
)
on conflict (id) do nothing;

-- Aucune policy storage pour anon / authenticated : le bucket n'est atteint
-- que par le worker et les Route Handlers, sous clé de service.

-- ============================================================
-- 02. Dépôt d'un GPX : source + snapshot + job + outbox, en une transaction
-- ============================================================

create or replace function public.enqueue_race_gpx(
  p_race_id uuid,
  p_storage_path text,
  p_content_hash char(64),
  p_title text default 'Trace GPX'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid;
  v_organization_id uuid;
  v_source_id uuid;
  v_snapshot_id uuid;
  v_version integer;
  v_idempotency_key text;
begin
  -- Même garde que les policies d'écriture du référentiel (0005, 0007). Le
  -- use case du domaine vérifie de son côté : la RLS protège la donnée, le
  -- use case protège l'opération, aucun ne délègue à l'autre.
  --
  -- La garde ne s'applique qu'aux sessions utilisateur. Sans session —
  -- worker, reprise de données, test d'intégration — `auth.uid()` est nul et
  -- l'appelant est `service_role`, qui reste tenu de vérifier lui-même ce
  -- qu'il fait (03_PRIVACY_RLS §8). Même raisonnement que le trigger de
  -- protection de colonnes de 0005.
  if (select auth.uid()) is not null and not (
    private.user_can_manage_race(p_race_id, 'editor') or private.is_pluka_admin()
  ) then
    raise exception 'action non autorisée sur cette épreuve'
      using errcode = '42501';
  end if;

  select r.edition_id, e.organization_id
  into v_edition_id, v_organization_id
  from public.races r
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  where r.id = p_race_id;

  if v_edition_id is null then
    raise exception 'épreuve introuvable' using errcode = 'P0002';
  end if;

  -- Idempotence par contenu (§22.1) : redéposer deux fois le même fichier sur
  -- la même course ne crée pas deux traitements. La clé est stable et
  -- calculable des deux côtés.
  v_idempotency_key := 'gpx.process:' || p_race_id::text || ':' || p_content_hash;

  -- Un dépôt déjà enfilé rend le snapshot existant plutôt qu'un doublon.
  select j.source_snapshot_id into v_snapshot_id
  from private.ingestion_jobs j
  where j.idempotency_key = v_idempotency_key;

  if v_snapshot_id is not null then
    return v_snapshot_id;
  end if;

  insert into public.sources
    (edition_id, organization_id, source_type, title, storage_path, status, created_by_user_id)
  values
    (v_edition_id, v_organization_id, 'gpx', p_title, p_storage_path, 'uploaded', (select auth.uid()))
  returning id into v_source_id;

  select coalesce(max(s.version_number), 0) + 1 into v_version
  from public.source_snapshots s
  where s.source_id = v_source_id;

  insert into public.source_snapshots (source_id, version_number, content_hash, snapshot_storage_path)
  values (v_source_id, v_version, p_content_hash, p_storage_path)
  returning id into v_snapshot_id;

  update public.sources set current_snapshot_id = v_snapshot_id where id = v_source_id;
  update public.races set gpx_source_id = v_source_id where id = p_race_id;

  -- §22.1 : le job porte sa clé d'idempotence, son compteur de tentatives et
  -- son statut. C'est lui qui rend un retour de message pgmq inoffensif.
  insert into private.ingestion_jobs (source_snapshot_id, job_type, status, idempotency_key)
  values (v_snapshot_id, 'gpx.process', 'queued', v_idempotency_key);

  -- §22.2 : l'événement part dans la même transaction que la mutation.
  insert into private.outbox_events (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'gpx.process',
    'race',
    p_race_id,
    jsonb_build_object(
      'raceId', p_race_id,
      'sourceSnapshotId', v_snapshot_id,
      'storagePath', p_storage_path,
      'idempotencyKey', v_idempotency_key
    ),
    v_idempotency_key
  );

  return v_snapshot_id;
end;
$$;

comment on function public.enqueue_race_gpx(uuid, text, char, text) is
  'Dépôt d''un GPX : source, snapshot, job et événement outbox dans une seule transaction (01_ARCHITECTURE §22.2, §31). Idempotent par (race, content_hash).';

revoke all on function public.enqueue_race_gpx(uuid, text, char, text) from public, anon;
grant execute on function public.enqueue_race_gpx(uuid, text, char, text)
  to authenticated, service_role;

-- ============================================================
-- 03. Dispatcher outbox → pgmq
-- ============================================================
-- Le dispatcher est la seule pièce qui traduit un événement métier en message
-- de file. Il verrouille les lignes qu'il prend (`for update skip locked`)
-- pour que deux workers puissent tourner sans se marcher dessus.

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
    -- Groupement par domaine, pas une queue par type de job (0002).
    v_queue := case
      when v_event.event_type like 'gpx.%' then 'pluka_geo'
      when v_event.event_type like 'source.%' then 'pluka_sources'
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

comment on function private.dispatch_outbox_events(integer) is
  'Traduit les événements outbox en messages pgmq (§22.2). `for update skip locked` : plusieurs workers peuvent tourner de front.';

-- ============================================================
-- 04. Persistance d'une géométrie traitée
-- ============================================================
-- Trois écritures qui n'ont de sens qu'ensemble : la version de géométrie, le
-- pointeur de la course, et la clôture du job. Les séparer laisserait une
-- course pointant vers une géométrie absente, ou un job terminé sans résultat.

create or replace function private.persist_race_geometry(
  p_race_id uuid,
  p_source_snapshot_id uuid,
  p_geometry_ewkt text,
  p_point_count integer,
  p_length_m numeric,
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
     point_count, length_m, processor_version)
  values (
    p_race_id,
    p_source_snapshot_id,
    v_version,
    extensions.ST_GeomFromEWKT(p_geometry_ewkt),
    extensions.ST_Force2D(extensions.ST_GeomFromEWKT(p_geometry_ewkt)),
    p_point_count,
    p_length_m,
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
  'Version de géométrie, pointeur de course et clôture de job dans une seule transaction (§31). Rejouable sans créer de doublon (§22.1).';

-- ============================================================
-- 05. Réclamation et échec d'un job
-- ============================================================

create or replace function private.claim_ingestion_job(p_idempotency_key text)
returns table (
  job_id uuid,
  status text,
  attempts integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Un job déjà terminé est rendu tel quel : l'appelant saura qu'il n'a rien
  -- à refaire, sans que le compteur de tentatives bouge.
  return query
  update private.ingestion_jobs j
  set status = case when j.status = 'completed' then 'completed' else 'running' end,
      attempts = case when j.status = 'completed' then j.attempts else j.attempts + 1 end,
      started_at = case when j.status = 'completed' then j.started_at else now() end
  where j.idempotency_key = p_idempotency_key
  returning j.id, j.status, j.attempts, j.max_attempts;
end;
$$;

create or replace function private.fail_ingestion_job(
  p_idempotency_key text,
  p_error text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Au-delà de `max_attempts`, le job devient `failed` définitivement : le
  -- worker cessera de le reprendre. En deçà il repasse `queued`, prêt pour le
  -- retour du message.
  update private.ingestion_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      last_error = left(p_error, 500)
  where idempotency_key = p_idempotency_key
  returning status into v_status;

  return v_status;
end;
$$;

comment on function private.fail_ingestion_job(text, text) is
  'Erreur normalisée et tronquée (§22.1). Au-delà de max_attempts le job est abandonné plutôt que réessayé indéfiniment.';

-- Les fonctions du schéma privé restent hors de portée des rôles client
-- (03_PRIVACY_RLS §7).
revoke all on all functions in schema private from anon, authenticated;

-- ============================================================
-- 06. Surface d'appel du worker
-- ============================================================
-- PostgREST n'expose que `public` (config.toml : schemas = ["public", ...]).
-- Les fonctions ci-dessus vivent dans `private`, et pgmq dans son propre
-- schéma : le worker ne peut donc en appeler aucune directement.
--
-- Ces enveloppes sont sa seule surface. Elles sont révoquées de `public`,
-- `anon` et `authenticated`, et accordées au seul `service_role` — le worker
-- est le seul rôle que 03_PRIVACY_RLS §8 autorise à les employer.

create or replace function public.worker_read_queue(
  p_queue text,
  p_visibility_seconds integer,
  p_count integer
)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
security definer
set search_path = ''
as $$
  select m.msg_id, m.read_ct, m.message
  from pgmq.read(p_queue, p_visibility_seconds, p_count) m;
$$;

create or replace function public.worker_archive_message(p_queue text, p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.archive(p_queue, p_msg_id);
$$;

create or replace function public.worker_claim_ingestion_job(p_idempotency_key text)
returns table (job_id uuid, status text, attempts integer, max_attempts integer)
language sql
security definer
set search_path = ''
as $$
  select * from private.claim_ingestion_job(p_idempotency_key);
$$;

create or replace function public.worker_fail_ingestion_job(p_idempotency_key text, p_error text)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.fail_ingestion_job(p_idempotency_key, p_error);
$$;

create or replace function public.worker_persist_race_geometry(
  p_race_id uuid,
  p_source_snapshot_id uuid,
  p_geometry_ewkt text,
  p_point_count integer,
  p_length_m numeric,
  p_processor_version text,
  p_idempotency_key text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.persist_race_geometry(
    p_race_id, p_source_snapshot_id, p_geometry_ewkt,
    p_point_count, p_length_m, p_processor_version, p_idempotency_key
  );
$$;

create or replace function public.worker_dispatch_outbox(p_limit integer default 50)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.dispatch_outbox_events(p_limit);
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_read_queue(text, integer, integer)',
    'public.worker_archive_message(text, bigint)',
    'public.worker_claim_ingestion_job(text)',
    'public.worker_fail_ingestion_job(text, text)',
    'public.worker_persist_race_geometry(uuid, uuid, text, integer, numeric, text, text)',
    'public.worker_dispatch_outbox(integer)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$do$;

comment on function public.worker_dispatch_outbox(integer) is
  'Surface d''appel du worker. Réservée à service_role : ces fonctions écrivent hors RLS (03_PRIVACY_RLS §8).';

commit;
