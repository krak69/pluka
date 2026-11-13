-- PLUKA — La boîte de réception des webhooks de paiement
-- Référence : migration 0089 · docs/01_ARCHITECTURE.md §28.1 · docs/03_PRIVACY_RLS.md §8
--
-- 1. Le prestataire dépose sans session ; le dépôt ne décide rien et part vers le worker.
-- 2. Les tailles sont bornées.
-- 3. Seul le worker lit et solde une livraison ; une livraison soldée ne se relit pas.

begin;

create extension if not exists pgtap;

select plan(8);

\ir _personas.psql

set local role anon;
select public.billing_receive_webhook('test', '{"id":"evt_1"}', 'abc') as delivery \gset
reset role;

select is(
  (select status from private.billing_webhook_inbox where id = :'delivery'),
  'received', 'INBOX-01 — le prestataire dépose sans session, et rien n''est décidé');
select is(
  (select event_type from private.outbox_events where aggregate_id = :'delivery'),
  'billing.webhook_received', 'INBOX-02 — le dépôt part vers le worker par l''outbox');

select private.dispatch_outbox_events(500);
select is(
  (select status from private.outbox_events where aggregate_id = :'delivery'),
  'published', 'INBOX-03 — l''aiguillage connaît la file du paiement');

set local role anon;
select throws_ok(
  $$ select public.billing_receive_webhook('test', repeat('x', 70000), 'abc') $$,
  '23514', null, 'INBOX-04 — un corps démesuré est refusé');
select throws_ok(
  $$ select * from public.worker_claim_billing_webhook(gen_random_uuid()) $$,
  '42501', null, 'INBOX-05 — un client ne lit pas la boîte');
reset role;

set local role service_role;
select is(
  (select provider || '/' || raw_body from public.worker_claim_billing_webhook(:'delivery')),
  'test/{"id":"evt_1"}', 'INBOX-06 — le worker lit la livraison brute');
select public.worker_settle_billing_webhook(:'delivery', 'rejected', 'SIGNATURE');
select is(
  (select count(*)::integer from public.worker_claim_billing_webhook(:'delivery')),
  0, 'INBOX-07 — une livraison soldée ne se relit pas');
reset role;

select is(
  (select format('%s/%s', status, result) from private.billing_webhook_inbox where id = :'delivery'),
  'rejected/SIGNATURE', 'INBOX-08 — l''issue reste visible pour le diagnostic');

select * from finish();
rollback;
