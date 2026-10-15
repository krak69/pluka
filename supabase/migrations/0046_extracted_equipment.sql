-- PLUKA V1 — Matériel extrait d'un document ou d'une page
-- File target: supabase/migrations/0046_extracted_equipment.sql
-- Référence : SOURCES_EXTRACTION §20, §31, §38, §82, S14 · 02_DATA_MODEL §8.3, §8.4 ·
--             AGENTS §13, §14 · migrations 0012, 0045
--
-- DÉCISION PRODUIT DU 2026-10-15
--
-- Le matériel se renseigne de deux façons, sans catalogue : à la main
-- depuis la fiche épreuve (0045), ou depuis les documents et pages web de
-- l'événement — l'extraction propose, un humain relit et publie. Les deux
-- chemins produisent la même information : un `race_fact` de catégorie
-- `equipment`, nom en `value_text`, et en `value_json`
-- { requirement, condition, detail }.
--
-- Ce qui change en base :
--
--   01. toute version d'un matériel qui porte une structure la porte bien
--       formée — quel que soit le chemin (saisie, publication d'un candidat,
--       correction). Une version sans structure reste possible : c'est un
--       matériel dont la source ne dit pas l'exigence, affiché « À préciser » ;
--   02. un candidat matériel dont l'exigence diffère de la version publiée
--       est une contradiction (§38), et non une simple confirmation ;
--   03. la lecture de revue rend la structure publiée, pour que cette
--       contradiction se lise.
--
-- La clé est la même des deux côtés (`equipment.<slug>`, `@pluka/contracts`) :
-- un matériel extrait se rapproche de celui saisi à la main.

begin;

-- ============================================================
-- 01. Structure d'une version de matériel
-- ============================================================

create or replace function private.check_equipment_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category public.fact_category;
begin
  if new.value_json is null then
    return new;
  end if;

  select f.category into v_category from public.race_facts f where f.id = new.fact_id;

  if v_category is distinct from 'equipment' then
    return new;
  end if;

  if jsonb_typeof(new.value_json) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(new.value_json) k
       where k not in ('requirement', 'condition', 'detail')
     ) then
    raise exception 'structure de matériel inconnue' using errcode = '22023';
  end if;

  -- Même règle que la saisie (0045) : exigence connue, condition d'un conditionnel.
  -- `equipment_value` lève l'erreur ; on garde la valeur telle qu'écrite.
  perform private.equipment_value(
    new.value_json->>'requirement',
    new.value_json->>'condition',
    new.value_json->>'detail'
  );

  return new;
end;
$$;

comment on function private.check_equipment_version is
  'Une version de matériel qui porte une structure la porte bien formée : exigence parmi mandatory, conditional, recommended, condition pour un conditionnel (§82, 0045, 0046).';

drop trigger if exists trg_race_fact_versions_equipment_shape on public.race_fact_versions;

create trigger trg_race_fact_versions_equipment_shape
before insert on public.race_fact_versions
for each row execute function private.check_equipment_version();

-- ============================================================
-- 02. Une exigence différente est une contradiction
-- ============================================================

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
  v_current_value text;
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
              and v.value_number is not distinct from (nullif(v_candidate->>'valueNumber', ''))::numeric
              -- 0046 : pour un matériel, l'exigence fait partie de la valeur.
              -- Un règlement qui passe la veste de « recommandée » à
              -- « obligatoire » contredit la version publiée (§82, S14) ; une
              -- exigence que le document ne dit pas ne contredit rien.
              and (f.category <> 'equipment'
                   or nullif(v_candidate->'valueJson'->>'requirement', '') is null
                   or v.value_json->>'requirement' is not distinct from
                      v_candidate->'valueJson'->>'requirement')),
             v.value_text
      into v_fact_id, v_same, v_current_value
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

      -- §38 : le conflit est matérialisé, pas seulement signalé sur le
      -- candidat. C'est lui que la revue de §40 ouvrira.
      if v_status = 'conflict' then
        insert into private.conflict_reports
          (race_id, fact_key, existing_fact_id, candidate_id, conflict_type, details)
        values (
          v_race_id,
          v_candidate->>'factKey',
          v_fact_id,
          v_candidate_id,
          'published_fact_conflict',
          jsonb_build_object(
            'publishedValue', v_current_value,
            'candidateValue', v_candidate->>'valueText',
            'origin', v_candidate->>'origin'
          )
        );
      end if;

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
  'Candidats, preuves et conflits d''une extraction (§20, §21, §38). Pour un matériel, une exigence différente de la version publiée est un conflit (0046). Ne touche jamais à public.race_facts : un candidat est une proposition, la publication est un workflow humain (§25, §30).';

-- ============================================================
-- 03. La revue lit la structure publiée
-- ============================================================

drop function if exists public.list_fact_candidates_for_review(uuid, integer);

create function public.list_fact_candidates_for_review(
  p_race_id uuid,
  p_limit integer default 100
)
returns table (
  candidate_id uuid,
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
  published_value_text text,
  published_version_id uuid,
  published_trust_level public.trust_level,
  conflict_type text,
  conflict_status text,
  excerpt text,
  page_number integer,
  section_path jsonb,
  locator jsonb,
  -- §20 : l'adresse de la preuve, sans laquelle la citation ne se vérifie pas.
  snapshot_id uuid,
  snapshot_content_hash char(64),
  block_index integer,
  chunk_index integer,
  block_content text,
  -- §86 du Design System : type et organisme de la source.
  source_title text,
  source_url text,
  source_type public.source_type,
  organization_name text,
  snapshot_retrieved_at timestamptz,
  provider text,
  model text,
  extracted_at timestamptz,
  -- 0046 : l'exigence d'un matériel publié, pour lire une contradiction
  -- d'exigence (« Gants » recommandés contre « Gants » obligatoires).
  published_value_json jsonb
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id, c.race_id, c.category, c.fact_key,
    c.value_text, c.value_number, c.unit, c.value_json,
    c.confidence_label, c.status, c.origin, c.notes, c.matched_fact_id,
    pv.value_text, pv.id, pv.trust_level,
    cr.conflict_type, cr.status,
    e.excerpt, e.page_number, e.section_path, e.locator,
    snap.id, snap.content_hash, e.block_index, e.chunk_index, e.block_content,
    src.title, src.url, src.source_type, org.name, snap.retrieved_at,
    r.provider, r.model, r.started_at,
    pv.value_json
  from private.fact_candidates c
  join private.extraction_runs r on r.id = c.extraction_run_id
  left join public.race_facts f on f.id = c.matched_fact_id
  left join public.race_fact_versions pv on pv.id = f.current_version_id
  left join private.conflict_reports cr
    on cr.candidate_id = c.id and cr.status = 'open'
  left join lateral (
    -- La preuve principale : celle que §20 appelle la citation précise. Les
    -- autres restent en base, l'écran n'en montre qu'une par candidat.
    select e2.excerpt, e2.page_number, e2.section_path, e2.locator,
           b.block_index, ch.chunk_index, b.content as block_content
    from private.fact_candidate_evidence e2
    left join private.source_blocks b on b.id = e2.source_block_id
    left join private.source_chunks ch on ch.id = e2.source_chunk_id
    where e2.candidate_id = c.id
    order by e2.is_primary desc, e2.id
    limit 1
  ) e on true
  left join public.source_snapshots snap on snap.id = r.source_snapshot_id
  left join public.sources src on src.id = snap.source_id
  left join public.organizations org on org.id = src.organization_id
  where c.race_id = p_race_id
    -- Deny by default : la fonction contourne la RLS, elle doit donc porter
    -- elle-même la question « qui a le droit de voir cette revue ».
    and (
      private.user_can_manage_race(p_race_id, 'viewer')
      or private.is_pluka_admin()
    )
    and c.status in ('detected', 'needs_review', 'conflict')
  order by
    case c.status when 'conflict' then 0 when 'needs_review' then 1 else 2 end,
    c.fact_key
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

comment on function public.list_fact_candidates_for_review is
  'Les huit colonnes que §30 impose à l''écran de revue, plus l''adresse de la preuve de §20 et la structure publiée (0046). Contourne la RLS, donc pose elle-même sa condition d''accès (03_PRIVACY_RLS §8).';

revoke all on function public.list_fact_candidates_for_review(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_fact_candidates_for_review(uuid, integer) to authenticated;

revoke all on function private.check_equipment_version() from public, anon, authenticated;

commit;
