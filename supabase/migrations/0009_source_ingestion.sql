-- PLUKA V1 — Ingestion de sources, étape 1 : fetch et snapshot
-- File target: supabase/migrations/0009_source_ingestion.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §6, §9, §10, §11 ·
--             docs/01_ARCHITECTURE.md §22.1, §22.2, §31 · docs/02_DATA_MODEL.md §7.1, §7.2
--
-- PÉRIMÈTRE
--
-- Récupération, stockage immuable, provenance, déduplication. Rien d'autre :
-- ni parsing, ni chunking, ni extraction, ni IA. §29 pose l'ordre —
-- « extraction déterministe avant IA » — et avant l'extraction, il faut un
-- contenu figé et daté auquel se référer.
--
-- Aucune colonne n'est ajoutée : la migration 0003 a déjà doté
-- `source_snapshots` de `content_type`, `size_bytes`, `final_url` et
-- `http_status`, en notant que « les versions de parseur restent dans la
-- couche de traitement privée pour que les snapshots restent immuables ».
-- C'est exactement la frontière de ce lot.
--
-- La contrainte `unique (source_id, content_hash)` de 0001 porte déjà la
-- déduplication de §10. Les fonctions ci-dessous la rendent gracieuse plutôt
-- que fatale : recapturer une source inchangée est le cas courant, pas une
-- erreur.

begin;

-- ============================================================
-- 01. Déclaration d'une source à ingérer
-- ============================================================
-- Source + job + événement outbox dans une seule transaction (§22.2, §31).

create or replace function public.enqueue_source_ingest(
  p_edition_id uuid,
  p_source_type public.source_type,
  p_title text,
  p_url text default null,
  p_race_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_source_id uuid;
  v_idempotency_key text;
begin
  -- Même garde que les policies d'écriture de sources (0005), et même
  -- exception pour le chemin serveur que `enqueue_race_gpx` : sans session,
  -- l'appelant est `service_role` et reste responsable de ses vérifications
  -- (03_PRIVACY_RLS §8).
  if (select auth.uid()) is not null and not (
    private.user_can_manage_edition(p_edition_id, 'editor') or private.is_pluka_admin()
  ) then
    raise exception 'action non autorisée sur cette édition'
      using errcode = '42501';
  end if;

  select e.organization_id into v_organization_id
  from public.editions ed
  join public.events e on e.id = ed.event_id
  where ed.id = p_edition_id;

  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  insert into public.sources
    (edition_id, organization_id, source_type, title, url, status, created_by_user_id)
  values
    (p_edition_id, v_organization_id, p_source_type, p_title, p_url, 'uploaded', (select auth.uid()))
  returning id into v_source_id;

  -- §6 : une Source est une référence logique durable, portée éventuellement
  -- par plusieurs courses.
  if p_race_id is not null then
    insert into public.source_race_scopes (source_id, race_id)
    values (v_source_id, p_race_id)
    on conflict do nothing;
  end if;

  -- La clé porte la source, pas le contenu : à ce stade le contenu est encore
  -- inconnu. C'est la capture qui déduplique ensuite, par empreinte (§10).
  v_idempotency_key := 'source.ingest:' || v_source_id::text;

  insert into private.outbox_events (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'source.ingest',
    'source',
    v_source_id,
    jsonb_build_object(
      'sourceId', v_source_id,
      'url', p_url,
      'idempotencyKey', v_idempotency_key
    ),
    v_idempotency_key
  );

  return v_source_id;
end;
$$;

comment on function public.enqueue_source_ingest is
  'Déclare une source et enfile sa capture (§22.2). Le contenu n''est pas encore connu : la déduplication se fait à la capture, par empreinte (§10).';

revoke all on function public.enqueue_source_ingest(uuid, public.source_type, text, text, uuid)
  from public, anon;
grant execute on function public.enqueue_source_ingest(uuid, public.source_type, text, text, uuid)
  to authenticated, service_role;

-- ============================================================
-- 02. Empreintes déjà connues d'une source
-- ============================================================
-- Alimente la décision de déduplication côté worker (§10). Rend les
-- empreintes, pas les contenus : le worker n'a besoin que de comparer.

create or replace function private.source_content_hashes(p_source_id uuid)
returns table (content_hash char(64))
language sql
stable
security definer
set search_path = ''
as $$
  select s.content_hash
  from public.source_snapshots s
  where s.source_id = p_source_id
  order by s.version_number desc;
$$;

-- ============================================================
-- 03. Enregistrement d'un snapshot
-- ============================================================
-- §9 : « une fois utilisé pour une publication, un snapshot ne doit pas être
-- modifié ». Il n'est donc jamais mis à jour : soit il existe déjà pour ce
-- contenu et on le rend tel quel, soit on en crée un nouveau.

create or replace function private.record_source_snapshot(
  p_source_id uuid,
  p_content_hash char(64),
  p_storage_path text,
  p_content_type text,
  p_size_bytes bigint,
  p_final_url text,
  p_http_status smallint
)
returns table (snapshot_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_version integer;
begin
  -- §10 : « éviter les snapshots strictement identiques ». Recapturer une
  -- source inchangée rend le snapshot existant, sans nouvelle version — sinon
  -- l'historique se remplirait de doublons et §36 signalerait des changements
  -- qui n'ont pas eu lieu.
  select s.id into v_snapshot_id
  from public.source_snapshots s
  where s.source_id = p_source_id and s.content_hash = p_content_hash;

  if v_snapshot_id is not null then
    return query select v_snapshot_id, false;
    return;
  end if;

  select coalesce(max(s.version_number), 0) + 1 into v_version
  from public.source_snapshots s
  where s.source_id = p_source_id;

  insert into public.source_snapshots
    (source_id, version_number, content_hash, snapshot_storage_path,
     content_type, size_bytes, final_url, http_status)
  values
    (p_source_id, v_version, p_content_hash, p_storage_path,
     p_content_type, p_size_bytes, p_final_url, p_http_status)
  returning id into v_snapshot_id;

  -- La source pointe vers son snapshot courant ; les précédents restent.
  update public.sources
  set current_snapshot_id = v_snapshot_id,
      status = 'ready',
      imported_at = now()
  where id = p_source_id;

  return query select v_snapshot_id, true;
end;
$$;

comment on function private.record_source_snapshot is
  'Snapshot immuable et déduplication par empreinte (§9, §10). Ne met jamais à jour un snapshot existant : il le rend.';

-- ============================================================
-- 04. Échec de capture
-- ============================================================

create or replace function private.mark_source_failed(p_source_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sources set status = 'failed' where id = p_source_id;
$$;

-- ============================================================
-- 05. Surface d'appel du worker
-- ============================================================
-- Même raison qu'en 0008 : PostgREST n'expose que `public`.

create or replace function public.worker_source_content_hashes(p_source_id uuid)
returns table (content_hash char(64))
language sql
security definer
set search_path = ''
as $$
  select * from private.source_content_hashes(p_source_id);
$$;

create or replace function public.worker_record_source_snapshot(
  p_source_id uuid,
  p_content_hash char(64),
  p_storage_path text,
  p_content_type text,
  p_size_bytes bigint,
  p_final_url text,
  p_http_status smallint
)
returns table (snapshot_id uuid, created boolean)
language sql
security definer
set search_path = ''
as $$
  select * from private.record_source_snapshot(
    p_source_id, p_content_hash, p_storage_path,
    p_content_type, p_size_bytes, p_final_url, p_http_status
  );
$$;

create or replace function public.worker_mark_source_failed(p_source_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.mark_source_failed(p_source_id);
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_source_content_hashes(uuid)',
    'public.worker_record_source_snapshot(uuid, char, text, text, bigint, text, smallint)',
    'public.worker_mark_source_failed(uuid)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$do$;

revoke all on all functions in schema private from anon, authenticated;

commit;
