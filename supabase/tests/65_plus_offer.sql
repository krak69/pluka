-- PLUKA — L'offre PLUKA+ sur l'écran de choix
-- Référence : migration 0090 · docs/00_PRODUCT_SPEC.md §6.3 · docs/04_ENTITLEMENTS.md §72
--
-- 1. Le prix vient du catalogue ; un produit inactif ne donne pas de prix.
-- 2. « Actif » ne parle que du coureur de la session.
-- 3. Un visiteur sans session n'y a pas accès.

begin;

create extension if not exists pgtap;

select plan(7);

\ir _personas.psql

-- ============================================================
-- 1. Le prix vient du catalogue
-- ============================================================

select amount_minor as plus_price from public.billing_products where product_key = 'plus_annual' \gset

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select amount_minor from public.get_plus_offer()),
  :plus_price,
  'le prix de PLUKA+ est celui du catalogue'
);
select is((select currency from public.get_plus_offer()), 'EUR', 'la devise suit le catalogue');
reset role;

update public.billing_products set active = false where product_key = 'plus_annual';
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select amount_minor from public.get_plus_offer()),
  null,
  'un produit inactif ne donne pas de prix'
);
reset role;
update public.billing_products set active = true where product_key = 'plus_annual';

-- ============================================================
-- 2. « Actif » ne parle que du coureur de la session
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is((select active from public.get_plus_offer()), false, 'sans PLUKA+, rien n''est actif');
reset role;

insert into public.entitlements (user_id, kind, scope_type, source, status, starts_at)
values ('22222222-2222-4222-8222-222222222222', 'plus', 'global', 'checkout', 'active', now());

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select active from public.get_plus_offer()),
  false,
  'le PLUKA+ d''un autre coureur ne compte pas'
);
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select active from public.get_plus_offer()), true, 'son propre PLUKA+ est actif');
reset role;

-- ============================================================
-- 3. Sans session
-- ============================================================

select pg_temp.act_as_anon();
select throws_ok(
  $$ select * from public.get_plus_offer() $$,
  '42501',
  null,
  'un visiteur sans session ne lit pas l''offre'
);
reset role;

select * from finish();
rollback;
