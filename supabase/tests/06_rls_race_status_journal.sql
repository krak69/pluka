-- PLUKA — RLS : journal des transitions de statut
-- Référence : docs/00_PRODUCT_SPEC.md §4.1, docs/03_PRIVACY_RLS.md §104, §170
--
-- CONTRAT DE LA SUITE
-- Chaque fichier rejoue les quatre interdictions organisation : Plan,
-- Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(17);

\ir _personas.psql

-- Une transition réelle, pour que le journal ne soit pas vide : sans elle,
-- les assertions de lecture passeraient sur une table sans ligne.
update public.races
set status = 'cancelled'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

-- ============================================================
-- 1. Le trigger journalise (§4.1, invariant 4)
-- ============================================================

select results_eq(
  $$ select from_status::text, to_status::text
     from public.race_status_transitions
     where race_id = 'aaaaaaaa-0000-4000-8000-000000000013' $$,
  $$ values ('published'::text, 'cancelled'::text) $$,
  'SPEC-4.1 — le changement de statut est journalisé avec son statut de départ'
);

select isnt_empty(
  $$ select created_at from public.race_status_transitions where created_at is not null $$,
  'SPEC-4.1 — la transition porte son horodatage'
);

-- Une écriture qui ne touche pas au statut ne doit rien journaliser : le
-- trigger est conditionné à un changement réel.
update public.races set name = '80K renommée'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

select results_eq(
  $$ select count(*)::int from public.race_status_transitions $$,
  $$ values (1) $$,
  'SPEC-4.1 — une mise à jour sans changement de statut ne journalise rien'
);

-- ============================================================
-- 2. Lecture réservée à l'organisation et à l'admin (§104)
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select isnt_empty(
  $$ select id from public.race_status_transitions $$,
  'PRIVACY — l''organisation gestionnaire lit l''historique de sa course'
);

reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');

select isnt_empty(
  $$ select id from public.race_status_transitions $$,
  'PRIVACY — l''admin plateforme lit l''historique'
);

reset role;

-- §156 : une organisation ne lit pas l'historique d'une autre.
select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select is_empty(
  $$ select id from public.race_status_transitions $$,
  'PRIVACY-P65 — Org B ne lit pas l''historique d''Org A'
);

reset role;

-- §4.1 : le coureur voit « Annulée », pas la main qui l'a décidé.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select is_empty(
  $$ select id from public.race_status_transitions $$,
  'PRIVACY — le participant ne lit pas qui a annulé sa course, ni quand'
);

reset role;

select pg_temp.act_as_anon();

select throws_ok(
  $$ select id from public.race_status_transitions $$,
  '42501', null,
  'PRIVACY — anon n''a aucun droit sur le journal (§170)'
);

reset role;

-- ============================================================
-- 3. Journal append-only
-- ============================================================
-- Un journal qu'on peut réécrire n'atteste plus rien : aucun verbe
-- d'écriture n'est accordé aux rôles client.

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ insert into public.race_status_transitions (race_id, from_status, to_status)
     values ('aaaaaaaa-0000-4000-8000-000000000013', 'draft', 'published') $$,
  '42501', null,
  'SPEC-4.1 — le client ne compose pas une entrée de journal'
);

select throws_ok(
  $$ update public.race_status_transitions set to_status = 'published' $$,
  '42501', null,
  'SPEC-4.1 — une entrée de journal ne se réécrit pas'
);

select throws_ok(
  $$ delete from public.race_status_transitions $$,
  '42501', null,
  'SPEC-4.1 — une entrée de journal ne s''efface pas'
);

reset role;

-- ============================================================
-- 4. Les quatre interdictions organisation
-- ============================================================
-- Journaliser les décisions d'une organisation ne lui ouvre rien de la
-- préparation privée des coureurs.

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

-- Et le coureur garde les siennes.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select isnt_empty($$ select id from public.race_plans $$,
  'PRIVACY — Runner A lit toujours son Plan (§32)');
select isnt_empty($$ select id from public.outings $$,
  'PRIVACY — Runner A lit toujours sa sortie (§39)');

reset role;

select * from finish();
rollback;
