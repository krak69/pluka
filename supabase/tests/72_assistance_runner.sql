-- PLUKA — Assistance du coureur : personnes, rendez-vous, « À me donner »
-- Référence : migration 0099 · 00_PRODUCT_SPEC §15 · 03_PRIVACY_RLS §43
--
-- 1. Le coureur écrit ses personnes, ses rendez-vous, ce qu'il faut lui donner.
-- 2. Les champs sont bornés.
-- 3. L'export de ses données inclut « À me donner ».
-- 4. Ni un autre coureur, ni l'organisation, n'y lisent ou n'y écrivent rien.

begin;

create extension if not exists pgtap;

select plan(10);

\ir _personas.psql

-- ============================================================
-- 1. Le coureur écrit son assistance
-- ============================================================

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ insert into public.assistance_items (assistance_assignment_id, item_type, label)
     values ('aaaaaaaa-0000-4000-8000-000000000062', 'other', 'Gourde pleine') $$,
  'le coureur note ce qu''il faut lui donner'
);

select lives_ok(
  $$ insert into public.race_assistants (participant_race_id, first_name, phone)
     values ('aaaaaaaa-0000-4000-8000-000000000031', 'Lou', '06 12 34 56 78') $$,
  'le coureur ajoute une personne'
);

-- ============================================================
-- 2. Des champs bornés
-- ============================================================

select throws_ok(
  $$ insert into public.race_assistants (participant_race_id, first_name)
     values ('aaaaaaaa-0000-4000-8000-000000000031', '   ') $$,
  '23514',
  null,
  'un prénom vide est refusé'
);

select throws_ok(
  $$ insert into public.assistance_items (assistance_assignment_id, item_type, label)
     values ('aaaaaaaa-0000-4000-8000-000000000062', 'other', repeat('x', 121)) $$,
  '23514',
  null,
  'une ligne de plus de 120 caractères est refusée'
);

select throws_ok(
  $$ update public.assistance_assignments set instructions = repeat('x', 1001)
     where id = 'aaaaaaaa-0000-4000-8000-000000000062' $$,
  '23514',
  null,
  'des consignes de plus de 1000 caractères sont refusées'
);

-- ============================================================
-- 3. L'export inclut « À me donner »
-- ============================================================

select ok(
  public.export_my_data()::text like '%Gourde pleine%',
  'l''export des données du compte contient « À me donner »'
);

-- ============================================================
-- 4. Personne d'autre
-- ============================================================

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is_empty(
  $$ select id from public.race_assistants $$,
  'un autre coureur ne voit aucune personne'
);

select is_empty(
  $$ select id from public.assistance_items $$,
  'un autre coureur ne voit rien de ce qu''il faut donner'
);

select throws_ok(
  $$ insert into public.assistance_items (assistance_assignment_id, item_type, label)
     values ('aaaaaaaa-0000-4000-8000-000000000062', 'other', 'Intrus') $$,
  '42501',
  null,
  'un autre coureur n''ajoute rien au rendez-vous'
);

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select is_empty(
  $$ select id from public.assistance_items $$,
  'l''owner de l''organisation ne voit rien de l''assistance (AGENTS §19)'
);

select * from finish();

rollback;
