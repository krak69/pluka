-- PLUKA — Les fonctions privées appelées par des policies restent exécutables
-- Référence : migration 0071
--
-- Une policy s'évalue sous le rôle de l'utilisateur : une fonction qu'il ne
-- peut pas exécuter fait échouer toute écriture du bucket, même quand une autre
-- policy l'aurait autorisée. Ce test casse si une migration retire de nouveau
-- ces droits en balayant le schéma.

begin;

create extension if not exists pgtap;

select plan(6);

select ok(
  has_function_privilege('authenticated', 'private.can_upload_edition_document(text)', 'execute'),
  'GRANTS — dépôt d''un document d''édition');
select ok(
  has_function_privilege('authenticated', 'private.can_edit_event_site_asset(text)', 'execute'),
  'GRANTS — images du site');
select ok(
  has_function_privilege('authenticated', 'private.is_site_downloadable_object(text)', 'execute'),
  'GRANTS — documents du site, connecté');
select ok(
  has_function_privilege('anon', 'private.is_site_downloadable_object(text)', 'execute'),
  'GRANTS — documents du site, anonyme');
select ok(
  has_function_privilege('authenticated', 'private.assert_can_import_participants(uuid)', 'execute'),
  'GRANTS — import des participants');

-- Toute fonction privée citée par une policy doit être exécutable par les rôles
-- que la policy vise.
select is_empty(
  $$ select p.proname
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and exists (
         select 1 from pg_policies pl
         where coalesce(pl.qual, '') || coalesce(pl.with_check, '')
           like '%private.' || p.proname || '(%'
       ) $$,
  'GRANTS — aucune policy n''appelle une fonction privée inexécutable');

select * from finish();
rollback;
