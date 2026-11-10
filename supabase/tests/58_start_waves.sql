-- PLUKA — Déclarer les vagues de départ
-- Référence : migration 0081

begin;

create extension if not exists pgtap;

select plan(16);

\ir _personas.psql

-- Deux lignes importées sur le 80K : une « élite » déclarée par le fichier,
-- une « Vague 2 » encore inconnue.
insert into public.participant_races
  (id, race_id, invite_email, status, registration_source, declared_wave_name)
values
  ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000013',
   'elite@example.com', 'active', 'organizer_import', 'élite'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000013',
   'v2@example.com', 'active', 'organizer_import', 'Vague 2');

create temporary table t_wave (id uuid) on commit drop;
grant all on t_wave to authenticated;

-- ============================================================
-- Déclarer
-- ============================================================

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
insert into t_wave
select public.org_declare_start_wave(
  'aaaaaaaa-0000-4000-8000-000000000013', 'Élite', '2026-06-20T04:30:00Z');
reset role;

select results_eq(
  $$ select start_wave_id, declared_wave_name from public.participant_races
     where id = 'eeeeeeee-0000-4000-8000-000000000001' $$,
  $$ select id, null::text from t_wave $$,
  'WAVE-01 — l''inscrit qui avait déclaré ce nom rejoint la vague');

select results_eq(
  $$ select f.category::text, v.value_text, v.trust_level::text, v.workflow_status::text
     from public.race_start_waves w
     join public.race_facts f on f.id = w.fact_id
     join public.race_fact_versions v on v.id = f.current_version_id
     where w.id = (select id from t_wave) $$,
  $$ values ('start', 'Élite : départ le 20 juin à 06:30', 'official', 'published') $$,
  'WAVE-02 — la vague est une information officielle publiée, à l''heure de Paris');

select is(
  (select ce.title from public.race_change_events ce
   join public.race_start_waves w on w.fact_id = ce.fact_id
   where w.id = (select id from t_wave)),
  'Vague Élite : heure de départ',
  'WAVE-03 — le changement porte un titre lisible, pas une clé');

select isnt_empty(
  $$ select 1 from public.fact_sources fs
     join public.race_facts f on f.current_version_id = fs.fact_version_id
     join public.race_start_waves w on w.fact_id = f.id
     where w.id = (select id from t_wave) $$,
  'WAVE-04 — sa source est la saisie de l''organisation');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ select public.org_declare_start_wave('aaaaaaaa-0000-4000-8000-000000000013', 'ÉLITE', now()) $$,
  '23505', null, 'WAVE-05 — deux vagues ne portent pas le même nom');
reset role;

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select throws_ok(
  $$ select public.org_declare_start_wave('aaaaaaaa-0000-4000-8000-000000000013', 'Éditeur', now()) $$,
  '42501', null, 'WAVE-06 — un éditeur ne déclare pas de vague');
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.org_declare_start_wave('aaaaaaaa-0000-4000-8000-000000000013', 'Intrus', now()) $$,
  '42501', null, 'WAVE-07 — une autre organisation non plus');
reset role;

-- ============================================================
-- Lire
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select set_eq(
  $$ select name, participants, wave_id is null
     from public.org_list_start_waves('aaaaaaaa-0000-4000-8000-000000000012') $$,
  $$ values ('Élite'::text, 1, false), ('Vague 2'::text, 1, true) $$,
  'WAVE-08 — un lecteur voit les vagues et les noms à déclarer, en nombres');
reset role;

-- ============================================================
-- Le chemin générique est fermé
-- ============================================================

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select throws_ok(
  $$ select public.revise_race_fact(
       (select fact_id from public.race_start_waves where id = (select id from t_wave)),
       'autre chose', null, null, 'official', null) $$,
  '55000', null, 'WAVE-09 — une vague ne se corrige pas comme une autre information');
select throws_ok(
  $$ select public.retire_race_fact(
       (select fact_id from public.race_start_waves where id = (select id from t_wave)), null) $$,
  '55000', null, 'WAVE-10 — ni ne se retire');
reset role;

-- ============================================================
-- Changer, et qui en est touché
-- ============================================================

-- Runner A (Plan actif, personas) court dans l'Élite.
update public.participant_races set start_wave_id = (select id from t_wave)
where id = 'aaaaaaaa-0000-4000-8000-000000000031';

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_update_start_wave((select id from t_wave), 'Élite', '2026-06-20T05:00:00Z');
select throws_ok(
  $$ select public.org_update_start_wave((select id from t_wave), 'Élite', '2026-06-20T05:00:00Z') $$,
  '55000', null, 'WAVE-11 — sans changement, rien ne se publie');
reset role;

select results_eq(
  $$ select v.version_number, v.value_text from public.race_start_waves w
     join public.race_facts f on f.id = w.fact_id
     join public.race_fact_versions v on v.id = f.current_version_id
     where w.id = (select id from t_wave) $$,
  $$ values (2, 'Élite : départ le 20 juin à 07:00'::text) $$,
  'WAVE-12 — une version 2, pas une réécriture');
select is(
  (select count(*)::integer from public.race_fact_versions v
   join public.race_start_waves w on w.fact_id = v.fact_id
   where w.id = (select id from t_wave) and v.workflow_status = 'superseded'),
  1, 'WAVE-13 — la version 1 est remplacée, gardée');
select is(
  (select start_datetime from public.race_start_waves where id = (select id from t_wave)),
  '2026-06-20T05:00:00Z'::timestamptz,
  'WAVE-14 — la vague porte la nouvelle heure');

select ok(
  private.analyze_change_impact(
    (select ce.id from public.race_change_events ce
     join public.race_start_waves w on w.fact_id = ce.fact_id
     where w.id = (select id from t_wave) and ce.change_kind = 'revised')) >= 1,
  'WAVE-15 — le Plan d''un coureur de la vague est signalé');

-- Une vague sans coureur ne touche personne, même si l'épreuve a des Plans.
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select public.org_declare_start_wave(
  'aaaaaaaa-0000-4000-8000-000000000013', 'Vague 3', '2026-06-20T06:00:00Z');
reset role;
select is(
  private.analyze_change_impact(
    (select ce.id from public.race_change_events ce
     join public.race_start_waves w on w.fact_id = ce.fact_id
     where w.name = 'Vague 3')),
  0, 'WAVE-16 — une vague sans coureur ne signale aucun Plan');

select * from finish();
rollback;
