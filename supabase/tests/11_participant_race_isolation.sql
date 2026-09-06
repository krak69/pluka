-- PLUKA — RLS : isolation d'une participation et de son objectif
-- Référence : docs/03_PRIVACY_RLS.md §26, §27, §28, §29, §136, §141 (P14 à P17)
--             docs/02_DATA_MODEL.md §9 · docs/00_PRODUCT_SPEC.md §9.1
--
-- §141 pose quatre attentes :
--
--   P14  Runner A lit sa participation                     → autorisé
--   P15  Runner A lit la participation de B                → refusé
--   P16  Org A lit le participant opérationnel de sa Race  → autorisé
--   P17  Org A utilise cette relation pour lire le Plan    → refusé
--
-- Ce fichier les vérifie, et ajoute ce que le lot ParticipantRace introduit :
-- l'objectif du coureur. §29 le rend strictement propriétaire, et une liste
-- d'inscrits ne doit jamais devenir un tableau de chronos visés.
--
-- CONTRAT DE LA SUITE
-- Comme les autres fichiers, celui-ci rejoue les quatre interdictions
-- organisation : Plan, Nutrition, Assistance, sortie individuelle.

begin;

create extension if not exists pgtap;

select plan(29);

\ir _personas.psql

-- ============================================================
-- Le monde de ce fichier
-- ============================================================
-- Trois participations sur la même course d'Org A :
--   - celle de Runner A, venue des personas (…031) ;
--   - celle de Runner B, ajoutée ici, avec son propre objectif ;
--   - une participation importée non encore réclamée (§10.2 de
--     01_ARCHITECTURE), qui n'appartient donc à aucun `auth.uid()`.
--
-- Sans la deuxième, « A ne voit pas l'objectif de B » passerait sur une base
-- où aucun autre objectif n'existe (§136). Sans la troisième, rien ne dirait
-- ce que devient une ligne sans propriétaire.

insert into public.participant_races (id, race_id, user_id, bib_number) values
  ('dddddddd-0000-4000-8000-000000000032', 'aaaaaaaa-0000-4000-8000-000000000013',
   '22222222-2222-4222-8222-222222222222', '202');

insert into public.participant_races
  (id, race_id, invite_email, first_name_snapshot, last_name_snapshot,
   registration_source, bib_number)
values
  ('dddddddd-0000-4000-8000-000000000033', 'aaaaaaaa-0000-4000-8000-000000000013',
   'invite@test.pluka', 'Sacha', 'Import', 'organizer_import', '203');

-- L'`updated_at` est daté volontairement : le trigger de 0017 doit le
-- déplacer à la première écriture. Sans valeur de départ distincte, `now()`
-- étant constant dans une transaction, l'assertion ne prouverait rien.
insert into public.participant_race_settings
  (participant_race_id, target_duration_seconds, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000031', 43200, '2020-01-01T00:00:00Z'),
  ('dddddddd-0000-4000-8000-000000000032', 50400, '2020-01-01T00:00:00Z');

-- ============================================================
-- 1. Runner A chez lui (§141 P14)
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select isnt_empty(
  $$ select id from public.participant_races $$,
  'PRIVACY-P14 — Runner A lit sa participation (§26)'
);

-- La liste exacte compte autant que sa non-vacuité : elle prouve du même coup
-- que ni la participation de B, ni la ligne importée sans propriétaire ne
-- remontent.
select results_eq(
  $$ select id::text from public.participant_races order by 1 $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'PRIVACY-P15 — Runner A ne voit que sa propre participation (§26)'
);

select isnt_empty(
  $$ select participant_race_id from public.participant_race_settings $$,
  'PRIVACY — Runner A lit ses préférences de course (§29)'
);

select is(
  (select target_duration_seconds from public.participant_race_settings
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  43200,
  'OBJECTIF — le coureur lit son propre objectif (00_PRODUCT_SPEC §9.1)'
);

select results_eq(
  $$ select participant_race_id::text from public.participant_race_settings order by 1 $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'OBJECTIF — Runner A ne voit pas l''objectif de Runner B (§29)'
);

-- §28 : l'email d'invitation n'est accordé à aucun rôle client, pas même sur
-- sa propre ligne. Le workflow qui en a besoin passe par le serveur.
select throws_ok(
  $$ select invite_email from public.participant_races $$,
  '42501', null,
  'PRIVACY — l''email d''invitation n''a aucun grant client (§28)'
);

-- §27, ADR-003 : la couche d'inscription n'est pas écrite par le navigateur.
-- Aucun verbe d'écriture n'est accordé sur `participant_races` ; le
-- rattachement passe par le use case serveur.
select throws_ok(
  $$ insert into public.participant_races (race_id, user_id)
     values ('aaaaaaaa-0000-4000-8000-000000000013',
             '11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'ÉCRITURE — un coureur ne crée pas sa participation depuis le client'
);

select throws_ok(
  $$ update public.participant_races set preparation_state = 'ready'
     where id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  '42501', null,
  'ÉCRITURE — un coureur ne modifie pas sa participation depuis le client'
);

reset role;

-- ============================================================
-- 2. Runner B ne voit rien de A (§141 P15)
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is_empty(
  $$ select id from public.participant_races
     where id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  'PRIVACY-P15 — Runner B ne lit pas la participation de Runner A (§26)'
);

select results_eq(
  $$ select id::text from public.participant_races order by 1 $$,
  $$ values ('dddddddd-0000-4000-8000-000000000032') $$,
  'PRIVACY — Runner B ne voit que la sienne, pas la ligne importée sans propriétaire'
);

select results_eq(
  $$ select participant_race_id::text from public.participant_race_settings order by 1 $$,
  $$ values ('dddddddd-0000-4000-8000-000000000032') $$,
  'OBJECTIF — Runner B ne voit pas l''objectif de Runner A (§29)'
);

select throws_ok(
  $$ insert into public.participant_race_settings (participant_race_id, target_duration_seconds)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 1) $$,
  '42501', null,
  'OBJECTIF — Runner B ne crée pas de réglages sur la participation de A (§29)'
);

-- Un UPDATE dont la clause `using` ne retient aucune ligne ne lève pas : il
-- n'en touche simplement aucune. Le silence est la bonne réponse — encore
-- faut-il vérifier qu'il est vide d'effet.
select lives_ok(
  $$ update public.participant_race_settings set target_duration_seconds = 1
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  'OBJECTIF — la tentative de Runner B sur l''objectif de A ne lève pas'
);

reset role;

select is(
  (select target_duration_seconds from public.participant_race_settings
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  43200,
  'OBJECTIF — et elle n''a rien changé (§29)'
);

-- ============================================================
-- 3. L'organisation gestionnaire (§141 P16, P17)
-- ============================================================
-- Testée avec `viewer`, le rôle le plus faible, puis avec `owner`, le plus
-- fort : le premier doit voir la liste opérationnelle, le second ne doit
-- toujours rien voir de privé (§103).

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select isnt_empty(
  $$ select id from public.participant_races $$,
  'PRIVACY-P16 — Org viewer A lit les inscrits de sa course (§26)'
);

select results_eq(
  $$ select id::text from public.participant_races order by 1 $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000031'),
            ('dddddddd-0000-4000-8000-000000000032'),
            ('dddddddd-0000-4000-8000-000000000033') $$,
  'PRIVACY-P16 — la liste opérationnelle couvre bien les trois inscrits, réclamés ou non'
);

select is_empty(
  $$ select participant_race_id from public.participant_race_settings $$,
  'OBJECTIF — l''organisation ne lit aucun objectif de coureur (§29)'
);

reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select invite_email from public.participant_races $$,
  '42501', null,
  'PRIVACY — l''email participant ne sort pas vers l''organisation (§28)'
);

select is_empty(
  $$ select participant_race_id from public.participant_race_settings $$,
  'OBJECTIF — l''Owner non plus ne lit aucun objectif (§29, §103)'
);

-- Les quatre interdictions organisation, rejouées ici avec deux participations
-- privées au lieu d'une (contrat de la suite, §141 P17).
select is_empty($$ select id from public.race_plans $$,
  'PRIVACY-P21 — Org Owner : aucun Plan (§31)');
select is_empty($$ select id from public.nutrition_plans $$,
  'PRIVACY-P24 — Org Owner : aucune Nutrition (§40)');
select is_empty($$ select id from public.race_assistants $$,
  'PRIVACY-P27 — Org Owner : aucune Assistance (§43)');
select is_empty($$ select id from public.outings $$,
  'PRIVACY-P30 — Org Owner : aucune sortie individuelle (§39)');

reset role;

-- ============================================================
-- 4. L'autre organisation (§92 des critères de scope)
-- ============================================================

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select is_empty(
  $$ select id from public.participant_races $$,
  'PRIVACY — Org B ne lit aucun inscrit d''Org A (§26, §114)'
);

reset role;

-- ============================================================
-- 5. Le membre parti (§114)
-- ============================================================
-- `ex-member-a` n'apparaît dans aucun membership : son accès opérationnel a
-- cessé avec son appartenance, sans qu'aucune donnée ne lui soit transférée.

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');

select is_empty(
  $$ select id from public.participant_races $$,
  'PRIVACY — un ancien membre d''Org A ne lit plus aucun inscrit (§114)'
);

reset role;

-- ============================================================
-- 6. Le coureur reste maître de son objectif
-- ============================================================
-- §29 donne l'écriture au propriétaire : c'est le seul chemin d'écriture
-- client de ce lot, et il ne concerne que les préférences.

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ update public.participant_race_settings set target_duration_seconds = 46800
     where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  'OBJECTIF — le coureur modifie son propre objectif (§29)'
);

reset role;

select is(
  (select target_duration_seconds from public.participant_race_settings
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  46800,
  'OBJECTIF — la nouvelle valeur est bien écrite'
);

-- Migration 0017 : sans ce trigger, `updated_at` resterait à sa valeur
-- d'insertion et « depuis quand cet objectif ? » n'aurait plus de réponse.
select ok(
  (select updated_at from public.participant_race_settings
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031')
    > '2020-01-02T00:00:00Z'::timestamptz,
  'HORODATAGE — le trigger de 0017 déplace updated_at à l''écriture'
);

-- L'objectif de B n'a pas bougé pendant tout ceci : les deux participations
-- sont bien indépendantes.
select is(
  (select target_duration_seconds from public.participant_race_settings
   where participant_race_id = 'dddddddd-0000-4000-8000-000000000032'),
  50400,
  'OBJECTIF — celui de Runner B est resté intact'
);

select * from finish();

rollback;
