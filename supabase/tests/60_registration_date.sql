-- PLUKA — Date d'inscription vérifiée
-- Référence : migration 0083 · docs/00_PRODUCT_SPEC.md §6.5.3, §29.1
--
-- 1. Un fichier apporte la date d'inscription d'un nouveau participant ; sans colonne, rien.
-- 2. Une date vérifiée est figée : un fichier repris ne la déplace pas, et la vérification le dit.
-- 3. Un participant sans date vérifiée prend celle du fichier, annoncée comme une mise à jour.
-- 4. La colonne reste côté serveur.
-- 5. La liste dit la date de référence et son origine ; une lecture par le support est journalisée.
-- 6. Les courses d'un coureur, pour le support : admin PLUKA seul, lecture journalisée.

begin;

create extension if not exists pgtap;

select plan(16);

\ir _personas.psql

-- Un import d'une ligne, en admin de l'organisation, sur une épreuve de l'édition.
create function pg_temp.import_one(p_email text, p_registered_on text) returns text
language plpgsql as $$
declare
  v_id uuid;
begin
  v_id := public.create_participant_import('aaaaaaaa-0000-4000-8000-000000000012', 'liste.csv',
    '["Email"]', jsonb_build_array(jsonb_build_object('Email', p_email)));
  perform public.validate_participant_import(v_id, '{}', jsonb_build_array(
    jsonb_build_object('rowNumber', 1, 'status', 'valid', 'mapped',
      jsonb_strip_nulls(jsonb_build_object(
        'raceId', 'aaaaaaaa-0000-4000-8000-000000000013', 'email', p_email,
        'firstName', 'Anna', 'lastName', 'Martin', 'registeredOn', p_registered_on)))));
  return v_id::text;
end;
$$;

create function pg_temp.registered_on(p_email text) returns date language sql as $$
  select registered_on from public.participant_races
  where invite_email = p_email and race_id = 'aaaaaaaa-0000-4000-8000-000000000013'
$$;

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select public.commit_participant_import(pg_temp.import_one('date@test.pluka', '2026-03-01')::uuid);
select public.commit_participant_import(pg_temp.import_one('sans-date@test.pluka', null)::uuid);
reset role;

select is(pg_temp.registered_on('date@test.pluka'), date '2026-03-01',
  'REG-01 — un nouveau participant reçoit la date du fichier, vérifiée');
select is(pg_temp.registered_on('sans-date@test.pluka'), null::date,
  'REG-02 — sans date dans le fichier, rien n''est inventé');

-- Une date vérifiée, reprise avec une autre date.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select pg_temp.import_one('date@test.pluka', '2026-04-15') as frozen_id \gset
select is(
  public.get_participant_import(:'frozen_id'::uuid) #>> '{effects,unchanged}', '1',
  'REG-03 — la vérification annonce qu''une date vérifiée ne bouge pas');
select is(
  public.commit_participant_import(:'frozen_id'::uuid) ->> 'skipped', '1',
  'REG-04 — l''import n''y touche pas');
reset role;
select is(pg_temp.registered_on('date@test.pluka'), date '2026-03-01',
  'REG-05 — la date vérifiée reste figée');

-- Un participant sans date vérifiée, repris avec une date.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select pg_temp.import_one('sans-date@test.pluka', '2026-02-10') as late_id \gset
select is(
  public.get_participant_import(:'late_id'::uuid) #>> '{effects,updated}', '1',
  'REG-06 — la vérification annonce la date apportée');
select is(
  public.commit_participant_import(:'late_id'::uuid) ->> 'updated', '1',
  'REG-07 — l''import la pose');
reset role;
select is(pg_temp.registered_on('sans-date@test.pluka'), date '2026-02-10',
  'REG-08 — une participation sans date vérifiée prend celle du fichier');

select ok(
  not has_column_privilege('authenticated', 'public.participant_races', 'registered_on', 'select'),
  'REG-09 — la date d''inscription n''est pas lisible directement par un client');

-- La liste de l'organisation : date transmise, ou jour d'arrivée à défaut.
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select is(
  (select p -> 'registration' from jsonb_array_elements(
     public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants') p
   where p ->> 'lastName' = 'Martin' and p -> 'registration' ->> 'origin' = 'verified'
   order by p -> 'registration' ->> 'day' limit 1),
  '{"day": "2026-02-10", "origin": "verified"}'::jsonb,
  'REG-10 — un viewer de l''organisation voit la date transmise et son origine');
select is(
  (select p -> 'registration' ->> 'origin' from jsonb_array_elements(
     public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') -> 'participants') p
   where (p ->> 'id')::uuid = 'aaaaaaaa-0000-4000-8000-000000000031'),
  'declared',
  'REG-11 — sans date transmise, la référence est déclarée');
reset role;

select is(
  (select count(*)::integer from private.audit_logs
   where action = 'edition_participants.read'
     and entity_id = 'aaaaaaaa-0000-4000-8000-000000000012'),
  0, 'REG-12 — la lecture par l''organisation elle-même ne remplit pas le journal');

select pg_temp.act_as('88888888-8888-4888-8888-888888888888');
select lives_ok(
  $$ select public.list_edition_participants('aaaaaaaa-0000-4000-8000-000000000012') $$,
  'REG-13 — le support PLUKA lit la liste');
select is(
  (select registration ->> 'origin' from public.admin_list_user_participations('11111111-1111-4111-8111-111111111111')
   where participant_race_id = 'aaaaaaaa-0000-4000-8000-000000000031'),
  'declared', 'REG-14 — le support lit les courses d''un coureur et l''origine de sa date');
reset role;

select is(
  (select count(*)::integer from private.audit_logs
   where actor_user_id = '88888888-8888-4888-8888-888888888888'
     and (action, entity_id) in (
       ('edition_participants.read', 'aaaaaaaa-0000-4000-8000-000000000012'::uuid),
       ('user_participations.read', '11111111-1111-4111-8111-111111111111'::uuid))),
  2, 'REG-15 — chaque lecture du support est inscrite au journal');

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select * from public.admin_list_user_participations('11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'REG-16 — un organisateur, même propriétaire, ne lit pas les courses d''un coureur');
reset role;

select * from finish();
rollback;
