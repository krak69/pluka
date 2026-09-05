-- PLUKA V1 — Ingestion de sources, étape 2 : parsing et chunking
-- File target: supabase/migrations/0010_source_parsing.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §18, §19, §20, §29 ·
--             docs/01_ARCHITECTURE.md §22.2, §31
--
-- PÉRIMÈTRE
--
-- Le snapshot immuable de l'étape 1 devient une suite de blocks et de chunks,
-- chacun portant de quoi revenir à sa position dans le document d'origine.
-- Aucune extraction de candidats, aucune IA — §29 : « extraction déterministe
-- avant IA ».
--
-- AUCUNE COLONNE AJOUTÉE
--
-- 0001 et 0003 avaient déjà tout prévu : `source_blocks` porte
-- `block_index`, `page_number`, `section_path`, `heading`, `block_type`,
-- `locator` et `content_hash` — la structure exacte de §18 ; `source_chunks` a
-- reçu `parse_run_id`, `section_path`, `locator` et `chunker_version` ;
-- `extraction_runs` porte `parser_version` et `chunker_version`.
--
-- Ces versions vivent dans le schéma **privé**, et c'est le point : re-parser
-- ne touche jamais au snapshot, cela crée un nouveau run. Le snapshot reste
-- immuable (§9), et un changement de parseur reste traçable.

begin;

-- ============================================================
-- 01. Un snapshot créé demande son parsing
-- ============================================================
-- §22.2 : l'événement part dans la même transaction que la mutation. La
-- fonction de l'étape 1 est remplacée pour enchaîner les deux étapes sans
-- qu'un appelant ait à y penser.

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
  select s.id into v_snapshot_id
  from public.source_snapshots s
  where s.source_id = p_source_id and s.content_hash = p_content_hash;

  -- §10 : un contenu identique ne crée ni snapshot ni parsing. Redemander un
  -- parsing pour un snapshot déjà connu ferait travailler le worker pour rien.
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

  update public.sources
  set current_snapshot_id = v_snapshot_id,
      status = 'ready',
      imported_at = now()
  where id = p_source_id;

  -- Étape 2 enfilée dans la même transaction que la capture.
  insert into private.outbox_events (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'source.parse',
    'source_snapshot',
    v_snapshot_id,
    jsonb_build_object(
      'sourceId', p_source_id,
      'snapshotId', v_snapshot_id,
      'storagePath', p_storage_path,
      'contentType', p_content_type,
      'idempotencyKey', 'source.parse:' || v_snapshot_id::text
    ),
    'source.parse:' || v_snapshot_id::text
  );

  return query select v_snapshot_id, true;
end;
$$;

-- ============================================================
-- 02. Ouverture d'un run de parsing
-- ============================================================

create or replace function private.start_parse_run(
  p_snapshot_id uuid,
  p_parser_version text,
  p_chunker_version text,
  p_input_hash char(64)
)
returns table (run_id uuid, already_completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  -- Un run terminé pour le même snapshot **et le même couple de versions** est
  -- rendu tel quel : re-parser un snapshot inchangé ne doit rien produire de
  -- nouveau. Changer une version ouvre au contraire un nouveau run, et les
  -- deux restent consultables côte à côte — c'est ce qui rend le changement
  -- traçable.
  select r.id into v_run_id
  from private.extraction_runs r
  where r.source_snapshot_id = p_snapshot_id
    and r.run_type = 'text_extract'
    and r.status = 'completed'
    and r.parser_version = p_parser_version
    and r.chunker_version = p_chunker_version;

  if v_run_id is not null then
    return query select v_run_id, true;
    return;
  end if;

  insert into private.extraction_runs
    (source_snapshot_id, run_type, status, parser_version, chunker_version, input_hash)
  values
    (p_snapshot_id, 'text_extract', 'running', p_parser_version, p_chunker_version, p_input_hash)
  returning id into v_run_id;

  return query select v_run_id, false;
end;
$$;

-- ============================================================
-- 03. Écriture des blocks et des chunks
-- ============================================================
-- Blocks, chunks, liens et clôture du run : quatre écritures qui n'ont de sens
-- qu'ensemble (§31). Un run marqué terminé sans ses blocks laisserait croire à
-- un document vide ; des chunks sans leurs liens perdraient la provenance que
-- §20 exige.

create or replace function private.complete_parse_run(
  p_run_id uuid,
  p_snapshot_id uuid,
  p_blocks jsonb,
  p_chunks jsonb,
  p_chunker_version text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block jsonb;
  v_chunk jsonb;
  v_block_ids uuid[] := array[]::uuid[];
  v_chunk_id uuid;
  v_block_index integer;
  v_sort integer;
  v_count integer := 0;
begin
  for v_block in select * from jsonb_array_elements(p_blocks)
  loop
    insert into private.source_blocks
      (source_snapshot_id, extraction_run_id, block_index, page_number,
       section_path, heading, block_type, content, locator, content_hash)
    values (
      p_snapshot_id,
      p_run_id,
      (v_block->>'blockIndex')::integer,
      nullif(v_block->>'pageNumber', '')::integer,
      coalesce(v_block->'sectionPath', '[]'::jsonb),
      nullif(v_block->>'heading', ''),
      v_block->>'blockType',
      v_block->>'text',
      coalesce(v_block->'locator', '{}'::jsonb),
      encode(extensions.digest(v_block->>'text', 'sha256'), 'hex')
    )
    returning id into v_chunk_id;

    -- Les identifiants sont rangés par index de block : les chunks y
    -- renvoient par position, pas par identifiant, ce qui garde la charge
    -- utile lisible.
    v_block_ids := array_append(v_block_ids, v_chunk_id);
    v_count := v_count + 1;
  end loop;

  for v_chunk in select * from jsonb_array_elements(p_chunks)
  loop
    insert into private.source_chunks
      (source_snapshot_id, parse_run_id, chunk_index, page_start, page_end,
       section_label, content, content_hash, chunker_version)
    values (
      p_snapshot_id,
      p_run_id,
      (v_chunk->>'chunkIndex')::integer,
      nullif(v_chunk->>'pageStart', '')::integer,
      nullif(v_chunk->>'pageEnd', '')::integer,
      nullif(v_chunk->>'sectionLabel', ''),
      v_chunk->>'text',
      v_chunk->>'contentHash',
      p_chunker_version
    )
    returning id into v_chunk_id;

    -- §19 : « conserver sa relation aux blocks ».
    v_sort := 0;
    for v_block_index in select value::integer from jsonb_array_elements_text(v_chunk->'blockIndexes')
    loop
      insert into private.source_chunk_blocks (source_chunk_id, source_block_id, sort_order)
      values (v_chunk_id, v_block_ids[v_block_index + 1], v_sort);
      v_sort := v_sort + 1;
    end loop;
  end loop;

  update private.extraction_runs
  set status = 'completed', completed_at = now()
  where id = p_run_id;

  return v_count;
end;
$$;

comment on function private.complete_parse_run is
  'Blocks, chunks, liens et clôture du run dans une seule transaction (§31). La provenance de §20 dépend des liens : les écrire séparément la perdrait.';

create or replace function private.fail_parse_run(p_run_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.extraction_runs
  set status = 'failed', completed_at = now(), error_message = left(p_error, 500)
  where id = p_run_id;
$$;

-- ============================================================
-- 04. Surface d'appel du worker
-- ============================================================

create or replace function public.worker_start_parse_run(
  p_snapshot_id uuid,
  p_parser_version text,
  p_chunker_version text,
  p_input_hash char(64)
)
returns table (run_id uuid, already_completed boolean)
language sql
security definer
set search_path = ''
as $$
  select * from private.start_parse_run(p_snapshot_id, p_parser_version, p_chunker_version, p_input_hash);
$$;

create or replace function public.worker_complete_parse_run(
  p_run_id uuid,
  p_snapshot_id uuid,
  p_blocks jsonb,
  p_chunks jsonb,
  p_chunker_version text
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.complete_parse_run(p_run_id, p_snapshot_id, p_blocks, p_chunks, p_chunker_version);
$$;

create or replace function public.worker_fail_parse_run(p_run_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.fail_parse_run(p_run_id, p_error);
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_start_parse_run(uuid, text, text, char)',
    'public.worker_complete_parse_run(uuid, uuid, jsonb, jsonb, text)',
    'public.worker_fail_parse_run(uuid, text)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$do$;


-- ============================================================
-- 05. Lecture du résultat de parsing
-- ============================================================
-- Le schéma privé n'est jamais exposé aux rôles client (03_PRIVACY_RLS §7).
-- Ces lectures suivent le principe de §163 — « consulter via des endpoints
-- contrôlés sans grant direct au schéma privé » — et servent le diagnostic,
-- la vérification d'intégrité et, plus tard, l'écran de validation humaine
-- de §30. Réservées à `service_role`.

create or replace function public.worker_read_runs(p_snapshot_id uuid)
returns table (
  run_id uuid,
  parser_version text,
  chunker_version text,
  status text,
  started_at timestamptz,
  completed_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select r.id, r.parser_version, r.chunker_version, r.status, r.started_at, r.completed_at
  from private.extraction_runs r
  where r.source_snapshot_id = p_snapshot_id and r.run_type = 'text_extract'
  order by r.started_at;
$$;

create or replace function public.worker_read_blocks(p_snapshot_id uuid)
returns table (
  block_index integer,
  page_number integer,
  section_path jsonb,
  heading text,
  block_type text,
  content text,
  locator jsonb,
  content_hash char(64)
)
language sql
security definer
set search_path = ''
as $$
  select b.block_index, b.page_number, b.section_path, b.heading,
         b.block_type, b.content, b.locator, b.content_hash
  from private.source_blocks b
  join private.extraction_runs r on r.id = b.extraction_run_id
  where b.source_snapshot_id = p_snapshot_id and r.status = 'completed'
  order by r.started_at desc, b.block_index;
$$;

create or replace function public.worker_read_chunk_links(p_snapshot_id uuid)
returns table (chunk_index integer, block_index integer, sort_order smallint)
language sql
security definer
set search_path = ''
as $$
  select c.chunk_index, b.block_index, l.sort_order
  from private.source_chunks c
  join private.source_chunk_blocks l on l.source_chunk_id = c.id
  join private.source_blocks b on b.id = l.source_block_id
  where c.source_snapshot_id = p_snapshot_id
  order by c.chunk_index, l.sort_order;
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_read_runs(uuid)',
    'public.worker_read_blocks(uuid)',
    'public.worker_read_chunk_links(uuid)'
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
