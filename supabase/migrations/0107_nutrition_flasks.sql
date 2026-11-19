-- ============================================================
-- 0107 — Nutrition : contenants portés et points de remplissage
-- ============================================================
--
-- NUTRITION_ENGINE §33, §34 (consommer / remplir / emporter) ; décisions du
-- 2026-11-19 : le coureur déclare ses contenants dans la modale Nutrition
-- (réglés par stratégie), et peut dire qu'il ne remplit pas à un ravitaillement.
-- Le plan de flasques lui-même se recalcule à la lecture, comme les prises.

alter table public.nutrition_plans
  add column flask_count smallint not null default 2
    constraint nutrition_plans_flask_count check (flask_count between 0 and 4),
  add column flask_capacity_ml integer not null default 500
    constraint nutrition_plans_flask_capacity check (flask_capacity_ml between 150 and 1000),
  add column bladder_ml integer
    constraint nutrition_plans_bladder check (bladder_ml is null or bladder_ml between 500 and 3000),
  add column no_refill_waypoint_ids uuid[] not null default '{}'
    constraint nutrition_plans_no_refill_size check (cardinality(no_refill_waypoint_ids) <= 100);

comment on column public.nutrition_plans.flask_count is
  'Flasques portées (0107) ; 2 × 500 ml par défaut, comme le prototype.';
comment on column public.nutrition_plans.bladder_ml is
  'Poche à eau portée, en ml ; nulle sans poche (0107).';
comment on column public.nutrition_plans.no_refill_waypoint_ids is
  'Ravitaillements de la course où le coureur ne remplit pas ses flasques (0107).';

/* Les contenants de la stratégie du Plan actif. */
create or replace function public.set_nutrition_containers(
  p_participant_race_id uuid,
  p_flask_count integer,
  p_flask_capacity_ml integer,
  p_bladder_ml integer
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  update public.nutrition_plans n
  set flask_count = p_flask_count,
      flask_capacity_ml = p_flask_capacity_ml,
      bladder_ml = p_bladder_ml,
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

revoke all on function public.set_nutrition_containers(uuid, integer, integer, integer)
  from public, anon;
grant execute on function public.set_nutrition_containers(uuid, integer, integer, integer)
  to authenticated;

/*
 * « Je remplis ici » / « je ne remplis pas ici », pour un point de la course
 * du coureur. Un point d'une autre course est refusé.
 */
create or replace function public.set_nutrition_refill_point(
  p_participant_race_id uuid,
  p_race_waypoint_id uuid,
  p_refill boolean
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
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
  set no_refill_waypoint_ids = case
        when coalesce(p_refill, true)
          then array_remove(n.no_refill_waypoint_ids, p_race_waypoint_id)
        else array_append(array_remove(n.no_refill_waypoint_ids, p_race_waypoint_id),
                          p_race_waypoint_id)
      end,
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

revoke all on function public.set_nutrition_refill_point(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_nutrition_refill_point(uuid, uuid, boolean) to authenticated;
