-- ============================================================
-- 0104 — Nutrition : « Mes produits » et les produits d'une stratégie
-- ============================================================
--
-- NUTRITION_ENGINE §26, §27 ; prototype `nutStepProducts` ; décisions du
-- 2026-11-17 (pas de stock : « Mes produits » est la liste des produits que
-- le coureur utilise, sans quantités — §3 exclut le stock domestique).
--
-- 1. Un produit personnel (`custom_*`, 0001) gagne un type, pour être rangé
--    et réparti comme un produit du catalogue (gel, boisson, capsule…).
-- 2. Une stratégie retient les produits choisis pour elle (§27 : le moteur ne
--    pioche jamais ailleurs). Écriture par fonction, qui vérifie que chaque
--    produit appartient au coureur.

alter table public.user_nutrition_products
  add column custom_category public.nutrition_product_category,
  add constraint user_nutrition_products_custom_category
    check (nutrition_product_id is not null or custom_category is not null),
  add constraint user_nutrition_products_custom_name_length
    check (custom_name is null or char_length(btrim(custom_name)) between 1 and 80),
  add constraint user_nutrition_products_custom_brand_length
    check (custom_brand is null or char_length(btrim(custom_brand)) between 1 and 60);

comment on column public.user_nutrition_products.custom_category is
  'Type d''un produit personnel (0104) ; un produit du catalogue garde le sien.';

alter table public.nutrition_plans
  add column selected_user_product_ids uuid[] not null default '{}';

comment on column public.nutrition_plans.selected_user_product_ids is
  'Produits de « Mes produits » choisis pour cette stratégie (NUTRITION_ENGINE §27, 0104).';

/*
 * Retient les produits choisis pour la stratégie du Plan actif. Chaque produit
 * doit appartenir au coureur ; sinon rien n'est écrit.
 */
create or replace function public.set_nutrition_products(
  p_participant_race_id uuid,
  p_user_product_ids uuid[]
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_user_product_ids, '{}'::uuid[])) as wanted(id)
    where not exists (
      select 1 from public.user_nutrition_products u
      where u.id = wanted.id and u.user_id = v_user
    )
  ) then
    raise exception 'produit introuvable' using errcode = '42501';
  end if;

  update public.nutrition_plans n
  set selected_user_product_ids = coalesce(p_user_product_ids, '{}'::uuid[]),
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

revoke all on function public.set_nutrition_products(uuid, uuid[]) from public, anon;
grant execute on function public.set_nutrition_products(uuid, uuid[]) to authenticated;
