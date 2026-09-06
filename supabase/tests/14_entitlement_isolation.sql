-- PLUKA — Droits commerciaux : lecture propriétaire, écriture serveur
-- Référence : docs/04_ENTITLEMENTS.md §5, §24, §32, §34, §69, §70, §93, §94
--             docs/03_PRIVACY_RLS.md §24, §30, §102, §103 · docs/02_DATA_MODEL.md §10
--
-- §93 pose la règle d'accès :
--
--   Écriture : service serveur ; webhook ; admin ; organisation via use case
--   Lecture  : le user lit ses propres droits, jamais ceux des autres
--
-- Et §5, principe 12, la frontière la plus importante du document :
--
--   « Les droits commerciaux ne doivent jamais modifier les règles de
--     confidentialité. »
--
-- Une organisation qui finance la préparation d'un coureur n'en devient pas
-- propriétaire. Ce fichier le vérifie sur la table même qui matérialise le
-- financement.
--
-- Les invariants de §69, §70 et §34 sont testés en tant que contraintes : ils
-- doivent tenir face à n'importe quel écrivain, y compris un worker ou une clé
-- de service (§94, « le fait d'utiliser service_role ne dispense pas des règles
-- métier »).

begin;

create extension if not exists pgtap;

select plan(32);

\ir _personas.psql

-- ============================================================
-- Le monde de ce fichier
-- ============================================================
-- Runner A a payé un Race Pass sur sa participation, et consommé une sortie
-- liée. Runner B a le sien sur sa propre participation : sans lui, « A ne voit
-- pas les droits de B » passerait sur une base sans autre droit (§136).

insert into public.participant_races (id, race_id, user_id, bib_number) values
  ('dddddddd-0000-4000-8000-000000000032', 'aaaaaaaa-0000-4000-8000-000000000013',
   '22222222-2222-4222-8222-222222222222', '202');

insert into public.entitlements
  (id, kind, source, status, scope_type, user_id, participant_race_id)
values
  ('eeeeeeee-0000-4000-8000-000000000001', 'race_pass', 'checkout', 'active',
   'participant_race', '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000031'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'race_pass', 'checkout', 'active',
   'participant_race', '22222222-2222-4222-8222-222222222222',
   'dddddddd-0000-4000-8000-000000000032');

insert into public.beta_access_grants (id, user_id, scope_type, reason) values
  ('eeeeeeee-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111',
   'global', 'testeur interne');

insert into public.purchases (id, user_id, product_key, provider, status) values
  ('eeeeeeee-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111',
   'race_pass', 'provider-de-test', 'pending');

insert into public.outings (id, user_id, linked_participant_race_id, name) values
  ('eeeeeeee-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000031', 'Reconnaissance Col du Test');

insert into public.entitlement_usage
  (id, user_id, entitlement_id, capability, participant_race_id, outing_id, usage_key)
values
  ('eeeeeeee-0000-4000-8000-000000000041', '11111111-1111-4111-8111-111111111111',
   'eeeeeeee-0000-4000-8000-000000000001', 'outing.create_linked',
   'aaaaaaaa-0000-4000-8000-000000000031', 'eeeeeeee-0000-4000-8000-000000000031',
   'linked-outing:eeeeeeee-0000-4000-8000-000000000031');

-- ============================================================
-- 1. Personne d'anonyme (§30)
-- ============================================================

select pg_temp.act_as_anon();

select throws_ok(
  $$ select id from public.entitlements $$,
  '42501', null,
  'DROITS — anon n''a aucun droit sur les entitlements (§30)'
);

select throws_ok(
  $$ select id from public.entitlement_usage $$,
  '42501', null,
  'DROITS — anon n''a aucun droit sur le ledger d''usage (§30)'
);

reset role;

-- ============================================================
-- 2. Chaque coureur lit les siens, et rien d'autre (§93)
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select results_eq(
  $$ select id::text from public.entitlements order by 1 $$,
  $$ values ('eeeeeeee-0000-4000-8000-000000000001') $$,
  'DROITS — Runner A lit son Race Pass, pas celui de Runner B (§93)'
);

select results_eq(
  $$ select id::text from public.entitlement_usage order by 1 $$,
  $$ values ('eeeeeeee-0000-4000-8000-000000000041') $$,
  'DROITS — Runner A lit ses consommations de quota (§33)'
);

select isnt_empty(
  $$ select id from public.beta_access_grants $$,
  'DROITS — Runner A lit son accès testeur (§14)'
);

select isnt_empty(
  $$ select id from public.purchases $$,
  'DROITS — Runner A lit son historique d''achat (§71)'
);

reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select results_eq(
  $$ select id::text from public.entitlements order by 1 $$,
  $$ values ('eeeeeeee-0000-4000-8000-000000000002') $$,
  'DROITS — la réciproque tient : Runner B ne lit que le sien'
);

select is_empty(
  $$ select id from public.entitlement_usage $$,
  'DROITS — Runner B ne lit pas les consommations de Runner A (§93)'
);

select is_empty(
  $$ select id from public.beta_access_grants $$,
  'DROITS — ni son accès testeur'
);

select is_empty(
  $$ select id from public.purchases $$,
  'DROITS — ni ses achats (§71)'
);

reset role;

-- ============================================================
-- 3. L'organisation ne voit rien, et son financement n'y change rien
-- ============================================================
-- §5, principe 12, et 03_PRIVACY_RLS §103 : « Owner organisation ≠ owner des
-- données participant ». Le Race Pass de Runner A porte sur une course gérée
-- par Org A — le cas le plus favorable à une fuite.

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty($$ select id from public.entitlements $$,
  'DROITS — Org Owner ne lit aucun droit commercial de ses inscrits (§30, §93)');
select is_empty($$ select id from public.entitlement_usage $$,
  'DROITS — ni leurs consommations de quota');
select is_empty($$ select id from public.purchases $$,
  'DROITS — ni leurs achats');
select is_empty($$ select id from public.beta_access_grants $$,
  'DROITS — ni leurs accès testeur');

reset role;

-- Un Organizer Included financé par Org A n'ouvre toujours rien : le droit
-- commercial et la confidentialité sont deux systèmes séparés (AGENTS §24).
insert into public.entitlements
  (id, kind, source, status, scope_type, user_id, participant_race_id, organization_id)
values
  ('eeeeeeee-0000-4000-8000-000000000003', 'organizer_included', 'organization', 'active',
   'participant_race', '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000001');

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — financer la préparation n''ouvre aucun Plan (§5 p12, §103)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — ni aucune Nutrition');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — ni aucune Assistance');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — ni aucune sortie, y compris celle qu''elle a financée');

reset role;

-- ============================================================
-- 4. Aucune écriture depuis le client (§93, §94)
-- ============================================================
-- Aucun verbe d'écriture n'est accordé à `authenticated` sur ces tables : les
-- grants viennent du serveur, du webhook ou de l'admin. Un coureur qui pourrait
-- s'accorder un PLUKA+ rendrait tout le reste décoratif.

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.entitlements (kind, source, scope_type, user_id)
     values ('plus', 'checkout', 'global', '11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'ÉCRITURE — un coureur ne s''accorde pas un PLUKA+ (§93)'
);

select throws_ok(
  $$ update public.entitlements set ends_at = null
     where id = 'eeeeeeee-0000-4000-8000-000000000001' $$,
  '42501', null,
  'ÉCRITURE — ni ne prolonge son propre droit'
);

select throws_ok(
  $$ delete from public.entitlement_usage
     where id = 'eeeeeeee-0000-4000-8000-000000000041' $$,
  '42501', null,
  'ÉCRITURE — ni n''efface une consommation de quota (§32)'
);

select throws_ok(
  $$ insert into public.beta_access_grants (user_id, scope_type)
     values ('11111111-1111-4111-8111-111111111111', 'global') $$,
  '42501', null,
  'ÉCRITURE — ni ne se déclare testeur (§14)'
);

select throws_ok(
  $$ insert into public.purchases (user_id, product_key, provider, status)
     values ('11111111-1111-4111-8111-111111111111', 'plus_annual', 'x', 'paid') $$,
  '42501', null,
  'ÉCRITURE — ni ne déclare un achat payé (§25)'
);

reset role;

-- ============================================================
-- 5. Les invariants de scope tiennent face à tout écrivain (§69)
-- ============================================================

select throws_ok(
  $$ insert into public.entitlements (kind, source, scope_type, user_id, participant_race_id)
     values ('plus', 'checkout', 'global', '11111111-1111-4111-8111-111111111111',
             'aaaaaaaa-0000-4000-8000-000000000031') $$,
  '23514', null,
  'SCOPE — un PLUKA+ est global, jamais lié à une participation (§11, §69)'
);

select throws_ok(
  $$ insert into public.entitlements (kind, source, scope_type, user_id)
     values ('race_pass', 'checkout', 'participant_race',
             '11111111-1111-4111-8111-111111111111') $$,
  '23514', null,
  'SCOPE — un Race Pass sans participation n''existe pas (§9, §69)'
);

select throws_ok(
  $$ insert into public.entitlements
       (kind, source, scope_type, user_id, participant_race_id)
     values ('organizer_included', 'organization', 'participant_race',
             '11111111-1111-4111-8111-111111111111',
             'aaaaaaaa-0000-4000-8000-000000000031') $$,
  '23514', null,
  'SCOPE — un Organizer Included nomme l''organisation qui finance (§12, §69)'
);

-- §24 : une révocation est auditée. Une ligne révoquée sans date ne dit pas
-- quand elle l'a été.
select throws_ok(
  $$ insert into public.entitlements (kind, source, status, scope_type, user_id)
     values ('plus', 'checkout', 'revoked', 'global',
             '22222222-2222-4222-8222-222222222222') $$,
  '23514', null,
  'RÉVOCATION — une révocation sans date n''est pas auditable (§24)'
);

-- ============================================================
-- 6. Pas de doublon actif (§70)
-- ============================================================

insert into public.entitlements (kind, source, scope_type, user_id) values
  ('plus', 'checkout', 'global', '22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ insert into public.entitlements (kind, source, scope_type, user_id)
     values ('plus', 'checkout', 'global', '22222222-2222-4222-8222-222222222222') $$,
  '23505', null,
  'DOUBLON — un seul PLUKA+ actif par utilisateur (§70)'
);

select throws_ok(
  $$ insert into public.entitlements
       (kind, source, scope_type, user_id, participant_race_id)
     values ('race_pass', 'checkout', 'participant_race',
             '11111111-1111-4111-8111-111111111111',
             'aaaaaaaa-0000-4000-8000-000000000031') $$,
  '23505', null,
  'DOUBLON — un seul Race Pass actif par participation (§70, E22)'
);

-- ============================================================
-- 7. Le ledger de quota (§32, §34)
-- ============================================================

select throws_ok(
  $$ insert into public.entitlement_usage
       (user_id, entitlement_id, capability, participant_race_id, usage_key)
     values ('11111111-1111-4111-8111-111111111111',
             'eeeeeeee-0000-4000-8000-000000000001', 'outing.create_linked',
             'aaaaaaaa-0000-4000-8000-000000000031',
             'linked-outing:eeeeeeee-0000-4000-8000-000000000031') $$,
  '23505', null,
  'QUOTA — la même sortie ne consomme qu''une fois (§34, usage_key)'
);

-- §32 : « le quota compte les créations confirmées de sorties liées, même si
-- elles sont ensuite supprimées ». La FK est `on delete set null` : la ligne de
-- ledger survit à la sortie, sinon le cycle créer → supprimer → recréer
-- contournerait le quota indéfiniment.
delete from public.outings where id = 'eeeeeeee-0000-4000-8000-000000000031';

select isnt_empty(
  $$ select id from public.entitlement_usage
     where usage_key = 'linked-outing:eeeeeeee-0000-4000-8000-000000000031' $$,
  'QUOTA — supprimer la sortie ne rend pas le quota (§32)'
);

select is(
  (select outing_id from public.entitlement_usage
   where usage_key = 'linked-outing:eeeeeeee-0000-4000-8000-000000000031'),
  null::uuid,
  'QUOTA — la consommation survit à la sortie qu''elle référençait'
);

select * from finish();

rollback;
