-- PLUKA — Canal B : l'option PLUKA vendue à l'inscription
-- Référence : migrations 0085, 0086 · docs/04_ENTITLEMENTS.md §69, §70, §73.2, E46 à E48
--
-- 1. Seul PLUKA ouvre le canal d'une édition, et jamais avec l'accès inclus.
-- 2. Un acheteur déjà sur PLUKA reçoit son Race Pass à l'import ; les autres attendent.
-- 3. Un fichier rejoué ne double rien (E46) ; une participation déjà couverte passe en conflit (E47).
-- 4. L'activation accorde le Race Pass, et l'invitation le dit réglé (E48).
-- 5. Une fusion garde la vente et la date d'inscription vérifiée.
-- 6. Canal fermé : la colonne est ignorée, et la vérification le dit.
-- 7. Les lignes restent côté serveur ; un Race Pass partner_sale nomme son origine.

begin;

create extension if not exists pgtap;

select plan(24);

\ir _personas.psql

-- Un import en admin de l'organisation : (e-mail, référence, date d'inscription).
create function pg_temp.import_sales(p_lines jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  v_id := public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'ventes.csv',
    '["Email"]', (select jsonb_agg(jsonb_build_object('Email', l ->> 0)) from jsonb_array_elements(p_lines) l));
  perform public.validate_participant_import(v_id, '{}', (
    select jsonb_agg(jsonb_build_object('rowNumber', n, 'status', 'valid', 'mapped',
      jsonb_strip_nulls(jsonb_build_object(
        'raceId', 'aaaaaaaa-0000-4000-8000-000000000013', 'email', l ->> 0,
        'firstName', 'Camille', 'lastName', 'Durand',
        'partnerSale', 'yes', 'externalReference', l ->> 1, 'registeredOn', l ->> 2))))
    from jsonb_array_elements(p_lines) with ordinality as t(l, n)));
  return v_id;
end;
$$;

create function pg_temp.race_passes(p_participant uuid) returns integer language sql as $$
  select count(*)::integer from public.entitlements
  where participant_race_id = p_participant and kind = 'race_pass' and status = 'active'
$$;

create function pg_temp.line_status(p_reference text) returns text language sql as $$
  select status from public.partner_sale_lines
  where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and external_reference = p_reference
$$;

-- Runner A est déjà sur PLUKA, et l'organisation le connaît par son adresse.
update public.participant_races set invite_email = 'runner-a@test.pluka'
where id = 'aaaaaaaa-0000-4000-8000-000000000031';

insert into auth.users (id, email) values
  ('cccccccc-0000-4000-8000-0000000000a1', 'acheteur@test.pluka'),
  ('cccccccc-0000-4000-8000-0000000000a2', 'fusion@test.pluka');

-- `fusion` a ajouté la course lui-même avant que l'organisation ne l'importe.
insert into public.participant_races (id, race_id, user_id) values
  ('cccccccc-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-0000-4000-8000-0000000000a2');

-- ============================================================
-- 1. L'ouverture du canal
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ update public.editions set partner_sales_enabled = true
     where id = 'aaaaaaaa-0000-4000-8000-000000000012' $$,
  '42501', null, 'PS-01 — le propriétaire de l''organisation n''ouvre pas le canal lui-même');
select throws_ok(
  $$ select public.admin_set_edition_partner_sales('aaaaaaaa-0000-4000-8000-000000000012', true) $$,
  '42501', null, 'PS-02 — la fonction d''ouverture est réservée à PLUKA');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  $$ select public.admin_set_edition_partner_sales('aaaaaaaa-0000-4000-8000-000000000012', true) $$,
  'PS-03 — PLUKA ouvre le canal de l''édition');
select throws_ok(
  $$ select public.admin_set_edition_participants_included('aaaaaaaa-0000-4000-8000-000000000012', true) $$,
  '55000', null, 'PS-04 — l''accès inclus ne s''ouvre pas sur une édition qui vend l''option');
reset role;

-- ============================================================
-- 2. L'import
-- ============================================================

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select pg_temp.import_sales('[["runner-a@test.pluka", "CMD-A"], ["acheteur@test.pluka", "CMD-B"],
  ["fusion@test.pluka", "CMD-F", "2026-01-10"]]') as first_import \gset
select is(
  public.get_participant_import(:'first_import') -> 'partnerSales',
  '{"open": true, "rows": 3, "new": 3}'::jsonb,
  'PS-05 — la vérification annonce les options du fichier');
select is(
  public.commit_participant_import(:'first_import') ->> 'partnerSales', '3',
  'PS-06 — l''import enregistre une vente par référence');
reset role;

select is(pg_temp.line_status('CMD-A'), 'granted',
  'PS-07 — un acheteur déjà sur PLUKA reçoit son Race Pass à l''import');
select is(
  (select format('%s/%s/%s', source, organization_id, external_reference) from public.entitlements
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031' and kind = 'race_pass'),
  'partner_sale/aaaaaaaa-0000-4000-8000-000000000001/CMD-A',
  'PS-08 — le Race Pass nomme sa source, son organisation et sa ligne d''export (§69)');
select is(pg_temp.line_status('CMD-B'), 'pending',
  'PS-09 — sans compte, la vente attend l''activation');
select is(
  (select count(*)::integer from public.entitlements e
   join public.participant_races pr on pr.id = e.participant_race_id
   where pr.invite_email = 'acheteur@test.pluka'),
  0, 'PS-10 — aucun droit n''existe avant l''activation');

-- ============================================================
-- 3. Rejeu et conflit
-- ============================================================

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.commit_participant_import(pg_temp.import_sales(
    '[["runner-a@test.pluka", "CMD-A"], ["acheteur@test.pluka", "CMD-B"]]')) ->> 'partnerSales',
  '0', 'PS-11 — E46 : un fichier rejoué n''enregistre aucune vente');
select is(
  public.commit_participant_import(pg_temp.import_sales('[["runner-a@test.pluka", "CMD-A2"]]'))
    ->> 'partnerSales',
  '1', 'PS-12 — une nouvelle référence pour un coureur déjà couvert est enregistrée');
reset role;

select is(pg_temp.line_status('CMD-A2'), 'conflict',
  'PS-13 — E47 : la participation déjà couverte passe la vente en conflit');
select is(pg_temp.race_passes('aaaaaaaa-0000-4000-8000-000000000031'), 1,
  'PS-14 — E46/E47 : jamais deux Race Pass actifs sur une participation');

-- ============================================================
-- 4. L'activation
-- ============================================================

insert into public.participant_invitations (participant_race_id, email, token_hash, status, expires_at)
select pr.id, pr.invite_email, 'jeton-' || split_part(pr.invite_email::text, '@', 1), 'sent', now() + interval '30 days'
from public.participant_races pr
where pr.invite_email in ('acheteur@test.pluka', 'fusion@test.pluka') and pr.user_id is null;

select is(
  (select format('%s/%s', included, prepaid) from public.preview_participant_invitation('jeton-acheteur')),
  'f/t', 'PS-15 — E48 : l''invitation sait la préparation réglée, sans accès inclus');

select pg_temp.act_as('cccccccc-0000-4000-8000-0000000000a1');
select public.accept_participant_invitation('jeton-acheteur') as buyer_race \gset
reset role;

select is(pg_temp.line_status('CMD-B'), 'granted', 'PS-16 — l''activation accorde la vente');
select is(
  (select format('%s/%s', kind, source) from public.entitlements
   where participant_race_id = :'buyer_race' and status = 'active'),
  'race_pass/partner_sale', 'PS-17 — E48 : un Race Pass, jamais un Organizer Included');

-- ============================================================
-- 5. La fusion
-- ============================================================

select pg_temp.act_as('cccccccc-0000-4000-8000-0000000000a2');
select is(
  public.accept_participant_invitation('jeton-fusion'), 'cccccccc-0000-4000-8000-0000000000b2'::uuid,
  'PS-18 — la participation du coureur est gardée');
reset role;

select is(
  (select format('%s/%s', l.status, l.participant_race_id) from public.partner_sale_lines l
   where l.external_reference = 'CMD-F'),
  'granted/cccccccc-0000-4000-8000-0000000000b2',
  'PS-19 — la vente suit le coureur dans sa participation, et s''accorde');
select is(
  (select registered_on from public.participant_races where id = 'cccccccc-0000-4000-8000-0000000000b2'),
  date '2026-01-10', 'PS-20 — la date d''inscription vérifiée survit à la fusion');

-- ============================================================
-- 6. Canal fermé, et ce que voit l'organisation
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select is(
  public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'partnerSales',
  '{"open": true, "pending": 0, "granted": 3, "conflict": 1}'::jsonb,
  'PS-21 — l''organisation voit ses ventes par état');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select public.admin_set_edition_partner_sales('aaaaaaaa-0000-4000-8000-000000000012', false);
reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select pg_temp.import_sales('[["nouveau@test.pluka", "CMD-Z"]]') as closed_import \gset
select is(
  (public.get_participant_import(:'closed_import') -> 'partnerSales' ->> 'open')
    || '/' || (public.commit_participant_import(:'closed_import') ->> 'partnerSales'),
  'false/0', 'PS-22 — canal fermé : la vérification le dit, l''import n''enregistre rien');
reset role;

-- ============================================================
-- 7. Côté serveur
-- ============================================================

select ok(
  not has_table_privilege('authenticated', 'public.partner_sale_lines', 'select'),
  'PS-23 — les lignes de vente ne se lisent pas directement');
select throws_ok(
  $$ insert into public.entitlements (kind, source, status, scope_type, user_id, participant_race_id)
     values ('race_pass', 'partner_sale', 'active', 'participant_race',
       '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000031') $$,
  '23514', null, 'PS-24 — un Race Pass partner_sale sans organisation ni référence est refusé');

select * from finish();
rollback;
