-- PLUKA V1 — Le tableau du matériel : une exigence par épreuve, enregistrée d'un coup
-- File target: supabase/migrations/0048_edition_equipment_grid.sql
-- Référence : SOURCES_EXTRACTION §82 · 02_DATA_MODEL §8.4 · AGENTS §14 · migrations 0043, 0045, 0047
--
-- DÉCISION PRODUIT DU 2026-10-15
--
-- Le matériel d'une édition se règle dans un tableau : une ligne par pièce,
-- une colonne par épreuve, et chaque case porte sa propre exigence — non
-- concernée, recommandée, conditionnelle, obligatoire. Les clics forment un
-- brouillon ; « Enregistrer » l'applique en une transaction, pour qu'une
-- hésitation ne publie pas trois versions ni trois alertes.
--
-- Une ligne porte un nom, une condition et une précision communs à ses
-- épreuves ; la condition ne s'écrit que dans les cases conditionnelles.
--
-- `set_edition_equipment` (0047) appliquait une seule exigence à toutes les
-- épreuves cochées. Le tableau la remplace ; elle est retirée.
--
-- Chaque case passe par le geste qui la fait déjà : ajout (0045), correction
-- en version N+1 (0045), retrait et restauration (0043). Autorité, preuve,
-- journal et signal aux coureurs sont les leurs.

begin;

drop function if exists public.set_edition_equipment(
  uuid, text, uuid[], text, text, text, text, public.trust_level, text, boolean);

-- ============================================================
-- Une case : amener l'élément d'une épreuve à l'état voulu
-- ============================================================

/*
 * `p_requirement` nul : l'épreuve n'est pas concernée, l'élément est retiré
 * s'il est affiché. Sinon il est ajouté, restauré ou corrigé selon ce qui
 * existe. Rend le nombre de gestes faits (0 si la case est déjà dans l'état).
 */
create or replace function private.apply_race_equipment(
  p_race_id uuid,
  p_fact_key text,
  p_label text,
  p_requirement text,
  p_condition text,
  p_detail text,
  p_trust_level public.trust_level,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact public.race_facts;
  v_current public.race_fact_versions;
  v_condition text := case when p_requirement = 'conditional' then p_condition else null end;
  v_value jsonb;
  v_changes integer := 0;
begin
  select * into v_fact from public.race_facts f
  where f.race_id = p_race_id and f.fact_key = p_fact_key;

  if p_requirement is null then
    if v_fact.id is not null and v_fact.archived_at is null then
      perform public.retire_race_fact(v_fact.id, p_note);
      return 1;
    end if;
    return 0;
  end if;

  v_value := private.equipment_value(p_requirement, v_condition, p_detail);

  if v_fact.id is null then
    perform public.add_race_equipment(
      array[p_race_id], p_fact_key, p_label, p_requirement, v_condition, p_detail,
      p_trust_level, p_note);
    return 1;
  end if;

  if v_fact.category is distinct from 'equipment' then
    raise exception 'la clé % désigne une autre information', p_fact_key using errcode = '22023';
  end if;

  if v_fact.archived_at is not null then
    perform public.restore_race_fact(v_fact.id, p_note);
    v_changes := 1;
  end if;

  select * into v_current from public.race_fact_versions v where v.id = v_fact.current_version_id;

  if v_current.id is null
     or v_current.value_text is distinct from nullif(btrim(coalesce(p_label, '')), '')
     or v_current.value_json is distinct from v_value
     or v_current.trust_level is distinct from p_trust_level then
    perform public.revise_race_equipment(
      v_fact.id, p_label, p_requirement, v_condition, p_detail, p_trust_level, p_note);
    v_changes := 1;
  end if;

  return v_changes;
end;
$$;

-- ============================================================
-- Le tableau : toutes les lignes modifiées, en une transaction
-- ============================================================

/*
 * `p_items` : un tableau de lignes
 *   { "factKey": "equipment.frontale", "create": false,
 *     "label": "Frontale", "condition": null, "detail": "piles",
 *     "requirements": { "<race_id>": "mandatory" | "conditional" | "recommended" | null } }
 *
 * Une épreuve de l'édition absente de `requirements` est laissée telle
 * quelle : le brouillon n'envoie que ce qu'il connaît. `create` refuse une
 * clé déjà présente dans l'édition (23505), pour qu'un ajout ne modifie pas
 * une ligne sans le savoir.
 *
 * Rend le nombre de cases modifiées ; refuse (55000) si rien ne change.
 */
create or replace function public.save_edition_equipment(
  p_edition_id uuid,
  p_items jsonb,
  p_trust_level public.trust_level,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_key text;
  v_race_id uuid;
  v_requirement text;
  v_changes integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'geste refusé : aucun acte humain' using errcode = '42501';
  end if;

  if not exists (select 1 from public.editions e where e.id = p_edition_id) then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'aucune ligne à enregistrer' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_key := v_item ->> 'factKey';

    if v_key is null or v_key !~ '^equipment\.[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'clé de matériel invalide' using errcode = '22023';
    end if;

    if jsonb_typeof(v_item -> 'requirements') is distinct from 'object' then
      raise exception 'exigences par épreuve manquantes' using errcode = '22023';
    end if;

    -- Une case hors de l'édition est une erreur de l'appelant, pas une
    -- épreuve à ignorer.
    if exists (
      select 1 from jsonb_object_keys(v_item -> 'requirements') as cell(race_key)
      where not exists (
        select 1 from public.races r
        where r.id::text = cell.race_key and r.edition_id = p_edition_id)
    ) then
      raise exception 'épreuve hors de l''édition' using errcode = '22023';
    end if;

    if coalesce((v_item ->> 'create')::boolean, false) and exists (
      select 1 from public.race_facts f
      join public.races r on r.id = f.race_id
      where r.edition_id = p_edition_id and f.fact_key = v_key
    ) then
      raise exception 'ce matériel existe déjà dans l''édition' using errcode = '23505';
    end if;

    for v_race_id, v_requirement in
      select r.id, v_item -> 'requirements' ->> r.id::text
      from public.races r
      where r.edition_id = p_edition_id and (v_item -> 'requirements') ? r.id::text
      order by r.id
    loop
      v_changes := v_changes + private.apply_race_equipment(
        v_race_id, v_key, v_item ->> 'label', v_requirement,
        v_item ->> 'condition', v_item ->> 'detail', p_trust_level, p_note);
    end loop;
  end loop;

  if v_changes = 0 then
    raise exception 'aucune modification' using errcode = '55000';
  end if;

  return v_changes;
end;
$$;

comment on function public.save_edition_equipment is
  'Le tableau du matériel d''une édition : une exigence par épreuve et par pièce, appliquée en une transaction par les gestes de 0043 et 0045 (autorité, preuve, journal, signal). Rien de changé : 55000.';

revoke all on function private.apply_race_equipment(uuid, text, text, text, text, text, public.trust_level, text)
  from public, anon, authenticated;
revoke all on function public.save_edition_equipment(uuid, jsonb, public.trust_level, text)
  from public, anon, authenticated;
grant execute on function public.save_edition_equipment(uuid, jsonb, public.trust_level, text)
  to authenticated;

commit;
