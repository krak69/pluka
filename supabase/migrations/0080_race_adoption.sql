-- PLUKA V1 — Ligne d'adoption de l'organisation
-- File target: supabase/migrations/0080_race_adoption.sql
-- Référence : docs/00_PRODUCT_SPEC.md §26.2, §36 · docs/03_PRIVACY_RLS.md §67,
--             §70 · AGENTS §19, §20
--
-- DÉCISIONS DU 2026-11-10
--
-- - Compté à la lecture, par épreuve : toujours à jour. La table
--   `organization_adoption_snapshots` reste pour une courbe, plus tard.
-- - Inscrits, invités et activés sont toujours rendus : l'organisation les
--   voit déjà ligne par ligne dans Participants.
-- - Plans, Nutrition et Assistance comptent des gestes privés. Sous 10 activés
--   sur l'épreuve, ils sortent nuls (§70) : sur une petite épreuve, un « 1 »
--   dirait qui a préparé quoi. La base applique le seuil ; l'écran ne fait que
--   le dire.
--
-- Ce qui est compté, par participation activée et non retirée : au moins un
-- Plan ; au moins une Nutrition sur un de ses Plans ; au moins un assistant.
-- Jamais lequel, jamais son contenu (AGENTS §19).

begin;

create function public.org_race_adoption(p_edition_id uuid)
returns table (
  race_id uuid,
  registered integer,
  invited integer,
  activated integer,
  with_plan integer,
  with_nutrition integer,
  with_assistance integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.user_can_manage_edition(p_edition_id, 'viewer') or private.is_pluka_admin()) then
    raise exception 'lecture réservée à l''organisation' using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      r.id as race_id,
      pr.id as participant_race_id,
      pr.user_id is not null as activated,
      exists (
        select 1 from public.participant_invitations i where i.participant_race_id = pr.id
      ) as invited,
      pr.user_id is not null and exists (
        select 1 from public.race_plans p where p.participant_race_id = pr.id
      ) as with_plan,
      pr.user_id is not null and exists (
        select 1 from public.race_plans p
        join public.nutrition_plans n on n.race_plan_id = p.id
        where p.participant_race_id = pr.id
      ) as with_nutrition,
      pr.user_id is not null and exists (
        select 1 from public.race_assistants a where a.participant_race_id = pr.id
      ) as with_assistance
    from public.races r
    left join public.participant_races pr
      on pr.race_id = r.id and pr.status <> 'archived'
    where r.edition_id = p_edition_id
  ),
  counts as (
    select
      rows.race_id,
      count(rows.participant_race_id)::integer as registered,
      count(*) filter (where rows.invited)::integer as invited,
      count(*) filter (where rows.activated)::integer as activated,
      count(*) filter (where rows.with_plan)::integer as with_plan,
      count(*) filter (where rows.with_nutrition)::integer as with_nutrition,
      count(*) filter (where rows.with_assistance)::integer as with_assistance
    from rows
    group by rows.race_id
  )
  select
    c.race_id,
    c.registered,
    c.invited,
    c.activated,
    -- §70 : sous 10 activés, aucun chiffre de préparation.
    case when c.activated >= 10 then c.with_plan end,
    case when c.activated >= 10 then c.with_nutrition end,
    case when c.activated >= 10 then c.with_assistance end
  from counts c;
end;
$$;

revoke all on function public.org_race_adoption(uuid) from public, anon;
grant execute on function public.org_race_adoption(uuid) to authenticated;

comment on function public.org_race_adoption(uuid) is
  'Adoption par épreuve (§36) : inscrits, invités, activés ; Plans, Nutrition et Assistance nuls sous 10 activés (§70). 0080.';

commit;
