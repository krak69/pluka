-- PLUKA — Invitations des participants
-- Référence : docs/03_PRIVACY_RLS.md §115–§118 · docs/04_ENTITLEMENTS.md §12, §65, §70 ·
--             migration 0069

begin;

create extension if not exists pgtap;

select plan(37);

\ir _personas.psql

-- Les épreuves des personas sont parties en juin : celle-ci repart dans deux mois.
update public.races set start_datetime = now() + interval '60 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

insert into auth.users (id, email) values
  ('cccccccc-1111-4111-8111-000000000001', 'camille@example.com'),
  ('cccccccc-1111-4111-8111-000000000002', 'dana@example.com'),
  ('cccccccc-1111-4111-8111-000000000003', 'autre@example.com');

insert into public.race_start_waves (id, race_id, name, start_datetime, sort_order) values
  ('cccccccc-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000013',
   'Vague 2', now() + interval '60 days', 2);

insert into public.participant_races
  (id, race_id, invite_email, first_name_snapshot, bib_number, start_wave_id, status,
   registration_source)
values
  -- Importée, jamais activée : invitable.
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   'camille@example.com', 'Camille', '101', null, 'active', 'organizer_import'),
  -- Importée, et la coureuse s'est déjà inscrite seule : fusion.
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013',
   'dana@example.com', 'Dana', '102', 'cccccccc-0000-4000-8000-0000000000a1', 'active',
   'organizer_import'),
  -- Retirée : jamais invitée.
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000013',
   'retire@example.com', 'Rémi', '103', null, 'archived', 'organizer_import');

insert into public.participant_races (id, race_id, user_id, status)
values
  ('cccccccc-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000013',
   'cccccccc-1111-4111-8111-000000000002', 'active');

insert into public.race_plans
  (id, participant_race_id, version, engine_version,
   initial_target_duration_seconds, target_duration_seconds)
values
  ('cccccccc-0000-4000-8000-0000000000b1', 'cccccccc-0000-4000-8000-000000000004',
   1, 'test', 36000, 36000);

insert into private.participant_demographics (participant_race_id, nationality)
values ('cccccccc-0000-4000-8000-000000000002', 'FRA');

-- ============================================================
-- 1. Qui envoie
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'INVITE-01 — un éditeur n''invite pas');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'INVITE-02 — une autre organisation n''invite pas');
select throws_ok(
  $$ select * from public.org_list_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'INVITE-03 — une autre organisation ne lit pas les invitations');
reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012'),
  2, 'INVITE-04 — un admin invite les deux participants invitables');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012'),
  0, 'INVITE-05 — renvoyer à tous n''invite pas deux fois');
reset role;

select is_empty(
  $$ select id from public.participant_invitations
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000003' $$,
  'INVITE-06 — un participant retiré n''est pas invité');
select is(
  (select count(*)::integer from private.outbox_events o
   join public.participant_invitations i on i.id = o.aggregate_id
   where o.event_type = 'email.participant_invitation'
     and i.participant_race_id::text like 'cccccccc-%'),
  2, 'INVITE-07 — chaque invitation demande son envoi dans la transaction');
select is_empty(
  $$ select id from public.participant_invitations
     where token_hash is not null and participant_race_id::text like 'cccccccc-%' $$,
  'INVITE-08 — aucun jeton n''existe avant l''envoi');
select is(
  (select expires_at from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  (select start_datetime from public.races where id = 'aaaaaaaa-0000-4000-8000-000000000013'),
  'INVITE-09 — le lien vaut jusqu''au départ');

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select is(
  (select count(*)::integer from public.org_list_participant_invitations(
     'aaaaaaaa-0000-4000-8000-000000000012')
   where participant_race_id::text like 'cccccccc-%'),
  2, 'INVITE-10 — un lecteur de l''organisation suit les invitations');
reset role;

-- Le worker tire les jetons.
select is(
  (select sendable from public.worker_claim_participant_invitation(
     (select id from public.participant_invitations
      where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
     repeat('1', 64))),
  true, 'INVITE-11 — le worker réclame l''envoi');
select public.worker_complete_participant_invitation(
  (select id from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'));
select public.worker_claim_participant_invitation(
  (select id from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000002'),
  repeat('2', 64));
select public.worker_complete_participant_invitation(
  (select id from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000002'));

select is(
  (select sendable from public.worker_claim_participant_invitation(
     (select id from public.participant_invitations
      where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
     repeat('9', 64))),
  false, 'INVITE-12 — une invitation envoyée ne se renvoie pas par la file');

-- ============================================================
-- 2. Le lien
-- ============================================================

set local role anon;
select results_eq(
  $$ select state, masked_email, included from public.preview_participant_invitation(repeat('1', 64)) $$,
  $$ values ('valid'::text, 'c***@example.com'::text, false) $$,
  'INVITE-13 — l''aperçu anonyme masque l''adresse');
select is(
  (select state from public.preview_participant_invitation(repeat('0', 64))),
  'unknown', 'INVITE-14 — un jeton inconnu ne dit rien de plus');
select throws_ok(
  $$ select public.accept_participant_invitation(repeat('1', 64)) $$,
  '42501', null, 'INVITE-15 — anonyme, on n''active pas');
reset role;

select pg_temp.act_as('cccccccc-1111-4111-8111-000000000003');
select throws_ok(
  $$ select public.accept_participant_invitation(repeat('1', 64)) $$,
  '42501', null, 'INVITE-16 — un lien transféré ne suffit pas (§117)');
reset role;

-- L'accès inclus est réglé par PLUKA, pas par l'organisation.
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ update public.editions set participants_included = true
     where id = 'aaaaaaaa-0000-4000-8000-000000000012' $$,
  '42501', null, 'INVITE-17 — l''organisation ne s''accorde pas l''accès inclus');
select throws_ok(
  $$ select public.admin_set_edition_participants_included(
       'aaaaaaaa-0000-4000-8000-000000000012', true) $$,
  '42501', null, 'INVITE-18 — le réglage est réservé à PLUKA');
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  $$ select public.admin_set_edition_participants_included(
       'aaaaaaaa-0000-4000-8000-000000000012', true) $$,
  'INVITE-19 — PLUKA ouvre l''accès inclus de l''édition');
reset role;

-- ============================================================
-- 3. Activer
-- ============================================================

select pg_temp.act_as('cccccccc-1111-4111-8111-000000000001');
select is(
  public.accept_participant_invitation(repeat('1', 64)),
  'cccccccc-0000-4000-8000-000000000001'::uuid,
  'INVITE-20 — la bonne adresse active, et retrouve sa participation');
select throws_ok(
  $$ select public.accept_participant_invitation(repeat('1', 64)) $$,
  '55000', null, 'INVITE-21 — une invitation ne s''active qu''une fois (§118)');
reset role;

select is(
  (select user_id from public.participant_races where id = 'cccccccc-0000-4000-8000-000000000001'),
  'cccccccc-1111-4111-8111-000000000001'::uuid,
  'INVITE-22 — la participation est rattachée au compte');
select results_eq(
  $$ select kind::text, source::text, organization_id from public.entitlements
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  $$ values ('organizer_included'::text, 'organization'::text,
             'aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
  'INVITE-23 — l''accès inclus est accordé, lié à l''organisation');

-- La fusion.
select pg_temp.act_as('cccccccc-1111-4111-8111-000000000002');
select is(
  public.accept_participant_invitation(repeat('2', 64)),
  'cccccccc-0000-4000-8000-000000000004'::uuid,
  'INVITE-24 — une coureuse déjà inscrite retrouve sa propre participation');
reset role;

select is_empty(
  $$ select id from public.participant_races where id = 'cccccccc-0000-4000-8000-000000000002' $$,
  'INVITE-25 — la ligne importée a été fusionnée');
select results_eq(
  $$ select bib_number, start_wave_id, invite_email::text from public.participant_races
     where id = 'cccccccc-0000-4000-8000-000000000004' $$,
  $$ values ('102'::text, 'cccccccc-0000-4000-8000-0000000000a1'::uuid, 'dana@example.com'::text) $$,
  'INVITE-26 — dossard, vague et adresse du fichier la rejoignent');
select isnt_empty(
  $$ select id from public.race_plans where participant_race_id = 'cccccccc-0000-4000-8000-000000000004' $$,
  'INVITE-27 — sa préparation est intacte');
select is(
  (select nationality from private.participant_demographics
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000004'),
  'FRA', 'INVITE-28 — ce que l''import savait la suit');
select is(
  (select status::text from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000004'),
  'activated', 'INVITE-29 — l''invitation reste attachée, activée');
select is(
  (select count(*)::integer from public.entitlements
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000004'
     and kind = 'organizer_included'),
  1, 'INVITE-30 — l''accès inclus va à la participation fusionnée');

-- ============================================================
-- 4. Retrait et renvoi
-- ============================================================

insert into public.participant_races (id, race_id, invite_email, status, registration_source)
values ('cccccccc-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000013',
        'eli@example.com', 'active', 'organizer_import');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012',
    array['cccccccc-0000-4000-8000-000000000005'::uuid]),
  1, 'INVITE-31 — un renvoi ciblé invite cette ligne');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012',
    array['cccccccc-0000-4000-8000-000000000005'::uuid]),
  1, 'INVITE-32 — renvoyer crée un nouveau lien');
reset role;

select results_eq(
  $$ select status::text from public.participant_invitations
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000005'
     order by created_at, status $$,
  $$ values ('pending'::text), ('revoked'::text) $$,
  'INVITE-33 — le lien précédent est révoqué');

update public.participant_races set status = 'archived'
where id = 'cccccccc-0000-4000-8000-000000000005';

select is_empty(
  $$ select id from public.participant_invitations
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000005'
       and status in ('pending', 'sent') $$,
  'INVITE-34 — retirer un participant révoque son invitation');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012',
    array['cccccccc-0000-4000-8000-000000000001'::uuid]),
  0, 'INVITE-35 — un compte déjà rattaché n''est plus invité');
reset role;

-- Un envoi en échec : le fournisseur a refusé, l'invitation reste ouverte.
update public.participant_races set status = 'active'
where id = 'cccccccc-0000-4000-8000-000000000005';
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012',
  array['cccccccc-0000-4000-8000-000000000005'::uuid]);
reset role;
select public.worker_fail_participant_invitation(
  (select id from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000005' and status = 'pending'),
  '[permanent] PROVIDER_REJECTED : réponse 403 du fournisseur');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012'),
  1, 'INVITE-37 — inviter tout le monde reprend les envois en échec');
reset role;

update public.races set start_datetime = now() - interval '1 hour'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';
update public.participant_races set status = 'active'
where id = 'cccccccc-0000-4000-8000-000000000005';

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012'),
  0, 'INVITE-36 — une épreuve partie n''invite plus');
reset role;

select * from finish();
rollback;
