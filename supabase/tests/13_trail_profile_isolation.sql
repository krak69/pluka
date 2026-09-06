-- PLUKA — RLS : le Profil trailer n'appartient qu'à son coureur
-- Référence : docs/03_PRIVACY_RLS.md §5, §13, §103, §114, §136, §138 (P04)
--             docs/00_PRODUCT_SPEC.md §8 · docs/02_DATA_MODEL.md §4.2
--             supabase/migrations/0019_trail_profile_effort_coherence.sql
--
-- §13 ne laisse aucune marge :
--
--   SELECT : propriétaire
--   INSERT : propriétaire
--   UPDATE : propriétaire
--   DELETE : propriétaire si produit l'autorise
--   ORGANIZATION : aucun
--
-- et §138 P04 en fait un test nommé : « Org Owner lit trail profile Runner A →
-- refusé ».
--
-- La ligne « Admin / serveur : Oui » de la matrice §5 désigne le service
-- serveur, pas une session client : un `pluka_admin` connecté comme n'importe
-- quel utilisateur ne doit rien voir de plus qu'un autre coureur. Ce fichier
-- le vérifie aussi.

begin;

create extension if not exists pgtap;

select plan(24);

\ir _personas.psql

-- ============================================================
-- Le monde de ce fichier
-- ============================================================
-- Les personas donnent déjà un profil à Runner A. Runner B en reçoit un ici :
-- sans lui, « A ne voit pas le profil de B » passerait sur une base où aucun
-- autre profil n'existe (§136).

insert into public.trail_profiles
  (user_id, representative_effort_label, weekly_distance_km, climb_comfort)
values
  ('22222222-2222-4222-8222-222222222222', 'Ultra de B 2025', 62.5, 'high');

-- ============================================================
-- 1. Personne d'anonyme
-- ============================================================

select pg_temp.act_as_anon();

select throws_ok(
  $$ select user_id from public.trail_profiles $$,
  '42501', null,
  'PROFIL — anon n''a aucun droit sur les profils trailer (§13)'
);

reset role;

-- ============================================================
-- 2. Chaque coureur chez lui, et nulle part ailleurs
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select isnt_empty(
  $$ select user_id from public.trail_profiles $$,
  'PROFIL — Runner A lit son profil trailer (§13)'
);

select results_eq(
  $$ select user_id::text from public.trail_profiles order by 1 $$,
  $$ values ('11111111-1111-4111-8111-111111111111') $$,
  'PROFIL — et seulement le sien : celui de Runner B ne remonte pas (§13, §136)'
);

reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select results_eq(
  $$ select user_id::text from public.trail_profiles order by 1 $$,
  $$ values ('22222222-2222-4222-8222-222222222222') $$,
  'PROFIL — la réciproque tient : Runner B ne lit que le sien'
);

reset role;

-- ============================================================
-- 3. L'organisation, à tous ses rôles (§138 P04)
-- ============================================================
-- Testée sur la course qu'elle gère, à laquelle Runner A participe — le cas le
-- plus favorable à une fuite. §103 : « Owner organisation ≠ owner des données
-- participant. »

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select is_empty($$ select user_id from public.trail_profiles $$,
  'PROFIL — Org viewer A : aucun profil trailer (§13)');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is_empty($$ select user_id from public.trail_profiles $$,
  'PROFIL — Org editor A : aucun profil trailer (§13)');
reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is_empty($$ select user_id from public.trail_profiles $$,
  'PROFIL — Org admin A : aucun profil trailer (§13)');
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty($$ select user_id from public.trail_profiles $$,
  'PROFIL-P04 — Org Owner ne lit pas le profil trailer de Runner A (§13, §138)');

-- L'organisation voit bien l'inscription de Runner A (§26). Le chemin
-- « je connais son participant_race, donc je remonte à son profil » doit
-- s'arrêter net : c'est exactement ce que §13 refuse, et ce qu'une jointure
-- naïve tenterait.
select is_empty(
  $$ select tp.user_id
     from public.participant_races pr
     join public.trail_profiles tp on tp.user_id = pr.user_id $$,
  'PROFIL — la relation d''inscription ne mène pas au profil (§13, §26)'
);

reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select is_empty($$ select user_id from public.trail_profiles $$,
  'PROFIL — Org B ne lit aucun profil (§13)');
reset role;

-- §114 : l'accès d'un ancien membre a cessé avec son appartenance.
select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select is_empty($$ select user_id from public.trail_profiles $$,
  'PROFIL — un ancien membre d''Org A ne lit aucun profil (§114)');
reset role;

-- La matrice §5 dit « Admin / serveur : Oui » — le serveur, pas la session
-- client. 02_DATA_MODEL §31 précise « Support strict ».
select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select is_empty($$ select user_id from public.trail_profiles $$,
  'PROFIL — un pluka_admin connecté comme client ne lit aucun profil (§5, §8)');
reset role;

-- ============================================================
-- 4. Écriture : propriétaire, et lui seul
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ insert into public.trail_profiles (user_id, climb_comfort)
     values ('11111111-1111-4111-8111-111111111111', 'low') $$,
  '42501', null,
  'PROFIL — Runner B ne crée pas de profil au nom de Runner A (§13, §108)'
);

-- Un UPDATE ou un DELETE dont la clause `using` ne retient aucune ligne ne
-- lève pas : il n'en touche simplement aucune. Le silence est la bonne
-- réponse — encore faut-il vérifier qu'il est vide d'effet.
select lives_ok(
  $$ update public.trail_profiles set climb_comfort = 'low'
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'PROFIL — la tentative de Runner B sur le profil de A ne lève pas'
);

select lives_ok(
  $$ delete from public.trail_profiles
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'PROFIL — sa tentative de suppression non plus'
);

reset role;

select is(
  (select representative_effort_label from public.trail_profiles
   where user_id = '11111111-1111-4111-8111-111111111111'),
  'Trail des Tests 2025',
  'PROFIL — et le profil de Runner A est intact (§13, §136)'
);

select isnt_empty(
  $$ select user_id from public.trail_profiles
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'PROFIL — la ligne existe toujours après la tentative de suppression'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ update public.trail_profiles
     set weekly_distance_km = 48.5, descent_comfort = 'medium'
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'PROFIL — le coureur met à jour son propre profil (§13)'
);

reset role;

select is(
  (select descent_comfort::text from public.trail_profiles
   where user_id = '11111111-1111-4111-8111-111111111111'),
  'medium',
  'PROFIL — sa modification est bien écrite'
);

-- ============================================================
-- 5. Un effort représentatif est complet, ou absent (0019)
-- ============================================================
-- §8.1 : « distance ; D+ ; durée ; date facultative ». La contrainte vit en
-- SQL parce que le client écrit cette table directement sous RLS : le use case
-- serveur n'est pas le seul chemin d'écriture.

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ update public.trail_profiles set representative_distance_km = 42
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null,
  'EFFORT — une distance seule ne situe aucune allure (§8.1)'
);

select throws_ok(
  $$ update public.trail_profiles
     set representative_distance_km = 42, representative_duration_seconds = 21600
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null,
  'EFFORT — il manque encore le D+ (§8.1)'
);

select lives_ok(
  $$ update public.trail_profiles
     set representative_distance_km = 42,
         representative_elevation_gain_m = 2000,
         representative_duration_seconds = 21600
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'EFFORT — les trois mesures ensemble passent (§8.1)'
);

reset role;

select is(
  (select representative_elevation_gain_m from public.trail_profiles
   where user_id = '11111111-1111-4111-8111-111111111111'),
  2000,
  'EFFORT — et l''effort est relisible par son propriétaire'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

-- Le retirer entièrement reste permis : §7.2 laisse reprendre un profil, et un
-- profil sans effort de référence reste valide — il lui manque seulement un
-- signal d'allure, ce qui est une question de complétude, pas de cohérence.
select lives_ok(
  $$ update public.trail_profiles
     set representative_distance_km = null,
         representative_elevation_gain_m = null,
         representative_duration_seconds = null
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'EFFORT — retirer les trois d''un coup reste permis (§7.2)'
);

reset role;

select * from finish();

rollback;
