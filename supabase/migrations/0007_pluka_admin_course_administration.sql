-- PLUKA V1 — Administration de la base courses par pluka_admin
-- File target: supabase/migrations/0007_pluka_admin_course_administration.sql
-- Référence : docs/00_PRODUCT_SPEC.md §3.5 et §4.1, docs/03_PRIVACY_RLS.md §16, §104
--
-- POURQUOI
--
-- 0005 accorde à `pluka_admin` la *lecture* de events / editions / races, mais
-- aucune écriture : toutes les policies d'écriture passent par un rôle
-- d'organisation, et `private.user_has_org_role(null, ...)` est faux.
--
-- Deux règles du produit deviennent donc inapplicables :
--
--   « administration de la base courses » (§3.5)
--   « Un événement sans organisation gestionnaire n'est administrable que par
--     `pluka_admin` » (§4.1)
--
-- Le second cas est le plus net : un événement maintenu par PLUKA à partir de
-- sources publiques n'a pas d'organisation, donc personne ne peut le gérer.
--
-- PORTÉE
--
-- Trois tables, deux verbes. Les helpers `private.user_can_manage_*` ne sont
-- volontairement pas redéfinis : ils portent aussi les accès participants et
-- Race Intelligence, et « le simple statut pluka_admin ne doit pas transformer
-- toutes les données en contenu courant de l'admin UI » (§104). L'ouverture
-- est additive et s'arrête au référentiel de course.
--
-- Pas de DELETE : §4.1 donne `archived` comme sortie de circulation, et une
-- suppression d'événement cascaderait jusqu'aux participations. Retirer une
-- course du courant est une transition de statut, pas un effacement.

begin;

create policy events__insert__pluka_admin on public.events
  for insert to authenticated
  with check (private.is_pluka_admin());

create policy events__update__pluka_admin on public.events
  for update to authenticated
  using (private.is_pluka_admin())
  with check (private.is_pluka_admin());

create policy editions__insert__pluka_admin on public.editions
  for insert to authenticated
  with check (private.is_pluka_admin());

create policy editions__update__pluka_admin on public.editions
  for update to authenticated
  using (private.is_pluka_admin())
  with check (private.is_pluka_admin());

create policy races__insert__pluka_admin on public.races
  for insert to authenticated
  with check (private.is_pluka_admin());

create policy races__update__pluka_admin on public.races
  for update to authenticated
  using (private.is_pluka_admin())
  with check (private.is_pluka_admin());

comment on policy races__update__pluka_admin on public.races is
  'Administration de la base courses (§3.5), et seul chemin possible pour un événement sans organisation gestionnaire (§4.1). Les transitions de statut restent arbitrées par le use case : la RLS ouvre l''écriture, elle ne dit pas quelle transition est légale.';

commit;
