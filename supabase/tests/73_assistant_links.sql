-- PLUKA — Lien privé de l'accompagnant
-- Référence : migration 0100 · 03_PRIVACY_RLS §44 à §47, §144 (P27, P28, P29) ·
--             AC-ASST-06, AC-ASST-07
--
-- 1. Le coureur crée le lien ; seule l'empreinte entre en base ; régénérer
--    éteint l'ancien.
-- 2. Sans compte, la page lit une projection sûre — et rien d'autre.
-- 3. Révoqué, ou plus de 3 jours après la course : refusé.
-- 4. Un autre coureur et l'organisation n'y touchent pas.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

-- La course de la fixture est passée : on la remet dans dix jours, pour qu'un
-- lien soit valable.
update public.races set start_datetime = now() + interval '10 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

update public.assistance_assignments set instructions = 'Parking du haut'
where id = 'aaaaaaaa-0000-4000-8000-000000000062';

insert into public.assistance_items (assistance_assignment_id, item_type, label)
values ('aaaaaaaa-0000-4000-8000-000000000062', 'other', 'Gourde pleine');

update public.race_assistants set phone = '06 12 34 56 78'
where id = 'aaaaaaaa-0000-4000-8000-000000000061';

-- ============================================================
-- 1. Créer, régénérer
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.create_assistant_link('aaaaaaaa-0000-4000-8000-000000000061',
       encode(extensions.digest('jeton-un', 'sha256'), 'hex')) $$,
  'le coureur crée le lien de sa personne'
);

select is(
  (select count(*)::int from public.list_assistant_links('aaaaaaaa-0000-4000-8000-000000000031')),
  1,
  'un seul lien actif : celui de la fixture a été éteint'
);

select public.create_assistant_link('aaaaaaaa-0000-4000-8000-000000000061',
  encode(extensions.digest('jeton-deux', 'sha256'), 'hex'));

select is(
  (select count(*)::int from public.list_assistant_links('aaaaaaaa-0000-4000-8000-000000000031')),
  1,
  'régénérer laisse un seul lien actif'
);

select throws_ok(
  $$ select public.create_assistant_link('aaaaaaaa-0000-4000-8000-000000000061', 'jeton-en-clair') $$,
  '22023',
  null,
  'P29 — un jeton en clair n''entre jamais en base'
);

-- ============================================================
-- 2. La page, sans compte
-- ============================================================

select pg_temp.act_as_anon();

select is(
  public.assistant_link_view(encode(extensions.digest('jeton-deux', 'sha256'), 'hex')) ->> 'state',
  'valid',
  'P27 — un lien valable ouvre la page, sans compte'
);

select is(
  public.assistant_link_view(encode(extensions.digest('jeton-deux', 'sha256'), 'hex'))
    #>> '{rendezvous,0,items,0}',
  'Gourde pleine',
  'la page dit ce qu''il faut apporter'
);

select ok(
  public.assistant_link_view(encode(extensions.digest('jeton-deux', 'sha256'), 'hex'))::text
    not like '%06 12 34 56 78%'
  and public.assistant_link_view(encode(extensions.digest('jeton-deux', 'sha256'), 'hex'))
    -> 'targetDurationSeconds' is null,
  '§46 — ni téléphone, ni objectif dans la projection'
);

select is(
  public.assistant_link_view(encode(extensions.digest('jeton-un', 'sha256'), 'hex')) ->> 'state',
  'revoked',
  'P28 — l''ancien lien, remplacé, est refusé'
);

select is(
  public.assistant_link_view(encode(extensions.digest('jamais-créé', 'sha256'), 'hex')) ->> 'state',
  'unknown',
  'un jeton inconnu ne rend rien'
);

select throws_ok(
  $$ select token_hash from public.assistant_access_tokens $$,
  '42501',
  null,
  '§45 — la table des jetons ne se lit pas en anonyme'
);

-- ============================================================
-- 3. Révoqué, expiré
-- ============================================================

reset role;
update public.races set start_datetime = now() - interval '4 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

select pg_temp.act_as_anon();

select is(
  public.assistant_link_view(encode(extensions.digest('jeton-deux', 'sha256'), 'hex')) ->> 'state',
  'expired',
  'plus de trois jours après la course, le lien est éteint'
);

-- ============================================================
-- 4. Personne d'autre
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.revoke_assistant_link('aaaaaaaa-0000-4000-8000-000000000061') $$,
  '42501',
  null,
  'un autre coureur ne révoque pas le lien'
);

select is_empty(
  $$ select * from public.list_assistant_links('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'un autre coureur ne voit aucun lien'
);

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty(
  $$ select * from public.list_assistant_links('aaaaaaaa-0000-4000-8000-000000000031') $$,
  'l''owner de l''organisation ne voit aucun lien (AGENTS §19)'
);

select * from finish();

rollback;
