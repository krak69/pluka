-- PLUKA V1 — Matériel d'une épreuve, saisi et corrigé à la main
-- File target: supabase/migrations/0045_race_equipment.sql
-- Référence : 00_PRODUCT_SPEC §14.1 · SOURCES_EXTRACTION §82 · 02_DATA_MODEL §7.4, §8.3, §8.4 ·
--             AGENTS §13, §14 · migrations 0012, 0043
--
-- DÉCISION PRODUIT DU 2026-10-08
--
-- Le matériel se gère depuis la fiche épreuve, sans catalogue : « chaque
-- événement peut nommer des choses de manière différente, il ne faut pas que
-- ça bloque ». Le nom est celui du règlement.
--
-- UN ÉLÉMENT DE MATÉRIEL EST UNE INFORMATION DE COURSE
--
-- §14.1 : « Le matériel obligatoire provient d'une information de course
-- sourcée. » Chaque élément est donc un `race_fact` de catégorie `equipment` :
--
--   value_text  le nom, tel que l'organisation l'écrit (« Veste imperméable ») ;
--   value_json  { "requirement": "mandatory" | "conditional" | "recommended",
--                 "condition": texte | null,   -- « si température < 5 °C »
--                 "detail": texte | null }     -- « membrane 10 000 mm »
--
-- Il hérite ainsi de tout ce que la chaîne garantit déjà : versions
-- immuables (une correction crée N+1), retrait et restauration (0043),
-- preuve, journal, et signal à l'analyseur d'impact — S14 « Equipment
-- change » : un nouvel élément obligatoire doit être détectable côté
-- Préparation, sans mutation silencieuse d'une checklist personnelle.
--
-- `equipment_items` et `race_equipment_requirements` (0001) restent en
-- place, inutilisés : le catalogue est écarté, et la structure vit dans la
-- version du fact, qui est versionnée — une ligne d'exigence ne l'est pas.
--
-- LA PREUVE D'UNE SAISIE MANUELLE
--
-- Une version publiée nomme sa source (`fact_sources`, un snapshot exigé).
-- Une saisie a pour source une source sans document, une par édition et par
-- auteur : « Saisie de l'organisation » (`organizer_input`) quand un éditeur
-- de l'organisation saisit, « Saisie PLUKA » (`manual`) quand c'est l'équipe
-- PLUKA — le coureur lit qui parle. L'auteur de chaque geste est dans
-- `fact_publication_acts` et l'audit. Rien n'est publié sans humain.
--
-- AUTORITÉ
--
-- Celle des autres gestes sur une information (0043) : éditeur de
-- l'organisation de la course, sinon l'administration PLUKA. « Officielle »
-- reste réservée à l'éditeur de l'organisation (§32) ; un admin PLUKA publie
-- en « Validée PLUKA ».
--
-- CE QUE LA MIGRATION AJOUTE
--
--   01. la source « Saisie manuelle » d'une édition ;
--   02. ajouter un élément, à une ou plusieurs épreuves de la même édition ;
--   03. corriger un élément (version N+1, structure comprise) ;
--   04. `revise_race_fact` refuse le matériel — il perdrait sa structure ;
--   05. la lecture d'édition rend la valeur structurée.

begin;

-- ============================================================
-- 01. Source « Saisie manuelle »
-- ============================================================

create or replace function private.manual_source_of(
  p_edition_id uuid,
  p_actor uuid,
  p_organization_id uuid,
  p_by_organization boolean
)
returns table (manual_source_id uuid, manual_snapshot_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.source_type :=
    case when p_by_organization then 'organizer_input' else 'manual' end::public.source_type;
  v_source_id uuid;
  v_snapshot_id uuid;
begin
  select s.id, s.current_snapshot_id into v_source_id, v_snapshot_id
  from public.sources s
  where s.edition_id = p_edition_id and s.source_type = v_type and s.status <> 'archived'
  order by s.created_at
  limit 1
  for update;

  if v_source_id is null then
    insert into public.sources
      (edition_id, organization_id, source_type, title, status, created_by_user_id)
    values (
      p_edition_id,
      case when p_by_organization then p_organization_id else null end,
      v_type,
      case when p_by_organization then 'Saisie de l''organisation' else 'Saisie PLUKA' end,
      'ready',
      p_actor
    )
    returning id into v_source_id;
  end if;

  if v_snapshot_id is null then
    -- Le contenu d'une saisie est dans la version publiée ; le snapshot ne
    -- porte qu'une empreinte stable, propre à l'édition.
    insert into public.source_snapshots (source_id, version_number, content_hash, metadata)
    values (
      v_source_id, 1,
      encode(sha256(convert_to('pluka:' || v_type::text || ':' || p_edition_id::text, 'UTF8')), 'hex'),
      jsonb_build_object('kind', v_type)
    )
    on conflict (source_id, version_number) do nothing;

    select ss.id into v_snapshot_id from public.source_snapshots ss
    where ss.source_id = v_source_id and ss.version_number = 1;

    update public.sources set current_snapshot_id = v_snapshot_id where id = v_source_id;
  end if;

  return query select v_source_id, v_snapshot_id;
end;
$$;

-- ============================================================
-- Valeur structurée
-- ============================================================

create or replace function private.equipment_value(
  p_requirement text,
  p_condition text,
  p_detail text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_requirement is null or p_requirement not in ('mandatory', 'conditional', 'recommended') then
    raise exception 'exigence inconnue : %', p_requirement using errcode = '22023';
  end if;

  -- §82 : un élément conditionnel dit sa condition ; sans elle, il se lirait
  -- comme obligatoire ou comme facultatif, selon qui le lit.
  if p_requirement = 'conditional' and nullif(btrim(coalesce(p_condition, '')), '') is null then
    raise exception 'un matériel conditionnel précise sa condition' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'requirement', p_requirement,
    'condition', nullif(btrim(coalesce(p_condition, '')), ''),
    'detail', nullif(btrim(coalesce(p_detail, '')), '')
  );
end;
$$;

-- ============================================================
-- 02. Ajouter
-- ============================================================

/*
 * Ajoute un élément à une ou plusieurs épreuves d'une même édition — le
 * matériel d'un règlement vaut souvent pour toutes. Une épreuve qui a déjà
 * cet élément (même clé) est laissée telle quelle ; rend le nombre
 * d'épreuves où il a été ajouté, et refuse si c'est zéro.
 *
 * La clé (`equipment.<slug>`) est calculée par le domaine depuis le nom ; elle
 * n'est qu'un identifiant de rapprochement, la base n'en vérifie que la forme.
 */
create or replace function public.add_race_equipment(
  p_race_ids uuid[],
  p_fact_key text,
  p_label text,
  p_requirement text,
  p_condition text,
  p_detail text,
  p_trust_level public.trust_level,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_value jsonb;
  v_race_id uuid;
  v_edition_id uuid;
  v_editions integer;
  v_who record;
  v_source record;
  v_fact_id uuid;
  v_version_id uuid;
  v_added integer := 0;
begin
  if p_race_ids is null or cardinality(p_race_ids) = 0 then
    raise exception 'aucune épreuve visée' using errcode = '22023';
  end if;
  if v_label is null then
    raise exception 'un matériel porte un nom' using errcode = '22023';
  end if;
  if p_fact_key is null or p_fact_key !~ '^equipment\.[a-z0-9]+(-[a-z0-9]+)*$' or length(p_fact_key) > 90 then
    raise exception 'clé de matériel invalide' using errcode = '22023';
  end if;
  if p_trust_level not in ('official', 'pluka_validated') then
    raise exception 'niveau de confiance non publiable' using errcode = '22023';
  end if;

  v_value := private.equipment_value(p_requirement, p_condition, p_detail);

  select count(distinct r.edition_id), min(r.edition_id::text)::uuid into v_editions, v_edition_id
  from public.races r where r.id = any (p_race_ids);

  if v_editions = 0 or (select count(*) from public.races r where r.id = any (p_race_ids))
                       <> cardinality(array(select distinct unnest(p_race_ids))) then
    raise exception 'épreuve introuvable' using errcode = 'P0002';
  end if;
  if v_editions > 1 then
    raise exception 'les épreuves visées appartiennent à des éditions différentes' using errcode = '22023';
  end if;

  foreach v_race_id in array array(select distinct unnest(p_race_ids)) loop
    -- L'autorité se juge épreuve par épreuve : la garde refuse tout le geste
    -- dès qu'une épreuve visée échappe à l'acteur.
    select * into v_who from private.fact_gesture_authority(v_race_id);

    if p_trust_level = 'official' and v_who.authority <> 'organization_member' then
      raise exception 'OFFICIAL_AUTHORIZATION_REQUIRED' using errcode = '42501';
    end if;
    -- Et « Validée PLUKA » est la voix de PLUKA : réservée à son équipe
    -- (`refusalForTrustLevel`, domaine).
    if p_trust_level = 'pluka_validated' and not private.user_id_is_pluka_admin(v_who.actor_user_id) then
      raise exception 'PLUKA_VALIDATION_REQUIRED' using errcode = '42501';
    end if;

    if exists (
      select 1 from public.race_facts f where f.race_id = v_race_id and f.fact_key = p_fact_key
    ) then
      continue;
    end if;

    if v_source is null then
      select * into v_source from private.manual_source_of(
        v_edition_id, v_who.actor_user_id, v_who.organization_id,
        v_who.authority = 'organization_member'
      );
    end if;

    insert into public.race_facts (race_id, category, fact_key)
    values (v_race_id, 'equipment', p_fact_key)
    returning id into v_fact_id;

    insert into public.race_fact_versions
      (fact_id, version_number, value_text, value_json, trust_level, workflow_status,
       created_by_user_id, published_by_user_id, validated_by_user_id,
       validated_by_organization_id, validated_at, published_at)
    values (
      v_fact_id, 1, v_label, v_value, p_trust_level, 'published',
      v_who.actor_user_id, v_who.actor_user_id, v_who.actor_user_id,
      case when p_trust_level = 'official' then v_who.organization_id else null end,
      now(), now()
    )
    returning id into v_version_id;

    insert into public.fact_sources
      (fact_version_id, source_id, source_snapshot_id, excerpt, is_primary)
    values (v_version_id, v_source.manual_source_id, v_source.manual_snapshot_id, null, true);

    update public.race_facts set current_version_id = v_version_id where id = v_fact_id;

    perform private.signal_fact_change(
      v_race_id, v_fact_id, p_fact_key, 'equipment', 'published',
      null, v_version_id, p_note, v_who.actor_user_id,
      case when v_who.authority = 'organization_member' then v_who.organization_id else null end
    );

    insert into private.fact_publication_acts
      (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role,
       trust_level, published_value, note)
    values (
      v_race_id, v_fact_id, v_version_id, 'publish', v_who.actor_user_id, v_who.authority,
      v_who.actor_role, p_trust_level,
      jsonb_build_object('valueText', v_label, 'valueJson', v_value), p_note
    );

    insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
    values (v_who.actor_user_id, v_who.organization_id, 'fact.publish', 'race_fact_versions', v_version_id,
            jsonb_build_object('factKey', p_fact_key, 'trustLevel', p_trust_level, 'manual', true));

    v_added := v_added + 1;
  end loop;

  if v_added = 0 then
    raise exception 'ce matériel est déjà présent sur les épreuves visées' using errcode = '23505';
  end if;

  return v_added;
end;
$$;

-- ============================================================
-- 03. Corriger
-- ============================================================

create or replace function public.revise_race_equipment(
  p_fact_id uuid,
  p_label text,
  p_requirement text,
  p_condition text,
  p_detail text,
  p_trust_level public.trust_level,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact public.race_facts;
  v_current public.race_fact_versions;
  v_who record;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_value jsonb;
  v_version_id uuid;
  v_next integer;
begin
  select * into v_fact from public.race_facts f where f.id = p_fact_id for update;
  if v_fact.id is null then
    raise exception 'information introuvable' using errcode = 'P0002';
  end if;

  select * into v_who from private.fact_gesture_authority(v_fact.race_id);

  if v_fact.category <> 'equipment' then
    raise exception 'cette information n''est pas du matériel' using errcode = '22023';
  end if;
  if v_fact.archived_at is not null then
    raise exception 'information retirée : restaure-la avant de la corriger' using errcode = '55000';
  end if;
  if v_label is null then
    raise exception 'un matériel porte un nom' using errcode = '22023';
  end if;
  if p_trust_level not in ('official', 'pluka_validated') then
    raise exception 'niveau de confiance non publiable' using errcode = '22023';
  end if;
  if p_trust_level = 'official' and v_who.authority <> 'organization_member' then
    raise exception 'OFFICIAL_AUTHORIZATION_REQUIRED' using errcode = '42501';
  end if;
  if p_trust_level = 'pluka_validated' and not private.user_id_is_pluka_admin(v_who.actor_user_id) then
    raise exception 'PLUKA_VALIDATION_REQUIRED' using errcode = '42501';
  end if;

  v_value := private.equipment_value(p_requirement, p_condition, p_detail);

  select * into v_current from public.race_fact_versions v where v.id = v_fact.current_version_id;

  if v_current.id is not null
     and v_current.value_text is not distinct from v_label
     and v_current.value_json is not distinct from v_value
     and v_current.trust_level = p_trust_level then
    raise exception 'aucune modification' using errcode = '55000';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.race_fact_versions v where v.fact_id = p_fact_id;

  insert into public.race_fact_versions
    (fact_id, version_number, value_text, value_json, trust_level, workflow_status,
     supersedes_version_id, created_by_user_id, published_by_user_id,
     validated_by_user_id, validated_by_organization_id, validated_at, published_at)
  values (
    p_fact_id, v_next, v_label, v_value, p_trust_level, 'published',
    v_current.id, v_who.actor_user_id, v_who.actor_user_id, v_who.actor_user_id,
    case when p_trust_level = 'official' then v_who.organization_id else null end,
    now(), now()
  )
  returning id into v_version_id;

  if v_current.id is not null then
    update public.race_fact_versions set workflow_status = 'superseded'
    where id = v_current.id and workflow_status = 'published';

    -- Comme 0043 : la correction porte sur la lecture, les preuves suivent.
    insert into public.fact_sources
      (fact_version_id, source_id, source_snapshot_id, page_start, page_end,
       section_label, excerpt, locator, is_primary)
    select v_version_id, fs.source_id, fs.source_snapshot_id, fs.page_start, fs.page_end,
           fs.section_label, fs.excerpt, fs.locator, fs.is_primary
    from public.fact_sources fs
    where fs.fact_version_id = v_current.id;
  end if;

  update public.race_facts set current_version_id = v_version_id where id = p_fact_id;

  perform private.signal_fact_change(
    v_fact.race_id, p_fact_id, v_fact.fact_key, v_fact.category, 'revised',
    v_current.id, v_version_id, p_note, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id else null end
  );

  insert into private.fact_publication_acts
    (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role,
     trust_level, original_value, published_value, note)
  values (
    v_fact.race_id, p_fact_id, v_version_id, 'revise', v_who.actor_user_id, v_who.authority,
    v_who.actor_role, p_trust_level,
    jsonb_build_object('valueText', v_current.value_text, 'valueJson', v_current.value_json,
                       'trustLevel', v_current.trust_level),
    jsonb_build_object('valueText', v_label, 'valueJson', v_value),
    p_note
  );

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'fact.revise', 'race_fact_versions', v_version_id,
          jsonb_build_object('factKey', v_fact.fact_key, 'trustLevel', p_trust_level));

  return v_version_id;
end;
$$;

-- ============================================================
-- 04. La correction générique refuse le matériel
-- ============================================================

-- `revise_race_fact` (0043) ne recopie pas la valeur structurée : appliqué à
-- un matériel, il effacerait son exigence. Il le refuse donc, et renvoie au
-- geste dédié. Le reste de la fonction est celui de 0043, à l'identique.
create or replace function public.revise_race_fact(
  p_fact_id uuid,
  p_value_text text,
  p_value_number numeric,
  p_unit text,
  p_trust_level public.trust_level,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact public.race_facts;
  v_current public.race_fact_versions;
  v_who record;
  v_version_id uuid;
  v_next integer;
  v_text text := nullif(btrim(coalesce(p_value_text, '')), '');
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
begin
  select * into v_fact from public.race_facts f where f.id = p_fact_id for update;
  if v_fact.id is null then
    raise exception 'information introuvable' using errcode = 'P0002';
  end if;

  select * into v_who from private.fact_gesture_authority(v_fact.race_id);

  if v_fact.category = 'equipment' then
    raise exception 'le matériel se corrige depuis le panneau Matériel de l''épreuve'
      using errcode = '55000';
  end if;

  if v_fact.archived_at is not null then
    raise exception 'information retirée : restaure-la avant de la corriger' using errcode = '55000';
  end if;

  if p_trust_level not in ('official', 'pluka_validated') then
    raise exception 'niveau de confiance non publiable' using errcode = '22023';
  end if;

  if num_nonnulls(v_text, p_value_number) = 0 then
    raise exception 'une version sans valeur ne publie rien' using errcode = '22023';
  end if;

  select * into v_current from public.race_fact_versions v where v.id = v_fact.current_version_id;

  if v_current.id is not null
     and v_current.value_text is not distinct from v_text
     and v_current.value_number is not distinct from p_value_number
     and v_current.unit is not distinct from v_unit
     and v_current.trust_level = p_trust_level then
    raise exception 'aucune modification' using errcode = '55000';
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.race_fact_versions v where v.fact_id = p_fact_id;

  insert into public.race_fact_versions
    (fact_id, version_number, value_text, value_number, unit, value_json,
     trust_level, workflow_status, supersedes_version_id,
     created_by_user_id, published_by_user_id,
     validated_by_user_id, validated_by_organization_id, validated_at, published_at)
  values (
    p_fact_id, v_next, v_text, p_value_number, v_unit, null,
    p_trust_level, 'published', v_current.id,
    v_who.actor_user_id, v_who.actor_user_id, v_who.actor_user_id,
    case when p_trust_level = 'official' then v_who.organization_id else null end,
    now(), now()
  )
  returning id into v_version_id;

  if v_current.id is not null then
    update public.race_fact_versions set workflow_status = 'superseded'
    where id = v_current.id and workflow_status = 'published';

    insert into public.fact_sources
      (fact_version_id, source_id, source_snapshot_id, page_start, page_end,
       section_label, excerpt, locator, is_primary)
    select v_version_id, fs.source_id, fs.source_snapshot_id, fs.page_start, fs.page_end,
           fs.section_label, fs.excerpt, fs.locator, fs.is_primary
    from public.fact_sources fs
    where fs.fact_version_id = v_current.id;
  end if;

  update public.race_facts set current_version_id = v_version_id where id = p_fact_id;

  perform private.signal_fact_change(
    v_fact.race_id, p_fact_id, v_fact.fact_key, v_fact.category, 'revised',
    v_current.id, v_version_id, p_note, v_who.actor_user_id,
    case when v_who.authority = 'organization_member' then v_who.organization_id else null end
  );

  insert into private.fact_publication_acts
    (race_id, fact_id, fact_version_id, action, actor_user_id, authority, actor_role,
     trust_level, original_value, published_value, note)
  values (
    v_fact.race_id, p_fact_id, v_version_id, 'revise', v_who.actor_user_id, v_who.authority,
    v_who.actor_role, p_trust_level,
    jsonb_build_object('valueText', v_current.value_text, 'valueNumber', v_current.value_number,
                       'unit', v_current.unit, 'trustLevel', v_current.trust_level),
    jsonb_build_object('valueText', v_text, 'valueNumber', p_value_number, 'unit', v_unit),
    p_note
  );

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values (v_who.actor_user_id, v_who.organization_id, 'fact.revise', 'race_fact_versions', v_version_id,
          jsonb_build_object('factKey', v_fact.fact_key, 'trustLevel', p_trust_level));

  return v_version_id;
end;
$$;

-- ============================================================
-- 05. Lecture : la valeur structurée
-- ============================================================

-- Même fonction que 0043, avec `valueJson` en plus : l'écran Matériel en lit
-- l'exigence, la condition et la précision.
create or replace function public.list_race_facts_for_editing(p_race_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.fact_gesture_authority(p_race_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'factId', f.id,
      'category', f.category,
      'factKey', f.fact_key,
      'archivedAt', f.archived_at,
      'versionId', v.id,
      'versionNumber', v.version_number,
      'valueText', v.value_text,
      'valueNumber', v.value_number,
      'unit', v.unit,
      'valueJson', v.value_json,
      'trustLevel', v.trust_level,
      'publishedAt', v.published_at,
      'source', (
        select jsonb_build_object('title', s.title, 'page', fs.page_start, 'excerpt', fs.excerpt)
        from public.fact_sources fs join public.sources s on s.id = fs.source_id
        where fs.fact_version_id = v.id
        order by fs.is_primary desc, fs.id
        limit 1
      )
    ) order by f.archived_at nulls first, f.category, f.fact_key)
    from public.race_facts f
    join public.race_fact_versions v on v.id = f.current_version_id
    where f.race_id = p_race_id
  ), '[]'::jsonb);
end;
$$;

-- ============================================================
-- Droits
-- ============================================================

revoke all on function private.manual_source_of(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.equipment_value(text, text, text) from public, anon, authenticated;

revoke all on function public.add_race_equipment(uuid[], text, text, text, text, text, public.trust_level, text)
  from public, anon;
revoke all on function public.revise_race_equipment(uuid, text, text, text, text, public.trust_level, text)
  from public, anon;

grant execute on function public.add_race_equipment(uuid[], text, text, text, text, text, public.trust_level, text)
  to authenticated;
grant execute on function public.revise_race_equipment(uuid, text, text, text, text, public.trust_level, text)
  to authenticated;

commit;
