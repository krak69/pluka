-- PLUKA — Un effort représentatif est complet, ou absent
-- Migration: 0019_trail_profile_effort_coherence.sql
--
-- Référence : docs/00_PRODUCT_SPEC.md §8.1 · docs/02_DATA_MODEL.md §4.2
--
-- POURQUOI
--
-- §8.1 décrit l'effort de référence comme un tout : « distance ; D+ ; durée ;
-- date facultative ». Seule la date est marquée facultative. Une distance sans
-- durée ne situe aucune allure, une durée sans distance non plus : un effort à
-- moitié saisi n'est pas un signal faible, c'est une donnée qui ne veut rien
-- dire.
--
-- POURQUOI EN SQL ET PAS SEULEMENT DANS LE DOMAINE
--
-- `trail_profiles` est l'une des rares tables que le client écrit directement
-- sous RLS : 0005 accorde insert/update/delete à `authenticated`, filtrés par
-- les policies propriétaire. Le use case serveur n'est donc pas le seul chemin
-- d'écriture, et un invariant qui ne vivrait que dans `packages/domain` ne
-- serait pas un invariant — juste une politesse du chemin principal.
--
-- CE QUE LA MIGRATION NE FAIT PAS
--
-- Elle ne contraint pas la date de l'effort à être passée. PostgreSQL refuse
-- les fonctions non immuables dans une contrainte CHECK, et `current_date` en
-- est une : la règle reste portée par le domaine, avec une horloge injectée.
--
-- Elle n'exige pas non plus qu'un profil soit complet. §7.2 veut qu'on puisse
-- le reprendre sans reposer toutes les questions, donc l'enregistrer avant la
-- fin ; la complétude est une lecture, pas une contrainte de table.

begin;

alter table public.trail_profiles
  add constraint trail_profiles_effort_is_whole check (
    (
      representative_distance_km is null
      and representative_elevation_gain_m is null
      and representative_duration_seconds is null
    )
    or (
      representative_distance_km is not null
      and representative_elevation_gain_m is not null
      and representative_duration_seconds is not null
    )
  );

comment on constraint trail_profiles_effort_is_whole on public.trail_profiles is
  'Effort représentatif tout ou rien (§8.1). Le libellé et la date restent indépendants : l''un nomme l''effort, l''autre le situe, aucun des deux ne mesure une allure.';

commit;
