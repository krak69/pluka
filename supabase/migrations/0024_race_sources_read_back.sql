-- PLUKA V1 — Dépôt d'un GPX : la relecture de la ligne écrite
-- File target: supabase/migrations/0024_race_sources_read_back.sql
-- Référence : docs/03_PRIVACY_RLS.md §84 · docs/01_ARCHITECTURE.md §15
--
-- POURQUOI
--
-- 0023 a ouvert le dépôt d'un GPX par deux policies, `insert` et `update`, et
-- s'est explicitement refusé le `select` : « l'application dépose, elle ne
-- relit pas les fichiers ». Le raisonnement était faux, et aucun dépôt n'a
-- jamais pu aboutir.
--
-- PostgreSQL applique les policies `select` aux lignes rendues par un
-- `returning`. Or l'API Storage écrit toujours ainsi :
--
--     insert into storage.objects (...) values (...)
--     on conflict (name, bucket_id) do update set ...
--     returning *
--
-- Sans policy `select`, la ligne est refusée au moment d'être rendue — et
-- l'erreur remontée est « new row violates row-level security policy », qui
-- désigne l'insertion et non la relecture. C'est ce qui a fait chercher le
-- défaut du mauvais côté : le prédicat d'écriture était juste, et un
-- `insert` nu passait ; c'est le `returning` qui échouait.
--
-- Ce n'est pas un assouplissement de §84. « Accès via : signed URL ; endpoint
-- serveur ; **user / organisation autorisés** » : la policy ci-dessous ne
-- rend lisible que ce que son auteur avait déjà le droit d'écrire, et sous
-- exactement le même prédicat. Un GPX de course est un fait de course, pas
-- une donnée personnelle — l'interdit de §87 porte sur les traces d'Outing,
-- qui vivent dans un autre bucket.

begin;

create policy race_sources__select__course_editor
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'race-sources'
    and private.race_of_source_object(name) is not null
    and (
      private.user_can_manage_race(private.race_of_source_object(name), 'editor')
      or private.is_pluka_admin()
    )
  );

comment on policy race_sources__select__course_editor on storage.objects is
  'Relecture d''un GPX de course par qui a le droit de le déposer, sous le même prédicat que `race_sources__insert__course_editor`. Nécessaire au dépôt lui-même : l''API Storage écrit avec `returning`, et PostgreSQL applique les policies `select` aux lignes rendues.';

commit;
