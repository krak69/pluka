-- PLUKA — « Envoyer à mon accompagnant » la liste Nutrition
-- Référence : migration 0109 · NUTRITION_ENGINE §55 · 03_PRIVACY_RLS §46
--
-- 1. Le coureur envoie une liste : elle remplace l'envoi précédent, sans toucher
--    à ce qu'il a noté à la main ; une liste vide la retire.
-- 2. L'accompagnant la voit sur sa page, avant le reste — des quantités seulement.
-- 3. Un autre coureur n'envoie rien à la place du coureur.

begin;

create extension if not exists pgtap;

select plan(8);

\ir _personas.psql

update public.races set start_datetime = now() + interval '10 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000013';

insert into public.assistance_items (assistance_assignment_id, item_type, label)
values ('aaaaaaaa-0000-4000-8000-000000000062', 'other', 'Gourde pleine');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.send_assistance_nutrition('aaaaaaaa-0000-4000-8000-000000000062',
       array['3 × Gel 25', '1 dose de Näak']) $$,
  'le coureur envoie la liste Nutrition à son accompagnant'
);

select public.send_assistance_nutrition('aaaaaaaa-0000-4000-8000-000000000062',
  array['2 × Gel 25', '1 dose de Näak']);

select results_eq(
  $$ select item_type::text, label from public.assistance_items
     where assistance_assignment_id = 'aaaaaaaa-0000-4000-8000-000000000062'
     order by (item_type = 'nutrition') desc, created_at $$,
  $$ values ('nutrition', '2 × Gel 25'), ('nutrition', '1 dose de Näak'), ('other', 'Gourde pleine') $$,
  'un nouvel envoi remplace le précédent, dans l''ordre, sans toucher au reste'
);

select throws_ok(
  $$ select public.send_assistance_nutrition('aaaaaaaa-0000-4000-8000-000000000062',
       array_fill('x'::text, array[51])) $$,
  '22023',
  null,
  'une liste démesurée est refusée'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.send_assistance_nutrition('aaaaaaaa-0000-4000-8000-000000000062',
       array['1 × Faux']) $$,
  '42501',
  null,
  'un autre coureur n''envoie rien à la place du coureur'
);

-- La page de l'accompagnant, sans compte.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select public.create_assistant_link('aaaaaaaa-0000-4000-8000-000000000061',
  encode(extensions.digest('jeton-envoi', 'sha256'), 'hex'));

select pg_temp.act_as_anon();

select is(
  public.assistant_link_view(encode(extensions.digest('jeton-envoi', 'sha256'), 'hex'))
    -> 'rendezvous' -> 0 -> 'items',
  '["2 × Gel 25", "1 dose de Näak", "Gourde pleine"]'::jsonb,
  'l''accompagnant voit la liste envoyée d''abord, puis ce que le coureur a noté'
);

select is(
  (public.assistant_link_view(encode(extensions.digest('jeton-envoi', 'sha256'), 'hex'))
    -> 'rendezvous' -> 0) ?| array['carbs', 'targets', 'strategy'],
  false,
  'ni objectifs ni stratégie dans sa page (§55)'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.send_assistance_nutrition('aaaaaaaa-0000-4000-8000-000000000062', '{}') $$,
  'une liste vide retire l''envoi'
);

select is(
  (select array_agg(label) from public.assistance_items
   where assistance_assignment_id = 'aaaaaaaa-0000-4000-8000-000000000062'),
  array['Gourde pleine'],
  'il ne reste que ce que le coureur a noté'
);

select * from finish();

rollback;
