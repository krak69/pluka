-- PLUKA — Catalogue Nutrition : fiche complète, création, édition, import, suppression
-- Référence : docs/02_DATA_MODEL.md §15.1 · NUTRITION_ENGINE §734 · migration 0039
--
-- 1. Seule l'administration qui écrit gère le catalogue ; Support et coureurs
--    sont refusés.
-- 2. Les contraintes portent les décisions : tags de faits seulement, liens
--    https, valeurs non négatives, pas de doublon de clé naturelle.
-- 3. L'import est idempotent : rejoué, il met à jour sans dupliquer.
-- 4. Une fiche citée par un coureur ne se supprime pas : elle s'archive.

begin;

create extension if not exists pgtap;

select plan(20);

\ir _personas.psql

delete from private.audit_logs;
delete from public.user_nutrition_products;
delete from public.race_aid_station_items;
delete from public.nutrition_products;

update public.users set platform_role = 'pluka_admin', staff_role = 'support'
where id = '99999999-9999-4999-8999-999999999999';

-- ============================================================
-- 1. Qui gère
-- ============================================================

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select throws_ok(
  $$ select public.admin_save_nutrition_product(null, '{"category":"gel","name":"X","carbs_g":20,"sodium_mg":0,"caffeine_mg":0}') $$,
  '42501', null, 'NUTC-01 — support : creer une fiche est refuse');
select throws_ok(
  $$ select * from public.admin_list_nutrition_products() $$,
  '42501', null, 'NUTC-02 — support : la Banque reste hors de sa liste de lectures');
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.admin_import_nutrition_products('[]') $$,
  '42501', null, 'NUTC-03 — coureur : importer est refuse');
reset role;

-- ============================================================
-- 2. Créer, modifier, contraintes
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ select public.admin_save_nutrition_product(null, '{
       "category":"chew","brand":"Ta Energy","name":"Gomme énergétique","variant":"Tropical",
       "serving_quantity":30,"serving_unit":"g","calories_kcal":101,"carbs_g":25,"sodium_mg":114,
       "potassium_mg":55,"caffeine_mg":100,"protein_g":0.1,"fat_g":0.1,"fiber_g":0.33,
       "texture":"chewy","is_vegan":true,"is_organic":false,"is_gluten_free":true,
       "tags":["Caféiné","Riche en glucides"],
       "image_url":"https://exemple.test/gomme.png","purchase_url":"https://exemple.test/acheter",
       "purchase_is_affiliate":true,"status":"validated"}') $$,
  'NUTC-04 — admin : creer une fiche complete, validee');

reset role;

select results_eq(
  $$ select category::text, magnesium_mg is null, tags, purchase_is_affiliate, verified_at is not null, hydration_ml
     from public.nutrition_products where name = 'Gomme énergétique' $$,
  $$ values ('chew'::text, true, array['Caféiné','Riche en glucides']::text[], true, true, 0) $$,
  'NUTC-05 — valeurs posees, absente restee nulle, tags, affiliation, date de verification'
);

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select throws_ok(
  $$ select public.admin_save_nutrition_product(null, '{"category":"gel","brand":"TA ENERGY","name":"gomme énergétique","variant":"tropical","carbs_g":1,"sodium_mg":0,"caffeine_mg":0}') $$,
  '23505', null, 'NUTC-06 — meme marque, nom et saveur, sans casse : doublon refuse');

select throws_ok(
  $$ select public.admin_save_nutrition_product(null, '{"category":"gel","name":"Gel scientifique","carbs_g":20,"sodium_mg":0,"caffeine_mg":0,"tags":["Scientifique"]}') $$,
  '23514', null, 'NUTC-07 — un tag hors de la liste de faits est refuse');

select throws_ok(
  $$ select public.admin_save_nutrition_product(null, '{"category":"gel","name":"Gel http","carbs_g":20,"sodium_mg":0,"caffeine_mg":0,"image_url":"http://exemple.test/x.png"}') $$,
  '23514', null, 'NUTC-08 — une image hors https est refusee');

select throws_ok(
  $$ select public.admin_save_nutrition_product(null, '{"category":"gel","name":"Gel negatif","carbs_g":-1,"sodium_mg":0,"caffeine_mg":0}') $$,
  '23514', null, 'NUTC-09 — une valeur negative est refusee');

select lives_ok(
  $$ select public.admin_save_nutrition_product(
       (select id from public.nutrition_products where name = 'Gomme énergétique'),
       '{"category":"chew","brand":"Ta Energy","name":"Gomme énergétique","variant":"Tropical","carbs_g":24,"sodium_mg":114,"caffeine_mg":100,"status":"validated"}') $$,
  'NUTC-10 — admin : modifier une fiche');

-- ============================================================
-- 3. Import idempotent
-- ============================================================

select results_eq(
  $$ select created_count, updated_count from public.admin_import_nutrition_products('[
       {"category":"gel","brand":"Maurten","name":"Gel 100","variant":"Neutre","carbs_g":25,"sodium_mg":20,"caffeine_mg":0,"status":"validated"},
       {"category":"electrolyte","brand":"Precision","name":"PH 1500","variant":"Neutre","carbs_g":0,"sodium_mg":750,"caffeine_mg":0,"status":"validated"},
       {"category":"chew","brand":"Ta Energy","name":"Gomme énergétique","variant":"Tropical","carbs_g":25,"sodium_mg":114,"caffeine_mg":100,"status":"validated"}
     ]') $$,
  $$ values (2, 1) $$,
  'NUTC-11 — l''import cree les nouvelles fiches et met a jour l''existante'
);

select results_eq(
  $$ select created_count, updated_count from public.admin_import_nutrition_products('[
       {"category":"gel","brand":"Maurten","name":"Gel 100","variant":"Neutre","carbs_g":25,"sodium_mg":20,"caffeine_mg":0,"status":"validated"}
     ]') $$,
  $$ values (0, 1) $$,
  'NUTC-12 — rejoue, il ne duplique rien'
);

select throws_ok(
  $$ select * from public.admin_import_nutrition_products('[
       {"category":"gel","name":"Bon","carbs_g":20,"sodium_mg":0,"caffeine_mg":0},
       {"category":"gel","name":"Mauvais","carbs_g":-5,"sodium_mg":0,"caffeine_mg":0}
     ]') $$,
  '23514', null, 'NUTC-13 — tout ou rien : une fiche refusee annule l''import');

reset role;

select is((select count(*) from public.nutrition_products where name = 'Bon'), 0::bigint,
  'NUTC-14 — rien de l''import refuse n''a ete ecrit');

-- ============================================================
-- 4. Lecture, recherche, compteurs
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is((select count(*) from public.admin_list_nutrition_products(null, 200, 'maurten')), 1::bigint,
  'NUTC-15 — la recherche porte sur la marque, sans casse');

select is((select total from public.admin_count_nutrition_products() where status = 'validated'), 3::bigint,
  'NUTC-16 — les compteurs d''onglets comptent par statut');

-- ============================================================
-- 5. Suppression
-- ============================================================

reset role;
insert into public.user_nutrition_products (user_id, nutrition_product_id)
select '11111111-1111-4111-8111-111111111111', id from public.nutrition_products where name = 'Gel 100';

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is((select in_use from public.admin_list_nutrition_products(null, 200, 'Gel 100')), true,
  'NUTC-17 — la liste dit qu''une fiche est utilisee');

select throws_ok(
  $$ select public.admin_delete_nutrition_product((select product_id from public.admin_list_nutrition_products(null, 200, 'Gel 100'))) $$,
  '55000', null, 'NUTC-18 — une fiche qu''un coureur utilise ne se supprime pas');

select lives_ok(
  $$ select public.admin_delete_nutrition_product((select product_id from public.admin_list_nutrition_products(null, 200, 'PH 1500'))) $$,
  'NUTC-19 — une fiche que personne n''utilise se supprime');

reset role;

select ok(
  (select count(*) from private.audit_logs where action like 'nutrition_product.%') >= 5
  and not exists (select 1 from private.audit_logs where action like 'nutrition_product.%' and after_data::text like '%http%'),
  'NUTC-20 — chaque geste est journalise, sans recopier de lien'
);

select * from finish();

rollback;
