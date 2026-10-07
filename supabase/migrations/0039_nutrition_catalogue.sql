-- PLUKA V1 — Catalogue Nutrition : fiche complète, création, édition, import
-- File target: supabase/migrations/0039_nutrition_catalogue.sql
-- Référence : docs/02_DATA_MODEL.md §15.1 · docs/engines/NUTRITION_ENGINE.md
--             §166, §734, §765 · docs/06_DESIGN_SYSTEM.md §98 · migrations
--             0001, 0028, 0029 · décisions produit du 2026-10-07
--
-- POURQUOI
--
-- La Banque Nutrition (0001) ne portait que ce que le moteur lit : glucides,
-- sodium, caféine, hydratation, et des kcal facultatives. Le catalogue que
-- PLUKA administre décrit davantage un produit — c'est ce que le coureur lit
-- pour choisir. Cette migration ajoute ces champs, les gestes de création et
-- d'édition, et un import en masse.
--
-- CE QUE LE MOTEUR LIT NE CHANGE PAS
--
-- `NutritionProductSnapshot` ne consomme que glucides, sodium, caféine et
-- hydratation (§765). Tout le reste est descriptif. Une fiche modifiée ne
-- change pas une stratégie confirmée : la stratégie garde son snapshot (§734).
--
-- LES DÉCISIONS
--
-- - **Types** : les huit de 0001, plus `puree`, `capsule`, `electrolyte` —
--   le mélange de la base et du catalogue réel.
-- - **Tags** : une liste fermée de faits (`private.nutrition_tags_allowed`).
--   Aucune allégation : ni « naturel », ni « scientifique », ni « estomac
--   sensible ». Le moteur ne les lit pas.
-- - **Achat** : `purchase_url`, et `purchase_is_affiliate` pour que l'écran
--   dise « Lien affilié » quand c'est le cas (§98).
-- - **Valeurs absentes** : `null`, jamais un 0 inventé (AGENTS §38) — sauf
--   les quatre valeurs du moteur, `not null` depuis 0001.
-- - **Suppression** : refusée si un coureur a la fiche dans ses produits ou
--   si un ravitaillement la cite ; elle s'archive alors.
--
-- UNE SEULE ÉCRITURE
--
-- `private.save_nutrition_product` porte l'insertion et la mise à jour d'une
-- fiche. La création, l'édition et l'import l'appellent toutes : une règle de
-- fiche n'existe qu'une fois. Clé naturelle : marque + nom + saveur, sans
-- casse — un import rejoué met à jour, il ne duplique pas.

begin;

alter type public.nutrition_product_category add value if not exists 'puree';
alter type public.nutrition_product_category add value if not exists 'capsule';
alter type public.nutrition_product_category add value if not exists 'electrolyte';

create type public.nutrition_texture as enum ('gel', 'liquid', 'semi_liquid', 'solid', 'chewy');

/* Les tags admis — des faits, aucune allégation (décision du 2026-10-07). */
create or replace function private.nutrition_tags_allowed()
returns text[] language sql immutable set search_path = '' as $$
  select array['Caféiné', 'Riche en glucides', 'Riche en sodium', 'Salé', 'Isotonique', 'Hydrogel'];
$$;

alter table public.nutrition_products
  add column potassium_mg integer check (potassium_mg is null or potassium_mg >= 0),
  add column magnesium_mg integer check (magnesium_mg is null or magnesium_mg >= 0),
  add column protein_g numeric(7,2) check (protein_g is null or protein_g >= 0),
  add column fat_g numeric(7,2) check (fat_g is null or fat_g >= 0),
  add column fiber_g numeric(7,2) check (fiber_g is null or fiber_g >= 0),
  add column texture public.nutrition_texture,
  add column glucose_fructose_ratio text
    check (glucose_fructose_ratio is null or glucose_fructose_ratio ~ '^[0-9]+([.,][0-9]+)?:[0-9]+([.,][0-9]+)?$'),
  add column is_vegan boolean,
  add column is_organic boolean,
  add column is_gluten_free boolean,
  add column tags text[] not null default '{}'
    check (tags <@ private.nutrition_tags_allowed()),
  add column image_url text check (image_url is null or image_url ~ '^https://'),
  add column purchase_url text check (purchase_url is null or purchase_url ~ '^https://'),
  add column purchase_is_affiliate boolean not null default false,
  add constraint nutrition_products_serving_quantity_positive
    check (serving_quantity is null or serving_quantity > 0);

create unique index ux_nutrition_products_natural_key
  on public.nutrition_products (lower(coalesce(brand, '')), lower(name), lower(coalesce(variant, '')));

-- ============================================================
-- 1. L'écriture unique
-- ============================================================

/*
 * Insère (`p_product_id` nul) ou met à jour une fiche à partir d'un objet
 * JSON dont les clés sont les colonnes. Les contraintes de la table tranchent
 * les valeurs ; le domaine les a validées en amont. Rend l'identifiant et si
 * la fiche est nouvelle.
 *
 * Une fiche passée `validated` reçoit `verified_at` ; repassée en brouillon
 * ou archivée, elle le garde — c'est la date de sa dernière vérification.
 */
create or replace function private.save_nutrition_product(p_product_id uuid, p jsonb)
returns table (product_id uuid, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_product_id;
  v_created boolean := false;
  v_status public.nutrition_product_status :=
    coalesce((p ->> 'status')::public.nutrition_product_status, 'draft');
begin
  if v_id is null then
    insert into public.nutrition_products (
      category, brand, name, variant, serving_quantity, serving_unit,
      carbs_g, sodium_mg, caffeine_mg, hydration_ml, calories_kcal,
      potassium_mg, magnesium_mg, protein_g, fat_g, fiber_g,
      texture, glucose_fructose_ratio, is_vegan, is_organic, is_gluten_free,
      tags, image_url, purchase_url, purchase_is_affiliate, source_url,
      status, verified_at
    ) values (
      (p ->> 'category')::public.nutrition_product_category,
      p ->> 'brand', p ->> 'name', p ->> 'variant',
      (p ->> 'serving_quantity')::numeric, p ->> 'serving_unit',
      (p ->> 'carbs_g')::numeric, (p ->> 'sodium_mg')::integer,
      (p ->> 'caffeine_mg')::integer, coalesce((p ->> 'hydration_ml')::integer, 0),
      (p ->> 'calories_kcal')::integer,
      (p ->> 'potassium_mg')::integer, (p ->> 'magnesium_mg')::integer,
      (p ->> 'protein_g')::numeric, (p ->> 'fat_g')::numeric, (p ->> 'fiber_g')::numeric,
      (p ->> 'texture')::public.nutrition_texture, p ->> 'glucose_fructose_ratio',
      (p ->> 'is_vegan')::boolean, (p ->> 'is_organic')::boolean, (p ->> 'is_gluten_free')::boolean,
      coalesce(array(select jsonb_array_elements_text(p -> 'tags')), '{}'),
      p ->> 'image_url', p ->> 'purchase_url',
      coalesce((p ->> 'purchase_is_affiliate')::boolean, false), p ->> 'source_url',
      v_status, case when v_status = 'validated' then now() end
    )
    returning id into v_id;
    v_created := true;
  else
    update public.nutrition_products set
      category = (p ->> 'category')::public.nutrition_product_category,
      brand = p ->> 'brand',
      name = p ->> 'name',
      variant = p ->> 'variant',
      serving_quantity = (p ->> 'serving_quantity')::numeric,
      serving_unit = p ->> 'serving_unit',
      carbs_g = (p ->> 'carbs_g')::numeric,
      sodium_mg = (p ->> 'sodium_mg')::integer,
      caffeine_mg = (p ->> 'caffeine_mg')::integer,
      hydration_ml = coalesce((p ->> 'hydration_ml')::integer, hydration_ml),
      calories_kcal = (p ->> 'calories_kcal')::integer,
      potassium_mg = (p ->> 'potassium_mg')::integer,
      magnesium_mg = (p ->> 'magnesium_mg')::integer,
      protein_g = (p ->> 'protein_g')::numeric,
      fat_g = (p ->> 'fat_g')::numeric,
      fiber_g = (p ->> 'fiber_g')::numeric,
      texture = (p ->> 'texture')::public.nutrition_texture,
      glucose_fructose_ratio = p ->> 'glucose_fructose_ratio',
      is_vegan = (p ->> 'is_vegan')::boolean,
      is_organic = (p ->> 'is_organic')::boolean,
      is_gluten_free = (p ->> 'is_gluten_free')::boolean,
      tags = coalesce(array(select jsonb_array_elements_text(p -> 'tags')), '{}'),
      image_url = p ->> 'image_url',
      purchase_url = p ->> 'purchase_url',
      purchase_is_affiliate = coalesce((p ->> 'purchase_is_affiliate')::boolean, false),
      source_url = p ->> 'source_url',
      status = v_status,
      verified_at = case when v_status = 'validated' then now() else verified_at end
    where id = v_id;

    if not found then
      raise exception 'fiche introuvable' using errcode = 'P0002';
    end if;
  end if;

  return query select v_id, v_created;
end;
$$;

revoke all on function private.save_nutrition_product(uuid, jsonb) from public, anon, authenticated;

-- ============================================================
-- 2. Gestes de console
-- ============================================================

/* Créer ou modifier une fiche. Un doublon de clé naturelle remonte en `23505`. */
create or replace function public.admin_save_nutrition_product(p_product_id uuid, p_product jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_created boolean;
begin
  perform private.assert_pluka_admin('admin_save_nutrition_product');

  select s.product_id, s.created into v_id, v_created
  from private.save_nutrition_product(p_product_id, p_product) s;

  perform private.record_audit(
    case when v_created then 'nutrition_product.create' else 'nutrition_product.update' end,
    'nutrition_products', v_id,
    jsonb_build_object('status', p_product ->> 'status')
  );

  return v_id;
end;
$$;

/*
 * Import en masse : un tableau de fiches. Chaque fiche est rapprochée par sa
 * clé naturelle — trouvée, elle est mise à jour ; absente, créée. Tout ou
 * rien : une fiche refusée par une contrainte annule l'import entier, et le
 * domaine a déjà écarté les lignes invalides avec leur raison.
 */
create or replace function public.admin_import_nutrition_products(p_products jsonb)
returns table (created_count integer, updated_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_product jsonb;
  v_existing uuid;
  v_created integer := 0;
  v_updated integer := 0;
begin
  perform private.assert_pluka_admin('admin_import_nutrition_products');

  if jsonb_typeof(p_products) <> 'array' then
    raise exception 'un tableau de fiches est attendu' using errcode = '22023';
  end if;

  for v_product in select value from jsonb_array_elements(p_products) loop
    select n.id into v_existing
    from public.nutrition_products n
    where lower(coalesce(n.brand, '')) = lower(coalesce(v_product ->> 'brand', ''))
      and lower(n.name) = lower(v_product ->> 'name')
      and lower(coalesce(n.variant, '')) = lower(coalesce(v_product ->> 'variant', ''))
    for update;

    perform private.save_nutrition_product(v_existing, v_product);

    if v_existing is null then
      v_created := v_created + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform private.record_audit(
    'nutrition_product.import', 'nutrition_products', null,
    jsonb_build_object('created', v_created, 'updated', v_updated)
  );

  return query select v_created, v_updated;
end;
$$;

/*
 * Supprimer une fiche — seulement si rien ne la cite. Un coureur qui l'a dans
 * ses produits, ou un ravitaillement qui la nomme, perdrait sa référence : la
 * fiche s'archive alors (0029).
 */
create or replace function public.admin_delete_nutrition_product(p_product_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  perform private.assert_pluka_admin('admin_delete_nutrition_product');

  select n.name into v_name from public.nutrition_products n where n.id = p_product_id for update;

  if not found then
    raise exception 'fiche introuvable' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.user_nutrition_products where nutrition_product_id = p_product_id)
     or exists (select 1 from public.race_aid_station_items where nutrition_product_id = p_product_id) then
    raise exception 'fiche utilisee par des coureurs ou un ravitaillement' using errcode = '55000';
  end if;

  delete from public.nutrition_products where id = p_product_id;

  perform private.record_audit('nutrition_product.delete', 'nutrition_products', p_product_id, '{}'::jsonb);
end;
$$;

-- ============================================================
-- 3. Lectures de console
-- ============================================================

-- Le type de retour change : la fonction de 0028 est remplacée.
drop function if exists public.admin_list_nutrition_products(public.nutrition_product_status, integer);

create or replace function public.admin_list_nutrition_products(
  p_status public.nutrition_product_status default null,
  p_limit integer default 200,
  p_query text default null
)
returns table (
  product_id uuid,
  brand text,
  name text,
  variant text,
  category public.nutrition_product_category,
  status public.nutrition_product_status,
  serving_quantity numeric,
  serving_unit text,
  carbs_g numeric,
  sodium_mg integer,
  caffeine_mg integer,
  hydration_ml integer,
  calories_kcal integer,
  tags text[],
  image_url text,
  purchase_url text,
  purchase_is_affiliate boolean,
  source_url text,
  in_use boolean,
  verified_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform private.assert_pluka_admin('admin_list_nutrition_products');

  return query select
    p.id, p.brand, p.name, p.variant, p.category, p.status,
    p.serving_quantity, p.serving_unit,
    p.carbs_g, p.sodium_mg, p.caffeine_mg, p.hydration_ml, p.calories_kcal,
    p.tags, p.image_url, p.purchase_url, p.purchase_is_affiliate, p.source_url,
    exists (select 1 from public.user_nutrition_products u where u.nutrition_product_id = p.id)
      or exists (select 1 from public.race_aid_station_items a where a.nutrition_product_id = p.id),
    p.verified_at, p.updated_at
  from public.nutrition_products p
  where (p_status is null or p.status = p_status)
    and (
      v_query is null
      or p.name ilike '%' || v_query || '%'
      or p.brand ilike '%' || v_query || '%'
      or p.variant ilike '%' || v_query || '%'
      or p.category::text ilike '%' || v_query || '%'
    )
  order by p.brand nulls last, p.name, p.variant nulls first
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

/* Compteurs des onglets — un par statut. */
create or replace function public.admin_count_nutrition_products()
returns table (status public.nutrition_product_status, total bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_count_nutrition_products');

  return query select p.status, count(*) from public.nutrition_products p group by p.status;
end;
$$;

/* La fiche complète, pour l'édition. */
create or replace function public.admin_get_nutrition_product(p_product_id uuid)
returns setof public.nutrition_products
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_get_nutrition_product');

  return query select * from public.nutrition_products n where n.id = p_product_id;
end;
$$;

-- ============================================================
-- 4. Droits d'exécution
-- ============================================================

revoke all on function public.admin_save_nutrition_product(uuid, jsonb) from public, anon;
revoke all on function public.admin_import_nutrition_products(jsonb) from public, anon;
revoke all on function public.admin_delete_nutrition_product(uuid) from public, anon;
revoke all on function public.admin_list_nutrition_products(public.nutrition_product_status, integer, text) from public, anon;
revoke all on function public.admin_count_nutrition_products() from public, anon;
revoke all on function public.admin_get_nutrition_product(uuid) from public, anon;

grant execute on function public.admin_save_nutrition_product(uuid, jsonb) to authenticated;
grant execute on function public.admin_import_nutrition_products(jsonb) to authenticated;
grant execute on function public.admin_delete_nutrition_product(uuid) to authenticated;
grant execute on function public.admin_list_nutrition_products(public.nutrition_product_status, integer, text) to authenticated;
grant execute on function public.admin_count_nutrition_products() to authenticated;
grant execute on function public.admin_get_nutrition_product(uuid) to authenticated;

commit;
