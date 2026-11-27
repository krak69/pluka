-- PLUKA — Communauté d'édition
-- Référence : migration 0114 · 03_PRIVACY_RLS §53 à §55 · AC-COM-01 à AC-COM-04
--
-- 1. Un participant ouvre un sujet dans son édition, rattaché à une course et
--    un point de cette édition seulement ; un double envoi ne crée rien.
-- 2. Un participant d'une autre course de l'édition lit, répond, trouve utile,
--    signale. L'auteur s'affiche « Prénom N. » ; aucun identifiant de compte.
-- 3. Ne lisent pas : une autre édition, une participation archivée, un compte
--    sans participation (la course est publique), editor et viewer de
--    l'organisation, une autre organisation.
-- 4. Owner, admin de l'organisation et admin PLUKA lisent sans écrire ; ils
--    voient les signalements, le signaleur aussi, pas l'auteur signalé.
-- 5. Aucune écriture directe : un contenu masqué ne se republie pas.
-- 6. L'auteur supprime son contenu, et seulement le sien.

begin;

create extension if not exists pgtap;

select plan(45);

\ir _personas.psql

-- Édition « Trail de Test 2026 » d'Org A : 80K (Runner A) et « Test privé ».
-- Runner B court « Test privé » : même édition, autre course. Runner C court
-- chez Org B. Runner D a une participation archivée au 80K.
insert into auth.users (id, email) values
  ('12121212-1212-4121-8121-121212121212', 'runner-c@test.pluka'),
  ('13131313-1313-4131-8131-131313131313', 'runner-d@test.pluka');

update public.users set first_name = 'Alice', last_name = 'dupont'
where id = '11111111-1111-4111-8111-111111111111';
update public.users set first_name = 'Bruno', last_name = null
where id = '22222222-2222-4222-8222-222222222222';

insert into public.participant_races (id, race_id, user_id, status) values
  ('aaaaaaaa-0000-4000-8000-000000000181', 'aaaaaaaa-0000-4000-8000-000000000014',
   '22222222-2222-4222-8222-222222222222', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000181', 'bbbbbbbb-0000-4000-8000-000000000013',
   '12121212-1212-4121-8121-121212121212', 'active'),
  ('aaaaaaaa-0000-4000-8000-000000000182', 'aaaaaaaa-0000-4000-8000-000000000013',
   '13131313-1313-4131-8131-131313131313', 'archived');

-- ============================================================
-- 1. Un participant ouvre un sujet
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.create_community_thread(
       'aaaaaaaa-0000-4000-8000-000000000012', 'race',
       '  Descente du col : technique ?  ', 'Roulant ou technique ?',
       null, 'aaaaaaaa-0000-4000-8000-000000000022') $$,
  'un participant ouvre un sujet rattaché à un point de son édition'
);

select lives_ok(
  $$ select public.create_community_thread(
       'aaaaaaaa-0000-4000-8000-000000000012', 'race',
       'Descente du col : technique ?', 'Roulant ou technique ?',
       null, 'aaaaaaaa-0000-4000-8000-000000000022') $$,
  'le même sujet renvoyé aussitôt ne lève rien'
);

select results_eq(
  $$ select title, race_id, waypoint_name, author_label, is_mine, reply_count
     from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  $$ values ('Descente du col : technique ?'::text, 'aaaaaaaa-0000-4000-8000-000000000013'::uuid,
            'Col du Test'::text, 'Alice D.'::text, true, 0) $$,
  'un seul sujet, titre nettoyé, course déduite du point, auteur « Prénom N. » (§54)'
);

select throws_ok(
  $$ select public.create_community_thread(
       'aaaaaaaa-0000-4000-8000-000000000012', 'race', 'Course voisine', '',
       'bbbbbbbb-0000-4000-8000-000000000013', null) $$,
  '22023', 'INVALID_RACE',
  'une course d''une autre édition : refusée'
);

select throws_ok(
  $$ select public.create_community_thread(
       'aaaaaaaa-0000-4000-8000-000000000012', 'race', 'Point voisin', '',
       'aaaaaaaa-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000023') $$,
  '22023', 'INVALID_WAYPOINT',
  'un point d''une autre course que celle du sujet : refusé'
);

select throws_ok(
  $$ select public.create_community_thread(
       'bbbbbbbb-0000-4000-8000-000000000012', 'logistics', 'Navette ?', '') $$,
  '42501', null,
  'pas de sujet dans une édition où il ne court pas'
);

select throws_ok(
  $$ insert into public.community_threads (edition_id, author_user_id, category, title, body)
     values ('aaaaaaaa-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111',
             'other', 'Sujet direct', '') $$,
  '42501', null,
  'aucune écriture directe dans la table'
);

reset role;

-- Des identifiants fixes pour la suite.
update public.community_threads set id = 'aaaaaaaa-0000-4000-8000-000000000191'
where title = 'Descente du col : technique ?';

-- ============================================================
-- 2. Un participant d'une autre course de l'édition
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(
  (select count(*) from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')),
  1::bigint,
  'un participant d''une autre course de l''édition lit le sujet'
);

select lives_ok(
  $$ select public.reply_community_thread('aaaaaaaa-0000-4000-8000-000000000191',
                                          'Technique sur la fin.') $$,
  'il répond'
);
select lives_ok(
  $$ select public.reply_community_thread('aaaaaaaa-0000-4000-8000-000000000191',
                                          'Technique sur la fin.') $$,
  'la même réponse renvoyée aussitôt ne lève rien'
);

select is(
  jsonb_array_length(public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') -> 'posts'),
  1,
  'une seule réponse enregistrée'
);

reset role;

update public.community_posts set id = 'aaaaaaaa-0000-4000-8000-000000000192'
where thread_id = 'aaaaaaaa-0000-4000-8000-000000000191';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(
  public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') -> 'posts' -> 0 ->> 'authorLabel',
  'Bruno',
  'sans nom de famille, le prénom seul'
);

select ok(
  public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191')::text
    !~ '11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222',
  'aucun identifiant de compte dans le sujet lu (AGENTS §79)'
);

select ok(
  (public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') ->> 'canReply')::boolean
    and not (public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') ->> 'canModerate')::boolean,
  'le participant peut répondre, pas modérer'
);

select is(
  public.set_community_useful('aaaaaaaa-0000-4000-8000-000000000191', null, true),
  1,
  '« utile » posé sur le sujet'
);
select is(
  public.set_community_useful('aaaaaaaa-0000-4000-8000-000000000191', null, true),
  1,
  '« utile » reposé : rien de plus'
);

select is(
  public.report_community_content('aaaaaaaa-0000-4000-8000-000000000191', null, 'misinformation'),
  public.report_community_content('aaaaaaaa-0000-4000-8000-000000000191', null, 'misinformation'),
  'un second signalement ouvert du même contenu ne s''ajoute pas'
);

select throws_ok(
  $$ select public.set_community_useful('aaaaaaaa-0000-4000-8000-000000000191',
                                        'aaaaaaaa-0000-4000-8000-000000000192', true) $$,
  '22023', 'INVALID_TARGET',
  'un geste vise un sujet ou une réponse, pas les deux'
);

reset role;

select is(
  (select count(*) from public.community_reports
   where thread_id = 'aaaaaaaa-0000-4000-8000-000000000191'),
  1::bigint,
  'un seul signalement en base'
);

-- ============================================================
-- 3. Ceux qui ne lisent pas
-- ============================================================

select pg_temp.act_as('12121212-1212-4121-8121-121212121212');
select throws_ok(
  $$ select * from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'un participant d''une autre édition ne lit pas la liste'
);
select throws_ok(
  $$ select public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') $$,
  '42501', null, 'ni le sujet'
);
select is_empty(
  $$ select id from public.community_posts $$,
  'ni les réponses, en lecture directe'
);
reset role;

select pg_temp.act_as('13131313-1313-4131-8131-131313131313');
select throws_ok(
  $$ select * from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'une participation archivée n''ouvre plus la communauté'
);
reset role;

select pg_temp.act_as('99999999-9999-4999-8999-999999999999');
select throws_ok(
  $$ select * from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'une course publique ne rend pas sa communauté publique'
);
select is_empty(
  $$ select id from public.community_threads $$,
  'pas même en lecture directe'
);
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select * from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'l''editor de l''organisation ne lit pas (§55)'
);
reset role;

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select * from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'le viewer de l''organisation ne lit pas (§55)'
);
select is_empty(
  $$ select id from public.community_threads $$,
  'pas même en lecture directe'
);
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'l''owner d''une autre organisation ne lit pas'
);
reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ select * from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012') $$,
  '42501', null, 'un visiteur ne lit rien'
);
reset role;

-- ============================================================
-- 4. Les modérateurs
-- ============================================================

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(
  (select count(*) from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')),
  1::bigint,
  'l''owner de l''organisation lit la communauté de son édition'
);
select ok(
  (public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') ->> 'canModerate')::boolean
    and not (public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') ->> 'canReply')::boolean,
  'il peut modérer ; sans participation, il ne répond pas'
);
select is(
  (select count(*) from public.community_reports),
  1::bigint,
  'il voit le signalement'
);
select throws_ok(
  $$ select public.reply_community_thread('aaaaaaaa-0000-4000-8000-000000000191', 'Réponse orga') $$,
  '42501', null,
  'écrire reste réservé aux participants'
);
reset role;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(
  (select count(*) from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')),
  1::bigint,
  'l''admin de l''organisation lit aussi'
);
reset role;

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select is(
  (select count(*) from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')),
  1::bigint,
  'l''admin PLUKA lit'
);
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is_empty(
  $$ select id from public.community_reports $$,
  'l''auteur signalé ne voit pas qui l''a signalé'
);
reset role;

-- ============================================================
-- 5. Masquage : pas de republication
-- ============================================================

update public.community_threads set status = 'hidden'
where id = 'aaaaaaaa-0000-4000-8000-000000000191';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*) from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')),
  0::bigint,
  'un sujet masqué disparaît pour les participants'
);
select throws_ok(
  $$ select public.reply_community_thread('aaaaaaaa-0000-4000-8000-000000000191', 'Encore ?') $$,
  '22023', 'THREAD_CLOSED',
  'on ne répond pas à un sujet masqué'
);
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  (select status::text from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')),
  'hidden',
  'son auteur le voit encore, marqué masqué'
);
select throws_ok(
  $$ update public.community_threads set status = 'published'
     where id = 'aaaaaaaa-0000-4000-8000-000000000191' $$,
  '42501', null,
  'il ne peut pas le republier lui-même'
);
reset role;

update public.community_threads set status = 'published'
where id = 'aaaaaaaa-0000-4000-8000-000000000191';

-- ============================================================
-- 6. Suppression par l'auteur ; compte supprimé
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok(
  $$ select public.delete_community_content(null, 'aaaaaaaa-0000-4000-8000-000000000192') $$,
  '42501', null,
  'on ne supprime pas la réponse d''un autre'
);
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select lives_ok(
  $$ select public.delete_community_content(null, 'aaaaaaaa-0000-4000-8000-000000000192') $$,
  'l''auteur supprime sa réponse'
);
select is(
  jsonb_array_length(public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') -> 'posts'),
  0,
  'elle disparaît du sujet'
);
reset role;

-- 0078 : le compte effacé, l'auteur devient nul.
update public.community_threads set author_user_id = null
where id = 'aaaaaaaa-0000-4000-8000-000000000191';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') ->> 'authorLabel',
  'Compte supprimé',
  'un auteur effacé s''affiche « Compte supprimé »'
);
reset role;

select * from finish();

rollback;
