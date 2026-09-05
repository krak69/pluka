-- PLUKA V1 — Ingestion de sources, étape 3 : extraction de candidats
-- File target: supabase/migrations/0011_source_extraction.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §20, §21, §24, §25, §26,
--             §29, §30, §35, §61, §76, §77 · docs/01_ARCHITECTURE.md §22.2, §31
--
-- PÉRIMÈTRE
--
-- Les blocks et chunks de l'étape 2 deviennent des `fact_candidates` portant
-- leur provenance jusqu'à leur position dans le document d'origine. Rien n'est
-- publié : §25 — « le système ne doit jamais afficher directement un candidat
-- comme fact publié ». Aucune fonction de ce fichier n'écrit dans
-- `public.race_facts` ni dans `public.race_fact_versions`.
--
-- CE QUI EXISTAIT DÉJÀ
--
-- 0001 et 0003 portaient l'essentiel : `private.fact_candidates` avec sa clé
-- logique, son lien au chunk et son statut de revue ; `fact_candidate_evidence`
-- avec page, section, locator et extrait — la « preuve minimale » de §20 ;
-- `extraction_runs` avec provider, model, schema_version, prompt_version,
-- engine_version et la consommation de jetons.
--
-- CE QUE CE FICHIER AJOUTE
--
-- Quatre colonnes, et rien de plus : le run de parsing dont une extraction
-- descend (§26 : « sur quel run de parsing »), l'origine déterministe ou IA
-- d'un candidat (§29, sans quoi l'ordre ne serait pas auditable), et la
-- fenêtre de validité de §21.

begin;

-- ============================================================
-- 01. De quoi une extraction descend, et d'où vient un candidat
-- ============================================================

alter table private.extraction_runs
  add column parent_run_id uuid references private.extraction_runs(id) on delete cascade;

comment on column private.extraction_runs.parent_run_id is
  'Run de parsing dont cette extraction descend (§26). Un changement de parseur produit un autre parent, donc une autre extraction : la filiation reste lisible.';

alter table private.fact_candidates
  add column origin text check (origin is null or origin in ('deterministic', 'ai')),
  add column valid_from date,
  add column valid_to date;

comment on column private.fact_candidates.origin is
  'Lecture par une règle déterministe ou interprétation par un modèle (§29). Sans cette colonne, « déterministe avant IA » ne serait vérifiable qu''en mémoire.';

create index ix_private_extraction_runs_parent
  on private.extraction_runs(parent_run_id, started_at desc);

-- ============================================================
-- 02. Le niveau de confiance rejoint la charge immuable
-- ============================================================
-- 0001 protégeait déjà la valeur d'une version publiée : `value_text`,
-- `value_number`, `value_json`, `unit`, l'identité et l'horodatage de
-- création. §23 et §35 sont donc tenus sur la valeur, y compris face au
-- `service_role` — seul rôle capable de contourner la RLS, et justement celui
-- qu'emprunte le worker d'extraction.
--
-- Un champ manquait : `trust_level`. §32 est catégorique — « seule une
-- organisation autorisée peut conférer le niveau Officielle à une information
-- de sa course ». Requalifier une version existante contournerait ce workflow
-- sans laisser la moindre trace, alors qu'une nouvelle version l'enregistre.
--
-- Le cycle de vie reste ouvert : passer une version en `superseded` ou
-- l'horodater fait partie de la publication de §33. Ce qui est fermé est la
-- valeur, pas l'état. Rien sur DELETE non plus : les suppressions en cascade
-- d'une course en dépendent, et §37 protège le retrait d'une information par
-- le workflow, pas par un trigger.

create or replace function private.protect_fact_version_payload()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.fact_id is distinct from old.fact_id
     or new.version_number is distinct from old.version_number
     or new.value_text is distinct from old.value_text
     or new.value_number is distinct from old.value_number
     or new.unit is distinct from old.unit
     or new.value_json is distinct from old.value_json
     or new.trust_level is distinct from old.trust_level
     or new.supersedes_version_id is distinct from old.supersedes_version_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'race_fact_versions payload is immutable; create a new version instead';
  end if;

  return new;
end;
$$;

comment on function private.protect_fact_version_payload is
  'Une version de fact est immuable : la valeur ET son niveau de confiance (§23, §35, §32). Requalifier en place contournerait l''autorisation de §32 sans laisser de trace.';

-- ============================================================
-- 03. Un parsing terminé demande son extraction
-- ============================================================
-- §22.2 : l'événement part dans la transaction qui l'a rendu vrai. La fonction
-- de l'étape 2 est remplacée pour enchaîner, exactement comme la capture
-- enchaînait sur le parsing.

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
  v_source_id uuid;
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

  select s.source_id into v_source_id
  from public.source_snapshots s
  where s.id = p_snapshot_id;

  -- Étape 3 enfilée dans la même transaction que le parsing. Un run sans chunk
  -- n'a rien à extraire : ne pas l'enfiler évite un job qui échouerait sur
  -- `EXTRACTION_EMPTY` à chaque tour.
  if jsonb_array_length(coalesce(p_chunks, '[]'::jsonb)) > 0 then
    insert into private.outbox_events
      (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
    values (
      'source.extract',
      'source_snapshot',
      p_snapshot_id,
      jsonb_build_object(
        'sourceId', v_source_id,
        'snapshotId', p_snapshot_id,
        'parseRunId', p_run_id,
        'idempotencyKey', 'source.extract:' || p_run_id::text
      ),
      'source.extract:' || p_run_id::text
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return v_count;
end;
$$;

comment on function private.complete_parse_run is
  'Blocks, chunks, liens, clôture du run et demande d''extraction dans une seule transaction (§31, §22.2). La provenance de §20 dépend des liens : les écrire séparément la perdrait.';

-- ============================================================
-- 04. Ouverture d'un run d'extraction
-- ============================================================

create or replace function private.start_extraction_run(
  p_parse_run_id uuid,
  p_snapshot_id uuid,
  p_engine_version text,
  p_schema_version text,
  p_prompt_version text,
  p_provider text,
  p_model text,
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
  -- L'identité d'un run est le quintuplet que §26 demande de tracer : le run
  -- de parsing dont il descend, le moteur, le schéma, le prompt, et le couple
  -- fournisseur / modèle. Rejouer à l'identique rend le run existant ; changer
  -- l'un de ces cinq éléments en ouvre un nouveau, et §77 veut précisément que
  -- cette ré-extraction soit possible sans toucher aux facts publiés.
  select r.id into v_run_id
  from private.extraction_runs r
  where r.parent_run_id = p_parse_run_id
    and r.run_type = 'fact_extract'
    and r.status = 'completed'
    and r.engine_version is not distinct from p_engine_version
    and r.schema_version is not distinct from p_schema_version
    and r.prompt_version is not distinct from p_prompt_version
    and r.provider is not distinct from p_provider
    and r.model is not distinct from p_model
  order by r.started_at
  limit 1;

  if v_run_id is not null then
    return query select v_run_id, true;
    return;
  end if;

  insert into private.extraction_runs
    (source_snapshot_id, parent_run_id, run_type, status,
     engine_version, schema_version, prompt_version, provider, model, input_hash)
  values
    (p_snapshot_id, p_parse_run_id, 'fact_extract', 'running',
     p_engine_version, p_schema_version, p_prompt_version, p_provider, p_model, p_input_hash)
  returning id into v_run_id;

  return query select v_run_id, false;
end;
$$;

-- ============================================================
-- 05. Écriture des candidats et de leurs preuves
-- ============================================================
-- Candidats, preuves et clôture du run : trois écritures qui n'ont de sens
-- qu'ensemble (§31). Un candidat sans preuve ne satisferait pas §20 et ne
-- pourrait pas être relu par un humain ; un run terminé sans candidat
-- laisserait croire à un document sans information.
--
-- Une source couvre les courses auxquelles elle est rattachée. Un règlement
-- qui s'applique à trois épreuves produit donc le candidat pour chacune : un
-- fact est per-course (`race_facts.race_id`), et il n'existe pas en V1 de
-- rapprochement entre le nom d'une épreuve dans un document et une Race.

create or replace function private.record_fact_candidates(
  p_run_id uuid,
  p_parse_run_id uuid,
  p_snapshot_id uuid,
  p_candidates jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_edition_id uuid;
  v_race_ids uuid[];
  v_race_id uuid;
  v_candidate jsonb;
  v_evidence jsonb;
  v_candidate_id uuid;
  v_chunk_id uuid;
  v_block_id uuid;
  v_fact_id uuid;
  v_same boolean;
  v_status text;
  v_count integer := 0;
begin
  select s.source_id, src.edition_id
  into v_source_id, v_edition_id
  from public.source_snapshots s
  join public.sources src on src.id = s.source_id
  where s.id = p_snapshot_id;

  if v_source_id is null then
    raise exception 'snapshot % inconnu', p_snapshot_id using errcode = 'no_data_found';
  end if;

  select array_agg(scope.race_id)
  into v_race_ids
  from public.source_race_scopes scope
  where scope.source_id = v_source_id;

  -- Sans portée explicite, la source vaut pour les courses de son édition.
  -- Le rattachement reste large et visible plutôt que muet : un candidat
  -- rattaché à trop de courses se rejette en revue, un candidat perdu ne se
  -- retrouve pas.
  if v_race_ids is null then
    select array_agg(r.id) into v_race_ids
    from public.races r
    where r.edition_id = v_edition_id;
  end if;

  if v_race_ids is null then
    return 0;
  end if;

  for v_candidate in select * from jsonb_array_elements(p_candidates)
  loop
    -- Le chunk de la preuve principale situe le candidat dans le découpage.
    select c.id into v_chunk_id
    from private.source_chunks c
    where c.parse_run_id = p_parse_run_id
      and c.chunk_index = (
        select (e->>'chunkIndex')::integer
        from jsonb_array_elements(v_candidate->'evidence') e
        where coalesce((e->>'isPrimary')::boolean, false)
        limit 1
      );

    foreach v_race_id in array v_race_ids
    loop
      -- §36 : « comparer les candidats aux facts courants ». La comparaison est
      -- une LECTURE. Rien n'est écrit dans `race_facts`, et le fait existant
      -- reste exactement ce qu'il était.
      select f.id,
             (v.value_text is not distinct from nullif(v_candidate->>'valueText', '')
              and v.value_number is not distinct from (nullif(v_candidate->>'valueNumber', ''))::numeric)
      into v_fact_id, v_same
      from public.race_facts f
      left join public.race_fact_versions v on v.id = f.current_version_id
      where f.race_id = v_race_id
        and f.fact_key = v_candidate->>'factKey';

      -- Un candidat qui contredit une valeur publiée n'écrase rien : il est
      -- signalé comme tel et attend un humain (§30, §38).
      v_status := case
        when v_fact_id is not null and coalesce(v_same, false) = false then 'conflict'
        when v_candidate->>'reviewState' = 'needs_review' then 'needs_review'
        else 'detected'
      end;

      insert into private.fact_candidates
        (extraction_run_id, race_id, source_chunk_id, category, fact_key,
         value_text, value_number, unit, value_json,
         confidence, confidence_label, status, matched_fact_id, notes, origin,
         valid_from, valid_to)
      values (
        p_run_id,
        v_race_id,
        v_chunk_id,
        (v_candidate->>'factType')::public.fact_category,
        v_candidate->>'factKey',
        nullif(v_candidate->>'valueText', ''),
        (nullif(v_candidate->>'valueNumber', ''))::numeric,
        nullif(v_candidate->>'unit', ''),
        case when v_candidate->'valueJson' = 'null'::jsonb then null else v_candidate->'valueJson' end,
        -- §28 : la confiance est « seulement un signal de tri », pas une
        -- probabilité. La colonne numérique reste vide, l'étiquette suffit.
        null,
        v_candidate->>'confidence',
        v_status,
        v_fact_id,
        nullif(v_candidate->>'notes', ''),
        v_candidate->>'origin',
        (nullif(v_candidate->>'validFrom', ''))::date,
        (nullif(v_candidate->>'validTo', ''))::date
      )
      returning id into v_candidate_id;

      for v_evidence in select * from jsonb_array_elements(v_candidate->'evidence')
      loop
        -- §20 : la preuve descend au block, donc à une page, une section et un
        -- locator dans le document d'origine.
        select b.id into v_block_id
        from private.source_blocks b
        where b.extraction_run_id = p_parse_run_id
          and b.block_index = (v_evidence->>'blockIndex')::integer;

        select c.id into v_chunk_id
        from private.source_chunks c
        where c.parse_run_id = p_parse_run_id
          and c.chunk_index = (nullif(v_evidence->>'chunkIndex', ''))::integer;

        if v_block_id is null and v_chunk_id is null then
          continue;
        end if;

        insert into private.fact_candidate_evidence
          (candidate_id, source_chunk_id, source_block_id, page_number,
           section_path, locator, excerpt, is_primary)
        values (
          v_candidate_id,
          v_chunk_id,
          v_block_id,
          nullif(v_evidence->>'pageNumber', '')::integer,
          coalesce(v_evidence->'sectionPath', '[]'::jsonb),
          coalesce(v_evidence->'locator', '{}'::jsonb),
          nullif(v_evidence->>'excerpt', ''),
          coalesce((v_evidence->>'isPrimary')::boolean, false)
        );
      end loop;

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

comment on function private.record_fact_candidates is
  'Candidats et preuves d''une extraction (§20, §21). Ne touche jamais à public.race_facts : un candidat est une proposition, la publication est un workflow humain (§25, §30).';

create or replace function private.complete_extraction_run(
  p_run_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer,
  p_output_json jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.extraction_runs
  set status = 'completed',
      completed_at = now(),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      latency_ms = p_latency_ms,
      output_json = p_output_json
  where id = p_run_id;
$$;

create or replace function private.fail_extraction_run(
  p_run_id uuid,
  p_error_code text,
  p_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  -- §61 : « un échec extraction ne doit jamais invalider un RaceFact déjà
  -- publié. » Un run en échec ne touche donc que lui-même.
  update private.extraction_runs
  set status = 'failed',
      completed_at = now(),
      error_code = left(p_error_code, 60),
      error_message = left(p_error, 500)
  where id = p_run_id;
$$;

-- ============================================================
-- 06. Surface d'appel du worker
-- ============================================================

create or replace function public.worker_start_extraction_run(
  p_parse_run_id uuid,
  p_snapshot_id uuid,
  p_engine_version text,
  p_schema_version text,
  p_prompt_version text,
  p_provider text,
  p_model text,
  p_input_hash char(64)
)
returns table (run_id uuid, already_completed boolean)
language sql
security definer
set search_path = ''
as $$
  select * from private.start_extraction_run(
    p_parse_run_id, p_snapshot_id, p_engine_version, p_schema_version,
    p_prompt_version, p_provider, p_model, p_input_hash);
$$;

create or replace function public.worker_record_fact_candidates(
  p_run_id uuid,
  p_parse_run_id uuid,
  p_snapshot_id uuid,
  p_candidates jsonb
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.record_fact_candidates(p_run_id, p_parse_run_id, p_snapshot_id, p_candidates);
$$;

create or replace function public.worker_complete_extraction_run(
  p_run_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer,
  p_output_json jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.complete_extraction_run(
    p_run_id, p_input_tokens, p_output_tokens, p_latency_ms, p_output_json);
$$;

create or replace function public.worker_fail_extraction_run(
  p_run_id uuid,
  p_error_code text,
  p_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.fail_extraction_run(p_run_id, p_error_code, p_error);
$$;

-- ============================================================
-- 07. Lecture des candidats
-- ============================================================
-- Le schéma privé n'est jamais exposé aux rôles client (03_PRIVACY_RLS §7).
-- Ces lectures suivent §163 — « consulter via des endpoints contrôlés sans
-- grant direct au schéma privé » — et serviront l'écran de validation humaine
-- de §30, qui doit afficher « valeur proposée ; type ; source ; extrait ;
-- page / section ; anciennes valeurs ; contradictions ». Réservées à
-- `service_role`.

-- Sortie d'un run de parsing, dans la forme que le moteur d'extraction attend.
--
-- L'extraction travaille sur ce qui a été *persisté*, pas sur un re-parsing en
-- mémoire. Les deux devraient coïncider — le parseur est déterministe — mais
-- faire confiance à cette coïncidence rendrait la provenance invérifiable : un
-- candidat citerait un block que la base ne contient pas.

create or replace function public.worker_read_parse_output(p_parse_run_id uuid)
returns table (blocks jsonb, chunks jsonb)
language sql
security definer
set search_path = ''
as $$
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'blockIndex', b.block_index,
          'pageNumber', b.page_number,
          'sectionPath', b.section_path,
          'heading', b.heading,
          'blockType', b.block_type,
          'text', b.content,
          'locator', b.locator
        ) order by b.block_index)
      from private.source_blocks b
      where b.extraction_run_id = p_parse_run_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'chunkIndex', c.chunk_index,
          'text', c.content,
          'contentHash', c.content_hash,
          'pageStart', c.page_start,
          'pageEnd', c.page_end,
          'sectionLabel', c.section_label,
          'blockIndexes', coalesce((
            select jsonb_agg(b.block_index order by l.sort_order)
            from private.source_chunk_blocks l
            join private.source_blocks b on b.id = l.source_block_id
            where l.source_chunk_id = c.id
          ), '[]'::jsonb)
        ) order by c.chunk_index)
      from private.source_chunks c
      where c.parse_run_id = p_parse_run_id
    ), '[]'::jsonb);
$$;

create or replace function public.worker_read_candidates(p_snapshot_id uuid)
returns table (
  candidate_id uuid,
  run_id uuid,
  race_id uuid,
  category public.fact_category,
  fact_key text,
  value_text text,
  value_number numeric,
  unit text,
  value_json jsonb,
  confidence_label text,
  status text,
  origin text,
  notes text,
  matched_fact_id uuid,
  provider text,
  model text,
  prompt_version text,
  engine_version text,
  parse_run_id uuid
)
language sql
security definer
set search_path = ''
as $$
  select c.id, r.id, c.race_id, c.category, c.fact_key,
         c.value_text, c.value_number, c.unit, c.value_json,
         c.confidence_label, c.status, c.origin, c.notes, c.matched_fact_id,
         r.provider, r.model, r.prompt_version, r.engine_version, r.parent_run_id
  from private.fact_candidates c
  join private.extraction_runs r on r.id = c.extraction_run_id
  where r.source_snapshot_id = p_snapshot_id
  order by r.started_at, c.fact_key, c.race_id;
$$;

create or replace function public.worker_read_candidate_evidence(p_candidate_id uuid)
returns table (
  block_index integer,
  chunk_index integer,
  page_number integer,
  section_path jsonb,
  locator jsonb,
  excerpt text,
  is_primary boolean,
  block_content text
)
language sql
security definer
set search_path = ''
as $$
  select b.block_index, c.chunk_index, e.page_number, e.section_path,
         e.locator, e.excerpt, e.is_primary, b.content
  from private.fact_candidate_evidence e
  left join private.source_blocks b on b.id = e.source_block_id
  left join private.source_chunks c on c.id = e.source_chunk_id
  where e.candidate_id = p_candidate_id
  order by e.is_primary desc, b.block_index;
$$;

create or replace function public.worker_read_extraction_runs(p_snapshot_id uuid)
returns table (
  run_id uuid,
  parent_run_id uuid,
  status text,
  engine_version text,
  schema_version text,
  prompt_version text,
  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select r.id, r.parent_run_id, r.status, r.engine_version, r.schema_version,
         r.prompt_version, r.provider, r.model, r.input_tokens, r.output_tokens,
         r.error_code, r.started_at, r.completed_at
  from private.extraction_runs r
  where r.source_snapshot_id = p_snapshot_id and r.run_type = 'fact_extract'
  order by r.started_at;
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.worker_start_extraction_run(uuid, uuid, text, text, text, text, text, char)',
    'public.worker_record_fact_candidates(uuid, uuid, uuid, jsonb)',
    'public.worker_complete_extraction_run(uuid, integer, integer, integer, jsonb)',
    'public.worker_fail_extraction_run(uuid, text, text)',
    'public.worker_read_parse_output(uuid)',
    'public.worker_read_candidates(uuid)',
    'public.worker_read_candidate_evidence(uuid)',
    'public.worker_read_extraction_runs(uuid)'
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
