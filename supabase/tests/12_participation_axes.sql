-- PLUKA — Les deux axes d'une participation
-- Référence : docs/02_DATA_MODEL.md §9.3 · supabase/migrations/0018_preparation_state_scope.sql
--
-- §9.3 sépare deux questions que `participant_races` posait auparavant deux
-- fois :
--
--   preparation_state  où en est le coureur dans sa préparation ?
--   status             qu'est devenue sa participation ?
--
-- « Un coureur peut être `ready` et finir en `dnf` : sa préparation était
-- complète, sa course ne s'est pas terminée. Dériver une colonne de l'autre
-- écraserait cette distinction et ferait perdre l'information "il était
-- prêt". »
--
-- Ce fichier vérifie que le schéma tient cette séparation : l'axe préparation
-- ne peut plus porter un fait de course, et les deux colonnes bougent
-- indépendamment. La règle est prouvée au niveau du type, donc valable pour
-- tout écrivain — use case, worker, import, ou psql.

begin;

create extension if not exists pgtap;

select plan(14);

\ir _personas.psql

-- ============================================================
-- 1. L'axe préparation ne porte plus de fait de course
-- ============================================================

select results_eq(
  $$ select unnest(enum_range(null::public.preparation_state))::text order by 1 $$,
  $$ values ('preparing'), ('ready'), ('to_prepare') $$,
  'AXES — preparation_state se limite à l''avancement du coureur (0018, §9.3)'
);

-- Les trois valeurs retirées ne sont plus écrivables du tout : ce n'est pas une
-- convention applicative, c'est le type qui refuse.
select throws_ok(
  $$ insert into public.participant_races (race_id, user_id, preparation_state)
     values ('aaaaaaaa-0000-4000-8000-000000000013',
             '22222222-2222-4222-8222-222222222222', 'dnf') $$,
  '22P02', null,
  'AXES — « dnf » n''est pas un état de préparation (§9.3)'
);

select throws_ok(
  $$ insert into public.participant_races (race_id, user_id, preparation_state)
     values ('aaaaaaaa-0000-4000-8000-000000000013',
             '22222222-2222-4222-8222-222222222222', 'dns') $$,
  '22P02', null,
  'AXES — « dns » n''est pas un état de préparation (§9.3)'
);

select throws_ok(
  $$ insert into public.participant_races (race_id, user_id, preparation_state)
     values ('aaaaaaaa-0000-4000-8000-000000000013',
             '22222222-2222-4222-8222-222222222222', 'completed') $$,
  '22P02', null,
  'AXES — « completed » n''est pas un état de préparation (§9.3)'
);

-- ============================================================
-- 2. Prêt, et pourtant DNF
-- ============================================================
-- Le cas que §9.3 nomme explicitement. S'il ne se représentait pas, la
-- séparation des deux axes n'aurait servi à rien.

select lives_ok(
  $$ insert into public.participant_races
       (id, race_id, user_id, preparation_state, status)
     values ('dddddddd-0000-4000-8000-000000000201',
             'aaaaaaaa-0000-4000-8000-000000000013',
             '22222222-2222-4222-8222-222222222222', 'ready', 'dnf') $$,
  'AXES — une participation peut être « ready » et « dnf » à la fois (§9.3)'
);

select is(
  (select preparation_state::text from public.participant_races
   where id = 'dddddddd-0000-4000-8000-000000000201'),
  'ready',
  'AXES — l''information « il était prêt » survit à l''abandon'
);

select is(
  (select status::text from public.participant_races
   where id = 'dddddddd-0000-4000-8000-000000000201'),
  'dnf',
  'AXES — et le fait de course vit dans status'
);

-- ============================================================
-- 3. Chaque colonne bouge seule
-- ============================================================
-- « Aucun chemin d'écriture ne calcule l'une à partir de l'autre. » Aucun
-- trigger, aucune contrainte ne doit rattraper l'une quand l'autre change.

select lives_ok(
  $$ update public.participant_races set status = 'finished'
     where id = 'dddddddd-0000-4000-8000-000000000201' $$,
  'AXES — le statut se corrige seul'
);

select is(
  (select preparation_state::text from public.participant_races
   where id = 'dddddddd-0000-4000-8000-000000000201'),
  'ready',
  'AXES — sans que l''état de préparation ne bouge'
);

select lives_ok(
  $$ update public.participant_races set preparation_state = 'preparing'
     where id = 'dddddddd-0000-4000-8000-000000000201' $$,
  'AXES — l''état de préparation se corrige seul'
);

select is(
  (select status::text from public.participant_races
   where id = 'dddddddd-0000-4000-8000-000000000201'),
  'finished',
  'AXES — sans que le statut ne bouge'
);

-- L'archivage reste sur l'axe participation, et n'a aucun équivalent côté
-- préparation : sortir une participation de la circulation est un geste
-- d'administration.
select lives_ok(
  $$ update public.participant_races set status = 'archived'
     where id = 'dddddddd-0000-4000-8000-000000000201' $$,
  'AXES — archived appartient à status seul (§9.3)'
);

-- ============================================================
-- 4. Défauts à l'inscription
-- ============================================================
-- §9.3 : « `status` est écrit à l'inscription (`active`) ». Une participation
-- nouvelle n'a rien préparé et n'a rien couru.

insert into public.participant_races (id, race_id, invite_email) values
  ('dddddddd-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000013',
   'nouvelle@test.pluka');

select is(
  (select preparation_state::text from public.participant_races
   where id = 'dddddddd-0000-4000-8000-000000000202'),
  'to_prepare',
  'AXES — une participation neuve part de « to_prepare » (0018 restaure le défaut)'
);

select is(
  (select status::text from public.participant_races
   where id = 'dddddddd-0000-4000-8000-000000000202'),
  'active',
  'AXES — et de « active » (§9.3)'
);

select * from finish();

rollback;
