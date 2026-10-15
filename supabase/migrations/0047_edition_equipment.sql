-- PLUKA V1 — Le matériel se gère depuis l'événement, épreuve par épreuve cochée
-- File target: supabase/migrations/0047_edition_equipment.sql
-- Référence : SOURCES_EXTRACTION §82 · 02_DATA_MODEL §8.4 · AGENTS §14 · migrations 0043, 0045
--
-- DÉCISION PRODUIT DU 2026-10-15
--
-- Le matériel se gère depuis l'écran de l'événement : une ligne par élément,
-- une case par épreuve de l'édition (ou toutes). Le modèle ne change pas —
-- chaque épreuve cochée porte son `race_fact` « Matériel » (0045), avec ses
-- versions, son retrait et son signal aux coureurs. Ce qui s'ajoute est le
-- geste : appliquer un élément à l'édition en une seule transaction.
--
--   épreuve cochée, sans l'élément        → ajout (version 1)
--   épreuve cochée, élément retiré        → restauration, puis correction si besoin
--   épreuve cochée, élément différent     → correction (version N+1)
--   épreuve cochée, élément identique     → rien
--   épreuve décochée, élément en place    → retrait (l'historique reste)
--
-- Chaque mouvement passe par la fonction qui le fait déjà (0043, 0045) :
-- autorité, preuve, journal et signal sont les leurs, sans copie.

begin;

/*
 * Applique un élément de matériel aux épreuves cochées d'une édition, et le
 * retire des autres. `p_create` vaut vrai pour un ajout depuis le formulaire
 * « Ajouter » : un élément déjà présent dans l'édition est alors refusé
 * (23505), pour ne pas modifier sans le savoir une ligne existante.
 *
 * Rend le nombre d'épreuves modifiées ; refuse (55000) si rien ne change.
 */
create or replace function public.set_edition_equipment(
  p_edition_id uuid,
  p_fact_key text,
  p_race_ids uuid[],
  p_label text,
  p_requirement text,
  p_condition text,
  p_detail text,
  p_trust_level public.trust_level,
  p_note text default null,
  p_create boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checked uuid[] := array(select distinct unnest(coalesce(p_race_ids, '{}'::uuid[])));
  v_value jsonb;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_race record;
  v_fact public.race_facts;
  v_current public.race_fact_versions;
  v_changes integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'geste refusé : aucun acte humain' using errcode = '42501';
  end if;

  if not exists (select 1 from public.editions e where e.id = p_edition_id) then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  -- Une case cochée hors de l'édition est une erreur de l'appelant, pas une
  -- épreuve à ignorer.
  if exists (
    select 1 from unnest(v_checked) as checked(race_id)
    where not exists (
      select 1 from public.races r where r.id = checked.race_id and r.edition_id = p_edition_id)
  ) then
    raise exception 'épreuve hors de l''édition' using errcode = '22023';
  end if;

  if p_create then
    if cardinality(v_checked) = 0 then
      raise exception 'aucune épreuve cochée' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.race_facts f
      join public.races r on r.id = f.race_id
      where r.edition_id = p_edition_id and f.fact_key = p_fact_key
    ) then
      raise exception 'ce matériel existe déjà dans l''édition' using errcode = '23505';
    end if;
  end if;

  -- La forme de la valeur est vérifiée une fois, avant tout mouvement.
  v_value := private.equipment_value(p_requirement, p_condition, p_detail);

  for v_race in
    select r.id from public.races r where r.edition_id = p_edition_id order by r.id
  loop
    select * into v_fact from public.race_facts f
    where f.race_id = v_race.id and f.fact_key = p_fact_key;

    if v_race.id = any (v_checked) then
      if v_fact.id is null then
        perform public.add_race_equipment(
          array[v_race.id], p_fact_key, v_label, p_requirement, p_condition, p_detail,
          p_trust_level, p_note);
        v_changes := v_changes + 1;
        continue;
      end if;

      if v_fact.category is distinct from 'equipment' then
        raise exception 'la clé % désigne une autre information', p_fact_key using errcode = '22023';
      end if;

      if v_fact.archived_at is not null then
        perform public.restore_race_fact(v_fact.id, p_note);
        v_changes := v_changes + 1;
      end if;

      select * into v_current from public.race_fact_versions v where v.id = v_fact.current_version_id;

      if v_current.id is null
         or v_current.value_text is distinct from v_label
         or v_current.value_json is distinct from v_value
         or v_current.trust_level is distinct from p_trust_level then
        perform public.revise_race_equipment(
          v_fact.id, v_label, p_requirement, p_condition, p_detail, p_trust_level, p_note);
        if v_fact.archived_at is null then
          v_changes := v_changes + 1;
        end if;
      end if;
    elsif v_fact.id is not null and v_fact.archived_at is null then
      perform public.retire_race_fact(v_fact.id, p_note);
      v_changes := v_changes + 1;
    end if;
  end loop;

  if v_changes = 0 then
    raise exception 'aucune modification' using errcode = '55000';
  end if;

  return v_changes;
end;
$$;

comment on function public.set_edition_equipment is
  'Applique un matériel aux épreuves cochées d''une édition et le retire des autres, en une transaction, par les gestes de 0043 et 0045 (autorité, preuve, journal, signal). Rien de changé : 55000.';

revoke all on function public.set_edition_equipment(uuid, text, uuid[], text, text, text, text, public.trust_level, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_edition_equipment(uuid, text, uuid[], text, text, text, text, public.trust_level, text, boolean)
  to authenticated;

commit;
