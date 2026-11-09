-- PLUKA — Refuser d'être contacté
-- Référence : migration 0075

begin;

create extension if not exists pgtap;

select plan(7);

\ir _personas.psql

update public.races set start_datetime = now() + interval '60 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

insert into public.participant_races (id, race_id, invite_email, status, registration_source)
values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
        'refus@example.com', 'active', 'organizer_import');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012',
  array['cccccccc-0000-4000-8000-000000000001'::uuid]);
reset role;

select public.worker_claim_participant_invitation(
  (select id from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  repeat('7', 64));

set local role anon;
select is(public.decline_participant_invitation(repeat('0', 64)), 'unknown',
  'OPTOUT-01 — un lien inconnu ne refuse rien');
select is(public.decline_participant_invitation(repeat('7', 64)), 'declined',
  'OPTOUT-02 — le lien de l''e-mail suffit pour refuser, sans compte');
reset role;

select is(
  (select status::text from public.participant_invitations
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  'revoked', 'OPTOUT-03 — l''invitation est révoquée');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.org_send_participant_invitations('aaaaaaaa-0000-4000-8000-000000000012',
    array['cccccccc-0000-4000-8000-000000000001'::uuid]),
  0, 'OPTOUT-04 — un renvoi ne recontacte pas l''adresse');
select is(
  (select count(*)::integer from public.org_list_contact_optouts('aaaaaaaa-0000-4000-8000-000000000012')
   where participant_race_id = 'cccccccc-0000-4000-8000-000000000001'),
  1, 'OPTOUT-05 — l''organisation voit que la ligne a refusé');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.org_list_contact_optouts('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'OPTOUT-06 — une autre organisation ne le voit pas');
reset role;

-- Une autre organisation garde le droit d'inviter cette adresse.
insert into public.participant_races (id, race_id, invite_email, status, registration_source)
values ('cccccccc-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000013',
        'refus@example.com', 'active', 'organizer_import');
update public.races set start_datetime = now() + interval '60 days'
where id = 'bbbbbbbb-0000-4000-8000-000000000013';

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select is(
  public.org_send_participant_invitations('bbbbbbbb-0000-4000-8000-000000000012',
    array['cccccccc-0000-4000-8000-000000000002'::uuid]),
  1, 'OPTOUT-07 — le refus vaut pour une organisation, pas pour toutes');
reset role;

select * from finish();
rollback;
