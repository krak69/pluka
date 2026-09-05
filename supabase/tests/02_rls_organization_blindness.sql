-- PLUKA — RLS : l'organisation est aveugle à la préparation privée
-- Référence : docs/03_PRIVACY_RLS.md §1, §5, §26, §29, §31, §36 à §40,
--             §43, §48, §49, §51, §56, §63, §103, §142 à §145
--
-- C'est le fichier central de la suite. Le principe testé est le plus fort du
-- document :
--
--   « L'organisation ne voit jamais la préparation privée individuelle
--     du coureur. » (§1)
--
-- Il est vérifié pour les quatre rôles organisation, sur la course que
-- l'organisation gère elle-même et à laquelle Runner A participe — c'est-à-dire
-- dans le cas le plus favorable à une fuite.
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(50);

\ir _personas.psql

-- ============================================================
-- 1. Org Owner — le rôle le plus fort ne voit rien de privé
-- ============================================================
-- §103 : « Owner organisation ≠ owner des données participant. »

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

-- Ce qu'il voit légitimement : l'inscription, pas la préparation (§26).
select isnt_empty($$ select id from public.participant_races $$,
  'PRIVACY — Org Owner voit l''inscription de Runner A (§26)');

-- Les quatre interdictions.
select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Owner : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Owner : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Owner : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Owner : aucune sortie individuelle (§39)');

-- Le détail du Plan et de la Nutrition, table enfant par table enfant : une
-- policy oubliée sur une table fille suffirait à reconstituer le Plan.
select is_empty($$ select id from public.plan_waypoints $$,
  'PRIVACY-P18 — Org Owner : aucun waypoint de Plan (§31)');
select is_empty($$ select id from public.plan_version_dependencies $$,
  'PRIVACY-P19 — Org Owner : aucune dépendance de Plan (§34)');
select is_empty($$ select id from public.nutrition_waypoints $$,
  'PRIVACY-P22 — Org Owner : aucun point Nutrition (§40)');
select is_empty($$ select id from public.user_nutrition_products $$,
  'PRIVACY-P23 — Org Owner : aucun produit personnel (§41)');
select is_empty($$ select id from public.assistance_assignments $$,
  'PRIVACY-P25 — Org Owner : aucun rendez-vous d''assistance (§43)');
select is_empty($$ select id from public.outing_waypoints $$,
  'PRIVACY-P31 — Org Owner : aucun point de sortie (§39)');

-- Préparation, matériel, sacs (§36, §37, §38).
select is_empty($$ select id from public.tasks $$,
  'PRIVACY — Org Owner : aucun TODO, même né d''un changement officiel (§36)');
select is_empty($$ select id from public.participant_equipment $$,
  'PRIVACY — Org Owner : ne sait pas si le coureur a coché ses gants (§37)');
select is_empty($$ select id from public.bags $$,
  'PRIVACY — Org Owner : aucun sac (§38)');
select is_empty($$ select id from public.bag_items $$,
  'PRIVACY — Org Owner : aucun contenu de sac (§38)');
select is_empty($$ select id from public.library_templates $$,
  'PRIVACY — Org Owner : aucune bibliothèque personnelle');

-- Urgence, profil, préférences (§48, §13, §29).
select is_empty($$ select id from public.emergency_contacts $$,
  'PRIVACY — Org Owner : aucun contact d''urgence (§48)');
select is_empty($$ select user_id from public.trail_profiles $$,
  'PRIVACY — Org Owner : aucun profil trailer (§13)');
select is_empty($$ select participant_race_id from public.participant_race_settings $$,
  'PRIVACY — Org Owner : aucune préférence de préparation (§29)');

-- Météo et Conditions personnelles (§49, §51).
select is_empty($$ select id from public.weather_forecast_runs $$,
  'PRIVACY-P32 — Org Owner : aucun run météo personnel (§49)');
select is_empty($$ select id from public.condition_periods $$,
  'PRIVACY-P33 — Org Owner : aucune période de conditions (§49)');
select is_empty($$ select id from public.condition_proposals $$,
  'PRIVACY-P34 — Org Owner : ne sait pas si le coureur a accepté une suggestion froid (§51)');

-- Q&A et après-course (§63, §56).
select is_empty($$ select id from public.pluka_conversations $$,
  'PRIVACY-P35 — Org Owner : aucune conversation Q&A (§63)');
select is_empty($$ select id from public.pluka_messages $$,
  'PRIVACY-P36 — Org Owner : aucun message Q&A (§63)');
select is_empty($$ select id from public.post_race_reviews $$,
  'PRIVACY — Org Owner : aucun retour après-course brut (§56)');

-- §45 : la table des jetons Assistant n'est ouverte à personne côté client.
select throws_ok(
  $$ select id from public.assistant_access_tokens $$,
  '42501', null,
  'PRIVACY-P29 — Org Owner : la table des jetons Assistant n''a aucun grant (§45)'
);

reset role;

-- ============================================================
-- 2. Org Admin — mêmes interdictions
-- ============================================================

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Admin : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Admin : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Admin : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Admin : aucune sortie individuelle (§39)');

reset role;

-- ============================================================
-- 3. Org Editor — mêmes interdictions
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Editor : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Editor : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Editor : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Editor : aucune sortie individuelle (§39)');

reset role;

-- ============================================================
-- 4. Org Viewer — mêmes interdictions
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Viewer : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Viewer : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Viewer : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Viewer : aucune sortie individuelle (§39)');

reset role;

-- ============================================================
-- 5. Ce que l'organisation obtient bien
-- ============================================================
-- Un test d'interdiction ne vaut que si le droit légitime, lui, fonctionne :
-- sinon la suite passerait sur une base simplement fermée (§136).

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select isnt_empty($$ select id from public.race_intelligence_runs $$,
  'PRIVACY — Org Viewer lit les agrégats Race Intelligence (§68)');
select isnt_empty($$ select id from public.organization_adoption_snapshots $$,
  'PRIVACY — Org Viewer lit les compteurs d''adoption (§67)');
select isnt_empty($$ select id from public.organizer_briefs $$,
  'PRIVACY — Org Viewer lit le Brief de son édition (§75)');
select isnt_empty($$ select id from public.race_notices $$,
  'PRIVACY — Org Viewer lit les notices officielles de sa course (§52)');

reset role;

-- ============================================================
-- 6. Le coureur, lui, garde tout
-- ============================================================
-- La contrepartie : ces interdictions ne doivent pas avoir fermé l'accès du
-- propriétaire à ses propres données.

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select isnt_empty($$ select id from public.race_plans $$,
  'PRIVACY-P20 — Runner A lit son Plan (§32)');
select isnt_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY — Runner A lit sa Nutrition (§40)');
select isnt_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P28 — Runner A lit son Assistance (§43)');
select isnt_empty($$ select id from public.outings $$,
  'PRIVACY — Runner A lit sa sortie (§39)');
select isnt_empty($$ select id from public.emergency_contacts $$,
  'PRIVACY — Runner A lit son contact d''urgence (§48)');
select isnt_empty($$ select id from public.pluka_conversations $$,
  'PRIVACY-P37 — Runner A lit sa conversation Q&A (§63)');
select isnt_empty($$ select id from public.weather_forecast_runs $$,
  'PRIVACY — Runner A lit son run météo (§50)');
select isnt_empty($$ select id from public.post_race_reviews $$,
  'PRIVACY — Runner A lit son retour après-course (§56)');

reset role;

select * from finish();
rollback;
