-- PLUKA — RLS : administration de la base courses par pluka_admin
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 et §4.1, docs/03_PRIVACY_RLS.md §16, §104
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(21);

\ir _personas.psql

-- Un événement sans organisation gestionnaire : le cas que §4.1 confie
-- explicitement à `pluka_admin`, et que la RLS de 0005 ne permettait à
-- personne d'administrer.
insert into public.events (id, organization_id, name, slug, status) values
  ('cccccccc-0000-4000-8000-000000000001', null, 'Trail Communautaire', 'trail-communautaire', 'draft');

insert into public.editions (id, event_id, year, slug, start_date, status) values
  ('cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001',
   2026, 'trail-communautaire-2026', '2026-08-15', 'draft');

-- ============================================================
-- 1. pluka_admin administre la base courses (§3.5)
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select lives_ok(
  $$ insert into public.events (organization_id, name, slug)
     values (null, 'Nouvel événement PLUKA', 'nouvel-evenement-pluka') $$,
  'SPEC-3.5 — l''admin plateforme crée un événement sans organisation'
);

select lives_ok(
  $$ insert into public.editions (event_id, year, slug, start_date)
     values ('cccccccc-0000-4000-8000-000000000001', 2027, 'trail-communautaire-2027', '2027-08-14') $$,
  'SPEC-3.5 — l''admin plateforme crée une édition'
);

select lives_ok(
  $$ insert into public.races (edition_id, name, slug, distance_km, start_datetime, timezone)
     values ('cccccccc-0000-4000-8000-000000000002', '30K', '30k', 30,
             '2026-08-15T05:00:00Z', 'Europe/Paris') $$,
  'SPEC-4.1 — l''admin plateforme crée une épreuve sur un événement sans organisation'
);

-- La course de la fixture est `published` : on vise `cancelled`, un vrai
-- changement. Repasser `published` sur `published` réussirait sans rien faire
-- et ne prouverait rien.
select lives_ok(
  $$ update public.races set status = 'cancelled'
     where id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  'SPEC-4.1 — l''admin plateforme change le statut d''une course d''organisation'
);

-- Le journal de 0006 a bien enregistré la transition faite par l'admin.
select isnt_empty(
  $$ select id from public.race_status_transitions
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  'SPEC-4.1 — la transition de l''admin est journalisée comme les autres'
);

-- Pas de suppression : §4.1 donne `archived` comme sortie de circulation.
--
-- Un DELETE hors périmètre ne lève pas : la policy retire simplement les
-- lignes de la portée et la commande en supprime zéro. La preuve est donc que
-- l'événement survit, pas qu'une exception a été levée.
select lives_ok(
  $$ delete from public.events where id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'SPEC-4.1 — le DELETE ne lève pas, il ne voit aucune ligne'
);

select isnt_empty(
  $$ select id from public.events where id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'SPEC-4.1 — l''événement est intact : l''admin l''archive, il ne l''efface pas'
);

reset role;

-- ============================================================
-- 2. Personne d'autre n'y accède (§104, §156)
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty(
  $$ select id from public.events where id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'PRIVACY — Org Owner ne voit pas un événement sans organisation gestionnaire'
);

select throws_ok(
  $$ insert into public.events (organization_id, name, slug)
     values (null, 'Événement orphelin', 'evenement-orphelin') $$,
  '42501', null,
  'SPEC-4.1 — une organisation ne crée pas un événement sans organisation'
);

reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

-- Même nuance : l'UPDATE ne lève pas, il ne trouve aucune ligne dans sa
-- portée. Ce qui se vérifie, c'est que le statut n'a pas bougé.
select lives_ok(
  $$ update public.races set status = 'archived'
     where id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  'PRIVACY — l''UPDATE d''Org B ne lève pas, il ne voit aucune ligne'
);

reset role;

select results_eq(
  $$ select status::text from public.races
     where id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  $$ values ('cancelled'::text) $$,
  'PRIVACY-P66 — Org B n''a pas changé le statut de la course d''Org A (§156)'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.events (organization_id, name, slug)
     values (null, 'Par un coureur', 'par-un-coureur') $$,
  '42501', null,
  'PRIVACY — un coureur n''écrit pas dans la base courses'
);

reset role;

-- ============================================================
-- 3. L'ouverture s'arrête au référentiel (§104)
-- ============================================================
-- « Le simple statut pluka_admin ne doit pas transformer toutes les données
-- en contenu courant de l'admin UI. » Les quatre interdictions valent aussi
-- pour lui : le support passe par des use cases audités, pas par une lecture
-- directe.

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — admin plateforme : aucun Plan (§31, §104)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — admin plateforme : aucune Nutrition (§40, §104)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — admin plateforme : aucune Assistance (§43, §104)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — admin plateforme : aucune sortie individuelle (§39, §104)');

select is_empty($$ select id from public.emergency_contacts $$,
  'PRIVACY — admin plateforme : aucun contact d''urgence (§48)');

reset role;

-- ============================================================
-- 4. Les quatre interdictions, organisation gestionnaire
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Owner : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Owner : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Owner : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Owner : aucune sortie individuelle (§39)');

reset role;

select * from finish();
rollback;
