-- PLUKA — Suppression de compte et export
-- Référence : migration 0078, docs/03_PRIVACY_RLS.md §94

begin;

create extension if not exists pgtap;

select plan(21);

\ir _personas.psql

-- Runner A a aussi une participation venue d'Org A : la ligne de son fichier,
-- réclamée, avec une préparation et une donnée déclarative.
insert into public.participant_races
  (id, race_id, user_id, invite_email, status, registration_source, preparation_state, joined_at)
values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000014',
   '11111111-1111-4111-8111-111111111111', 'runner-a@example.com', 'active',
   'organizer_import', 'preparing', now());
insert into public.race_plans
  (id, participant_race_id, version, engine_version,
   initial_target_duration_seconds, target_duration_seconds)
values
  ('cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001',
   1, 'plan-1.0.0', 7200, 7200);
insert into private.participant_demographics (participant_race_id, nationality) values
  ('cccccccc-0000-4000-8000-000000000001', 'FRA');

insert into public.community_threads (id, edition_id, author_user_id, category, title, body) values
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000012',
   '11111111-1111-4111-8111-111111111111', 'race', 'Navette au départ ?', 'Quelqu''un sait ?');

-- ============================================================
-- La demande
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(public.request_account_deletion() ->> 'status', 'scheduled',
  'DEL-01 — un coureur ferme son compte');
select is(public.request_account_deletion() ->> 'status', 'scheduled',
  'DEL-02 — redemander ne casse rien');
reset role;

select ok(
  (select purge_after between now() + interval '29 days' and now() + interval '31 days'
   from private.account_deletion_requests where user_id = '11111111-1111-4111-8111-111111111111'),
  'DEL-03 — l''effacement est prévu 30 jours plus tard');

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(public.request_account_deletion() ->> 'reason', 'sole_owner',
  'DEL-04 — le seul propriétaire d''une organisation est refusé');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(public.request_account_deletion() ->> 'reason', 'publisher',
  'DEL-05 — l''auteur d''une publication de faits est refusé');
reset role;

select pg_temp.act_as_anon();
select throws_ok($$ select public.request_account_deletion() $$, '42501', null,
  'DEL-06 — sans session, aucune demande');
reset role;

-- ============================================================
-- L'export, avant l'effacement
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(public.export_my_data() -> 'account' ->> 'id', '11111111-1111-4111-8111-111111111111',
  'DEL-18 — l''export rend le compte de la session');
select is(jsonb_array_length(public.export_my_data() -> 'participations'), 2,
  'DEL-19 — avec ses deux participations, et rien d''un autre coureur');
select ok(public.export_my_data()::text not like '%token_hash%',
  'DEL-20 — aucune empreinte de jeton ne sort');
reset role;

-- Runner B a demandé il y a 40 jours, et s'est reconnecté depuis.
insert into private.account_deletion_requests (user_id, requested_at, purge_after) values
  ('22222222-2222-4222-8222-222222222222', now() - interval '40 days', now() - interval '10 days');
update auth.users set last_sign_in_at = now() - interval '5 days'
where id = '22222222-2222-4222-8222-222222222222';

-- ============================================================
-- La purge
-- ============================================================

select is((private.purge_expired_data(now() + interval '10 days') ->> 'accountsDeleted')::integer, 0,
  'DEL-07 — avant 30 jours, rien n''est effacé');
select isnt_empty($$ select id from public.users where id = '11111111-1111-4111-8111-111111111111' $$,
  'DEL-08 — le compte existe toujours pendant le délai');
select is_empty(
  $$ select user_id from private.account_deletion_requests where user_id = '22222222-2222-4222-8222-222222222222' $$,
  'DEL-09 — une reconnexion annule la demande');

select is((private.purge_expired_data(now() + interval '31 days') ->> 'accountsDeleted')::integer, 1,
  'DEL-10 — après 30 jours, le compte est effacé');
select is_empty($$ select id from auth.users where id = '11111111-1111-4111-8111-111111111111' $$,
  'DEL-11 — l''identité de connexion aussi');
select isnt_empty($$ select id from public.users where id = '22222222-2222-4222-8222-222222222222' $$,
  'DEL-12 — le coureur revenu est gardé');

select is_empty($$ select id from public.participant_races where id = 'aaaaaaaa-0000-4000-8000-000000000031' $$,
  'DEL-13 — une participation créée par le coureur disparaît');
select results_eq(
  $$ select user_id, preparation_state::text, joined_at from public.participant_races
     where id = 'cccccccc-0000-4000-8000-000000000001' $$,
  $$ values (null::uuid, 'to_prepare'::text, null::timestamptz) $$,
  'DEL-14 — une participation venue d''une organisation redevient sa ligne importée');
select is_empty($$ select id from public.race_plans where participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'DEL-15 — sa préparation est effacée');
select isnt_empty(
  $$ select participant_race_id from private.participant_demographics
     where participant_race_id = 'cccccccc-0000-4000-8000-000000000001' $$,
  'DEL-16 — ce que l''organisation a importé reste, jusqu''à la purge de sa liste');
select results_eq(
  $$ select author_user_id from public.community_threads where id = 'cccccccc-0000-4000-8000-000000000003' $$,
  $$ values (null::uuid) $$,
  'DEL-17 — un fil de communauté reste, sans auteur');

-- ============================================================
-- Le garde-fou : chaque clé vers un compte ou une participation est classée
-- ============================================================
-- c = part avec, n = perd son auteur, r = bloque. Une table nouvelle fait
-- échouer ce test : décider d'abord, dans delete_user_account, ce qu'elle
-- devient quand un coureur supprime son compte (§94).

select set_eq(
  $$ select c.conrelid::regclass::text || '.' || a.attname || ':' || c.confdeltype::text
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid in ('public.users'::regclass, 'public.participant_races'::regclass)
       and c.conrelid::regclass::text not like 'auth.%' $$,
  array[
    'trail_profiles.user_id:c',
    'organization_members.user_id:c',
    'bags.participant_race_id:c',
    'sources.created_by_user_id:n',
    'race_fact_versions.created_by_user_id:n',
    'race_fact_versions.validated_by_user_id:n',
    'race_notices.published_by_user_id:n',
    'participant_races.user_id:n',
    'participant_race_settings.participant_race_id:c',
    'entitlements.user_id:c',
    'entitlements.participant_race_id:c',
    'race_plans.participant_race_id:c',
    'race_change_events.published_by_user_id:n',
    'participant_change_impacts.participant_race_id:c',
    'tasks.participant_race_id:c',
    'participant_equipment.participant_race_id:c',
    'outings.user_id:c',
    'outings.linked_participant_race_id:n',
    'user_nutrition_products.user_id:c',
    'race_assistants.participant_race_id:c',
    'emergency_contacts.participant_race_id:c',
    'library_templates.user_id:c',
    'participant_imports.created_by_user_id:n',
    'condition_proposals.user_id:c',
    'condition_proposals.participant_race_id:c',
    'community_reactions.user_id:c',
    'post_race_reviews.participant_race_id:c',
    'participant_import_rows.participant_race_id:n',
    'enrichment_imports.created_by_user_id:n',
    'enrichment_import_rows.matched_participant_race_id:n',
    'enrichment_import_rows.reviewed_by_user_id:n',
    'participant_invitations.participant_race_id:c',
    'pluka_conversations.user_id:c',
    'pluka_conversations.participant_race_id:c',
    'private.fact_candidates.reviewed_by_user_id:n',
    'private.conflict_reports.resolved_by_user_id:n',
    'private.participant_performance_signals.participant_race_id:c',
    'private.analytics_events.user_id:n',
    'private.analytics_events.participant_race_id:n',
    'private.audit_logs.actor_user_id:n',
    'purchases.user_id:c',
    'purchases.participant_race_id:n',
    'entitlement_usage.participant_race_id:n',
    'entitlements.revoked_by_user_id:n',
    'entitlement_usage.user_id:c',
    'beta_access_grants.user_id:c',
    'beta_access_grants.participant_race_id:c',
    'beta_access_grants.created_by_user_id:n',
    'private.race_intelligence_run_members.participant_race_id:c',
    'race_status_transitions.actor_user_id:n',
    'participant_invitations.accepted_by_user_id:n',
    'race_fact_versions.published_by_user_id:r',
    'private.fact_publication_acts.actor_user_id:r',
    'private.notification_deliveries.participant_race_id:c',
    'event_status_transitions.actor_user_id:n',
    'edition_status_transitions.actor_user_id:n',
    'organization_invitations.invited_by_user_id:n',
    'organization_invitations.accepted_by_user_id:n',
    'staff_invitations.invited_by_user_id:n',
    'staff_invitations.accepted_by_user_id:n',
    'organizations.deleted_by_user_id:n',
    'private.event_discoveries.requested_by_user_id:n',
    'event_sites.published_by_user_id:n',
    'event_sites.updated_by_user_id:n',
    'sources.public_download_by_user_id:n',
    'participant_invitations.invited_by_user_id:n',
    'private.participant_demographics.participant_race_id:c',
    'repere_estimates.participant_race_id:c',
    'private.beta_access_reservations.created_by_user_id:n',
    'repere_calibration_pairs.user_id:c',
    'private.account_deletion_requests.user_id:c',
    'community_threads.author_user_id:n',
    'community_posts.author_user_id:n',
    'community_reports.reporter_user_id:n',
    'participant_start_changes.participant_race_id:c',
    -- Une vente a eu lieu même si la participation disparaît : elle reste, détachée (0086).
    'partner_sale_lines.participant_race_id:n'
  ],
  'DEL-21 — chaque clé vers un compte ou une participation a une règle décidée');

select * from finish();
rollback;
