-- PLUKA — Photo de profil, illustration par défaut, sexe facultatif
-- Référence : migration 0115 · 03_PRIVACY_RLS §12, §54, §54.1
--
-- 1. Le coureur règle son sexe et son illustration ; la clé de sa photo ne
--    s'écrit que par la fonction, et seulement vers un fichier à lui.
-- 2. On ne dépose que sous une clé aléatoire, en son propre nom.
-- 3. Une photo se voit là où son auteur a écrit : un participant de
--    l'édition et la modération la voient ; une autre édition, un editor de
--    l'organisation, un anonyme non. Rien avant qu'il ait écrit.
-- 4. Les lectures de la Communauté rendent l'avatar de l'auteur : la photo
--    si le lecteur peut la voir, sinon l'illustration — choisie, ou celle du
--    sexe. Le sexe d'un autre compte ne se lit jamais.
-- 5. On ne retire que ses propres fichiers.

begin;

create extension if not exists pgtap;

select plan(26);

\ir _personas.psql

-- Runner A court le 80K de l'édition d'Org A ; Runner B court « Test privé »,
-- même édition ; Runner C court chez Org B.
insert into auth.users (id, email) values
  ('12121212-1212-4121-8121-121212121212', 'runner-c@test.pluka');

update public.users set first_name = 'Alice', last_name = 'Dupont'
where id = '11111111-1111-4111-8111-111111111111';
update public.users set first_name = 'Bruno', sex = 'female'
where id = '22222222-2222-4222-8222-222222222222';

insert into public.participant_races (id, race_id, user_id, status) values
  ('aaaaaaaa-0000-4000-8000-000000000181', 'aaaaaaaa-0000-4000-8000-000000000014',
   '22222222-2222-4222-8222-222222222222', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000181', 'bbbbbbbb-0000-4000-8000-000000000013',
   '12121212-1212-4121-8121-121212121212', 'active');

-- Les fichiers tels que le stockage les enregistre : `owner_id` vient de la session.
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', 'aaaaaaaa-0000-4000-8000-0000000a0001.webp', '11111111-1111-4111-8111-111111111111'),
  ('avatars', 'aaaaaaaa-0000-4000-8000-0000000a0002.webp', '11111111-1111-4111-8111-111111111111'),
  ('avatars', 'bbbbbbbb-0000-4000-8000-0000000b0001.webp', '22222222-2222-4222-8222-222222222222');

-- ============================================================
-- 1. Son profil
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ update public.users set sex = 'male', avatar_illustration = 'man'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  'le coureur renseigne son sexe et choisit son illustration'
);

select throws_ok(
  $$ update public.users set sex = 'robot' where id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null,
  'un sexe hors de la liste est refusé'
);

select throws_ok(
  $$ update public.users set avatar_path = 'aaaaaaaa-0000-4000-8000-0000000a0001.webp'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'la clé de la photo ne s''écrit pas directement'
);

select is(
  public.set_my_avatar_photo('aaaaaaaa-0000-4000-8000-0000000a0001.webp'),
  null,
  'une première photo : rien à retirer'
);

select is(
  public.set_my_avatar_photo('aaaaaaaa-0000-4000-8000-0000000a0002.webp'),
  'aaaaaaaa-0000-4000-8000-0000000a0001.webp',
  'une nouvelle photo rend la clé de l''ancienne, que l''app retire'
);

select throws_ok(
  $$ select public.set_my_avatar_photo('bbbbbbbb-0000-4000-8000-0000000b0001.webp') $$,
  '22023', 'INVALID_AVATAR',
  'la photo d''un autre compte est refusée'
);

select throws_ok(
  $$ select public.set_my_avatar_photo('cccccccc-0000-4000-8000-0000000c0001.webp') $$,
  '22023', 'INVALID_AVATAR',
  'une clé sans fichier est refusée'
);

-- ============================================================
-- 2. Déposer
-- ============================================================

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('avatars', 'aaaaaaaa-0000-4000-8000-0000000a0003.webp',
             '11111111-1111-4111-8111-111111111111') $$,
  'il dépose sous une clé aléatoire, en son nom'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('avatars', '11111111-1111-4111-8111-111111111111/photo.webp',
             '11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'pas de chemin libre : il porterait l''identifiant du compte'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('avatars', 'aaaaaaaa-0000-4000-8000-0000000a0004.webp',
             '22222222-2222-4222-8222-222222222222') $$,
  '42501', null,
  'pas de dépôt au nom d''un autre'
);

reset role;

-- ============================================================
-- 3. Qui voit la photo
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(
  (select count(*) from storage.objects
   where bucket_id = 'avatars' and owner_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'avant qu''il écrive, sa photo ne se voit pas, même de son édition'
);
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok(
  $$ select public.create_community_thread(
       'aaaaaaaa-0000-4000-8000-000000000012', 'logistics', 'Navette retour ?', '') $$,
  'il ouvre un sujet dans son édition'
);
reset role;

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select ok(
  (select count(*) from storage.objects
   where bucket_id = 'avatars' and owner_id = '11111111-1111-4111-8111-111111111111') > 0,
  'un participant de l''édition voit sa photo'
);
select is(
  (select author_avatar from public.community_threads_list('aaaaaaaa-0000-4000-8000-000000000012')),
  '{"kind": "photo", "path": "aaaaaaaa-0000-4000-8000-0000000a0002.webp"}'::jsonb,
  'la liste rend la photo, par sa clé, sans identifiant de compte'
);
select is(
  (select count(*) from public.users where id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'le sexe d''un autre compte ne se lit pas : sa ligne reste fermée'
);
reset role;

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select ok(
  (select count(*) from storage.objects
   where bucket_id = 'avatars' and owner_id = '11111111-1111-4111-8111-111111111111') > 0,
  'l''owner de l''organisation, qui modère, la voit'
);
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(
  (select count(*) from storage.objects
   where bucket_id = 'avatars' and owner_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'un editor de l''organisation ne la voit pas'
);
reset role;

select pg_temp.act_as('12121212-1212-4121-8121-121212121212');
select is(
  (select count(*) from storage.objects
   where bucket_id = 'avatars' and owner_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'un participant d''une autre édition ne la voit pas'
);
reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.set_my_avatar_photo(null) $$,
  '42501', null,
  'un anonyme ne règle aucune photo'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'avatars'),
  0::bigint,
  'un anonyme ne voit aucune photo'
);
reset role;

-- ============================================================
-- 4. L'illustration, quand la photo manque ou ne se voit pas
-- ============================================================

update public.community_threads set id = 'aaaaaaaa-0000-4000-8000-000000000191'
where title = 'Navette retour ?';

-- Bruno a une photo déposée, mais pas posée : sans choix, l'illustration de son sexe.
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select lives_ok(
  $$ select public.reply_community_thread('aaaaaaaa-0000-4000-8000-000000000191', 'Oui, à 16 h.') $$,
  'un autre participant répond'
);
reset role;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') -> 'posts' -> 0 -> 'authorAvatar',
  '{"kind": "woman"}'::jsonb,
  'sans photo ni choix : l''illustration de son sexe'
);
reset role;

update public.users set avatar_illustration = 'neutral'
where id = '22222222-2222-4222-8222-222222222222';

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(
  public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') -> 'posts' -> 0 -> 'authorAvatar',
  '{"kind": "neutral"}'::jsonb,
  'son choix l''emporte sur son sexe'
);
reset role;

-- Le sujet masqué par la modération : Alice n'a plus rien de publié.
update public.community_threads set status = 'hidden'
where id = 'aaaaaaaa-0000-4000-8000-000000000191';

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');
select is(
  public.community_thread_read('aaaaaaaa-0000-4000-8000-000000000191') -> 'authorAvatar',
  '{"kind": "man"}'::jsonb,
  'un contenu masqué ne montre plus la photo, même à la modération : son illustration'
);
reset role;

-- ============================================================
-- 5. Retirer
-- ============================================================

select set_config('storage.allow_delete_query', 'true', true);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
delete from storage.objects where bucket_id = 'avatars'
  and name = 'aaaaaaaa-0000-4000-8000-0000000a0001.webp';
reset role;
select is(
  (select count(*) from storage.objects where name = 'aaaaaaaa-0000-4000-8000-0000000a0001.webp'),
  1::bigint,
  'un autre compte ne retire pas la photo d''Alice'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
delete from storage.objects where bucket_id = 'avatars'
  and name = 'aaaaaaaa-0000-4000-8000-0000000a0001.webp';
reset role;
select is(
  (select count(*) from storage.objects where name = 'aaaaaaaa-0000-4000-8000-0000000a0001.webp'),
  0::bigint,
  'Alice retire son ancienne photo'
);

select * from finish();

rollback;
