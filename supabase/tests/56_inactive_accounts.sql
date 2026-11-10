-- PLUKA — Comptes inactifs depuis 3 ans
-- Référence : migration 0079

begin;

create extension if not exists pgtap;

select plan(12);

\ir _personas.psql

-- Runner A ne s'est pas connecté depuis 3 ans moins 20 jours ; Runner B s'est
-- connecté hier. L'owner d'Org A est inactif, mais seul propriétaire.
update auth.users set last_sign_in_at = now() - interval '3 years' + interval '20 days'
where id in ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
update auth.users set last_sign_in_at = now() - interval '1 day'
where id = '22222222-2222-4222-8222-222222222222';

select is((private.purge_expired_data(now()) ->> 'inactivityNotices')::integer, 1,
  'INACT-01 — un seul coureur est à prévenir');
select results_eq(
  $$ select reason, notice_status from private.account_deletion_requests
     where user_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values ('inactivity'::text, 'pending'::text) $$,
  'INACT-02 — 30 jours avant, une demande s''ouvre, e-mail à envoyer');
select isnt_empty(
  $$ select id from private.outbox_events
     where event_type = 'email.account_inactivity'
       and payload ->> 'accountNoticeUserId' = '11111111-1111-4111-8111-111111111111' $$,
  'INACT-03 — l''e-mail part dans la même transaction');
select is_empty(
  $$ select user_id from private.account_deletion_requests
     where user_id in ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333') $$,
  'INACT-04 — ni un coureur actif, ni un seul propriétaire');

select is((private.purge_expired_data(now()) ->> 'inactivityNotices')::integer, 0,
  'INACT-05 — relancer la purge ne prévient pas deux fois');

-- L'e-mail n'est pas parti : même 40 jours plus tard, rien n'est effacé.
select is((private.purge_expired_data(now() + interval '40 days') ->> 'deletionsAwaitingNotice')::integer, 1,
  'INACT-06 — jamais prévenu, jamais effacé');
select isnt_empty($$ select id from public.users where id = '11111111-1111-4111-8111-111111111111' $$,
  'INACT-07 — le compte est toujours là');

-- Le worker envoie.
select results_eq(
  $$ select sendable, recipient_email, attempt
     from public.worker_claim_account_notice('11111111-1111-4111-8111-111111111111') $$,
  $$ values (true, 'runner-a@test.pluka'::text, 1) $$,
  'INACT-08 — le worker réclame l''envoi');
select public.worker_complete_account_notice('11111111-1111-4111-8111-111111111111');
select ok(
  (select purge_after >= now() + interval '29 days' from private.account_deletion_requests
   where user_id = '11111111-1111-4111-8111-111111111111'),
  'INACT-09 — l''échéance court depuis l''envoi');
select is(
  (select sendable from public.worker_claim_account_notice('11111111-1111-4111-8111-111111111111')),
  false,
  'INACT-10 — un avertissement parti ne repart pas');

select is((private.purge_expired_data(now() + interval '31 days') ->> 'accountsDeleted')::integer, 1,
  'INACT-11 — prévenu et sans retour : le compte est effacé');

set local role authenticated;
select throws_ok(
  $$ select public.worker_claim_account_notice('22222222-2222-4222-8222-222222222222') $$,
  '42501', null,
  'INACT-12 — un coureur ne peut pas appeler les fonctions du worker');
reset role;

select * from finish();
rollback;
