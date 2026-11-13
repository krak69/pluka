-- PLUKA — Acheter un Race Pass
-- Référence : migration 0088 · docs/00_PRODUCT_SPEC.md §6.5 · docs/04_ENTITLEMENTS.md §26, §70, §72.1, §73.1
--
-- 1. L'offre et l'achat appartiennent au coureur de la participation.
-- 2. La base décide du tarif à son heure : inscrit, ou standard (mêmes bornes que le domaine).
-- 3. Un second clic reprend l'achat ; une course déjà couverte ne se vend pas (DUPLICATE_PURCHASE).
-- 4. La vente porte l'organisation du lien suivi (§73.1).
-- 5. Seul le webhook confirme ; rejoué, il ne crée rien ; une course couverte entre-temps passe en conflit.
-- 6. Catalogue et confirmation restent côté serveur.

begin;

create extension if not exists pgtap;

select plan(22);

\ir _personas.psql

-- L'épreuve part dans 200 jours ; Runner A s'est inscrit aujourd'hui (date vérifiée).
update public.races set start_datetime = now() + interval '200 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';
update public.participant_races set registered_on = (now() at time zone 'Europe/Paris')::date
where id = 'aaaaaaaa-0000-4000-8000-000000000031';

-- Runner B suit le lien de l'organisation pour ajouter la même épreuve, inscrit il y a 30 jours.
select code as code_a from public.organization_referral_codes
where edition_id = 'aaaaaaaa-0000-4000-8000-000000000012' \gset
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select public.attach_participant_race('aaaaaaaa-0000-4000-8000-000000000013', :'code_a') as part_b \gset
reset role;
update public.participant_races set registered_on = (now() at time zone 'Europe/Paris')::date - 30
where id = :'part_b';

-- ============================================================
-- 1. À qui
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select coverage from public.get_race_pass_offer('aaaaaaaa-0000-4000-8000-000000000031')),
  null, 'CHK-01 — la course n''est couverte par rien');
select is(
  (select format('%s/%s/%s', registration_origin, standard_amount_minor, early_amount_minor)
   from public.get_race_pass_offer('aaaaaaaa-0000-4000-8000-000000000031')),
  'verified/1490/990', 'CHK-02 — le coureur lit sa date de référence et les deux prix du catalogue');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select * from public.get_race_pass_offer('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'P0002', null, 'CHK-03 — un autre coureur ne lit pas cette offre');
select throws_ok(
  $$ select * from public.start_race_pass_purchase('aaaaaaaa-0000-4000-8000-000000000031', 'test') $$,
  'P0002', null, 'CHK-04 — ni n''achète pour lui');
reset role;

-- ============================================================
-- 2. Le tarif, décidé par la base
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select * from public.start_race_pass_purchase('aaaaaaaa-0000-4000-8000-000000000031', 'test') \gset first_
select is(:'first_product_key' || '/' || :'first_amount_minor', 'race_pass_early/990',
  'CHK-05 — inscrit aujourd''hui, départ dans 200 jours : tarif inscrit');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select * from public.start_race_pass_purchase(:'part_b', 'test') \gset b_
select is(:'b_product_key' || '/' || :'b_amount_minor', 'race_pass/1490',
  'CHK-06 — inscrit il y a 30 jours : tarif standard');
reset role;

-- ============================================================
-- 3. Reprise et doublon
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select purchase_id::text || '/' || reused from public.start_race_pass_purchase('aaaaaaaa-0000-4000-8000-000000000031', 'test')),
  :'first_purchase_id' || '/true', 'CHK-07 — un second clic reprend l''achat en cours');
select lives_ok(
  format($$ select public.set_purchase_checkout_reference(%L, 'cs_test_a') $$, :'first_purchase_id'),
  'CHK-08 — l''achat reçoit la référence de sa session de paiement');
reset role;

-- ============================================================
-- 4. L'attribution
-- ============================================================

select is(
  (select format('%s/%s', channel, organization_id) from public.purchases where id = :'b_purchase_id'),
  'organizer_link/aaaaaaaa-0000-4000-8000-000000000001',
  'CHK-09 — la vente revient à l''organisation dont le coureur a suivi le lien');
select is(
  (select channel from public.purchases where id = :'first_purchase_id'),
  'app', 'CHK-10 — sans lien, la vente est directe');

-- ============================================================
-- 5. La confirmation
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.billing_record_checkout_event('test', 'evt_x', 'checkout.completed', null,
       'cs_test_a', 'pi_x', 'paid', now()) $$,
  '42501', null, 'CHK-11 — un client ne confirme pas son propre paiement');
reset role;

set local role service_role;
select is(
  public.billing_record_checkout_event('test', 'evt_1', 'checkout.completed', null,
    'cs_test_a', 'pi_1', 'paid', now()),
  'granted', 'CHK-12 — le webhook vérifié confirme et accorde');
select is(
  public.billing_record_checkout_event('test', 'evt_1', 'checkout.completed', null,
    'cs_test_a', 'pi_1', 'paid', now()),
  'duplicate', 'CHK-13 — rejoué, il ne crée rien');
reset role;

select is(
  (select format('%s/%s', e.kind, e.source) from public.entitlements e
   join public.purchases pu on pu.entitlement_id = e.id where pu.id = :'first_purchase_id'),
  'race_pass/purchase', 'CHK-14 — un Race Pass identique quel que soit le tarif (§72)');
select is(
  (select count(*)::integer from public.entitlements
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' and kind = 'race_pass'),
  1, 'CHK-15 — un seul droit');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select * from public.start_race_pass_purchase('aaaaaaaa-0000-4000-8000-000000000031', 'test') $$,
  '23505', null, 'CHK-16 — DUPLICATE_PURCHASE : une course déjà couverte ne se revend pas');
reset role;

-- Runner B reçoit un Race Pass par le canal B pendant que son paiement est en cours.
insert into public.entitlements (kind, source, status, scope_type, user_id, participant_race_id,
  organization_id, external_reference)
values ('race_pass', 'partner_sale', 'active', 'participant_race',
  '22222222-2222-4222-8222-222222222222', :'part_b', 'aaaaaaaa-0000-4000-8000-000000000001', 'CMD-B');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select public.set_purchase_checkout_reference(:'b_purchase_id', 'cs_test_b');
reset role;

set local role service_role;
select is(
  public.billing_record_checkout_event('test', 'evt_2', 'checkout.completed', null,
    'cs_test_b', 'pi_2', 'paid', now()),
  'conflict', 'CHK-17 — couverte entre-temps : le paiement est gardé et signalé, sans second droit');
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  (select format('%s/%s', status, conflict) from public.get_my_purchase(:'b_purchase_id')),
  'paid/t', 'CHK-18 — le coureur voit son paiement en conflit, à rembourser');
reset role;

-- ============================================================
-- 6. Côté serveur
-- ============================================================

-- Les bornes de packages/domain/tests/early-bird.test.ts, rejouées côté base.
update public.participant_races set registered_on = '2026-03-01'
where id = 'aaaaaaaa-0000-4000-8000-000000000031';
update public.races set start_datetime = '2026-10-10T05:00:00Z'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';
select is(private.race_pass_early_ends_before('aaaaaaaa-0000-4000-8000-000000000031'),
  '2026-03-16T23:00:00Z'::timestamptz,
  'CHK-21 — inscrit le 1er mars : tarif jusqu''au 16 mars 23:59 à Paris, comme le domaine');
update public.races set start_datetime = '2026-05-10T05:00:00Z'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';
select is(private.race_pass_early_ends_before('aaaaaaaa-0000-4000-8000-000000000031'),
  '2026-03-11T05:00:00.001Z'::timestamptz,
  'CHK-22 — la borne des 60 jours avant le départ, comme le domaine');

select ok(not has_table_privilege('authenticated', 'public.billing_products', 'select'),
  'CHK-19 — le catalogue ne se lit pas directement');
select ok(not has_table_privilege('authenticated', 'public.purchases', 'insert'),
  'CHK-20 — aucun client n''écrit un achat directement');

select * from finish();
rollback;
