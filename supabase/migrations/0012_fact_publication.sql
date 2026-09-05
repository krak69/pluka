-- PLUKA V1 — Ingestion de sources, étape 4 : publication des facts
-- File target: supabase/migrations/0012_fact_publication.sql
-- Référence : docs/engines/SOURCES_EXTRACTION.md §4, §23, §24, §25, §30, §31,
--             §32, §33, §34, §35, §37, §38, §40, §43, §44, §62 ·
--             docs/03_PRIVACY_RLS.md §8, §22, §24 · docs/01_ARCHITECTURE.md §22.2, §31
--
-- PÉRIMÈTRE
--
-- Un candidat `detected` / `needs_review` devient une `RaceFactVersion`
-- publiée. §33 énumère ce que « publier » veut dire, et les huit étapes se
-- font dans une seule transaction : résoudre le fact logique, créer une
-- version immuable, rattacher les FactSources, enregistrer l'auteur et le
-- niveau de confiance, déplacer `current_version_id`, produire un événement
-- métier, signaler l'impact downstream.
--
-- LA RÈGLE QUI GOUVERNE TOUT LE FICHIER
--
-- « Aucun chemin d'écriture ne doit permettre de publier sans acte humain
-- autorisé et journalisé. »
--
-- Elle n'est pas tenue par la seule fonction de publication : une fonction se
-- contourne, et le `service_role` du worker ignore la RLS. Elle est tenue par
-- la table elle-même, en trois couches qu'aucun rôle ne franchit :
--
--   1. une CONTRAINTE : une version `published` sans `published_by_user_id`
--      est refusée. Une publication anonyme est structurellement impossible ;
--   2. un TRIGGER : cet utilisateur doit avoir l'autorité voulue, relue en
--      base. Il s'applique au `service_role` comme aux autres, parce qu'un
--      trigger n'est pas une policy ;
--   3. un JOURNAL : `private.fact_publication_acts` enregistre chaque décision
--      de §31 — publier, éditer et publier, rejeter, marquer doublon, renvoyer
--      en revue — avec son auteur, son autorité et sa note.
--
-- L'IA n'a aucun chemin vers ces écritures : elle produit des candidats (0011)
-- et rien d'autre. Le worker non plus — il n'a pas de session, et la première
-- couche le refuse.

begin;

-- ============================================================
-- 01. Autorité relue en base, pour un utilisateur nommé
-- ============================================================
-- Les helpers de 0005 raisonnent sur `auth.uid()` : ils répondent « l'appelant
-- courant a-t-il ce droit ». Un trigger a besoin de l'autre question :
-- « l'utilisateur *inscrit dans la ligne* a-t-il ce droit », parce que c'est
-- lui que la version désigne comme auteur.
--
-- 03_PRIVACY_RLS §178 vaut ici comme ailleurs : le rôle est lu en base, jamais
-- reçu de l'appelant.

create or replace function private.user_id_is_pluka_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user_id and u.platform_role = 'pluka_admin'
  );
$$;

create or replace function private.user_id_has_org_role(
  p_user_id uuid,
  p_organization_id uuid,
  p_min_role public.organization_member_role
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
      and private.org_role_rank(om.role) >= private.org_role_rank(p_min_role)
  );
$$;

create or replace function private.organization_of_fact(p_fact_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select private.organization_of_race(f.race_id)
  from public.race_facts f
  where f.id = p_fact_id;
$$;

comment on function private.user_id_has_org_role(uuid, uuid, public.organization_member_role) is
  'Autorité d''un utilisateur nommé, pour les triggers qui jugent l''auteur d''une ligne plutôt que l''appelant (§30, §32).';

-- ============================================================
-- 02. Une version publiée nomme toujours un humain autorisé
-- ============================================================

alter table public.race_fact_versions
  add column published_by_user_id uuid references public.users(id) on delete restrict;

comment on column public.race_fact_versions.published_by_user_id is
  'Auteur humain de la publication (§30, §33 étape 4). La contrainte ci-dessous rend une publication anonyme impossible, y compris pour le service_role.';

-- Couche 1 : déclarative, donc infranchissable. Une version publiée sans
-- auteur n'existe pas.
alter table public.race_fact_versions
  add constraint race_fact_versions_published_needs_author
    check (workflow_status <> 'published' or published_by_user_id is not null);

-- L'auteur rejoint la charge immuable : réattribuer une publication après coup
-- reviendrait à falsifier le journal.
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
     or new.published_by_user_id is distinct from old.published_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'race_fact_versions payload is immutable; create a new version instead';
  end if;

  return new;
end;
$$;

comment on function private.protect_fact_version_payload is
  'Une version de fact est immuable : la valeur, son niveau de confiance et son auteur (§23, §35, §32). Requalifier ou réattribuer en place contournerait §32 sans laisser de trace.';

-- Couche 2 : l'autorité de cet auteur, relue en base au moment de l'écriture.
create or replace function private.enforce_fact_publication_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  -- Un brouillon n'engage rien : seule la publication est gardée.
  if new.workflow_status <> 'published' then
    return new;
  end if;

  -- L'absence totale d'auteur est l'affaire de la contrainte. Un trigger
  -- BEFORE s'exécutant avant elle, lui laisser la parole garde les deux
  -- couches distinctes et lisibles : « il faut un auteur » d'un côté, « cet
  -- auteur a-t-il autorité » de l'autre.
  if new.published_by_user_id is null then
    return new;
  end if;

  v_organization_id := private.organization_of_fact(new.fact_id);

  -- §30 : la validation humaine est le fait d'un admin PLUKA ou d'un rôle
  -- d'organisation. `editor` est le minimum d'écriture, aligné sur 0005.
  if not (
    private.user_id_is_pluka_admin(new.published_by_user_id)
    or private.user_id_has_org_role(new.published_by_user_id, v_organization_id, 'editor')
  ) then
    raise exception 'publication refusée : cet utilisateur n''a pas autorité sur cette course (§30)'
      using errcode = 'insufficient_privilege';
  end if;

  -- §32 : « seule une organisation autorisée peut conférer le niveau
  -- Officielle à une information de sa course ». Un admin PLUKA membre de
  -- l'organisation le peut donc ; un admin PLUKA qui ne l'est pas, non — et
  -- c'est exactement ce que §32 refuse : « se substituer silencieusement à
  -- l'organisateur ».
  if new.trust_level = 'official' then
    if v_organization_id is null
       or new.validated_by_organization_id is distinct from v_organization_id
       or not private.user_id_has_org_role(new.published_by_user_id, v_organization_id, 'editor')
    then
      raise exception 'niveau « officielle » réservé à l''organisation gestionnaire de la course (§32)'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- §4.2 : « Validée PLUKA » est une qualification de PLUKA. Une organisation
  -- qualifie ses informations d'officielles, elle ne se décerne pas un label
  -- de vérification par un tiers.
  if new.trust_level = 'pluka_validated'
     and not private.user_id_is_pluka_admin(new.published_by_user_id) then
    raise exception 'niveau « validée PLUKA » réservé à un administrateur PLUKA (§4.2)'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_race_fact_versions_publication_authority on public.race_fact_versions;

create trigger trg_race_fact_versions_publication_authority
before insert or update on public.race_fact_versions
for each row
execute function private.enforce_fact_publication_authority();

comment on function private.enforce_fact_publication_authority is
  'Autorité de publication vérifiée dans la table, pas dans une policy : un trigger s''applique aussi au service_role, seul rôle capable de contourner la RLS (03_PRIVACY_RLS §8).';

-- ============================================================
-- 03. Journal des décisions de revue
-- ============================================================
-- §31 énumère les actions ; §30 impose que la revue soit humaine ; §31 ajoute
-- qu'« une modification manuelle avant publication doit être auditée ».
--
-- Le journal enregistre les cinq actions, publication comprise, et pas
-- seulement celles qui écrivent un fact : savoir qu'un candidat a été rejeté,
-- par qui et pourquoi, vaut autant que savoir qu'il a été publié.

create table private.fact_publication_acts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references private.fact_candidates(id) on delete set null,
  race_id uuid not null references public.races(id) on delete cascade,
  fact_id uuid references public.race_facts(id) on delete set null,
  fact_version_id uuid references public.race_fact_versions(id) on delete set null,
  action text not null check (
    action in ('publish', 'edit_and_publish', 'reject', 'mark_duplicate', 'needs_review')
  ),
  -- Aucun acte anonyme : la colonne est `not null`, et c'est le point.
  actor_user_id uuid not null references public.users(id) on delete restrict,
  authority text not null check (authority in ('platform_admin', 'organization_member')),
  actor_role public.organization_member_role,
  trust_level public.trust_level,
  /** Valeur d'origine du candidat quand l'humain l'a corrigée — §31. */
  original_value jsonb,
  published_value jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index ix_private_publication_acts_race on private.fact_publication_acts(race_id, created_at desc);
create index ix_private_publication_acts_candidate on private.fact_publication_acts(candidate_id);

revoke all on private.fact_publication_acts from public, anon, authenticated;

comment on table private.fact_publication_acts is
  'Journal des décisions de revue (§30, §31). `actor_user_id` est `not null` : une décision sans auteur n''est pas une décision.';

-- ============================================================
-- 04. Un candidat contradictoire ouvre un conflit
-- ============================================================
-- §38 : « le système crée CONFLICT. Il ne choisit pas automatiquement une
-- valeur. » 0011 marquait le candidat `conflict` sans ouvrir de rapport ; la
-- fonction est remplacée pour le faire, dans la même transaction que
-- l'écriture du candidat.
--
-- §39 nomme le type : `published_fact_conflict` — un candidat contre une
-- valeur déjà publiée.

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
              and v.value_number is not distinct from (nullif(v_candidate->>'valueNumber', ''))::numeric),
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
  'Candidats, preuves et conflits d''une extraction (§20, §21, §38). Ne touche jamais à public.race_facts : un candidat est une proposition, la publication est un workflow humain (§25, §30).';

-- ============================================================
-- 05. Facts dont un changement se signale (§43)
-- ============================================================

create or replace function private.fact_change_is_critical(p_category public.fact_category)
returns boolean language sql immutable set search_path = '' as $$
  -- §43 : « heure de départ ; barrières ; parcours ; assistance ; matériel
  -- obligatoire ; kit froid / chaud ; annulation ; changement de lieu ;
  -- retrait dossard ». Traduit dans le vocabulaire de `fact_category`.
  select p_category in (
    'start', 'cutoff', 'course', 'gpx', 'assistance', 'equipment', 'safety', 'bib'
  );
$$;

-- ============================================================
-- 06. Publication d'un candidat — les huit étapes de §33
-- ============================================================
-- Une seule fonction, donc une seule transaction (01_ARCHITECTURE §31).
-- PostgREST n'exécute qu'une instruction par appel : découper reviendrait à
-- laisser un fact pointant vers une version dont les sources manquent, ou une
-- version publiée sans son événement métier.

create or replace function private.publish_fact_from_candidate(
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_trust_level public.trust_level,
  p_value_text text,
  p_value_number numeric,
  p_value_json jsonb,
  p_unit text,
  p_note text,
  p_resolve_conflict boolean
)
returns table (
  fact_id uuid,
  fact_version_id uuid,
  version_number integer,
  action text,
  superseded_version_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_candidate record;
  v_organization_id uuid;
  v_authority text;
  v_actor_role public.organization_member_role;
  v_fact_id uuid;
  v_fact_category public.fact_category;
  v_current_version_id uuid;
  v_next integer;
  v_version_id uuid;
  v_action text;
  v_edited boolean;
  v_value_text text;
  v_value_number numeric;
  v_value_json jsonb;
  v_unit text;
  v_evidence_count integer;
  v_primary_used boolean := false;
  v_evidence record;
  v_severity public.change_severity;
  v_change_id uuid;
begin
  -- ---------------------------------------------------------
  -- Acte humain : la première condition, avant toute lecture
  -- ---------------------------------------------------------
  -- `auth.uid()` est nul pour le `service_role` et pour le worker. §25 et §30
  -- ne laissent aucune place à une publication automatique : sans session, on
  -- s'arrête ici. L'identifiant passé en paramètre doit correspondre à la
  -- session — le fournir ne confère rien, il ne fait que rendre l'intention
  -- explicite et vérifiable.
  v_actor := (select auth.uid());

  if v_actor is null then
    raise exception 'publication refusée : aucun acte humain (§25, §30)'
      using errcode = 'insufficient_privilege';
  end if;

  if p_actor_user_id is distinct from v_actor then
    raise exception 'publication refusée : acteur déclaré différent de la session'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------
  -- Le candidat, et son état
  -- ---------------------------------------------------------
  select c.*, r.source_snapshot_id
  into v_candidate
  from private.fact_candidates c
  join private.extraction_runs r on r.id = c.extraction_run_id
  where c.id = p_candidate_id
  for update of c;

  -- `not found` plutôt qu'un test de nullité : un `record` dont tous les
  -- champs sont nuls serait « null » sans que la ligne manque.
  if not found then
    raise exception 'candidat introuvable' using errcode = 'no_data_found';
  end if;

  -- §25 : un candidat déjà tranché ne se retranche pas. Republier un candidat
  -- accepté créerait une seconde version identique sans décision nouvelle.
  if v_candidate.status not in ('detected', 'needs_review', 'conflict') then
    raise exception 'candidat déjà tranché (%): aucune décision à reprendre', v_candidate.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- §62 `FACT_CONFLICT_UNRESOLVED` : §38 — « il ne choisit pas automatiquement
  -- une valeur ». Publier par-dessus un conflit demande de le dire.
  if v_candidate.status = 'conflict' and coalesce(p_resolve_conflict, false) = false then
    raise exception 'FACT_CONFLICT_UNRESOLVED : ce candidat contredit une valeur publiée (§38, §40)'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- §62 `FACT_SOURCE_MISSING` : §34 et §20 — une version publiée doit pouvoir
  -- revenir à sa preuve. Sans preuve, il n'y a rien à publier.
  select count(*) into v_evidence_count
  from private.fact_candidate_evidence e
  where e.candidate_id = p_candidate_id;

  if v_evidence_count = 0 then
    raise exception 'FACT_SOURCE_MISSING : candidat sans preuve (§20, §34)'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- ---------------------------------------------------------
  -- Autorité, relue en base
  -- ---------------------------------------------------------
  v_organization_id := private.organization_of_race(v_candidate.race_id);

  select om.role into v_actor_role
  from public.organization_members om
  where om.organization_id = v_organization_id and om.user_id = v_actor;

  if private.user_id_has_org_role(v_actor, v_organization_id, 'editor') then
    v_authority := 'organization_member';
  elsif private.user_id_is_pluka_admin(v_actor) then
    v_authority := 'platform_admin';
  else
    raise exception 'publication refusée : autorité insuffisante sur cette course (§30)'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------
  -- §33.1 — résoudre le RaceFact logique
  -- ---------------------------------------------------------
  select f.id, f.category, f.current_version_id
  into v_fact_id, v_fact_category, v_current_version_id
  from public.race_facts f
  where f.race_id = v_candidate.race_id and f.fact_key = v_candidate.fact_key
  for update;

  if v_fact_id is null then
    insert into public.race_facts (race_id, category, fact_key)
    values (v_candidate.race_id, v_candidate.category, v_candidate.fact_key)
    returning id, category, current_version_id
    into v_fact_id, v_fact_category, v_current_version_id;
  elsif v_fact_category is distinct from v_candidate.category then
    -- §62 `FACT_IDENTITY_AMBIGUOUS` : la même clé logique désignerait deux
    -- concepts. §24 veut une identité qui « représente le sujet » ; deux
    -- catégories pour un sujet, c'est que la clé est mauvaise.
    raise exception 'FACT_IDENTITY_AMBIGUOUS : % existe en catégorie %, candidat en %',
      v_candidate.fact_key, v_fact_category, v_candidate.category
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- §37 : republier une information retirée la remet en circulation, et c'est
  -- une action humaine explicite — celle qu'on est en train de faire.
  update public.race_facts set archived_at = null
  where id = v_fact_id and archived_at is not null;

  -- ---------------------------------------------------------
  -- §31 — publier, ou éditer puis publier
  -- ---------------------------------------------------------
  v_edited :=
    p_value_text is not null or p_value_number is not null
    or p_value_json is not null or p_unit is not null;

  v_value_text := coalesce(p_value_text, case when v_edited then null else v_candidate.value_text end);
  v_value_number := coalesce(p_value_number, case when v_edited then null else v_candidate.value_number end);
  v_value_json := coalesce(p_value_json, case when v_edited then null else v_candidate.value_json end);
  v_unit := coalesce(p_unit, case when v_edited then null else v_candidate.unit end);

  if num_nonnulls(v_value_text, v_value_number, v_value_json) = 0 then
    raise exception 'une version sans valeur ne publie rien'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  v_action := case when v_edited then 'edit_and_publish' else 'publish' end;

  -- ---------------------------------------------------------
  -- §33.2 — créer une version immuable
  -- ---------------------------------------------------------
  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.race_fact_versions v
  where v.fact_id = v_fact_id;

  insert into public.race_fact_versions
    (fact_id, version_number, value_text, value_number, unit, value_json,
     trust_level, workflow_status, supersedes_version_id,
     created_by_user_id, published_by_user_id,
     validated_by_user_id, validated_by_organization_id, validated_at, published_at)
  values (
    v_fact_id, v_next, v_value_text, v_value_number, v_unit, v_value_json,
    p_trust_level, 'published', v_current_version_id,
    v_actor, v_actor,
    v_actor,
    -- §32 : le niveau « officielle » est conféré *par* une organisation. La
    -- colonne dit laquelle ; le trigger vérifie que c'est bien la sienne.
    case when p_trust_level = 'official' then v_organization_id else null end,
    now(), now()
  )
  returning id into v_version_id;

  -- §35 : l'ancienne version reste accessible à l'audit. Elle change d'état,
  -- jamais de valeur — le trigger d'immuabilité s'en assure.
  if v_current_version_id is not null then
    update public.race_fact_versions
    set workflow_status = 'superseded'
    where id = v_current_version_id and workflow_status = 'published';
  end if;

  -- ---------------------------------------------------------
  -- §33.3 / §34 — rattacher les FactSources
  -- ---------------------------------------------------------
  -- « Une version peut dépendre de plusieurs sources. La relation doit
  -- conserver le locator exact. »
  for v_evidence in
    select e.page_number, e.section_path, e.locator, e.excerpt, e.is_primary,
           coalesce(b.source_snapshot_id, c.source_snapshot_id) as snapshot_id
    from private.fact_candidate_evidence e
    left join private.source_blocks b on b.id = e.source_block_id
    left join private.source_chunks c on c.id = e.source_chunk_id
    where e.candidate_id = p_candidate_id
    order by e.is_primary desc, e.id
  loop
    if v_evidence.snapshot_id is null then
      continue;
    end if;

    insert into public.fact_sources
      (fact_version_id, source_id, source_snapshot_id, page_start, page_end,
       section_label, excerpt, locator, is_primary)
    select
      v_version_id,
      s.source_id,
      s.id,
      v_evidence.page_number,
      v_evidence.page_number,
      nullif(array_to_string(array(select jsonb_array_elements_text(v_evidence.section_path)), ' › '), ''),
      v_evidence.excerpt,
      coalesce(v_evidence.locator, '{}'::jsonb),
      -- Une seule preuve principale par version : l'index unique de 0001 le
      -- veut, et une citation « la » plus autoritative n'a de sens qu'au
      -- singulier.
      v_evidence.is_primary and not v_primary_used
    from public.source_snapshots s
    where s.id = v_evidence.snapshot_id;

    if v_evidence.is_primary then
      v_primary_used := true;
    end if;
  end loop;

  -- ---------------------------------------------------------
  -- §33.6 — déplacer le pointeur de version courante
  -- ---------------------------------------------------------
  update public.race_facts set current_version_id = v_version_id where id = v_fact_id;

  -- Le candidat est tranché : il ne reviendra pas en revue.
  update private.fact_candidates
  set status = 'accepted',
      matched_fact_id = v_fact_id,
      reviewed_by_user_id = v_actor,
      reviewed_at = now()
  where id = p_candidate_id;

  -- §40 : « la résolution crée une nouvelle RaceFactVersion. Elle ne modifie
  -- pas les sources. » Le rapport de conflit est clos, la source est intacte.
  update private.conflict_reports
  set status = 'resolved',
      resolved_by_user_id = v_actor,
      resolved_at = now(),
      resolved_fact_version_id = v_version_id,
      resolution_note = p_note
  where candidate_id = p_candidate_id and status = 'open';

  -- ---------------------------------------------------------
  -- §33.8 / §43 / §44 — signaler le changement
  -- ---------------------------------------------------------
  -- §44 : « le moteur Sources ne réécrit pas lui-même les objets downstream.
  -- Il signale le changement. » Rien ici ne touche à un Plan.
  v_severity := case
    when not private.fact_change_is_critical(v_candidate.category) then 'info'
    when v_current_version_id is null then 'important'
    else 'critical'
  end;

  insert into public.race_change_events
    (race_id, fact_id, from_version_id, to_version_id, severity, title, summary,
     published_by_user_id, published_by_organization_id)
  values (
    v_candidate.race_id,
    v_fact_id,
    v_current_version_id,
    v_version_id,
    v_severity,
    v_candidate.fact_key,
    p_note,
    v_actor,
    case when v_authority = 'organization_member' then v_organization_id else null end
  )
  returning id into v_change_id;

  -- ---------------------------------------------------------
  -- §33.7 — événement métier, dans la même transaction (§22.2)
  -- ---------------------------------------------------------
  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'race.fact.published',
    'race_fact',
    v_fact_id,
    jsonb_build_object(
      'raceId', v_candidate.race_id,
      'factId', v_fact_id,
      'factKey', v_candidate.fact_key,
      'factVersionId', v_version_id,
      'versionNumber', v_next,
      'previousVersionId', v_current_version_id,
      'trustLevel', p_trust_level,
      'severity', v_severity,
      'changeEventId', v_change_id,
      'idempotencyKey', 'race.fact.published:' || v_version_id::text
    ),
    'race.fact.published:' || v_version_id::text
  );

  -- ---------------------------------------------------------
  -- Journal de la décision (§30, §31)
  -- ---------------------------------------------------------
  insert into private.fact_publication_acts
    (candidate_id, race_id, fact_id, fact_version_id, action, actor_user_id,
     authority, actor_role, trust_level, original_value, published_value, note)
  values (
    p_candidate_id, v_candidate.race_id, v_fact_id, v_version_id, v_action, v_actor,
    v_authority, v_actor_role, p_trust_level,
    -- §31 : « une modification manuelle avant publication doit être auditée ».
    -- La valeur d'origine n'est enregistrée que lorsqu'elle a été corrigée.
    case
      when v_edited then jsonb_build_object(
        'valueText', v_candidate.value_text,
        'valueNumber', v_candidate.value_number,
        'unit', v_candidate.unit,
        'valueJson', v_candidate.value_json)
      else null
    end,
    jsonb_build_object(
      'valueText', v_value_text,
      'valueNumber', v_value_number,
      'unit', v_unit,
      'valueJson', v_value_json),
    p_note
  );

  insert into private.audit_logs
    (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (
    v_actor,
    v_organization_id,
    'fact.' || v_action,
    'race_fact_versions',
    v_version_id,
    jsonb_build_object('factKey', v_candidate.fact_key, 'trustLevel', p_trust_level)
  );

  return query select v_fact_id, v_version_id, v_next, v_action, v_current_version_id;
end;
$$;

comment on function private.publish_fact_from_candidate is
  'Les huit étapes de §33 en une transaction (§31). Refuse toute publication sans session : §25 et §30 ne laissent aucune place à une publication automatique.';

-- ============================================================
-- 07. Les décisions qui ne publient pas (§31)
-- ============================================================
-- « reject », « mark_duplicate », « needs_review ». Elles ne créent aucune
-- version, et sont journalisées au même titre : un candidat écarté sans trace
-- serait une décision invisible.

create or replace function private.decide_fact_candidate(
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_candidate record;
  v_organization_id uuid;
  v_authority text;
  v_actor_role public.organization_member_role;
  v_status text;
begin
  v_actor := (select auth.uid());

  if v_actor is null or p_actor_user_id is distinct from v_actor then
    raise exception 'décision refusée : aucun acte humain identifié (§30)'
      using errcode = 'insufficient_privilege';
  end if;

  if p_action not in ('reject', 'mark_duplicate', 'needs_review') then
    raise exception 'action de revue inconnue : %', p_action using errcode = 'invalid_parameter_value';
  end if;

  select c.* into v_candidate from private.fact_candidates c where c.id = p_candidate_id for update;

  if not found then
    raise exception 'candidat introuvable' using errcode = 'no_data_found';
  end if;

  if v_candidate.status = 'accepted' then
    -- Un candidat publié ne se rejette pas après coup : c'est la version
    -- publiée qu'il faudrait remplacer, par une nouvelle version (§35, §37).
    raise exception 'candidat déjà publié : le retrait passe par une nouvelle version (§37)'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  v_organization_id := private.organization_of_race(v_candidate.race_id);

  select om.role into v_actor_role
  from public.organization_members om
  where om.organization_id = v_organization_id and om.user_id = v_actor;

  if private.user_id_has_org_role(v_actor, v_organization_id, 'editor') then
    v_authority := 'organization_member';
  elsif private.user_id_is_pluka_admin(v_actor) then
    v_authority := 'platform_admin';
  else
    raise exception 'décision refusée : autorité insuffisante sur cette course (§30)'
      using errcode = 'insufficient_privilege';
  end if;

  v_status := case p_action
    when 'reject' then 'rejected'
    when 'mark_duplicate' then 'duplicate'
    else 'needs_review'
  end;

  update private.fact_candidates
  set status = v_status,
      reviewed_by_user_id = v_actor,
      reviewed_at = now(),
      notes = coalesce(p_note, notes)
  where id = p_candidate_id;

  -- Écarter un candidat clôt le conflit qu'il avait ouvert, sans rien publier :
  -- §40 laisse la valeur existante en place.
  if p_action in ('reject', 'mark_duplicate') then
    update private.conflict_reports
    set status = 'dismissed',
        resolved_by_user_id = v_actor,
        resolved_at = now(),
        resolution_note = p_note
    where candidate_id = p_candidate_id and status = 'open';
  end if;

  insert into private.fact_publication_acts
    (candidate_id, race_id, fact_id, action, actor_user_id, authority, actor_role, note)
  values (
    p_candidate_id, v_candidate.race_id, v_candidate.matched_fact_id, p_action,
    v_actor, v_authority, v_actor_role, p_note
  );

  insert into private.audit_logs
    (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (
    v_actor, v_organization_id, 'fact.' || p_action, 'fact_candidates', p_candidate_id,
    jsonb_build_object('factKey', v_candidate.fact_key, 'status', v_status)
  );

  return v_status;
end;
$$;

-- ============================================================
-- 08. Surface applicative
-- ============================================================
-- Accordée à `authenticated`, pas à `service_role` : la publication est un
-- acte de session. Un appel sans session est refusé par la fonction elle-même,
-- et cette absence de grant le dit aussi à la lecture.

create or replace function public.publish_fact_candidate(
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_trust_level public.trust_level,
  p_value_text text default null,
  p_value_number numeric default null,
  p_value_json jsonb default null,
  p_unit text default null,
  p_note text default null,
  p_resolve_conflict boolean default false
)
returns table (
  fact_id uuid,
  fact_version_id uuid,
  version_number integer,
  action text,
  superseded_version_id uuid
)
language sql
security definer
set search_path = ''
as $$
  select * from private.publish_fact_from_candidate(
    p_candidate_id, p_actor_user_id, p_trust_level, p_value_text, p_value_number,
    p_value_json, p_unit, p_note, p_resolve_conflict);
$$;

create or replace function public.decide_fact_candidate(
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_note text default null
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.decide_fact_candidate(p_candidate_id, p_actor_user_id, p_action, p_note);
$$;

-- ============================================================
-- 09. La revue humaine (§30)
-- ============================================================
-- « La revue doit afficher : valeur proposée ; type ; source ; extrait ;
-- page / section ; anciennes valeurs ; contradictions ; action proposée. »
--
-- Une seule lecture les rassemble : demander à l'écran de recoudre huit
-- requêtes lui ferait afficher des états incohérents entre elles.

-- Portée d'un candidat, pour le use case qui doit relire l'autorité avant
-- d'agir. Le domaine ne reçoit jamais un `raceId` de l'appelant : il le lit
-- ici, à partir du seul identifiant de candidat (03_PRIVACY_RLS §11, §178).
create or replace function public.get_fact_candidate_scope(p_candidate_id uuid)
returns table (
  candidate_id uuid,
  race_id uuid,
  organization_id uuid,
  category public.fact_category,
  fact_key text,
  status text,
  origin text,
  matched_fact_id uuid,
  value_text text,
  value_number numeric,
  unit text,
  evidence_count integer,
  conflict_status text
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id,
    c.race_id,
    private.organization_of_race(c.race_id),
    c.category,
    c.fact_key,
    c.status,
    c.origin,
    c.matched_fact_id,
    c.value_text,
    c.value_number,
    c.unit,
    (select count(*)::integer from private.fact_candidate_evidence e where e.candidate_id = c.id),
    (select cr.status from private.conflict_reports cr
     where cr.candidate_id = c.id and cr.status = 'open' limit 1)
  from private.fact_candidates c
  where c.id = p_candidate_id
    -- Deny by default : la fonction contourne la RLS, elle porte donc
    -- elle-même sa condition d'accès (03_PRIVACY_RLS §8).
    and (private.user_can_manage_race(c.race_id, 'viewer') or private.is_pluka_admin());
$$;

create or replace function public.list_fact_candidates_for_review(
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
  source_title text,
  source_url text,
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
    src.title, src.url, snap.retrieved_at,
    r.provider, r.model, r.started_at
  from private.fact_candidates c
  join private.extraction_runs r on r.id = c.extraction_run_id
  left join public.race_facts f on f.id = c.matched_fact_id
  left join public.race_fact_versions pv on pv.id = f.current_version_id
  left join private.conflict_reports cr
    on cr.candidate_id = c.id and cr.status = 'open'
  left join lateral (
    select e2.excerpt, e2.page_number, e2.section_path, e2.locator
    from private.fact_candidate_evidence e2
    where e2.candidate_id = c.id
    order by e2.is_primary desc, e2.id
    limit 1
  ) e on true
  left join public.source_snapshots snap on snap.id = r.source_snapshot_id
  left join public.sources src on src.id = snap.source_id
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
  'Les huit colonnes que §30 impose à l''écran de revue, en une lecture cohérente. Contourne la RLS, donc pose elle-même sa condition d''accès (03_PRIVACY_RLS §8).';

-- Le journal, lisible par ceux qui administrent la course.
--
-- §30 impose que la revue montre « anciennes valeurs » et « contradictions » ;
-- savoir *qui a décidé quoi* relève du même besoin. Un journal qu'aucune
-- surface ne peut lire ne se vérifie que par un accès direct à la base, ce qui
-- revient à ne pas être auditable.
create or replace function public.list_fact_publication_acts(
  p_race_id uuid,
  p_limit integer default 100
)
returns table (
  act_id uuid,
  candidate_id uuid,
  fact_id uuid,
  fact_version_id uuid,
  action text,
  actor_user_id uuid,
  authority text,
  actor_role public.organization_member_role,
  trust_level public.trust_level,
  original_value jsonb,
  published_value jsonb,
  note text,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select a.id, a.candidate_id, a.fact_id, a.fact_version_id, a.action, a.actor_user_id,
         a.authority, a.actor_role, a.trust_level, a.original_value, a.published_value,
         a.note, a.created_at
  from private.fact_publication_acts a
  where a.race_id = p_race_id
    and (private.user_can_manage_race(p_race_id, 'viewer') or private.is_pluka_admin())
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

do $do$
declare
  f text;
  signatures text[] := array[
    'public.publish_fact_candidate(uuid, uuid, public.trust_level, text, numeric, jsonb, text, text, boolean)',
    'public.list_fact_publication_acts(uuid, integer)',
    'public.decide_fact_candidate(uuid, uuid, text, text)',
    'public.list_fact_candidates_for_review(uuid, integer)',
    'public.get_fact_candidate_scope(uuid)'
  ];
begin
  foreach f in array signatures loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$do$;

revoke all on all functions in schema private from anon, authenticated;

commit;
