-- ============================================================
-- 0108 — Nutrition : « À préparer pour cette course »
-- ============================================================
--
-- NUTRITION_ENGINE §49 à §56 ; décisions du 2026-11-19 :
--
-- - la réserve se règle : aucune, +10 %, +20 % ou un pourcentage libre. Elle
--   s'ajoute à ce que le coureur prépare, jamais à ce qu'il consomme, et part
--   avec lui. La colonne existe depuis 0001 (`reserve_percent`, 0 à 100) ;
-- - ce qui sert après un ravitaillement vient de ce point : l'Assistance s'il y
--   a un rendez-vous, le drop bag s'il y en a un, sinon c'est porté depuis le
--   départ. Le coureur peut choisir point par point ; sans choix, c'est
--   automatique. Un point figure dans une seule de ces listes.
--
-- La répartition elle-même se calcule à la lecture, comme les prises et les
-- flasques. Ces colonnes sont sur `nutrition_plans` : l'export des données du
-- compte (0099) les reprend tel quel.

alter table public.nutrition_plans
  add column supply_start_waypoint_ids uuid[] not null default '{}',
  add column supply_bag_waypoint_ids uuid[] not null default '{}',
  add column supply_assistance_waypoint_ids uuid[] not null default '{}',
  add constraint nutrition_plans_supply_size check (
    cardinality(supply_start_waypoint_ids) <= 100
    and cardinality(supply_bag_waypoint_ids) <= 100
    and cardinality(supply_assistance_waypoint_ids) <= 100
  ),
  add constraint nutrition_plans_supply_disjoint check (
    not (supply_start_waypoint_ids && supply_bag_waypoint_ids)
    and not (supply_start_waypoint_ids && supply_assistance_waypoint_ids)
    and not (supply_bag_waypoint_ids && supply_assistance_waypoint_ids)
  );

comment on column public.nutrition_plans.supply_start_waypoint_ids is
  'Ravitaillements dont les produits partent avec le coureur dès le départ, par choix (0108).';
comment on column public.nutrition_plans.supply_bag_waypoint_ids is
  'Ravitaillements dont les produits viennent du drop bag, par choix (0108).';
comment on column public.nutrition_plans.supply_assistance_waypoint_ids is
  'Ravitaillements dont les produits viennent de l''Assistance, par choix (0108).';

/* La réserve de la stratégie du Plan actif ; la contrainte de 0001 la borne. */
create or replace function public.set_nutrition_reserve(
  p_participant_race_id uuid,
  p_reserve_percent numeric
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  update public.nutrition_plans n
  set reserve_percent = p_reserve_percent,
      updated_at = now()
  from public.race_plans rp
  where n.race_plan_id = rp.id
    and rp.participant_race_id = p_participant_race_id
    and rp.status = 'active';

  if not found then
    raise exception 'aucune stratégie Nutrition sur le Plan actif' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_nutrition_reserve(uuid, numeric) from public, anon;
grant execute on function public.set_nutrition_reserve(uuid, numeric) to authenticated;

/*
 * D'où viennent les produits après un ravitaillement de la course du coureur :
 * `start`, `bag` ou `assistance` ; nul, retour au choix automatique. Un point
 * d'une autre course est refusé.
 */
create or replace function public.set_nutrition_supply_point(
  p_participant_race_id uuid,
  p_race_waypoint_id uuid,
  p_source text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  if p_source is not null and p_source not in ('start', 'bag', 'assistance') then
    raise exception 'source inconnue : %', p_source using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.race_waypoints w
    join public.participant_races pr on pr.race_id = w.race_id
    where w.id = p_race_waypoint_id and pr.id = p_participant_race_id
  ) then
    raise exception 'point introuvable' using errcode = '42501';
  end if;

  update public.nutrition_plans n
  set supply_start_waypoint_ids =
        array_remove(n.supply_start_waypoint_ids, p_race_waypoint_id)
        || case when p_source = 'start' then array[p_race_waypoint_id] else '{}'::uuid[] end,
      supply_bag_waypoint_ids =
        array_remove(n.supply_bag_waypoint_ids, p_race_waypoint_id)
        || case when p_source = 'bag' then array[p_race_waypoint_id] else '{}'::uuid[] end,
      supply_assistance_waypoint_ids =
        array_remove(n.supply_assistance_waypoint_ids, p_race_waypoint_id)
        || case when p_source = 'assistance' then array[p_race_waypoint_id] else '{}'::uuid[] end,
      updated_at = now()
  from public.race_plans rp
  where n.race_plan_id = rp.id
    and rp.participant_race_id = p_participant_race_id
    and rp.status = 'active';

  if not found then
    raise exception 'aucune stratégie Nutrition sur le Plan actif' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_nutrition_supply_point(uuid, uuid, text) from public, anon;
grant execute on function public.set_nutrition_supply_point(uuid, uuid, text) to authenticated;
