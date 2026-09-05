-- PLUKA V1 — Provenance complète dans l'écran de revue
-- File target: supabase/migrations/0013_fact_review_provenance.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §20, §30, §86 de
--             docs/06_DESIGN_SYSTEM.md
--
-- POURQUOI
--
-- 0012 rend à l'écran de revue les huit éléments que §30 énumère. Il en
-- manque un pour que le réviseur puisse *vérifier* plutôt que croire :
-- l'identité de la preuve elle-même.
--
-- §20 définit la preuve minimale comme « snapshot_id, block_id ou chunk_id,
-- page_number, section_path, quote ». L'écran affichait la citation sans dire
-- de quel snapshot ni de quel block elle sortait : un extrait sans adresse ne
-- se remonte pas jusqu'au document.
--
-- §86 du Design System demande en plus le type de source et l'organisme.
--
-- Aucune règle d'accès ne change : la fonction garde la condition de 0012.

begin;

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
  extracted_at timestamptz
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
    r.provider, r.model, r.started_at
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
  'Les huit colonnes que §30 impose à l''écran de revue, plus l''adresse de la preuve de §20. Contourne la RLS, donc pose elle-même sa condition d''accès (03_PRIVACY_RLS §8).';

revoke all on function public.list_fact_candidates_for_review(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_fact_candidates_for_review(uuid, integer) to authenticated;

commit;
