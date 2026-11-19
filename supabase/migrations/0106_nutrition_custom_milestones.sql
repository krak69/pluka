-- ============================================================
-- 0106 — Nutrition : produits d'une prise choisis par le coureur
-- ============================================================
--
-- NUTRITION_ENGINE §57, §58 (« Modifier produits : affectations
-- personnalisées protégées »), §60 (stable keys). Retour du 2026-11-19 : le
-- coureur doit pouvoir changer le produit proposé à une prise.
--
-- Les prises automatiques restent calculées à la lecture depuis le Plan
-- actif (0102). Seules les prises que le coureur a modifiées s'enregistrent,
-- dans les tables prévues dès 0001/0003 : `nutrition_waypoints` (repérée par
-- sa `stable_key`, `is_customized`) et `nutrition_waypoint_items`.
--
-- Origine `generated_checkpoint`, même pour un ravitaillement : sa clé stable
-- (`aid:<point>`) le désigne déjà, et un lien `plan_waypoint` casserait
-- `nutrition_waypoints_origin_link_check` quand une version du Plan disparaît.
--
-- Les valeurs nutritionnelles sont recopiées par la fonction depuis « Mes
-- produits », jamais reçues du navigateur. `generic_label` garde le nom : si
-- le produit est supprimé de « Mes produits », la ligne reste valide.

create or replace function public.set_nutrition_milestone_items(
  p_participant_race_id uuid,
  p_stable_key text,
  p_label text,
  p_elapsed_seconds integer,
  p_distance_km numeric,
  p_user_product_ids uuid[],
  p_quantities integer[]
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_plan uuid;
  v_waypoint uuid;
  v_ids uuid[] := coalesce(p_user_product_ids, '{}'::uuid[]);
  v_quantities integer[] := coalesce(p_quantities, '{}'::integer[]);
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  if p_stable_key is null or p_stable_key !~ '^(intake|aid):[A-Za-z0-9:-]{1,120}$' then
    raise exception 'jalon invalide' using errcode = '22023';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 120
     or p_elapsed_seconds is null or p_elapsed_seconds < 0
     or (p_distance_km is not null and p_distance_km < 0) then
    raise exception 'jalon invalide' using errcode = '22023';
  end if;
  if cardinality(v_ids) <> cardinality(v_quantities) or cardinality(v_ids) > 6
     or exists (select 1 from unnest(v_quantities) q where q is null or q not between 1 and 5)
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'produits invalides' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as wanted(id)
    where not exists (
      select 1 from public.user_nutrition_products u
      where u.id = wanted.id and u.user_id = v_user
    )
  ) then
    raise exception 'produit introuvable' using errcode = '42501';
  end if;

  select n.id into v_plan
  from public.nutrition_plans n
  join public.race_plans rp on rp.id = n.race_plan_id
  where rp.participant_race_id = p_participant_race_id and rp.status = 'active';
  if v_plan is null then
    raise exception 'aucune stratégie Nutrition sur le Plan actif' using errcode = 'P0002';
  end if;

  insert into public.nutrition_waypoints
    (nutrition_plan_id, label, elapsed_seconds, distance_km, sort_order, origin,
     stable_key, is_customized)
  values
    (v_plan, btrim(p_label), p_elapsed_seconds, p_distance_km,
     (select coalesce(max(sort_order), 0) + 1 from public.nutrition_waypoints
      where nutrition_plan_id = v_plan),
     'generated_checkpoint', p_stable_key, true)
  on conflict (nutrition_plan_id, stable_key) do update
    set label = excluded.label,
        elapsed_seconds = excluded.elapsed_seconds,
        distance_km = excluded.distance_km,
        is_customized = true
  returning id into v_waypoint;

  delete from public.nutrition_waypoint_items where nutrition_waypoint_id = v_waypoint;

  insert into public.nutrition_waypoint_items
    (nutrition_waypoint_id, user_nutrition_product_id, generic_label, action, quantity,
     carbs_g, sodium_mg, caffeine_mg, hydration_ml, product_label_snapshot, is_customized)
  select
    v_waypoint, u.id,
    left(coalesce(nullif(concat_ws(' ', coalesce(p.brand, u.custom_brand),
                                   coalesce(p.name || coalesce(' ' || p.variant, ''), u.custom_name)), ''),
                  'Produit'), 160),
    'consume', wanted.quantity,
    coalesce(u.custom_carbs_g, p.carbs_g, 0),
    coalesce(u.custom_sodium_mg, p.sodium_mg, 0),
    coalesce(u.custom_caffeine_mg, p.caffeine_mg, 0),
    coalesce(u.custom_hydration_ml, p.hydration_ml, 0),
    left(coalesce(p.name, u.custom_name), 160),
    true
  from unnest(v_ids, v_quantities) with ordinality as wanted(id, quantity, position)
  join public.user_nutrition_products u on u.id = wanted.id and u.user_id = v_user
  left join public.nutrition_products p on p.id = u.nutrition_product_id
  order by wanted.position;

  update public.nutrition_plans set updated_at = now() where id = v_plan;
end;
$$;

revoke all on function public.set_nutrition_milestone_items(uuid, text, text, integer, numeric, uuid[], integer[])
  from public, anon;
grant execute on function public.set_nutrition_milestone_items(uuid, text, text, integer, numeric, uuid[], integer[])
  to authenticated;

/* Rend une prise au moteur : la proposition PLUKA revient. */
create or replace function public.reset_nutrition_milestone(
  p_participant_race_id uuid,
  p_stable_key text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  delete from public.nutrition_waypoints w
  using public.nutrition_plans n, public.race_plans rp
  where w.nutrition_plan_id = n.id
    and n.race_plan_id = rp.id
    and rp.participant_race_id = p_participant_race_id
    and rp.status = 'active'
    and w.stable_key = p_stable_key;
end;
$$;

revoke all on function public.reset_nutrition_milestone(uuid, text) from public, anon;
grant execute on function public.reset_nutrition_milestone(uuid, text) to authenticated;
