-- PLUKA — Modération de la Communauté par l'organisation
-- Référence : migration 0116 · 03_PRIVACY_RLS §55 · décisions du 2026-11-27
--
-- 1. La file : owner, admin de l'organisation et admin PLUKA lisent les
--    contenus signalés de l'édition, sans jamais le déclarant ; editor,
--    viewer, une autre organisation, un participant, anon ne la lisent pas.
-- 2. Masquer une réponse clôt ses signalements, sous une entrée d'audit ; un
--    second clic ne change rien. L'auteur la voit masquée, les autres plus.
-- 3. Rétablir la remet en ligne sans rouvrir ses signalements.
-- 4. Garder en ligne classe les signalements du contenu sans suite.
-- 5. Masquer un sujet, même sans signalement, clôt ceux de ses réponses.
-- 6. Refus : rôles sans modération, autre organisation, cible invalide ou
--    inconnue, écriture directe, fonction privée.
-- 7. Un contenu supprimé par son auteur : ni titre ni texte pour la
--    modération, pas de retour, ses signalements se closent.

begin;

create extension if not exists pgtap;

select plan(49);

\ir _personas.psql

-- Runner B court « Test privé », même édition que Runner A ; Runner C court
-- chez Org B.
insert into auth.users (id, email) values
  ('12121212-1212-4121-8121-121212121212', 'runner-c@test.pluka');

update public.users set first_name = 'Alice', last_name = 'dupont'
where id = '11111111-1111-4111-8111-111111111111';
update public.users set first_name = 'Bruno', last_name = null
where id = '22222222-2222-4222-8222-222222222222';

insert into public.participant_races (id, race_id, user_id, status) values
  ('aaaaaaaa-0000-4000-8000-000000000281', 'aaaaaaaa-0000-4000-8000-000000000014',
   '22222222-2222-4222-8222-222222222222', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000281', 'bbbbbbbb-0000-4000-8000-000000000013',
   '12121212-1212-4121-8121-121212121212', 'active');

-- T1 (Alice) et sa réponse P1 (Bruno), T2 (Bruno) ; T3 chez Org B.
insert into public.community_threads (id, edition_id, author_user_id, category, title, body) values
  ('aaaaaaaa-0000-4000-8000-000000000291', 'aaaaaaaa-0000-4000-8000-000000000012',
   '11111111-1111-4111-8111-111111111111', 'race', 'Descente du col', 'Roulant ?'),
  ('aaaaaaaa-0000-4000-8000-000000000293', 'aaaaaaaa-0000-4000-8000-000000000012',
   '22222222-2222-4222-8222-222222222222', 'logistics', 'Navette du matin', 'Qui monte ?'),
  ('bbbbbbbb-0000-4000-8000-000000000291', 'bbbbbbbb-0000-4000-8000-000000000012',
   '12121212-1212-4121-8121-121212121212', 'other', 'Chez Org B', 'Bonjour');

insert into public.community_posts (id, thread_id, author_user_id, body) values
  ('aaaaaaaa-0000-4000-8000-000000000292', 'aaaaaaaa-0000-4000-8000-000000000291',
   '22222222-2222-4222-8222-222222222222', 'Très technique.');

insert into public.community_reports (id, reporter_user_id, thread_id, post_id, reason, details) values
  ('aaaaaaaa-0000-4000-8000-000000000295', '22222222-2222-4222-8222-222222222222',
   'aaaaaaaa-0000-4000-8000-000000000291', null, 'spam', 'Pub déguisée'),
  ('aaaaaaaa-0000-4000-8000-000000000296', '11111111-1111-4111-8111-111111111111',
   null, 'aaaaaaaa-0000-4000-8000-000000000292', 'abuse', null),
  ('aaaaaaaa-0000-4000-8000-000000000297', '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000293', null, 'other', 'Hors sujet'),
  ('bbbbbbbb-0000-4000-8000-000000000295', '12121212-1212-4121-8121-121212121212',
   'bbbbbbbb-0000-4000-8000-000000000291', null, 'spam', null);

-- ============================================================
-- 1. La file
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is(
  jsonb_array_length(public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') -> 'reported'),
  3,
  'l''owner lit les trois contenus signalés de son édition, pas ceux d''Org B'
);

select results_eq(
  $$ select e ->> 'kind', e ->> 'threadTitle', e ->> 'body', e ->> 'authorLabel',
            jsonb_array_length(e -> 'reports')
     from jsonb_array_elements(
       public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') -> 'reported'
     ) e
     where e ->> 'postId' = 'aaaaaaaa-0000-4000-8000-000000000292' $$,
  $$ values ('post'::text, 'Descente du col'::text, 'Très technique.'::text, 'Bruno'::text, 1) $$,
  'une réponse signalée : son sujet, son texte, son auteur « Prénom N. »'
);

select is(
  (select array_agg(k order by k)
   from jsonb_object_keys(
     public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012')
       -> 'reported' -> 0 -> 'reports' -> 0
   ) k),
  array['createdAt', 'details', 'reason', 'reportId'],
  'un signalement : motif, précisions, date — pas de déclarant'
);

select ok(
  public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012')::text
    !~ '(11111111-1111|22222222-2222|12121212-1212)',
  'aucun identifiant de compte dans la file'
);

reset role;
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select lives_ok(
  $$ select public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') $$,
  'l''admin de l''organisation lit la file'
);

reset role;
select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  $$ select public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') $$,
  'l''admin PLUKA lit la file'
);

reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null,
  'l''editor de l''organisation ne lit pas la file'
);

reset role;
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null,
  'le viewer de l''organisation ne lit pas la file'
);

reset role;
select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null,
  'l''owner d''une autre organisation ne lit pas la file'
);

reset role;
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null,
  'un participant ne lit pas la file'
);

reset role;
select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null,
  'anon ne lit pas la file'
);

-- ============================================================
-- 2. Masquer une réponse
-- ============================================================

reset role;
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  public.hide_community_content(null, 'aaaaaaaa-0000-4000-8000-000000000292'),
  1,
  'l''admin masque la réponse signalée : un signalement clos'
);
select is(
  public.hide_community_content(null, 'aaaaaaaa-0000-4000-8000-000000000292'),
  0,
  'un second clic ne change rien'
);

reset role;
select results_eq(
  $$ select p.status::text, r.status::text, r.resolved_at is not null
     from public.community_posts p, public.community_reports r
     where p.id = 'aaaaaaaa-0000-4000-8000-000000000292'
       and r.id = 'aaaaaaaa-0000-4000-8000-000000000296' $$,
  $$ values ('hidden'::text, 'resolved'::text, true) $$,
  'la réponse est masquée, son signalement résolu'
);

select results_eq(
  $$ select actor_user_id, action, entity_table, after_data ->> 'statusTo',
            after_data -> 'closedReportIds'
     from private.audit_logs
     where entity_id = 'aaaaaaaa-0000-4000-8000-000000000292' $$,
  $$ values ('44444444-4444-4444-8444-444444444444'::uuid, 'community.hide'::text,
            'community_posts'::text, 'hidden'::text,
            '["aaaaaaaa-0000-4000-8000-000000000296"]'::jsonb) $$,
  'une seule entrée d''audit : qui, quoi, les signalements clos'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  (select p ->> 'status'
   from jsonb_array_elements(
     public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000291') -> 'posts'
   ) p),
  'hidden',
  'son auteur voit encore sa réponse, signalée comme masquée'
);
select is(
  (public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000291') ->> 'openReportCount')::int,
  0,
  'un participant ne voit pas les signalements du sujet'
);

reset role;
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  jsonb_array_length(public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000291') -> 'posts'),
  0,
  'les autres participants ne la voient plus'
);

reset role;
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select results_eq(
  $$ select (t ->> 'canModerate')::boolean, (t ->> 'openReportCount')::int,
            t -> 'posts' -> 0 ->> 'status', (t -> 'posts' -> 0 ->> 'openReportCount')::int
     from public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000291') t $$,
  $$ values (true, 1, 'hidden'::text, 0) $$,
  'l''owner voit dans le sujet ses signalements ouverts et la réponse masquée'
);
select results_eq(
  $$ select jsonb_array_length(q -> 'reported'), jsonb_array_length(q -> 'hidden'),
            q -> 'hidden' -> 0 ->> 'postId'
     from public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') q $$,
  $$ values (2, 1, 'aaaaaaaa-0000-4000-8000-000000000292'::text) $$,
  'la réponse quitte les signalements et rejoint les contenus masqués'
);

-- ============================================================
-- 3. Rétablir
-- ============================================================

select lives_ok(
  $$ select public.restore_community_content(null, 'aaaaaaaa-0000-4000-8000-000000000292') $$,
  'l''owner rétablit la réponse'
);
select lives_ok(
  $$ select public.restore_community_content(null, 'aaaaaaaa-0000-4000-8000-000000000292') $$,
  'la rétablir une seconde fois ne lève rien'
);

reset role;
select results_eq(
  $$ select p.status::text, r.status::text
     from public.community_posts p, public.community_reports r
     where p.id = 'aaaaaaaa-0000-4000-8000-000000000292'
       and r.id = 'aaaaaaaa-0000-4000-8000-000000000296' $$,
  $$ values ('published'::text, 'resolved'::text) $$,
  'la réponse est en ligne ; son signalement n''est pas rouvert'
);
select is(
  (select count(*) from private.audit_logs
   where entity_id = 'aaaaaaaa-0000-4000-8000-000000000292' and action = 'community.restore'),
  1::bigint,
  'une entrée d''audit pour le rétablissement, aucune pour le clic de trop'
);

-- ============================================================
-- 4. Garder en ligne
-- ============================================================

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select is(
  public.keep_community_content('aaaaaaaa-0000-4000-8000-000000000291', null),
  1,
  'l''admin PLUKA garde le sujet en ligne : un signalement classé'
);
select is(
  public.keep_community_content('aaaaaaaa-0000-4000-8000-000000000291', null),
  0,
  'plus rien à classer au second clic'
);

reset role;
select results_eq(
  $$ select t.status::text, r.status::text
     from public.community_threads t, public.community_reports r
     where t.id = 'aaaaaaaa-0000-4000-8000-000000000291'
       and r.id = 'aaaaaaaa-0000-4000-8000-000000000295' $$,
  $$ values ('published'::text, 'dismissed'::text) $$,
  'le sujet reste en ligne, son signalement est classé sans suite'
);
select results_eq(
  $$ select actor_user_id, action from private.audit_logs
     where entity_id = 'aaaaaaaa-0000-4000-8000-000000000291' $$,
  $$ values ('88888888-8888-4888-8888-888888888888'::uuid, 'community.keep'::text) $$,
  'garder en ligne est journalisé'
);

-- ============================================================
-- 5. Masquer un sujet sans signalement
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.report_community_content(
       null, 'aaaaaaaa-0000-4000-8000-000000000292', 'privacy', null) $$,
  'la réponse rétablie peut être signalée de nouveau'
);

reset role;
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(
  public.hide_community_content('aaaaaaaa-0000-4000-8000-000000000291', null),
  1,
  'l''owner masque le sujet : le signalement de sa réponse se clôt avec lui'
);

reset role;
select results_eq(
  $$ select t.status::text, p.status::text,
            (select count(*) from public.community_reports r
             where r.post_id = p.id and r.status = 'open')
     from public.community_threads t
     join public.community_posts p on p.thread_id = t.id
     where t.id = 'aaaaaaaa-0000-4000-8000-000000000291' $$,
  $$ values ('hidden'::text, 'published'::text, 0::bigint) $$,
  'le sujet est masqué ; sa réponse garde son état, sans signalement ouvert'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*) from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')
   where id = 'aaaaaaaa-0000-4000-8000-000000000291'),
  0::bigint,
  'un sujet masqué disparaît de la liste des participants'
);

reset role;
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select status::text from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')
   where id = 'aaaaaaaa-0000-4000-8000-000000000291'),
  'hidden',
  'son auteur le voit encore, masqué'
);
select throws_ok(
  $$ select public.restore_community_content('aaaaaaaa-0000-4000-8000-000000000291', null) $$,
  '42501', null,
  'son auteur ne le rétablit pas lui-même'
);

-- ============================================================
-- 6. Refus
-- ============================================================

reset role;
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.hide_community_content('aaaaaaaa-0000-4000-8000-000000000293', null) $$,
  '42501', null,
  'l''editor ne masque pas'
);

reset role;
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.restore_community_content('aaaaaaaa-0000-4000-8000-000000000291', null) $$,
  '42501', null,
  'le viewer ne rétablit pas'
);

reset role;
select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.hide_community_content('aaaaaaaa-0000-4000-8000-000000000293', null) $$,
  '42501', null,
  'l''owner d''une autre organisation ne masque pas'
);

reset role;
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok(
  $$ select public.keep_community_content('aaaaaaaa-0000-4000-8000-000000000293', null) $$,
  '42501', null,
  'un participant ne classe pas les signalements'
);

reset role;
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select throws_ok(
  $$ select public.hide_community_content('bbbbbbbb-0000-4000-8000-000000000291', null) $$,
  '42501', null,
  'l''owner ne modère pas la communauté d''une autre organisation'
);
select throws_ok(
  $$ select public.hide_community_content(null, null) $$,
  '22023', 'INVALID_TARGET',
  'ni sujet ni réponse : refusé'
);
select throws_ok(
  $$ select public.hide_community_content(
       'aaaaaaaa-0000-4000-8000-000000000293', 'aaaaaaaa-0000-4000-8000-000000000292') $$,
  '22023', 'INVALID_TARGET',
  'un sujet et une réponse à la fois : refusé'
);
select throws_ok(
  $$ select public.hide_community_content('aaaaaaaa-0000-4000-8000-000000000999', null) $$,
  '42501', null,
  'un contenu inconnu : le même refus, qui ne confirme rien'
);
select throws_ok(
  $$ update public.community_threads set status = 'published'
     where id = 'aaaaaaaa-0000-4000-8000-000000000291' $$,
  '42501', null,
  'pas d''écriture directe, modérateur compris'
);
select throws_ok(
  $$ select * from private.lock_community_target(
       'aaaaaaaa-0000-4000-8000-000000000293', null, 'test') $$,
  '42501', null,
  'la fonction privée reste hors d''atteinte'
);

-- ============================================================
-- 7. Un contenu supprimé par son auteur
-- ============================================================

reset role;
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select lives_ok(
  $$ select public.delete_community_content('aaaaaaaa-0000-4000-8000-000000000293', null) $$,
  'Bruno supprime son sujet signalé'
);

reset role;
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select results_eq(
  $$ select e ->> 'status', e ->> 'threadTitle' is null, e ->> 'body' is null,
            jsonb_array_length(e -> 'reports')
     from jsonb_array_elements(
       public.community_moderation_queue('aaaaaaaa-0000-4000-8000-000000000012') -> 'reported'
     ) e
     where e ->> 'threadId' = 'aaaaaaaa-0000-4000-8000-000000000293' $$,
  $$ values ('deleted'::text, true, true, 1) $$,
  'la modération voit le signalement, plus le titre ni le texte'
);
select throws_ok(
  $$ select public.restore_community_content('aaaaaaaa-0000-4000-8000-000000000293', null) $$,
  '55000', 'NOT_HIDDEN',
  'un contenu supprimé ne se rétablit pas'
);
select is(
  public.hide_community_content('aaaaaaaa-0000-4000-8000-000000000293', null),
  1,
  'le clore résout son signalement'
);

reset role;
select results_eq(
  $$ select t.status::text, r.status::text
     from public.community_threads t, public.community_reports r
     where t.id = 'aaaaaaaa-0000-4000-8000-000000000293'
       and r.id = 'aaaaaaaa-0000-4000-8000-000000000297' $$,
  $$ values ('deleted'::text, 'resolved'::text) $$,
  'le sujet reste supprimé, son signalement est résolu'
);

select * from finish();
rollback;
