-- PLUKA — Le tableau du matériel d'une édition
-- Référence : migrations 0047, 0048 · SOURCES_EXTRACTION §82 · AGENTS §14, §91
--
-- Une ligne par pièce, une exigence par épreuve, enregistrées d'un coup :
-- ajout, correction, retrait et restauration, chacun par son geste.

begin;

create extension if not exists pgtap;

select plan(16);

\ir _personas.psql

-- 80K et « Test privé », les deux épreuves de l'édition A.
create function pg_temp.frontale(
  p_80k text, p_prive text, p_label text default 'Frontale',
  p_condition text default null, p_create boolean default false
) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'factKey', 'equipment.frontale', 'create', p_create, 'label', p_label,
    'condition', p_condition, 'detail', null,
    'requirements', jsonb_build_object(
      'aaaaaaaa-0000-4000-8000-000000000013', p_80k,
      'aaaaaaaa-0000-4000-8000-000000000014', p_prive)));
$$;

create function pg_temp.state() returns text language sql as $$
  select string_agg(r.slug || ':' || case when f.archived_at is null
           then coalesce(v.value_json ->> 'requirement', '?') else 'retiré' end,
         ',' order by r.slug)
  from public.race_facts f
  join public.races r on r.id = f.race_id
  join public.race_fact_versions v on v.id = f.current_version_id
  where f.fact_key = 'equipment.frontale';
$$;

grant execute on function pg_temp.frontale(text, text, text, text, boolean) to authenticated;

-- ============================================================
-- 1. Qui peut
-- ============================================================

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok(
  $$ select public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
       pg_temp.frontale('mandatory', null, p_create => true), 'official') $$,
  '42501', null,
  'EDEQ-01 — lecteur de l''organisation : refusé'
);
reset role;

select pg_temp.act_as('77777777-7777-4777-8777-777777777777');
select throws_ok(
  $$ select public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
       pg_temp.frontale('mandatory', null, p_create => true), 'official') $$,
  '42501', null,
  'EDEQ-02 — owner d''une autre organisation : refusé'
);
reset role;

-- ============================================================
-- 2. Le tableau, case par case
-- ============================================================

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select throws_ok(
  $$ select public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
       jsonb_build_array(jsonb_build_object('factKey', 'equipment.frontale', 'label', 'Frontale',
         'requirements', jsonb_build_object('bbbbbbbb-0000-4000-8000-000000000013', 'mandatory'))),
       'official') $$,
  '22023', null,
  'EDEQ-03 — case d''une épreuve d''une autre édition : refusée'
);

select is(
  public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
    pg_temp.frontale('mandatory', 'recommended', p_create => true), 'official'),
  2,
  'EDEQ-04 — une exigence par épreuve, en un enregistrement'
);
reset role;

select is(pg_temp.state(), '80k:mandatory,test-prive:recommended',
  'EDEQ-05 — obligatoire sur le 80K, recommandé sur le Test privé');

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select throws_ok(
  $$ select public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
       pg_temp.frontale('mandatory', 'recommended', p_create => true), 'official') $$,
  '23505', null,
  'EDEQ-06 — ajouter ce qui existe déjà : refusé, la ligne se modifie'
);

select throws_ok(
  $$ select public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
       pg_temp.frontale('mandatory', 'recommended'), 'official') $$,
  '55000', null,
  'EDEQ-07 — rien de changé : refusé'
);

select throws_ok(
  $$ select public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
       pg_temp.frontale('conditional', 'recommended'), 'official') $$,
  '22023', null,
  'EDEQ-08 — une case conditionnelle sans condition : refusée (§82)'
);

-- Le Test privé n'est plus concerné ; le 80K devient conditionnel.
select is(
  public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
    pg_temp.frontale('conditional', null, p_condition => 'si départ de nuit'), 'official'),
  2,
  'EDEQ-09 — une case corrigée, une case vidée'
);
reset role;

select is(pg_temp.state(), '80k:conditional,test-prive:retiré',
  'EDEQ-10 — vider une case retire l''élément, l''historique reste');

select is(
  (select v.value_json from public.race_facts f
   join public.race_fact_versions v on v.id = f.current_version_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.frontale'),
  '{"requirement": "conditional", "condition": "si départ de nuit", "detail": null}'::jsonb,
  'EDEQ-11 — la condition de la ligne s''écrit dans la case conditionnelle'
);

-- Recocher le Test privé en obligatoire : restauré et corrigé.
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select is(
  public.save_edition_equipment('aaaaaaaa-0000-4000-8000-000000000012',
    pg_temp.frontale('conditional', 'mandatory', p_condition => 'si départ de nuit'), 'official'),
  1,
  'EDEQ-12 — recocher une épreuve : une case modifiée'
);
reset role;

select is(pg_temp.state(), '80k:conditional,test-prive:mandatory',
  'EDEQ-13 — restauré avec sa nouvelle exigence, sans condition hors conditionnel');

select is(
  (select v.value_json ->> 'condition' from public.race_facts f
   join public.race_fact_versions v on v.id = f.current_version_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000014' and f.fact_key = 'equipment.frontale'),
  null,
  'EDEQ-14 — une case obligatoire ne porte pas la condition de la ligne'
);

select is(
  (select string_agg(v.version_number::text || ':' || v.workflow_status::text, ',' order by v.version_number)
   from public.race_fact_versions v
   join public.race_facts f on f.id = v.fact_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000013' and f.fact_key = 'equipment.frontale'),
  '1:superseded,2:published',
  'EDEQ-15 — une correction crée une version, l''ancienne reste (AGENTS §14)'
);

-- `now()` est le même dans la transaction du test : tri par geste.
select is(
  (select string_agg(a.action, ',' order by a.action)
   from private.fact_publication_acts a
   join public.race_facts f on f.id = a.fact_id
   where f.race_id = 'aaaaaaaa-0000-4000-8000-000000000014' and f.fact_key = 'equipment.frontale'),
  'publish,restore,retire,revise',
  'EDEQ-16 — chaque case est journalisée par son geste'
);

select * from finish();

rollback;
