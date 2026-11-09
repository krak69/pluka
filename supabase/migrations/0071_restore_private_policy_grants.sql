-- PLUKA V1 — Rétablir les droits d'exécution retirés par 0067 et 0068
-- File target: supabase/migrations/0071_restore_private_policy_grants.sql
--
-- POURQUOI
--
-- 0067 et 0068 finissaient par `revoke all on all functions in schema private
-- from anon, authenticated`, recopié de 0015. Ce balayage retire aussi des
-- droits que des migrations postérieures avaient accordés exprès, parce que des
-- policies de stockage appellent ces fonctions sous le rôle de l'utilisateur.
-- Postgres évalue toutes les policies d'une écriture : une seule fonction
-- non exécutable fait échouer le dépôt d'un document, d'un GPX ou d'une image
-- du site, avec un refus de droit qui se lit comme un refus de rôle.
--
-- La règle désormais : une migration ne révoque que les fonctions qu'elle crée,
-- nommées une à une. Le test pgTAP 49 vérifie ces quatre droits.

begin;

-- 0051 : images du site de l'événement.
grant execute on function private.can_edit_event_site_asset(text) to authenticated;
-- 0052 : téléchargement public des documents du site.
grant execute on function private.is_site_downloadable_object(text) to anon, authenticated;
-- 0058 : dépôt d'un document d'édition par l'organisation.
grant execute on function private.can_upload_edition_document(text) to authenticated;
-- 0060 : garde de l'import des participants.
grant execute on function private.assert_can_import_participants(uuid) to authenticated;

commit;
