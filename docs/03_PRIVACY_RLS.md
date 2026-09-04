# PLUKA — Privacy & Row Level Security V1

**Fichier de référence :** `docs/03_PRIVACY_RLS.md`  
**Statut :** Référence sécurité, confidentialité et autorisations données — V1  
**Date de consolidation :** 2026-09-03  
**Principe :** deny-by-default, moindre privilège, séparation B2C/B2B, agrégation avant exposition organisateur

---

# 0. Rôle de ce document

Ce document définit :

- les frontières de confidentialité de PLUKA ;
- qui peut lire, créer, modifier ou supprimer quelles données ;
- les principes de Row Level Security PostgreSQL / Supabase ;
- les rôles coureur, organisation, assistant et administrateur ;
- les règles d’accès aux données publiques ;
- les règles d’accès aux données personnelles ;
- les règles d’agrégation B2B ;
- les liens privés tokenisés ;
- la séparation du schéma `private` ;
- la stratégie Storage ;
- l’audit ;
- les tests RLS obligatoires.

Il sert de référence à Claude Code avant toute connexion réelle de l’application à Supabase.

Ce document ne remplace pas :

- les règles fonctionnelles de `00_PRODUCT_SPEC.md` ;
- les règles commerciales de `04_ENTITLEMENTS.md` ;
- les règles métier des moteurs ;
- la migration SQL réelle.

---

## 0.1 Documents de référence

Cette spec complète :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/04_ENTITLEMENTS.md`
- `docs/engines/PLAN_ENGINE.md`
- `docs/engines/NUTRITION_ENGINE.md`
- `docs/engines/SOURCES_EXTRACTION.md`
- `docs/engines/WEATHER_CONDITIONS.md`
- `docs/engines/RACE_INTELLIGENCE.md`
- `docs/ACCEPTANCE_CRITERIA.md`
- `supabase/migrations/*`

Le schéma initial actuel active RLS en deny-by-default mais ne contient volontairement encore aucune policy complète.

### Ordre de priorité

En cas de contradiction :

1. ce document fait foi sur **ce qu’un rôle est autorisé à voir ou modifier** ;
2. `00_PRODUCT_SPEC.md` fait foi sur le comportement fonctionnel attendu ;
3. `04_ENTITLEMENTS.md` fait foi sur le droit commercial à utiliser une fonctionnalité ;
4. les specs moteurs font foi sur les données nécessaires au calcul ;
5. `02_DATA_MODEL.md` et les migrations font foi sur la structure persistée ;
6. l’application ne doit jamais élargir un droit défini ici.

Une contradiction Privacy doit être traitée comme bloquante.

---

# 1. Principes fondamentaux

PLUKA applique les principes suivants :

> **Deny by default.**

> **Least privilege.**

> **Server-authoritative writes.**

> **Privacy by design.**

> **L’organisation ne voit jamais la préparation privée individuelle du coureur.**

> **Les données B2B sont agrégées avant exposition.**

> **Un entitlement ne donne jamais accès à une donnée interdite par la Privacy.**

---

# 2. Rôles de sécurité

Les rôles fonctionnels principaux sont :

```text
ANON
AUTHENTICATED USER
PARTICIPANT / COUREUR
ORGANIZATION MEMBER
PLUKA ADMIN
SERVICE / WORKER
ASSISTANT TOKEN
BRIEF TOKEN
```

Ces rôles ne correspondent pas tous à un rôle PostgreSQL natif.

Supabase expose principalement :

```text
anon
authenticated
service_role
```

Les rôles métier sont ensuite résolus via les données PLUKA.

---

# 3. Rôles organisation

Le Data Model définit :

```text
owner
admin
editor
viewer
```

Règle générale :

| Rôle | Lecture B2B | Modifier infos | Publier | Import participants | Gérer membres |
|---|---:|---:|---:|---:|---:|
| Viewer | ✓ | — | — | — | — |
| Editor | ✓ | ✓ selon scope | ✓ selon scope | — / limité | — |
| Admin | ✓ | ✓ | ✓ | ✓ | selon politique |
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ |

Les détails par table sont définis plus loin.

---

# 4. Platform role

`public.users.platform_role` possède :

```text
user
pluka_admin
```

Règles :

- un client ne peut jamais modifier son `platform_role` ;
- le rôle admin ne doit pas être assignable par une mutation publique ;
- le frontend ne doit pas considérer une valeur client comme preuve d’administration ;
- l’administration sensible peut exiger une vérification serveur additionnelle.

---

# 5. Matrice de confidentialité générale

| Domaine | Anon | Coureur | Organisation | Admin / serveur |
|---|---|---|---|---|
| Profil utilisateur | Non | Soi-même | Non | Oui |
| Profil trailer | Non | Soi-même | Non | Oui |
| Course publiée | Oui selon visibilité | Oui | Oui | Oui |
| Sources publiées | Selon course | Oui | Gestion scope | Oui |
| ParticipantRace | Non | Propre | Opérationnel limité | Oui |
| Plan | Non | Propre | **Jamais** | Oui |
| Préparation | Non | Propre | **Jamais** | Oui |
| Nutrition | Non | Propre | **Jamais** | Oui |
| Assistance | Token / propriétaire uniquement | Propre | **Jamais** | Oui |
| Urgence | Non | Propre | Consentement explicite uniquement | Oui |
| Outings | Non | Propre | **Jamais** | Oui |
| Weather personnel | Non | Propre | **Jamais individuel** | Oui |
| Q&A personnel | Non | Propre | **Jamais brut** | Oui |
| Race Intelligence | Non | Non nécessaire | Agrégé uniquement | Oui |
| Question Insights | Non | Non | Agrégé uniquement | Oui |
| Analytics raw | Non | Non | Non | Oui |
| `private.*` | Non | Non | Non | Service uniquement |

---

# 6. Deny-by-default

Toutes les tables `public` contenant des données applicatives doivent avoir :

```sql
alter table ... enable row level security;
```

et, lorsque pertinent :

```sql
alter table ... force row level security;
```

en environnement de production si cela ne bloque pas les opérations serveur prévues.

Aucune table sensible ne doit dépendre uniquement :

- de l’absence de lien UI ;
- d’un filtre React ;
- d’un endpoint non documenté.

---

# 7. Schéma `private`

Le schéma `private` est **hors Data API client**.

Le SQL initial révoque déjà :

```sql
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
```

et tous les objets privés sont révoqués à `anon` et `authenticated`.

Cette règle reste absolue.

Tables actuelles `private` :

- `source_chunks`
- `ingestion_jobs`
- `extraction_runs`
- `fact_candidates`
- `conflict_reports`
- `participant_performance_signals`
- `analytics_events`
- `audit_logs`
- `outbox_events`

À ajouter selon les nouvelles specs :

- `race_intelligence_run_members`

Aucun accès direct B2C ou B2B.

---

# 8. `service_role`

Le `service_role` :

- n’existe jamais dans le navigateur ;
- n’est jamais inclus dans une variable `NEXT_PUBLIC_*` ;
- n’est jamais utilisé par du code exécuté côté client ;
- n’est jamais journalisé ;
- n’est jamais retourné à un utilisateur.

Le `service_role` permet de contourner RLS techniquement.

Donc :

> **service_role ne doit jamais être considéré comme une autorisation métier.**

Les use cases serveur doivent encore vérifier :

- ownership ;
- rôle organisation ;
- entitlement ;
- état de l’objet ;
- invariants métier.

---

# 9. Helper functions RLS

Les policies ne doivent pas recopier des sous-requêtes complexes partout.

Créer des helpers `security definer` ciblés dans un schéma non exposé, par exemple :

```text
private.current_user_is_pluka_admin()
private.user_is_org_member(org_id)
private.user_has_org_role(org_id, roles[])
private.user_owns_participant_race(participant_race_id)
private.user_owns_race_plan(race_plan_id)
private.org_manages_event(org_id, event_id)
private.org_manages_edition(org_id, edition_id)
private.org_manages_race(org_id, race_id)
```

Les fonctions doivent :

- avoir `search_path` explicitement fixé ;
- être minimales ;
- ne jamais prendre un `user_id` client comme vérité lorsqu’il peut être obtenu via `auth.uid()` ;
- être révocables de l’exécution publique si inutiles au client.

---

# 10. Exemple helper sécurisé

```sql
create or replace function private.user_is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
  );
$$;
```

Les noms et détails finaux doivent être testés dans Supabase local.

---

# 11. `auth.uid()`

Les policies utilisent :

```sql
auth.uid()
```

comme identité courante.

Ne jamais accepter :

```text
user_id venant du client
```

comme substitut à `auth.uid()` dans une policy.

---

# 12. Utilisateur `public.users`

## Lecture

Un user authentifié peut lire :

```text
sa propre ligne
```

Un autre participant ne peut pas lire ce profil directement.

L’organisation ne peut pas utiliser `public.users` comme annuaire complet de participants.

## Update

Le user peut modifier uniquement des colonnes autorisées :

- first_name ;
- last_name ;
- avatar_url ;
- locale ;
- timezone.

Il ne peut pas modifier :

- `id` ;
- `email` directement si géré par Auth ;
- `platform_role`.

Pour contrôler les colonnes, préférer :

- RPC / Server Action ;
- ou trigger de protection.

RLS seule ne contrôle pas facilement les colonnes.

---

# 13. `trail_profiles`

Accès :

```text
SELECT : propriétaire
INSERT : propriétaire
UPDATE : propriétaire
DELETE : propriétaire si produit l’autorise
ORGANIZATION : aucun
```

Le profil trailer ne doit pas être exposé à l’organisation, même si Race Intelligence utilise éventuellement un autre signal.

La V1 Race Intelligence ne l’utilise d’ailleurs pas comme signal direct.

---

# 14. Organizations

`organizations` peut avoir une partie publique minimale :

- nom ;
- logo ;
- site ;
- statut actif.

Mais les champs opérationnels ne doivent pas nécessairement être exposés via lecture brute anonyme.

Préférer des vues / payloads publics pour les homepages.

Les membres d’une organisation peuvent lire l’organisation correspondante.

---

# 15. `organization_members`

## Lecture

Un membre peut lire :

- ses propres memberships ;
- les memberships de son organisation si son rôle l’autorise pour la gestion des membres.

Un Viewer n’a pas nécessairement besoin de voir tous les emails / users.

## Écriture

- Owner : gestion complète selon règles ;
- Admin : gestion limitée selon politique ;
- Editor / Viewer : aucune gestion.

Empêcher :

- un admin de supprimer le dernier owner ;
- un user de s’auto-promouvoir owner ;
- une modification de rôle sans use case serveur.

Les mutations membres doivent idéalement passer par un service serveur.

---

# 16. Events / Editions / Races

## Lecture publique

Autoriser les objets :

```text
published
```

et compatibles avec :

```text
public_visibility = public
```

Les courses `unlisted` doivent être accessibles uniquement par contexte prévu.

Les courses `private` ne doivent pas être listables par `anon`.

## Organisation

Une organisation peut gérer uniquement les objets dont :

```text
event.organization_id = organization
```

et pour lesquels l’utilisateur est membre avec le rôle requis.

## Admin

Accès complet contrôlé.

---

# 17. Race visibility

### `public`

Lecture publique.

### `unlisted`

Pas de listing public global.

Accès possible :

- lien direct ;
- invitation ;
- participant concerné ;
- organisation.

La RLS / API doit empêcher qu’une query générique anonyme liste toutes les courses unlisted.

### `private`

Accès limité :

- organisation ;
- PLUKA admin ;
- participants explicitement autorisés si le produit le demande.

---

# 18. Course reference tables

Tables :

- `race_start_waves`
- `race_waypoints`
- `race_segments`
- `race_cutoffs`
- `race_assistance_rules`
- `equipment_items`
- `race_equipment_requirements`

Lecture :

- suit la visibilité de la Race ;
- participant autorisé peut toujours lire les données de sa Race ;
- organisation gestionnaire peut gérer ;
- admin complet.

Une course non publique ne doit pas devenir lisible via un waypoint directement requêté.

Les policies doivent remonter jusqu’à `races`.

---

# 19. Sources

Tables :

- `sources`
- `source_race_scopes`
- `source_snapshots`
- `race_facts`
- `race_fact_versions`
- `fact_sources`

Il faut distinguer :

```text
source metadata
snapshot brut
fact publié
```

---

# 20. Source metadata publique

Une source associée à une Race publique peut exposer au participant / public autorisé :

- titre ;
- type ;
- URL officielle si pertinente ;
- date ;
- provenance.

Mais :

- `storage_path` privé ;
- metadata technique ;
- erreur pipeline ;

ne doivent pas être exposés sans nécessité.

Il peut être préférable de ne pas accorder un `SELECT *` direct à `sources` pour `anon`, mais de servir une view / DTO public.

---

# 21. Source snapshots

Le contenu brut d’un snapshot peut être soumis à :

- copyright ;
- conditions de redistribution ;
- confidentialité.

Donc :

> **ne pas ouvrir automatiquement `source_snapshots` en lecture anon.**

Les participants ont besoin de citations et de preuve, pas nécessairement du fichier snapshot brut.

Les fichiers privés utilisent des signed URLs produites serveur selon autorisation.

---

# 22. RaceFacts

Une version `published` d’un RaceFact peut être lue par :

- participant de la Race ;
- public si Race publique et fact public ;
- organisation ;
- admin.

Les versions `draft`, `validated` non publiées, `rejected`, `superseded` sont :

- organisation concernée selon rôle ;
- admin ;
- pas public.

---

# 23. Niveau Official

Le champ `trust_level = official` ne doit pouvoir être écrit que par :

- une organisation autorisée sur la Race ;
- ou un use case serveur explicitement autorisé à reproduire sa décision.

Un admin PLUKA peut administrer le système, mais ne doit pas qualifier une donnée `official` au nom de l’organisation sans workflow explicite.

Cette règle est métier + audit, pas seulement RLS.

---

# 24. Versions immuables

Une `race_fact_version` publiée ne doit pas être modifiable.

Le SQL initial possède déjà des triggers de protection.

RLS doit en plus :

- refuser les UPDATE client ;
- refuser les DELETE client.

Une nouvelle valeur produit une nouvelle version.

---

# 25. FactSources

Les preuves publiées doivent être lisibles dans le même scope que le Fact.

Mais :

- chunk privé ;
- snapshot interne ;
- metadata IA ;

restent privés.

Le client reçoit un locator / excerpt prévu, pas un accès libre au schéma `private`.

---

# 26. ParticipantRace

`participant_races` est une donnée privée de participation.

## Coureur

Peut lire sa propre participation lorsque :

```text
participant_races.user_id = auth.uid()
```

ou relation d’activation équivalente.

## Organisation

L’organisation peut avoir besoin d’un accès **opérationnel limité** pour :

- liste des inscrits ;
- statut invitation ;
- dossard ;
- vague ;
- activation PLUKA ;
- données importées nécessaires.

Elle ne doit pas recevoir via ce droit :

- Plan ;
- profil trailer ;
- Nutrition ;
- Assistance ;
- notes ;
- sorties.

---

# 27. Vue participants organisation

Ne pas donner au BO un `SELECT *` arbitraire sur `participant_races` + `users`.

Créer une lecture métier safe contenant seulement les champs autorisés.

Exemple :

```text
participant_race_id
first_name
last_name
email si nécessaire au workflow invitation
bib_number
wave
invitation_status
activation_status
```

Puis, pour Race Intelligence :

- aucune donnée individuelle de performance dans cette vue nominale.

---

# 28. Minimisation email

L’email participant ne doit être visible à l’organisation que si :

- il vient de son import / relation légitime ;
- il est nécessaire à l’invitation / support participant.

Ne pas rendre l’email visible dans tous les écrans B2B.

---

# 29. `participant_race_settings`

Accès propriétaire uniquement côté B2C.

L’organisation ne doit pas lire des préférences personnelles de préparation.

---

# 30. Entitlements

Un user peut lire ses propres entitlements utiles à l’affichage.

Il ne peut pas :

- en créer ;
- en modifier ;
- les révoquer.

Écriture via :

- billing backend ;
- organisation via use case controlled ;
- admin.

L’organisation ne doit pas avoir un `INSERT` arbitraire lui permettant de créer PLUS.

Le use case Organizer Included impose le type et le scope.

---

# 31. Race Plans

Tables :

- `race_plans`
- `plan_waypoints`
- `plan_segments`
- `plan_cutoff_statuses`
- `plan_version_dependencies`

Règle absolue :

> **Organisation : aucun accès direct.**

Même si la participation a été financée par l’organisation.

---

# 32. Lecture Race Plan

Le propriétaire peut lire les Plans liés à ses `participant_races`.

Condition conceptuelle :

```text
race_plan.participant_race_id
→ participant_race.user_id
= auth.uid()
```

Le user peut lire les versions historiques qui lui appartiennent.

---

# 33. Écriture Race Plan

Les mutations structurantes doivent passer par le serveur.

Pourquoi :

- entitlement ;
- moteur déterministe ;
- versioning ;
- outbox ;
- downstream.

Recommandation RLS :

```text
client direct INSERT/UPDATE/DELETE = non
```

Le client appelle une Server Action / API.

Le serveur utilise user context ou service role avec autorisation métier.

---

# 34. `plan_version_dependencies`

Lecture propriétaire possible si nécessaire pour diagnostics.

Écriture :

```text
serveur uniquement
```

Le client ne doit jamais pouvoir déclarer arbitrairement :

> mon Plan dépend de telle version.

---

# 35. Race change impacts

Tables :

- `race_change_events`
- `participant_change_impacts`

Le participant lit :

- ses impacts.

L’organisation peut lire :

- l’événement de changement ;
- les agrégats impactés ;
- éventuellement status de consultation agrégé.

Ne pas exposer automatiquement :

```text
Clément a revérifié son Plan
```

dans le BO.

---

# 36. Tasks

`tasks` sont privées au coureur.

L’organisation ne lit pas les TODO individuels.

Même origine :

```text
official_change
```

ne les rend pas publics.

L’organisation peut connaître le nombre agrégé de préparations concernées via un snapshot métier distinct.

---

# 37. Participant equipment

`participant_equipment` est privé.

L’organisation connaît :

- ses `race_equipment_requirements`.

Elle ne connaît pas :

- si le coureur a coché ses gants ;
- ce qu’il a ajouté personnellement ;
- ce qu’il a packé.

Même une suggestion Conditions reste privée.

---

# 38. Bags

`bags` et `bag_items` sont privés.

Aucun accès organisation.

Un assistant peut recevoir uniquement les items explicitement rattachés à son rendez-vous via le payload Assistance.

---

# 39. Outings

Tables :

- `outings`
- `outing_waypoints`
- `outing_equipment`
- `outing_feedback`

Propriétaire uniquement.

Même si une Outing est liée à une Race organisée :

> **l’organisation n’obtient aucun accès à la sortie personnelle.**

Race Intelligence V1 n’utilise pas les sorties privées.

---

# 40. Nutrition

Tables :

- `user_nutrition_products`
- `nutrition_plans`
- `nutrition_conditions`
- `nutrition_condition_ranges`
- `nutrition_waypoints`
- `nutrition_waypoint_items`

Propriétaire uniquement.

Aucun accès organisation.

---

# 41. Canonical nutrition products

`nutrition_products` validés peuvent être lisibles par :

- users authentifiés ;
- éventuellement public si utilisé sur site public.

Les produits privés utilisateurs restent privés.

L’organisation peut lire le catalogue canonique si nécessaire, mais pas la sélection personnelle d’un participant.

---

# 42. Race aid station items

`race_aid_station_items` suit la visibilité de la Race.

Il s’agit de contenu officiel / validé de ravitaillement, pas de stratégie personnelle.

---

# 43. Assistance

Tables :

- `race_assistants`
- `assistance_assignments`
- `assistance_items`
- `assistant_access_tokens`

Propriétaire côté application.

Organisation :

```text
aucun accès
```

---

# 44. Assistant privé

Un assistant ne doit pas devenir un `authenticated` user obligatoire.

La page privée utilise :

```text
token opaque
```

Le token brut :

- apparaît uniquement dans l’URL / secret remis au coureur ;
- n’est jamais stocké en base ;
- est hashé.

---

# 45. `assistant_access_tokens`

La table stocke :

```text
token_hash
expires_at
revoked_at
```

Le navigateur `anon` ne doit pas faire :

```sql
select * from assistant_access_tokens where token_hash = ...
```

à travers RLS.

Le flow doit être :

```text
request avec token
→ endpoint serveur
→ hash token
→ recherche service
→ validation
→ projection safe
→ réponse
```

---

# 46. Payload Assistant safe

Le payload peut contenir :

- nom du rendez-vous ;
- waypoint ;
- heure estimée / fenêtre ;
- accès / parking utile ;
- sacs / items à apporter ;
- instructions ;
- météo compacte ;
- prochain rendez-vous.

Il ne contient pas automatiquement :

- objectif global ;
- Plan complet ;
- Nutrition complète ;
- autres notes privées ;
- profil trailer ;
- historique utilisateur.

---

# 47. Expiration Assistant token

Si :

```text
revoked_at not null
```

ou :

```text
expires_at <= now
```

le lien est invalide.

Aucun cache public ne doit continuer à servir le payload après révocation.

---

# 48. Emergency contacts

`emergency_contacts` est strictement séparé de l’Assistance.

Propriétaire :

- lecture / modification.

Organisation :

- aucun accès nominal par défaut.

Une future fonctionnalité sécurité ne pourrait exposer le contact que :

- avec consentement explicite ;
- finalité déterminée ;
- accès restreint ;
- audit.

Ne pas implémenter un accès organisation automatique V1.

---

# 49. Weather personnel

Tables :

- `weather_forecast_runs`
- `weather_forecast_points`
- `condition_periods`
- `condition_proposals`

Ces objets appartiennent au user / scope personnel.

Organisation :

> **aucun accès direct aux runs personnels.**

---

# 50. Weather ownership

Pour Race :

```text
weather_forecast_run.race_plan_id
→ participant_race.user_id
```

Pour Outing :

```text
weather_forecast_run.outing_id
→ outings.owner_user_id
```

Le propriétaire peut lire.

Écriture / refresh :

serveur.

---

# 51. Condition proposals

Une proposal est privée au user.

L’organisation ne voit pas :

- si le coureur a accepté une suggestion froid ;
- s’il a modifié sa Nutrition ;
- s’il a ajouté un vêtement.

---

# 52. Official notices météo

`race_notices` est distinct.

Une notice officielle peut être lue :

- Free ;
- Premium ;
- public selon visibilité de la Race.

Elle ne doit pas dépendre d’un WeatherRun personnel.

---

# 53. Community

Tables :

- `community_threads`
- `community_posts`
- `community_reactions`
- `community_reports`

Communauté liée à une Race / édition.

Lecture V1 :

- participants autorisés de la Race ;
- modérateurs ;
- admin.

Pas de communauté publique globale par défaut.

---

# 54. Community privacy

Un post communautaire ne doit pas exposer automatiquement :

- email ;
- Plan ;
- Nutrition ;
- Assistance.

Le display profile doit être minimal.

Prévoir une abstraction publique du profil si nécessaire.

---

# 55. Community moderation

Organisation peut modérer uniquement si le produit lui donne ce rôle.

Un rôle `viewer` organisation ne doit pas modérer.

Les signalements peuvent être visibles :

- modérateur autorisé ;
- admin PLUKA.

---

# 56. After-race

`post_race_reviews` :

```text
privé propriétaire
```

Organisation :

```text
aucun accès
```

---

# 57. Publication after-race

`post_race_review_publications` représente un snapshot explicitement publié.

Seul ce snapshot peut devenir visible à la communauté selon le produit.

Publier un retour :

- ne rend pas le `post_race_review` brut public ;
- ne rend pas les notes privées publiques ;
- ne rend pas Nutrition / Assistance privées publiques.

---

# 58. Imports participants

Tables :

- `participant_imports`
- `participant_import_rows`
- `enrichment_imports`
- `enrichment_import_rows`
- `participant_invitations`

Organisation concernée uniquement, selon rôle.

---

# 59. Imports — access roles

Recommandation :

### Viewer

Lecture synthétique seulement si nécessaire.

### Editor

Pas d’import brut par défaut.

### Admin / Owner

Créer, mapper, corriger, importer.

Le rôle exact peut être ajusté produit, mais l’import de PII n’est pas un droit Viewer.

---

# 60. Import rows

Contiennent potentiellement des PII.

Ne jamais :

- exposer à `anon` ;
- indexer publiquement ;
- envoyer en analytics ;
- rendre disponibles à une autre organisation.

---

# 61. Enrichment

`enrichment_import_rows` peut contenir des données ITRA / UTMB individuelles.

Accès :

- admins / owners organisation dans le workflow de matching ;
- serveur ;
- PLUKA admin selon support.

Pas d’accès Race Intelligence nominal permanent.

---

# 62. Performance signals privés

`private.participant_performance_signals` :

```text
service only
```

Race Intelligence utilise ces signaux côté worker.

L’organisation n’accède pas directement à cette table.

---

# 63. Q&A

Tables :

- `pluka_conversations`
- `pluka_messages`
- `pluka_answer_sources`

Conversations personnelles :

```text
propriétaire seulement
```

Organisation :

```text
aucun accès
```

---

# 64. Q&A answer sources

Le propriétaire peut voir les sources liées à ses réponses.

L’organisation ne peut pas utiliser `pluka_answer_sources` pour reconstruire les questions individuelles.

Les Insights utilisent un pipeline séparé.

---

# 65. Question Insights

`question_insight_snapshots` :

- agrégés ;
- participant_count >= 10 selon le schéma ;
- lisibles par organisation de la Race ;
- pas de user_id ;
- pas de message_id.

Le texte normalisé doit être suffisamment générique pour ne pas contenir accidentellement une PII issue d’un message.

Le pipeline de normalisation doit nettoyer les données identifiantes.

---

# 66. Analytics raw

`private.analytics_events` :

```text
service only
```

L’organisation n’a jamais accès aux events bruts.

Elle consomme :

```text
organization_adoption_snapshots
```

ou autres agrégats autorisés.

---

# 67. Adoption snapshots

`organization_adoption_snapshots` peut être lu par l’organisation concernée.

Il contient des counts.

Il ne contient pas :

- liste nominative des Plans ;
- liste Nutrition ;
- Assistance individuelle.

---

# 68. Race Intelligence

Tables publiques :

- `race_intelligence_runs`
- `race_intelligence_wave_summaries`
- `race_intelligence_waypoint_flows`
- `race_intelligence_cutoff_summaries`
- `race_intelligence_weather_exposures`

Règle :

> **Organisation : agrégats safe uniquement.**

Coureur :

pas besoin d’accès.

Anon :

aucun accès.

---

# 69. Private Race Intelligence inputs

À ajouter :

```text
private.race_intelligence_run_members
```

Contient les références individuelles nécessaires à l’audit.

Accès :

```text
service only
```

Même un Owner organisation ne doit pas lire cette table.

---

# 70. Minimum group size

Règle absolue V1 :

```text
minimum = 10
```

Un groupe sous 10 ne doit pas produire de sortie nominativement ou analytiquement exploitable.

Le schéma actuel impose déjà `participant_count >= 10` sur certaines tables.

Cette règle doit aussi être appliquée :

- avant insertion ;
- dans les APIs safe ;
- sur les breakdowns JSON ;
- dans les filtres.

---

# 71. Seuil dans les JSON breakdowns

Un `wave_breakdown jsonb` ne doit pas contenir :

```json
{
  "waveX": {
    "participantCount": 4,
    "expected": 3.2
  }
}
```

même si la row totale a 500 participants.

Le worker / PrivacyMask doit supprimer ce breakdown.

---

# 72. Small bucket

Un bucket de passage peut avoir moins de 10 personnes attendues.

Le risque apparaît surtout lorsqu’un filtre réduit la cohorte identifiable.

Politique V1 recommandée :

- si le **groupe source** est >=10, le bucket peut exister ;
- si un sous-groupe filtré possède <10 membres, ne pas afficher la valeur exacte ;
- payload safe peut retourner :
  - `suppressed: true`
  - ou une catégorie `low_volume`.

La policy exacte de rendu doit être cohérente partout.

---

# 73. Filtres B2B autorisés

Race Intelligence :

- Race ;
- vague si groupe >=10 ;
- waypoint ;
- cutoff ;
- période.

Interdits :

- participant ;
- email ;
- dossard ;
- combinaison âge/nationalité/index ;
- filtres arbitraires permettant une micro-cohorte.

---

# 74. Safe repository

Le BO ne doit pas lire directement les tables Race Intelligence via un Supabase client générique.

Préférer des services :

```text
getOrganizerRaceAnalysis
getOrganizerWaypointFlow
getOrganizerCutoffDetail
getOrganizerWeatherExposure
```

Ces services :

1. vérifient le membership ;
2. vérifient le scope Race ;
3. chargent le dernier run autorisé ;
4. appliquent le PrivacyMask ;
5. retournent un DTO sans identifiant participant.

---

# 75. Organizer brief

`organizer_briefs` contient un snapshot safe.

L’organisation peut lire ses briefs.

Un Brief partagé utilise un token privé séparé.

---

# 76. Brief token

Même principe que Assistance :

- token brut non stocké ;
- hash en DB ;
- expiration ;
- révocation ;
- endpoint serveur ;
- aucune lecture RLS anon brute.

---

# 77. Brief public payload

Le Brief partagé contient uniquement :

- Course ;
- conclusions Race Intelligence agrégées ;
- Insights agrégés ;
- Conditions agrégées ;
- état de préparation organisation.

Jamais :

- participant rows ;
- Plans ;
- index individuels ;
- emails ;
- Nutrition ;
- Assistance.

---

# 78. Token hashing

Pour les liens privés :

```text
token = random cryptographically secure bytes
token_hash = SHA-256(token)
```

Le token brut est retourné une fois au créateur / destinataire.

Ne jamais stocker :

```text
plaintext token
```

---

# 79. Token entropy

Utiliser au minimum une entropie suffisante pour rendre le brute-force irréaliste.

Recommandation :

```text
32 random bytes
```

encodés URL-safe.

---

# 80. Rate limiting tokens

Les routes tokenisées doivent être rate-limitées.

En cas de nombreuses tentatives invalides :

- ralentissement ;
- blocage temporaire ;
- logs sécurité.

Ne pas révéler :

> token existe mais est expiré

vs :

> token inconnu

si cette distinction augmente inutilement l’information à l’attaquant.

---

# 81. Noindex

Routes :

- app ;
- admin ;
- Assistance privée ;
- Brief partagé ;
- invitation ;

doivent être :

```text
noindex
```

selon leur nature.

---

# 82. Storage buckets

Buckets conceptuels :

```text
public-assets
race-sources
source-snapshots
gpx
participant-exports
generated-exports
```

---

# 83. `public-assets`

Peut contenir :

- logos publics ;
- images marketing ;
- assets course autorisés.

Lecture publique.

Écriture serveur / rôle autorisé.

---

# 84. `race-sources`

Par défaut privé.

Accès via :

- signed URL ;
- endpoint serveur ;
- user / organisation autorisés.

Une URL brute de Storage ne doit pas rendre un règlement privé accessible.

---

# 85. `source-snapshots`

Toujours privé par défaut.

Ce sont des preuves internes / versionnées.

Ne pas exposer un bucket public.

---

# 86. GPX

Un GPX officiel public peut éventuellement être distribué publiquement si la Race le permet.

Mais la bucket policy doit distinguer :

- GPX course officiel ;
- GPX Outing personnel.

Ne jamais stocker les deux avec les mêmes permissions génériques.

Recommandation :

```text
race-gpx
outing-gpx
```

ou préfixes strictement séparés.

---

# 87. Outing GPX

Strictement privé propriétaire.

Organisation :

aucun accès.

Même si Outing liée à une Race.

---

# 88. Participant exports

CSV / exports participants :

- privés organisation ;
- signed URL courte ;
- pas de bucket public ;
- audit téléchargement si nécessaire.

---

# 89. Generated exports coureur

PDF / Race Pack personnel :

- propriétaire ;
- signed URL ;
- pas public.

Un Race Pack peut contenir des informations personnelles de préparation.

---

# 90. Signed URL

Durée limitée.

Ne pas créer une signed URL d’une semaine par facilité.

La durée dépend du besoin UX.

La création d’une URL signée vérifie l’autorisation au moment de l’émission.

---

# 91. Audit

`private.audit_logs` conserve les opérations sensibles.

Actions à auditer au minimum :

- publication fact officielle ;
- modification membership ;
- import participants ;
- export participants ;
- grant entitlement ;
- revoke entitlement ;
- création / révocation lien Assistant ;
- création / révocation Brief ;
- publication notice officielle ;
- actions admin sensibles.

---

# 92. Audit log et PII

Éviter de stocker des snapshots complets contenant :

- nutrition ;
- téléphone ;
- conversation ;
- PII non nécessaire.

`before_data` / `after_data` doivent être minimisés / redacted selon l’action.

---

# 93. Retention

La politique légale finale devra être documentée séparément.

Architecture à prévoir :

- suppression compte ;
- anonymisation ;
- suppression / révocation tokens ;
- suppression des données privées ;
- conservation éventuelle d’agrégats anonymisés autorisés ;
- conservation d’audit strictement nécessaire.

Ne pas implémenter des durées arbitraires sans validation juridique.

---

# 94. User deletion

Un user doit pouvoir être supprimé / anonymisé selon la politique produit.

Le cascade ne doit pas accidentellement supprimer :

- les Facts Course partagés ;
- une Course organisation.

Mais doit supprimer / anonymiser :

- profil ;
- trail profile ;
- Plans ;
- Nutrition ;
- Assistance ;
- outings ;
- conversations personnelles ;
- tokens.

Le schéma doit être revu pour les `ON DELETE` pertinents.

---

# 95. Race Intelligence et suppression

Les run members privés reliant un participant à un run doivent suivre la politique d’effacement.

Les agrégats historiques peuvent potentiellement rester si :

- aucun participant n’est ré-identifiable ;
- le cadre juridique le permet ;
- le minimum de groupe reste satisfait.

Cette décision nécessite validation juridique avant production.

---

# 96. Analytics et suppression

Les events avec `user_id` doivent permettre :

- suppression ;
- anonymisation ;
- `on delete set null` si légalement adapté.

Le contenu analytics doit rester minimal.

---

# 97. Sensitive data classification

PLUKA doit classer ses données.

## Public

- Course publique ;
- facts publiés ;
- source officielle publique ;
- notices publiques.

## Account personal

- nom ;
- email ;
- profil.

## Private preparation

- Plan ;
- Nutrition ;
- matériel personnel ;
- bags ;
- Assistance ;
- outings ;
- Q&A ;
- post-race privé.

## Organization confidential

- imports participants ;
- emails ;
- invitations ;
- briefs non partagés ;
- données sources non publiées.

## Highly restricted technical

- performance signals ;
- raw analytics ;
- source chunks ;
- run members Race Intelligence ;
- audit ;
- jobs ;
- tokens hashés.

---

# 98. Data minimization

Chaque table / payload doit poser la question :

> **Cette donnée est-elle réellement nécessaire à cette finalité ?**

Exemples :

Race Intelligence n’a pas besoin :

- nom ;
- email.

Weather Engine n’a pas besoin :

- nom ;
- profil trailer.

Plan Engine n’a pas besoin :

- téléphone assistant.

---

# 99. Server Actions / Route handlers

Une mutation critique suit :

```text
authenticate
↓
authorize scope
↓
authorize role / entitlement
↓
validate input
↓
execute domain use case
↓
persist
↓
audit / outbox
```

Pas :

```text
client writes table directly
```

pour les domaines complexes.

---

# 100. Lectures directes client

Les lectures directes via Supabase client peuvent être autorisées uniquement pour des objets simples et bien protégés.

Exemples possibles :

- propre profil ;
- facts publics ;
- propre checklist simple.

Mais la préférence V1 pour les objets sensibles / agrégés est :

```text
server query
→ DTO
```

---

# 101. RLS et entitlements

RLS n’est pas le meilleur endroit pour réimplémenter toute la matrice Free / Race Pass / PLUS.

Séparation :

```text
RLS
= qui peut accéder à la donnée

EntitlementService
= qui peut utiliser une feature / mutation
```

Exemple :

un user peut avoir le droit de lire un ancien NutritionPlan lui appartenant après expiration PLUS, tout en n’ayant plus le droit de le modifier.

---

# 102. RLS et Organization Included

Organizer Included donne un droit au participant.

Il ne donne aucun droit supplémentaire à l’organisation sur les données privées générées.

C’est une règle critique.

---

# 103. Owner organisation ≠ owner des données participant

Même un :

```text
organization owner
```

ne devient jamais propriétaire :

- du Plan ;
- de Nutrition ;
- d’Assistance ;
- des Outings ;
- du profil trailer.

---

# 104. Admin PLUKA

Un PLUKA Admin peut avoir besoin d’accès pour support / modération.

Mais :

- l’accès doit être justifié ;
- audité ;
- limité dans l’UI ;
- pas utilisé pour navigation informelle.

Le simple statut `pluka_admin` ne doit pas transformer toutes les données en contenu courant de l’admin UI.

---

# 105. Support impersonation

Ne pas implémenter une “connexion en tant que user” opaque.

Si une future fonction d’impersonation existe :

- banner explicite ;
- justification ;
- audit ;
- expiration ;
- interdiction de certaines actions sensibles.

Hors MVP recommandé.

---

# 106. RLS policy naming

Convention recommandée :

```text
<table>__select__owner
<table>__select__published
<table>__select__org_member
<table>__insert__owner
<table>__update__owner
<table>__delete__owner
```

Exemple :

```text
trail_profiles__select__owner
```

Cela facilite l’audit.

---

# 107. `SELECT` owner pattern

Exemple :

```sql
create policy trail_profiles__select__owner
on public.trail_profiles
for select
to authenticated
using (user_id = auth.uid());
```

---

# 108. `INSERT` owner pattern

```sql
create policy trail_profiles__insert__owner
on public.trail_profiles
for insert
to authenticated
with check (user_id = auth.uid());
```

Si le PK user est créé serveur automatiquement, on peut refuser l’insert direct client et passer par use case.

---

# 109. Child ownership pattern

Exemple PlanWaypoint :

```sql
using (
  exists (
    select 1
    from public.race_plans rp
    join public.participant_races pr
      on pr.id = rp.participant_race_id
    where rp.id = plan_waypoints.race_plan_id
      and pr.user_id = auth.uid()
  )
)
```

Pour performance, encapsuler les patterns répétitifs dans des helpers stables et indexer les FK.

---

# 110. Race management helper

Une organisation gère une Race lorsque :

```text
race
→ edition
→ event
→ organization_id
```

et le user possède le rôle requis.

Helper conceptuel :

```text
private.user_can_manage_race(race_id, min_role)
```

La hiérarchie de rôles doit être explicite, pas lexicographique.

---

# 111. Role hierarchy

Définir une fonction métier :

```text
viewer  = 10
editor  = 20
admin   = 30
owner   = 40
```

ou checks par sets.

Ne pas dépendre de l’ordre enum PostgreSQL comme s’il représentait automatiquement une hiérarchie.

---

# 112. Published course helper

Créer un helper / view pour éviter les incohérences entre :

- race.status ;
- edition.status ;
- event.status ;
- visibility.

Exemple :

```text
private.race_is_publicly_readable(race_id)
```

---

# 113. Organization scoping imports

Un import doit être rattaché à une Race / Edition appartenant à l’organisation.

Une policy ne doit jamais seulement vérifier :

```text
created_by_user_id = auth.uid()
```

car un ancien utilisateur ayant quitté une organisation ne doit pas garder l’accès indéfiniment à un import organisation.

Le scope organisation prime.

---

# 114. Membership revoked

Lorsqu’un membre est retiré de l’organisation :

- les accès B2B cessent immédiatement ;
- ses anciennes actions restent dans l’audit ;
- les objets organisation qu’il a créés ne deviennent pas ses objets personnels.

---

# 115. Invite participant token

Les invitations participant peuvent utiliser un token.

Même principes :

- token hashé ;
- expiration ;
- révocation ;
- endpoint serveur ;
- limitation des données avant authentification.

Une invitation ne doit pas permettre de lire le ParticipantRace complet sans validation.

---

# 116. Claim invitation

Flow sécurisé :

```text
token valide
↓
preview minimale
↓
auth utilisateur
↓
vérification identité / email selon politique
↓
claim
↓
participant_race.user_id = auth.uid()
```

Le token seul ne doit pas permettre de changer arbitrairement le `user_id`.

---

# 117. Email matching

Si l’invitation est liée à un email :

le claim doit vérifier la politique choisie :

- email Auth correspond ;
- ou challenge supplémentaire.

Ne pas considérer la possession d’un lien transféré comme preuve suffisante si le produit exige une identité.

---

# 118. Concurrency claim

Une invitation ne peut être activée qu’une fois.

Utiliser transaction / lock / contrainte unique.

Deux requests simultanées ne doivent pas rattacher la même participation à deux users.

---

# 119. Public facts et communautés

Une information communautaire ne doit pas être lisible comme Official Fact.

Conserver :

```text
trust_level
```

et sources.

La UI et l’API doivent transmettre le trust level.

---

# 120. API Data leakage

Les DTO serveur doivent éviter les `select *`.

Exemple mauvais :

```ts
return participantRaceRow
```

Exemple correct :

```ts
return {
  id,
  bibNumber,
  waveName,
  invitationStatus
}
```

selon finalité.

---

# 121. JSONB privacy

Une row agrégée peut être safe au niveau des colonnes mais contenir des PII dans `metadata jsonb`.

Règle :

> **Tout JSONB exposé au B2B doit avoir un schéma de contenu contrôlé.**

Interdit :

```text
metadata = raw worker dump
```

---

# 122. Race Intelligence `input_snapshot`

Le `input_snapshot` public ne contient jamais :

- participant IDs ;
- Plan IDs ;
- signaux individuels ;
- ETAs ;
- emails.

Seulement des counts, versions et configs safe.

---

# 123. Organizer brief `content`

Même règle.

Le JSON doit être construit par une fonction safe / serializer.

Il ne doit pas contenir un dump des objets sources.

---

# 124. Q&A answer payload

Les réponses personnelles peuvent inclure des données du user.

Elles restent propriétaire only.

Une réponse Q&A ne devient pas un insight B2B brut.

---

# 125. Export user data

Prévoir une architecture permettant plus tard :

- export des données personnelles du user ;
- téléchargement de ses propres données.

Cette fonction sera serveur et auditée.

---

# 126. Export organization data

Une organisation peut exporter :

- ses données Course ;
- ses participants selon son droit ;
- ses agrégats.

Elle ne peut pas exporter les Plans privés.

---

# 127. Security headers

Les apps privées doivent configurer :

- CSP ;
- HSTS en production ;
- secure cookies ;
- `SameSite` adapté ;
- referrer policy ;
- permissions policy raisonnable.

Les pages tokenisées doivent éviter que le token fuit via referrer vers des tiers.

---

# 128. Referrer token leakage

Pour Assistance / Brief / Invitation :

utiliser une politique :

```text
Referrer-Policy: no-referrer
```

ou stratégie équivalente suffisamment stricte.

Éviter les scripts tiers inutiles sur ces pages.

---

# 129. Analytics sur pages tokenisées

Ne pas envoyer l’URL complète contenant le token à un outil analytics tiers.

Sanitiser :

- path ;
- query ;
- referrer.

---

# 130. PII logs

Interdit par défaut dans logs :

- email ;
- téléphone ;
- token ;
- contenu conversation ;
- note privée ;
- liste Nutrition.

Utiliser IDs techniques.

---

# 131. Error reporting

Sentry / erreurs :

- scrub PII ;
- scrub tokens ;
- ne pas inclure body complet des endpoints privés ;
- ne pas enregistrer signed URLs.

---

# 132. Database backups

Les backups contiennent des données privées.

Ils doivent suivre les garanties de la plateforme :

- chiffrement ;
- accès restreint ;
- rétention contrôlée ;
- restauration auditée.

Ne pas utiliser des dumps production sur les machines de dev.

---

# 133. Staging

Staging ne doit pas utiliser la base production.

Les datasets de test doivent être :

- synthétiques ;
- anonymisés ;
- ou explicitement autorisés.

Ne pas copier les participants d’une vraie organisation en staging sans cadre prévu.

---

# 134. Local dev

Seeds :

- fictifs ;
- clairement marqués ;
- pas de PII réelle.

Les exemples Wildstrubel du prototype restent des fixtures de démonstration, pas des données partenaires réelles.

---

# 135. Secret management

Secrets :

- Supabase service key ;
- Weather provider key ;
- AI key ;
- email key ;
- billing secret ;

stockés dans le secret manager de l’environnement.

Jamais Git.

---

# 136. RLS tests — principe

Pour chaque domaine, tester :

```text
autorisation positive
+
interdiction négative
```

Les tests négatifs sont aussi importants que les positifs.

---

# 137. Test personas

Minimum :

```text
anon
runner_a
runner_b
org_owner_a
org_admin_a
org_editor_a
org_viewer_a
org_owner_b
pluka_admin
service
```

Plus :

```text
assistant_valid_token
assistant_revoked_token
brief_valid_token
brief_expired_token
```

---

# 138. Tests users / profiles

## P01

Runner A lit son user.

Attendu : autorisé.

## P02

Runner A lit user B.

Attendu : refusé.

## P03

Runner A modifie son platform_role.

Attendu : refusé.

## P04

Org Owner lit trail profile Runner A.

Attendu : refusé.

---

# 139. Tests Course

## P05

Anon lit Race publique publiée.

Attendu : autorisé.

## P06

Anon liste Race private.

Attendu : refusé.

## P07

Participant invité lit sa Race unlisted.

Attendu : autorisé selon flow.

## P08

Org A modifie Race Org B.

Attendu : refusé.

---

# 140. Tests Sources

## P09

Anon lit RaceFact publié d’une Race publique.

Attendu : autorisé si fact public.

## P10

Anon lit RaceFact draft.

Attendu : refusé.

## P11

Org Editor publie sur sa Race si rôle prévu.

Attendu : autorisé via use case.

## P12

Org B publie fact sur Race Org A.

Attendu : refusé.

## P13

Client update RaceFactVersion publiée.

Attendu : refusé.

---

# 141. Tests ParticipantRace

## P14

Runner A lit sa participation.

Attendu : autorisé.

## P15

Runner A lit participation B.

Attendu : refusé.

## P16

Org A lit participant opérationnel de sa Race.

Attendu : autorisé via DTO safe.

## P17

Org A utilise cette relation pour lire le Plan.

Attendu : refusé.

---

# 142. Tests Plan

## P18

Runner A lit son RacePlan.

Attendu : autorisé.

## P19

Runner B lit RacePlan A.

Attendu : refusé.

## P20

Org Owner lit RacePlan A.

Attendu : refusé.

## P21

Client insère directement une version Plan non autorisée.

Attendu : refusé si stratégie server-only retenue.

---

# 143. Tests Nutrition

## P22

Runner A lit Nutrition A.

Attendu : autorisé.

## P23

Org A lit Nutrition A.

Attendu : refusé.

## P24

Assistant lit Nutrition complète.

Attendu : refusé.

---

# 144. Tests Assistance

## P25

Runner A gère son assistant.

Attendu : autorisé.

## P26

Org A lit race_assistants.

Attendu : refusé.

## P27

Token valide appelle endpoint.

Attendu : payload safe.

## P28

Token révoqué.

Attendu : refusé.

## P29

Token brut existe en DB.

Attendu : jamais.

---

# 145. Tests Outings

## P30

Runner A lit son Outing liée à Race A.

Attendu : autorisé.

## P31

Org A lit cette Outing.

Attendu : refusé.

---

# 146. Tests Weather

## P32

Runner A lit WeatherRun de son Plan.

Attendu : autorisé.

## P33

Org A lit WeatherRun A.

Attendu : refusé.

## P34

Org A lit Weather Exposure agrégée safe.

Attendu : autorisé.

---

# 147. Tests Q&A

## P35

Runner A lit sa conversation.

Attendu : autorisé.

## P36

Org A lit les messages A.

Attendu : refusé.

## P37

Org A lit QuestionInsight count >=10.

Attendu : autorisé.

---

# 148. Tests Race Intelligence

## P38

Org A lit run agrégé Race A.

Attendu : autorisé via safe repository.

## P39

Org A lit private performance signal.

Attendu : refusé.

## P40

Payload B2B contient participantRaceId.

Attendu : test échoue.

## P41

Wave breakdown sur groupe 7.

Attendu : supprimé / masqué.

---

# 149. Tests Organization roles

## P42

Viewer modifie source.

Attendu : refusé.

## P43

Editor modifie information autorisée.

Attendu : autorisé.

## P44

Editor gère membres.

Attendu : refusé.

## P45

Admin importe participants.

Attendu : autorisé.

## P46

Admin s’auto-promote Owner sans permission.

Attendu : refusé.

---

# 150. Tests Entitlements

## P47

Runner A lit ses entitlements.

Attendu : autorisé.

## P48

Runner A crée PLUS direct.

Attendu : refusé.

## P49

Org crée Organizer Included via use case sur participant de sa Race.

Attendu : autorisé.

## P50

Org crée PLUS.

Attendu : refusé.

---

# 151. Tests Brief

## P51

Org A lit son Brief.

Attendu : autorisé.

## P52

Anon avec token valide lit Brief safe.

Attendu : autorisé via endpoint.

## P53

Token expiré.

Attendu : refusé.

## P54

Brief contient email participant.

Attendu : test échoue.

---

# 152. Tests Storage

## P55

Anon ouvre source snapshot privé.

Attendu : refusé.

## P56

Runner A génère signed URL pour son Race Pack.

Attendu : autorisé.

## P57

Runner B génère signed URL pour Race Pack A.

Attendu : refusé.

## P58

Org ouvre GPX Outing A.

Attendu : refusé.

---

# 153. Tests private schema

## P59

authenticated select private.source_chunks.

Attendu : permission denied.

## P60

authenticated select private.participant_performance_signals.

Attendu : permission denied.

## P61

authenticated select private.audit_logs.

Attendu : permission denied.

---

# 154. Tests token leakage

## P62

Logs endpoint Assistant.

Attendu : token redacté.

## P63

Analytics page Brief.

Attendu : URL sans token brut.

---

# 155. Tests membership revoked

## P64

User était Admin Org A, membership supprimé.

Attendu :

- accès B2B immédiat refusé ;
- audit historique conservé.

---

# 156. Tests cross-organization

## P65

Org A connaît UUID Race B.

Attendu :

aucune lecture non publique / modification.

## P66

Org A connaît import ID B.

Attendu :

refusé.

## P67

Org A connaît Brief ID B.

Attendu :

refusé.

---

# 157. Tests JSON privacy

## P68

Race Intelligence input_snapshot.

Attendu :

aucun participant id.

## P69

Organizer Brief content.

Attendu :

aucun email / plan id / nutrition detail.

## P70

Question Insight normalized text.

Attendu :

pas de nom/email détectable dans fixture.

---

# 158. Tests service use cases

## P71

service_role tente mutation avec user non autorisé via use case.

Attendu :

use case refuse malgré bypass RLS.

Ce test est crucial.

---

# 159. Test entropy tokens

## P72

Tokens générés.

Attendu :

- cryptographic RNG ;
- longueur conforme ;
- hash only persisted.

---

# 160. Test race notice Free

## P73

Free non premium lit kit froid officiel.

Attendu : autorisé.

Ce test vérifie la séparation :

```text
Privacy + official info
≠ entitlement premium
```

---

# 161. Policy matrix détaillée — Identité

| Table | Anon | Owner user | Organization | Admin/server |
|---|---|---|---|---|
| `users` | — | R / U limité | — | CRUD |
| `trail_profiles` | — | CRUD | — | CRUD |

`email` et `platform_role` doivent être protégés hors update direct client.

---

# 162. Policy matrix — Organisation / Course

| Table | Anon | Participant | Org member | Admin/server |
|---|---|---|---|---|
| `organizations` | R public limité | R | R scope | CRUD |
| `organization_members` | — | propre membership | R/W selon rôle | CRUD |
| `events` | R publié | R autorisé | CRUD scope | CRUD |
| `editions` | R publié | R autorisé | CRUD scope | CRUD |
| `races` | R selon visibilité | R autorisé | CRUD scope | CRUD |
| `race_start_waves` | R selon Race | R | CRUD scope | CRUD |
| `race_waypoints` | R selon Race | R | CRUD scope | CRUD |
| `race_segments` | R selon Race | R | CRUD scope | CRUD |
| `race_cutoffs` | R selon Race | R | CRUD scope | CRUD |
| `race_assistance_rules` | R selon Race | R | CRUD scope | CRUD |
| `race_equipment_requirements` | R selon Race | R | CRUD scope | CRUD |
| `race_notices` | R publié | R | CRUD scope | CRUD |

---

# 163. Policy matrix — Sources

| Table | Anon | Participant | Org | Admin/server |
|---|---|---|---|---|
| `sources` | R metadata publié via safe view | R autorisé | CRUD scope | CRUD |
| `source_snapshots` | — / signed access | R citation context | R scope | CRUD |
| `race_facts` | R publié | R | CRUD scope | CRUD |
| `race_fact_versions` | R publié | R | create via workflow | CRUD |
| `fact_sources` | R publié safe | R | R/W via workflow | CRUD |
| `private.source_chunks` | — | — | — | CRUD |
| `private.fact_candidates` | — | — | — | CRUD / internal review |
| `private.conflict_reports` | — | — | — | CRUD / internal + mediated org UI |

L’orga peut consulter candidats / conflits via endpoints contrôlés sans grant direct au schéma privé.

---

# 164. Policy matrix — Participant / préparation

| Table | Anon | Owner | Org | Admin/server |
|---|---|---|---|---|
| `participant_races` | — | R | R limité via safe API | CRUD |
| `participant_race_settings` | — | CRUD | — | CRUD |
| `race_plans` | — | R | — | CRUD |
| `plan_waypoints` | — | R | — | CRUD |
| `plan_segments` | — | R | — | CRUD |
| `plan_cutoff_statuses` | — | R | — | CRUD |
| `plan_version_dependencies` | — | R limité | — | CRUD |
| `tasks` | — | CRUD | — | CRUD |
| `participant_equipment` | — | CRUD | — | CRUD |
| `bags` | — | CRUD | — | CRUD |
| `bag_items` | — | CRUD | — | CRUD |

---

# 165. Policy matrix — Nutrition / Assistance / Outing

| Table | Anon | Owner | Org | Admin/server |
|---|---|---|---|---|
| `nutrition_products` | R validé | R | R | CRUD |
| `user_nutrition_products` | — | CRUD | — | CRUD |
| `nutrition_plans` | — | CRUD contrôlé | — | CRUD |
| `nutrition_conditions` | — | CRUD contrôlé | — | CRUD |
| `nutrition_waypoints` | — | CRUD contrôlé | — | CRUD |
| `nutrition_waypoint_items` | — | CRUD contrôlé | — | CRUD |
| `race_assistants` | — | CRUD | — | CRUD |
| `assistance_assignments` | token endpoint | CRUD | — | CRUD |
| `assistance_items` | token endpoint | CRUD | — | CRUD |
| `assistant_access_tokens` | endpoint only | manage own | — | CRUD |
| `emergency_contacts` | — | CRUD | — | CRUD |
| `outings` | — | CRUD | — | CRUD |
| `outing_*` | — | CRUD | — | CRUD |

---

# 166. Policy matrix — Weather / Q&A / reviews

| Table | Anon | Owner | Org | Admin/server |
|---|---|---|---|---|
| `weather_forecast_runs` | — | R | — | CRUD |
| `weather_forecast_points` | — | R | — | CRUD |
| `condition_periods` | — | R | — | CRUD |
| `condition_proposals` | — | CRUD actionnée | — | CRUD |
| `pluka_conversations` | — | CRUD | — | CRUD |
| `pluka_messages` | — | R / create via server | — | CRUD |
| `pluka_answer_sources` | — | R | — | CRUD |
| `post_race_reviews` | — | CRUD | — | CRUD |
| `post_race_review_publications` | communauté autorisée | CRUD owner publication | — | CRUD |

---

# 167. Policy matrix — B2B

| Table | Anon | Participant | Org | Admin/server |
|---|---|---|---|---|
| `participant_imports` | — | — | CRUD rôle | CRUD |
| `participant_import_rows` | — | — | CRUD rôle | CRUD |
| `enrichment_imports` | — | — | CRUD rôle | CRUD |
| `enrichment_import_rows` | — | — | CRUD rôle | CRUD |
| `participant_invitations` | token endpoint | propre activation | CRUD rôle | CRUD |
| `race_intelligence_runs` | — | — | R safe | CRUD |
| `race_intelligence_wave_summaries` | — | — | R safe | CRUD |
| `race_intelligence_waypoint_flows` | — | — | R safe | CRUD |
| `race_intelligence_cutoff_summaries` | — | — | R safe | CRUD |
| `race_intelligence_weather_exposures` | — | — | R safe | CRUD |
| `question_insight_snapshots` | — | — | R safe | CRUD |
| `organization_adoption_snapshots` | — | — | R safe | CRUD |
| `organizer_briefs` | token endpoint | — | R | CRUD |

---

# 168. SQL migration recommandée

Créer une migration dédiée :

```text
0002_privacy_rls.sql
```

ou numéro adapté à l’ordre réel.

Elle contient :

1. helper functions ;
2. grants / revokes ;
3. policies ;
4. Storage policies si gérées par migrations ;
5. éventuelles safe views / RPCs ;
6. commentaires ;
7. indexes nécessaires aux policies.

Ne pas mélanger une énorme refonte du modèle dans la même migration si elle peut être évitée.

---

# 169. Avant la migration RLS

Les autres specs ont identifié des évolutions Data Model nécessaires :

- Entitlements ;
- Nutrition diff ;
- Weather metadata ;
- Race Intelligence run members.

Idéalement :

```text
migration structure corrective
↓
migration privacy / RLS
```

afin que les policies finales couvrent le schéma définitif.

---

# 170. Grants

RLS ne suffit pas si des grants trop larges existent.

Après création des tables :

- vérifier privileges `anon` ;
- vérifier privileges `authenticated` ;
- révoquer les objets privés ;
- n’accorder que les opérations attendues.

Ne pas faire :

```sql
grant all on all tables in schema public to authenticated;
```

sans revue.

---

# 171. Data API exposed schemas

Configuration Supabase :

- exposer `public` si nécessaire ;
- ne jamais exposer `private`.

Si des vues safe sont créées, elles doivent être dans un schéma prévu et sécurisé.

---

# 172. Views et security invoker

Les vues doivent respecter la sécurité de l’appelant.

Privilégier :

```text
security_invoker
```

quand le support PostgreSQL / Supabase le permet et lorsque pertinent.

Une view ne doit pas contourner RLS accidentellement.

---

# 173. RPC security definer

Une RPC `security definer` est une frontière sensible.

Elle doit :

- vérifier `auth.uid()` ;
- vérifier le rôle ;
- valider le scope ;
- définir `search_path` ;
- ne pas accepter un ID arbitraire sans contrôle ;
- retourner un DTO minimal ;
- être testée négativement.

---

# 174. SQL injection

Aucune dynamic SQL construite avec entrée utilisateur non sûre dans les helpers RLS.

Les fonctions de sécurité doivent être simples.

---

# 175. Performance RLS

Les policies doivent utiliser des colonnes indexées.

FK / indexes critiques :

- `participant_races.user_id`
- `race_plans.participant_race_id`
- `organization_members(user_id, organization_id)`
- `events.organization_id`
- `races.edition_id`
- `outings.owner_user_id`
- `weather_forecast_runs.race_plan_id`
- `weather_forecast_runs.outing_id`

Ajouter les indexes manquants avant production.

---

# 176. Avoid recursive RLS

Les helpers doivent éviter des cycles où :

```text
policy A
→ table B avec RLS
→ policy B
→ table A
```

Les `security definer` helpers ciblés peuvent simplifier ce problème.

---

# 177. Current user profile bootstrap

Le trigger `private.handle_new_auth_user()` crée le profil applicatif.

Il doit :

- copier uniquement les champs nécessaires ;
- ne jamais prendre `platform_role` depuis metadata utilisateur non fiable ;
- appliquer `user` par défaut.

---

# 178. Admin claim

Ne pas utiliser un JWT client librement modifiable pour décider :

```text
pluka_admin
```

Le claim peut être utilisé pour performance si synchronisé serveur, mais la source de vérité doit rester contrôlée.

---

# 179. Column protection

Tables nécessitant protections de colonnes particulières :

- `users.platform_role`
- `users.email`
- `entitlements.*`
- `race_fact_versions.trust_level`
- `race_fact_versions.workflow_status`
- `assistant_access_tokens.token_hash`
- `organizer_briefs.share_token_hash`

Utiliser :

- server-only writes ;
- triggers ;
- column grants si utile.

---

# 180. API organizer participant list

Créer un use case :

```text
listOrganizationParticipants(raceId)
```

Il retourne seulement les champs nécessaires.

Ne pas exposer le modèle relationnel brut.

---

# 181. API organizer analysis

Créer :

```text
getOrganizerRaceAnalysis(raceId)
```

Payload :

```text
coverage
wave summaries safe
key observations
flow summaries
cutoffs
weather exposure
```

Aucun objet privé.

---

# 182. API Assistant

Créer :

```text
getAssistantView(token)
```

Le token n’est pas un user.

Le service retourne un snapshot safe.

---

# 183. API Brief

Créer :

```text
getOrganizerBriefByToken(token)
```

Même logique.

---

# 184. API invitation

Créer :

```text
getParticipantInvitationPreview(token)
claimParticipantInvitation(token)
```

Preview minimale avant auth.

---

# 185. Security testing in CI

Pipeline :

```text
supabase db reset
→ migrations
→ seed test personas
→ pgTAP RLS tests
→ API integration privacy tests
→ Playwright critical flows
```

Aucune PR touchant :

- policies ;
- helpers ;
- sensitive DTOs ;

ne doit merger sans tests sécurité.

---

# 186. pgTAP

Tests SQL recommandés :

```text
has_rls
policy_exists
select succeeds / fails
insert succeeds / fails
update succeeds / fails
private schema permission denied
```

Utiliser `set local role authenticated` et claims de test adaptés.

---

# 187. RLS Advisor

Avant production :

- Supabase security advisor ;
- index advisor ;
- inspection des policies ;
- revue des grants.

Tout warning RLS doit être expliqué / résolu.

---

# 188. Pen-test manuel minimal

Tester :

- changer UUID dans URL ;
- changer participantRaceId ;
- changer organizationId ;
- appeler endpoint d’une autre organisation ;
- utiliser token expiré ;
- réutiliser invitation ;
- appeler une Server Action premium avec entitlement absent ;
- requêter table privée ;
- devtools client contre Supabase directement.

---

# 189. Security acceptance gate

Avant première bêta externe :

1. migration RLS appliquée ;
2. tests P01–P73 passent ;
3. aucune table privée exposée ;
4. aucune clé service client ;
5. token links hashés ;
6. signed URLs privées ;
7. B2B safe API validée ;
8. org ne peut pas lire Plan ;
9. org ne peut pas lire Nutrition ;
10. org ne peut pas lire Assistance ;
11. cross-org testé ;
12. entitlement + RLS testés séparément ;
13. logs scrubbed ;
14. staging séparé ;
15. backup / restore documenté.

---

# 190. Critères d’acceptation pour Claude Code

L’implémentation Privacy/RLS V1 est considérée correcte lorsque :

1. RLS est activée sur toutes les tables applicatives pertinentes ;
2. le défaut est deny ;
3. `private` est inaccessible à anon/authenticated ;
4. le service role n’existe jamais côté client ;
5. le user lit uniquement son profil ;
6. le trail profile est privé ;
7. les courses publiques sont lisibles selon visibilité ;
8. les courses privées/unlisted ne sont pas listables arbitrairement ;
9. l’organisation ne gère que ses événements/races ;
10. les rôles owner/admin/editor/viewer sont respectés ;
11. le retrait d’un membership retire les accès ;
12. les facts drafts ne sont pas publics ;
13. les versions de Facts publiées sont immuables ;
14. seul un workflow autorisé peut produire `official`;
15. les snapshots bruts restent privés par défaut ;
16. un participant lit seulement ses ParticipantRaces ;
17. l’organisation possède seulement une vue opérationnelle limitée des participants ;
18. l’organisation ne peut pas lire un RacePlan individuel ;
19. l’organisation ne peut pas lire PlanWaypoint/Segment ;
20. l’organisation ne peut pas lire Nutrition ;
21. l’organisation ne peut pas lire les bags personnels ;
22. l’organisation ne peut pas lire Assistance ;
23. l’organisation ne peut pas lire Outings ;
24. l’organisation ne peut pas lire WeatherRuns personnels ;
25. l’organisation ne peut pas lire Q&A individuel ;
26. l’organisation ne peut pas lire post-race privé ;
27. un assistant accède uniquement via endpoint tokenisé safe ;
28. un Brief partagé accède uniquement via endpoint tokenisé safe ;
29. les tokens bruts ne sont jamais persistés ;
30. les tokens expirés/révoqués sont refusés ;
31. les routes tokenisées sont noindex et ne leakent pas le referrer ;
32. le contact d’urgence n’est jamais visible à l’orga par défaut ;
33. les imports participants sont scoped organisation ;
34. les enrichissements sont scoped organisation ;
35. les performance signals restent privés ;
36. Race Intelligence n’expose que des agrégats ;
37. le seuil minimum de 10 est appliqué aux sous-groupes ;
38. les JSON breakdowns respectent aussi le seuil ;
39. l’API B2B n’accepte aucun filtre individuel ;
40. le public `input_snapshot` Race Intelligence ne contient aucune PII ;
41. les Question Insights ne contiennent aucun message individuel ;
42. l’adoption est agrégée ;
43. les raw analytics restent privées ;
44. l’entitlement d’un participant n’élargit pas la Privacy de l’organisation ;
45. Organizer Included ne donne aucun accès au Plan à l’organisation ;
46. les entitlements ne sont pas créables directement par le client ;
47. les official notices restent accessibles au Free ;
48. les Storage buckets privés utilisent signed URLs ;
49. le GPX personnel d’Outing reste privé ;
50. les exports participants restent organisation-confidentiels ;
51. les Race Packs personnels restent privés ;
52. les logs ne contiennent pas les tokens ;
53. les analytics tiers ne reçoivent pas les URLs tokenisées ;
54. les erreurs sont scrubbed ;
55. les migrations sont reproductibles localement ;
56. les policies utilisent des indexes adaptés ;
57. les helpers `security definer` fixent le `search_path`;
58. les Server Actions revérifient l’autorisation métier ;
59. un bypass RLS service ne bypass pas les use cases ;
60. les tests P01–P73 passent.

---

# 191. Décisions à valider juridiquement avant production

Ce document définit l’architecture de confidentialité mais ne remplace pas un cadrage juridique.

À valider séparément :

- base légale des traitements ;
- politique de confidentialité ;
- CGU ;
- contrats organisateurs ;
- rôle responsable de traitement / sous-traitant selon flux ;
- durée de conservation ;
- droit d’effacement ;
- export ;
- utilisation des indices ITRA / UTMB ;
- utilisation de résultats historiques pour calibration ;
- analytics ;
- conservation d’agrégats après suppression ;
- stockage / redistribution des données providers météo ;
- hébergement et transferts éventuels.

Claude Code ne doit pas inventer ces durées ou bases légales.

---

# 192. Consigne finale

La règle la plus importante de PLUKA est simple :

> **Une organisation peut financer l’expérience d’un participant sans devenir propriétaire de sa préparation.**

PLUKA peut aider l’organisation à comprendre son événement grâce à des agrégats.

Il ne lui donne jamais accès au cockpit privé du coureur.

Les règles absolues sont :

> **Plan privé.**

> **Nutrition privée.**

> **Assistance privée.**

> **Sorties privées.**

> **Conversations privées.**

> **Race Intelligence agrégée avant exposition.**

> **Minimum 10 pour les sous-groupes B2B.**

> **Deny-by-default dans PostgreSQL.**

> **Une autorisation commerciale ne contourne jamais une interdiction Privacy.**

---

**Fin — PLUKA Privacy & RLS V1**
