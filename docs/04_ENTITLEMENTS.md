# PLUKA — Entitlements V1

**Fichier de référence :** `docs/04_ENTITLEMENTS.md`  
**Statut :** Référence fonctionnelle et technique — V1  
**Date de consolidation :** 2026-09-03  
**Principe :** les droits sont calculés côté serveur, centralisés, explicables et indépendants de l’UI

---

# 0. Rôle de ce document

Ce document définit les **droits d’accès fonctionnels** de PLUKA V1.

Il répond à la question :

> **Pour ce user, sur ce scope, à cet instant, cette action est-elle autorisée ?**

Il formalise :

- les offres B2C ;
- l’accès inclus par une organisation ;
- l’accès bêta / testeur ;
- les droits par feature ;
- les quotas ;
- les scopes ;
- les règles de cumul ;
- les règles de priorité ;
- les règles de sécurité ;
- la persistance attendue ;
- les critères d’acceptation pour Claude Code.

Les entitlements ne sont pas des règles UI.

Ils constituent une **règle métier serveur**.

---

## 0.1 Documents de référence

Cette spec complète :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/03_PRIVACY_RLS.md`
- `docs/05_ROUTES_FLOWS.md`
- `docs/engines/PLAN_ENGINE.md`
- `docs/engines/NUTRITION_ENGINE.md`
- `docs/engines/WEATHER_CONDITIONS.md`
- `docs/engines/RACE_INTELLIGENCE.md`
- `docs/ACCEPTANCE_CRITERIA.md`

Le prototype figé sert de référence UX/UI, jamais de source de vérité pour autoriser une feature.

### Ordre de priorité

En cas de contradiction :

1. `00_PRODUCT_SPEC.md` fait foi sur les offres et le produit ;
2. ce document fait foi sur les règles d’accès ;
3. `03_PRIVACY_RLS.md` fait foi sur les données accessibles ;
4. `01_ARCHITECTURE.md` fait foi sur l’implémentation technique ;
5. `02_DATA_MODEL.md` et les migrations font foi sur la structure persistée ;
6. le prototype fait foi uniquement sur l’intention d’interface.

---

# 1. Offres commerciales V1

PLUKA V1 possède quatre états commerciaux principaux côté participant :

```text
FREE
RACE_PASS
PLUS
ORGANIZER_INCLUDED
```

Un accès bêta / testeur peut venir s’y superposer temporairement.

---

# 2. Positionnement commercial

## Free

> **Comprendre la course et commencer à préparer.**

## Race Pass

> **Préparer cette course jusqu’au bout.**

## PLUKA+

> **Préparer toute ma saison.**

## Organizer Included

> **Accès premium à cette course, inclus par l’organisation.**

---

# 3. Prix de référence

Ces prix sont ceux prévus après la phase de test :

```text
Free
0 €

Race Pass
14,90 € / course

PLUKA+
44,90 € / an
```

PLUKA+ est un abonnement annuel payé en une fois.

Pas d’abonnement mensuel V1.

Le mécanisme éventuel de crédit :

```text
Race Pass → PLUKA+
```

n’est pas figé dans cette spec.

Il ne doit pas être implémenté comme règle contractuelle sans validation commerciale explicite.

---

# 4. Bêta

Pendant la phase de test, certaines fonctionnalités peuvent être ouvertes gratuitement.

Cet accès doit être modélisé explicitement.

Ne jamais modifier les règles de Free pour simuler la bêta.

Prévoir un entitlement séparé :

```text
BETA_FULL_ACCESS
```

ou un grant équivalent.

Ainsi :

```text
prix futur
≠
droit bêta temporaire
```

---

# 5. Principes non négociables

1. Les droits sont calculés côté serveur.
2. L’UI ne fait jamais autorité.
3. Le provider de paiement n’est pas la source directe de vérité applicative.
4. Les droits peuvent être limités à une Race.
5. Les droits peuvent être limités à une Outing liée.
6. Un entitlement peut expirer.
7. Un entitlement révoqué ne reste pas actif via cache UI.
8. Les accès inclus par l’organisation ne donnent pas automatiquement accès à toute la saison.
9. Les sorties Race Pass sont limitées.
10. PLUKA+ autorise les sorties personnelles illimitées selon le scope produit.
11. Les alertes officielles restent accessibles même sans entitlement premium.
12. Les droits commerciaux ne doivent jamais modifier les règles de confidentialité.
13. Le serveur revérifie l’entitlement à chaque mutation premium.
14. Les règles de quota doivent être déterministes.
15. Les entitlements sont auditables.

---

# 6. Matrice fonctionnelle principale

| Fonction | Free | Race Pass | PLUKA+ | Organizer Included |
|---|---:|---:|---:|---:|
| Informations de course | ✓ | ✓ | ✓ | ✓ |
| Sources / provenance | ✓ | ✓ | ✓ | ✓ |
| Alertes officielles | ✓ | ✓ | ✓ | ✓ |
| Matériel obligatoire | ✓ | ✓ | ✓ | ✓ |
| Plan initial consultable | ✓ | ✓ | ✓ | ✓ |
| Modifier objectif | — | ✓ | ✓ | ✓ |
| Modifier segments | — | ✓ | ✓ | ✓ |
| Modifier arrêts | — | ✓ | ✓ | ✓ |
| Locks / contraintes | — | ✓ | ✓ | ✓ |
| Recalcul avancé du Plan | — | ✓ | ✓ | ✓ |
| Nutrition complète | — | ✓ | ✓ | ✓ |
| Préparation / sacs / TODO avancés | — | ✓ | ✓ | ✓ |
| Assistance complète | — | ✓ | ✓ | ✓ |
| Conditions personnalisées J-14 | — | ✓ | ✓ | ✓ |
| Après-course complet | — | ✓ | ✓ | ✓ |
| Sorties liées à la course | — | 2 max | illimitées | 2 max |
| Conditions sur sorties liées | — | ✓ | ✓ | ✓ |
| Sorties personnelles libres | — | — | ✓ | — |
| Conditions sur sorties personnelles | — | — | ✓ | — |
| Stratégies réutilisables | — | — | ✓ | — |
| Bibliothèque personnelle complète | — | — | ✓ | — |
| Mémoire de saison / historique | limité | limité | ✓ | limité |
| Ma saison multi-course | consultation de base | consultation | ✓ | consultation |
| Demander à PLUKA — infos course | ✓ selon contenu public/autorisé | ✓ | ✓ | ✓ |
| Demander à PLUKA — contexte premium | limité | ✓ | ✓ | ✓ |

Cette matrice est la référence fonctionnelle V1.

---

# 7. Scope d’un entitlement

Un entitlement doit toujours indiquer son scope.

Scopes conceptuels :

```text
global
race
participant_race
outing
organization_event
```

Tous les entitlements ne sont pas globaux.

---

# 8. Free

Free est implicite.

Il ne nécessite pas une row d’entitlement active.

Tout user authentifié ou participant autorisé possède les capacités Free applicables à son scope.

Free ne doit jamais être représenté comme un achat.

---

# 9. Race Pass

Race Pass appartient à :

```text
user
+
participant_race
```

Il ne donne pas accès aux autres races.

Exemple :

```text
Race Pass Wild 70
```

autorise le premium pour :

```text
Wild 70
```

mais pas :

```text
Marathon du Mont-Blanc
```

---

# 10. Race Pass et éditions

Un Race Pass est lié à une participation / édition précise.

Il ne doit pas automatiquement s’appliquer :

- à l’édition suivante ;
- à une autre distance ;
- à une autre Race du même Event.

---

# 11. PLUKA+

PLUKA+ est un entitlement global utilisateur.

Il donne accès aux fonctionnalités PLUS sur tous les scopes compatibles pendant sa période de validité.

Concept :

```text
user_id
scope = global
type = plus
```

---

# 12. Organizer Included

Organizer Included est accordé dans le cadre d’une Race ou d’une participation financée / couverte par une organisation.

Scope :

```text
participant_race
```

ou équivalent.

Il fournit une expérience fonctionnellement proche de Race Pass sur cette course.

Il ne donne pas :

- sorties personnelles illimitées ;
- premium sur les autres courses ;
- toute la mémoire PLUKA+.

---

# 13. Organizer Included et onboarding

Un participant invité sur une course incluse ne voit pas de pricing dans le tunnel.

Flow :

```text
invitation
→ informations préremplies
→ objectif
→ Plan
```

Le grant doit être créé / résolu avant les mutations premium.

---

# 14. Bêta Full Access

`BETA_FULL_ACCESS` est un override temporaire.

Il peut être :

```text
global
```

ou :

```text
race scoped
```

selon la politique de test.

Il doit avoir :

- `starts_at` ;
- `ends_at` ;
- provenance ;
- reason ;
- status.

À expiration, les droits reviennent au niveau commercial normal.

---

# 15. Feature flags vs entitlements

Différence fondamentale :

## Feature flag

> Cette fonctionnalité existe-t-elle dans cette release ?

Exemple :

```text
race_intelligence = false
```

## Entitlement

> Cet utilisateur a-t-il le droit d’utiliser cette fonctionnalité ?

Exemple :

```text
nutrition = Race Pass
```

Une feature doit passer les deux contrôles :

```text
feature flag enabled
AND
entitlement allowed
```

---

# 16. EntitlementService

Créer un service central :

```ts
interface EntitlementService {
  resolveContext(input: EntitlementContextInput): Promise<EntitlementContext>

  can(
    context: EntitlementContext,
    capability: Capability
  ): EntitlementDecision
}
```

Il peut également proposer des helpers typés.

---

# 17. Capabilities

Définir une enum centrale.

Exemple :

```ts
type Capability =
  | 'course.read'
  | 'course.sources.read'
  | 'course.official_notices.read'
  | 'plan.read_initial'
  | 'plan.edit'
  | 'plan.recalculate'
  | 'nutrition.use'
  | 'preparation.advanced'
  | 'assistance.use'
  | 'conditions.race'
  | 'outing.create_linked'
  | 'outing.create_personal'
  | 'conditions.outing'
  | 'library.use'
  | 'strategy.reuse'
  | 'season.memory'
  | 'postrace.advanced'
```

Les noms finaux peuvent évoluer, mais doivent rester centralisés.

---

# 18. EntitlementDecision

```ts
type EntitlementDecision = {
  allowed: boolean

  reason:
    | 'free_included'
    | 'race_pass'
    | 'plus'
    | 'organizer_included'
    | 'beta_access'
    | 'quota_available'
    | 'quota_exceeded'
    | 'not_entitled'
    | 'expired'
    | 'revoked'
    | 'wrong_scope'
    | 'feature_disabled'

  sourceEntitlementId?: string | null

  limits?: {
    max?: number
    used?: number
    remaining?: number
  }
}
```

Le frontend peut utiliser `reason` pour le wording.

Le serveur l’utilise pour l’autorisation.

---

# 19. Priorité des droits

Pour une capability donnée :

```text
BETA_FULL_ACCESS
→ PLUS
→ ORGANIZER_INCLUDED
→ RACE_PASS
→ FREE
```

Cette priorité est utile pour choisir l’expérience / source du droit.

Elle ne signifie pas qu’un entitlement “écrase” les autres en base.

---

# 20. Union des droits

Si plusieurs entitlements sont actifs :

> le user reçoit l’union des droits autorisés.

Exemple :

```text
PLUKA+
+
Organizer Included
```

ne réduit jamais les droits PLUKA+.

---

# 21. Le droit le plus large gagne

Exemple :

User possède :

```text
Race Pass Wild 70
+
PLUKA+
```

Sur Wild 70 :

```text
PLUS
```

est le contexte effectif le plus large.

Le Race Pass reste dans l’historique.

---

# 22. Expiration

Un entitlement peut être :

```text
starts_at <= now
AND
(ends_at is null OR now < ends_at)
```

et :

```text
status = active
```

Le contrôle utilise l’heure serveur.

---

# 23. Status

Statuts recommandés :

```text
active
expired
revoked
pending
```

Éventuellement :

```text
cancelled
```

si le modèle billing le nécessite.

Un entitlement `pending` ne donne pas accès.

---

# 24. Révocation

Une révocation peut venir de :

- remboursement ;
- erreur d’attribution ;
- retrait organisation ;
- fraude ;
- correction support.

Elle doit être auditée.

Le client ne doit pas continuer à autoriser une action via un cache ancien.

---

# 25. Paiement

Pipeline :

```text
checkout
↓
provider payment
↓
webhook vérifié
↓
purchase / payment record
↓
entitlement PLUKA
```

Le provider ne doit pas être interrogé à chaque action.

PLUKA stocke le droit applicatif.

---

# 26. Webhook idempotent

Le même event provider reçu deux fois ne doit pas créer :

- deux Race Pass ;
- deux PLUKA+ ;
- deux grants.

Utiliser :

```text
provider_event_id
```

ou une clé d’idempotence équivalente.

---

# 27. Race Pass — quota sorties

Race Pass autorise :

> **jusqu’à 2 sorties de préparation liées à la course.**

Le quota porte sur des `Outing` créées avec :

```text
linked_participant_race_id = participantRace
```

---

# 28. Organizer Included — quota sorties

Organizer Included suit la même logique :

```text
2 sorties liées maximum
```

sauf changement explicite futur de l’offre.

---

# 29. PLUKA+ — sorties

PLUKA+ autorise :

- sorties liées ;
- sorties personnelles non liées ;
- quantité illimitée fonctionnellement en V1.

“Illimité” signifie :

> pas de quota commercial V1.

Cela n’empêche pas des limites techniques raisonnables contre l’abus.

---

# 30. Free — sorties

Free ne permet pas de créer un usage illimité de Sorties comme substitut à PLUKA+.

Une éventuelle preview marketing ne doit pas devenir un droit fonctionnel implicite.

---

# 31. Calcul du quota de sorties liées

Le quota ne repose pas sur un compteur mutable de type :

```text
linked_outings_used = 1
```

sans source.

Il doit être calculable depuis les objets persistés :

```text
count(
  outings
  where owner_user_id = user
  and linked_participant_race_id = X
  and commercial_quota_consuming = true
  and deleted_at is null
)
```

Le champ exact dépend du Data Model.

---

# 32. Suppression d’une sortie et quota

Règle V1 :

si une sortie liée est supprimée avant ou après utilisation, elle ne doit pas être utilisée pour contourner indéfiniment le quota.

Le comportement doit être explicite.

Décision recommandée V1 :

> **le quota compte les créations confirmées de sorties liées, même si elles sont ensuite supprimées.**

Pourquoi :

- évite le cycle créer → utiliser météo → supprimer → recréer ;
- rend le quota commercial stable.

Cela nécessite un ledger ou usage record séparé.

---

# 33. Usage ledger

Créer conceptuellement :

```text
entitlement_usage
```

ou table équivalente.

Exemple :

```ts
type EntitlementUsage = {
  id: string
  userId: string
  entitlementId: string | null
  capability: string
  scopeType: string
  scopeId: string
  usageKey: string
  occurredAt: string
}
```

Pour les quotas de création, l’usage est consommé à la première confirmation.

---

# 34. Usage idempotent

`usageKey` doit empêcher de consommer deux fois le quota pour la même Outing.

Exemple :

```text
linked-outing:{outingId}
```

---

# 35. Race Pass et Conditions

Race Pass autorise Conditions uniquement si :

1. la capability `conditions.race` est autorisée ;
2. la Race correspond au Race Pass ;
3. J-14 est atteint ;
4. les données météo sont disponibles.

Entitlement :

> droit d’accès

J-14 :

> règle produit

Provider :

> disponibilité technique

Ces trois notions restent séparées.

---

# 36. Conditions sur sorties liées

Race Pass autorise :

```text
conditions.outing
```

uniquement sur ses deux sorties liées.

Une sortie hors lien Race Pass n’est pas autorisée.

---

# 37. PLUKA+ et Conditions sorties

PLUKA+ autorise Conditions sur toutes les Outings éligibles du user.

Toujours avec :

- date ;
- heure ;
- trace / timeline ;
- J-14.

---

# 38. Organizer Included et Conditions sorties

Même règle que Race Pass pour les sorties liées incluses.

Ne pas donner accès aux sorties indépendantes.

---

# 39. Alertes officielles

Les alertes officielles sont accessibles indépendamment du premium.

Capability :

```text
course.official_notices.read
```

est Free.

Donc un Free peut voir :

- kit froid ;
- changement de parcours ;
- annulation ;
- consigne sécurité.

Même si Conditions personnalisées est paywalled.

---

# 40. Free et route Conditions

Un Free peut ouvrir un écran Conditions si l’UX le prévoit.

Le serveur peut retourner :

```text
officialNotices = [...]
personalForecastAccess = false
```

L’UI affiche :

1. notices officielles ;
2. paywall.

Ne pas bloquer toute la route par entitlement.

---

# 41. Plan initial consultable

Free possède :

```text
plan.read_initial
```

Il doit pouvoir lire le premier Plan généré.

Free ne possède pas :

```text
plan.edit
```

---

# 42. Plan éditable

Race Pass / PLUKA+ / Organizer Included possèdent :

```text
plan.edit
plan.recalculate
```

Cela inclut selon la Product Spec :

- objectif ;
- durées ;
- stops ;
- locks ;
- recalcul ;
- dérive ;
- rebalance.

---

# 43. Ne pas dupliquer le moteur

Le Plan Engine ne possède pas :

```text
if (tier === free)
```

Le domaine autorise ou refuse la commande.

Le moteur reçoit une commande déjà autorisée.

Même principe pour Nutrition et Conditions.

---

# 44. Nutrition

Capability :

```text
nutrition.use
```

autorisée pour :

- Race Pass sur sa Race ;
- PLUKA+ ;
- Organizer Included sur sa Race ;
- Beta Full Access.

Free :

```text
false
```

pour la stratégie Nutrition complète.

---

# 45. Préparation avancée

Capability :

```text
preparation.advanced
```

comprend notamment :

- matériel personnel ;
- bags ;
- TODO avancés ;
- intégration Nutrition ;
- suggestions Conditions.

Le matériel obligatoire de la Race reste consultable en Free.

---

# 46. Assistance

Capability :

```text
assistance.use
```

autorisée premium sur le scope.

Free ne doit pas créer un lien privé Assistance complet.

---

# 47. Après-course

L’accès de base à un statut de fin peut rester général selon la Product Spec.

Le module complet :

- comparaison Plan ;
- Nutrition ;
- Assistance ;
- matériel ;
- note privée ;

est premium.

Capability :

```text
postrace.advanced
```

---

# 48. Bibliothèque

PLUKA+ donne accès à la Bibliothèque personnelle complète :

- produits ;
- stratégies ;
- matériel réutilisable ;
- modèles.

Race Pass peut utiliser les produits nécessaires à la course courante sans nécessairement bénéficier de toute l’expérience Bibliothèque annuelle.

Le détail UX est défini par Product Spec.

---

# 49. Stratégies réutilisables

Capability :

```text
strategy.reuse
```

réservée à PLUKA+ en V1.

Une stratégie créée pendant un Race Pass peut être conservée historiquement, mais sa réutilisation sur d’autres scopes nécessite PLUKA+.

---

# 50. Mémoire de saison

Capability :

```text
season.memory
```

réservée principalement à PLUKA+.

Les autres tiers peuvent conserver les données nécessaires au fonctionnement / historique de la course sans bénéficier de toutes les vues multi-course et réutilisations.

---

# 51. Fin d’un Race Pass

Un Race Pass n’est pas nécessairement “expiré à l’arrivée” au niveau donnée.

Il doit permettre :

- après-course ;
- consultation historique de la course ;
- exports liés.

La période de validité commerciale exacte peut être ouverte autour de la course.

Décision V1 recommandée :

> Race Pass reste rattaché durablement à cette participation, même après la course.

Cela signifie :

- pas besoin de réacheter pour relire sa préparation ;
- pas d’accès aux autres races.

---

# 52. Fin d’un Organizer Included

Même principe recommandé :

l’accès premium de la course reste disponible pour l’historique de cette participation, sauf politique contractuelle différente explicite.

Ne pas révoquer automatiquement au moment du finish.

---

# 53. Expiration PLUKA+

Lorsque PLUKA+ expire :

Le user :

- conserve ses données ;
- peut les consulter selon les droits historiques / Free applicables ;
- ne peut plus créer ou modifier les features PLUS non couvertes par un autre entitlement ;
- ne perd jamais silencieusement ses données.

---

# 54. Read-only après expiration

Principe recommandé :

> **expiration retire les nouvelles actions premium, pas la propriété des données déjà créées.**

Exemple :

une ancienne Outing PLUKA+ peut rester consultable.

Mais :

- créer une nouvelle Outing ;
- recalculer Conditions premium ;
- réutiliser une stratégie ;

peut nécessiter un entitlement actif.

Les détails par capability doivent être explicites.

---

# 55. Read vs write capabilities

Lorsque nécessaire, séparer :

```text
nutrition.read
nutrition.edit
```

plutôt qu’un simple :

```text
nutrition.use
```

La matrice V1 peut commencer plus compacte, mais les opérations après expiration nécessiteront probablement cette distinction.

Recommandation pour le code :

définir les capabilities suffisamment fines dès le départ.

---

# 56. Capability set recommandé

```ts
type Capability =
  // Course
  | 'course.read'
  | 'course.sources.read'
  | 'course.official_notices.read'
  | 'course.mandatory_equipment.read'

  // Plan
  | 'plan.read'
  | 'plan.generate_initial'
  | 'plan.edit'
  | 'plan.recalculate'

  // Nutrition
  | 'nutrition.read'
  | 'nutrition.edit'

  // Preparation
  | 'preparation.read'
  | 'preparation.edit_advanced'

  // Assistance
  | 'assistance.read'
  | 'assistance.edit'
  | 'assistance.share'

  // Conditions
  | 'conditions.race.read'
  | 'conditions.outing.read'

  // Outings
  | 'outing.read'
  | 'outing.create_linked'
  | 'outing.create_personal'
  | 'outing.edit'

  // Season / library
  | 'season.read'
  | 'season.memory'
  | 'library.read'
  | 'library.edit'
  | 'strategy.reuse'

  // After race
  | 'postrace.read'
  | 'postrace.edit_advanced'
```

---

# 57. Capability matrix détaillée

## Free

```text
course.read                  ✓
course.sources.read          ✓
course.official_notices.read ✓
course.mandatory_equipment   ✓
plan.read                    ✓
plan.generate_initial        ✓

plan.edit                    ✗
plan.recalculate             ✗
nutrition.edit               ✗
preparation.edit_advanced    ✗
assistance.edit/share        ✗
conditions.*                 ✗
outing.create_*              ✗
library.edit                 ✗
strategy.reuse               ✗
season.memory                ✗
```

## Décisions de complétion

La matrice ci-dessus et celles de §58 à §61 laissent trois points ouverts. Ils sont tranchés
ici, et le resolver les applique.

### Les capabilities `.read` appartiennent au socle Free

`nutrition.read`, `preparation.read`, `assistance.read`, `outing.read`, `season.read`,
`library.read` et `postrace.read` sont Free, au même titre que `plan.read`.

Raison : §54 pose que « l'expiration retire les nouvelles actions premium, pas la propriété
des données déjà créées », et l'illustre par « une ancienne Outing PLUKA+ peut rester
consultable ». §53 le dit dans l'autre sens — un PLUKA+ expiré « conserve ses données, peut
les consulter, ne perd jamais silencieusement ses données ». Sans ces lectures au socle, une
expiration reprendrait la vue de ce que le coureur a lui-même écrit.

Ce qui reste premium est donc l'écriture et l'avancé : `*.edit`, `*.edit_advanced`,
`assistance.share`, `conditions.*`, `outing.create_*`, `strategy.reuse`, `season.memory`.

### `outing.edit` suit `outing.create_linked`

Race Pass et Organizer Included possèdent `outing.edit` sur la participation couverte, en
plus de PLUKA+ (§59).

Raison : §58 et §60 accordent `outing.create_linked` sans se prononcer sur l'édition. Une
sortie qu'on peut créer mais pas modifier n'est pas une capacité cohérente. L'édition suit
donc la création, et reste bornée au même scope — elle ne donne aucun droit sur une sortie
personnelle, que §12 exclut explicitement.

### L'accès bêta n'a pas de quota de sorties liées

Un `BETA_FULL_ACCESS`, global ou limité à une course, crée des sorties liées sans limite
commerciale. Il ne consomme pas le ledger.

Raison : §29 pose le quota comme une règle **commerciale** — « illimité signifie : pas de
quota commercial V1 » — et §14 fait de la bêta « un override temporaire », délibérément séparé
des trois produits. Le modèle le confirme : `entitlement_usage.entitlement_id` est `not null`
et référence `entitlements`, table où un grant bêta n'a par construction aucune ligne
(`02_DATA_MODEL.md` §10.2). Compter un usage bêta supposerait de lui inventer un droit
commercial.

Cela ne dispense pas des limites techniques raisonnables contre l'abus, que §29 réserve déjà.

---

# 58. Race Pass

Sur la `participant_race` couverte :

```text
course.*                     ✓
plan.*                       ✓
nutrition.*                  ✓
preparation.*                ✓
assistance.*                 ✓
conditions.race.read         ✓
postrace.*                   ✓
outing.create_linked         ✓ quota 2
conditions.outing.read       ✓ uniquement sorties liées couvertes
```

Hors scope :

```text
outing.create_personal       ✗
library.edit annuel          ✗
strategy.reuse global        ✗
season.memory complet        ✗
```

---

# 59. PLUKA+

```text
course.*                     ✓
plan.*                       ✓
nutrition.*                  ✓
preparation.*                ✓
assistance.*                 ✓
conditions.race.read         ✓
conditions.outing.read       ✓
outing.create_linked         ✓
outing.create_personal       ✓
outing.edit                  ✓
library.*                    ✓
strategy.reuse               ✓
season.memory                ✓
postrace.*                   ✓
```

---

# 60. Organizer Included

Sur la participation couverte :

```text
course.*                     ✓
plan.*                       ✓
nutrition.*                  ✓
preparation.*                ✓
assistance.*                 ✓
conditions.race.read         ✓
postrace.*                   ✓
outing.create_linked         ✓ quota 2
conditions.outing.read       ✓ sorties liées couvertes
```

Hors scope :

```text
outing.create_personal       ✗
strategy.reuse global        ✗
season.memory complet        ✗
```

---

# 61. Beta Full Access

Si global :

équivalent fonctionnel temporaire à PLUKA+.

Si scoped à une Race :

équivalent temporaire à Race Pass / Organizer Included selon config.

La source doit rester :

```text
beta
```

pour pouvoir analyser les droits après la phase de test.

---

# 62. Organizer B2B entitlements

Les droits du BO organisateur ne doivent pas utiliser les tiers B2C.

Ils dépendent de :

```text
organization_members.role
+
contrat / feature flags organisation
```

Ne pas créer :

```text
Organizer Plus
```

à partir de la matrice B2C.

---

# 63. Roles organisation

Minimum :

```text
owner
admin
editor
viewer
```

Le rôle détermine les actions B2B.

Exemples :

### Viewer

- lire Brief ;
- lire Analyse ;
- lire Participants agrégés.

### Editor

- gérer certaines informations ;
- sources ;
- réponses officielles selon droits.

### Admin

- imports ;
- invitations ;
- publication ;
- membres selon politique.

### Owner

- droits les plus larges de l’organisation.

Les détails appartiennent à `03_PRIVACY_RLS.md`.

---

# 64. Organizer Included != organization role

Ne pas confondre :

```text
ORGANIZER_INCLUDED
```

= entitlement participant B2C financé par organisation

avec :

```text
organization member
```

= autorisation B2B.

Ce sont deux domaines distincts.

---

# 65. Acquisition Organizer Included

Flow possible :

```text
organization
→ participant import
→ sponsor access rule
→ participant invitation
→ entitlement grant
```

L’entitlement doit être lié à :

- organisation source ;
- Race ;
- participant ;
- date de création.

---

# 66. Révocation Organizer Included

Une organisation peut éventuellement retirer une invitation avant activation selon contrat.

Après activation / utilisation, le comportement contractuel doit être prudent.

Ne pas permettre à une organisation de supprimer les données personnelles du participant en révoquant un entitlement.

Révocation accès ≠ suppression donnée.

---

# 67. Source d’un entitlement

Enum recommandé :

```text
purchase
subscription
organization
beta
support
migration
promotion
```

Cela permet d’auditer l’origine.

---

# 68. Entitlement record

Contrat conceptuel :

```ts
type Entitlement = {
  id: string

  userId: string

  type:
    | 'race_pass'
    | 'plus'
    | 'organizer_included'
    | 'beta_full_access'

  source:
    | 'purchase'
    | 'subscription'
    | 'organization'
    | 'beta'
    | 'support'
    | 'migration'
    | 'promotion'

  scopeType:
    | 'global'
    | 'participant_race'

  participantRaceId?: string | null
  organizationId?: string | null

  startsAt: string
  endsAt: string | null

  status:
    | 'pending'
    | 'active'
    | 'expired'
    | 'revoked'

  externalReference?: string | null

  createdAt: string
  updatedAt: string
}
```

---

# 69. Contraintes DB

Pour un entitlement :

```text
type = plus
→ scope = global
```

```text
type = race_pass
→ participant_race obligatoire
```

```text
type = organizer_included
→ participant_race obligatoire
→ organization_id recommandé / obligatoire
```

```text
beta
→ scope explicite
```

Ces invariants doivent être dans le schéma ou vérifiés fortement côté domaine.

---

# 70. Duplicates

Éviter plusieurs entitlements actifs identiques créés accidentellement.

Exemples de contraintes logiques :

```text
1 Race Pass actif par user + participant_race + source commercial
```

```text
1 Organizer Included actif par participant_race + organization
```

PLUKA+ peut avoir plusieurs périodes historiques, mais pas deux périodes actives incohérentes issues du même abonnement.

---

# 71. Purchase record

Une transaction commerciale doit être conservée séparément du droit.

Exemple :

```text
purchase
→ entitlement
```

Un entitlement de support / beta n’a pas forcément de purchase.

---

# 72. Product catalog

Le code doit éviter :

```text
if price === 14.90
```

pour déterminer un produit.

Utiliser des IDs stables :

```text
race_pass
plus_annual
```

Les prix restent dans un catalogue / config commerciale.

---

# 73. Checkout

Le checkout reçoit :

```text
productKey
participantRaceId si Race Pass
```

Le serveur vérifie :

- ownership ;
- produit valide ;
- scope ;
- absence de droit plus large déjà actif ;
- idempotence.

---

# 74. User déjà PLUKA+

Si un user PLUKA+ tente d’acheter Race Pass :

l’UI doit expliquer que la course est déjà incluse.

Le serveur peut refuser un achat inutile.

Ne pas créer un entitlement redondant sans raison.

---

# 75. User déjà Organizer Included

Si la Race est incluse par l’organisation :

l’UI ne doit pas pousser Race Pass sur cette même Race.

Le contexte affiche :

> **Inclus par l’organisation**

---

# 76. Upgrade Race Pass → PLUKA+

Le concept commercial est possible mais non figé.

Ne pas coder :

```text
credit = 14.90 €
```

dans le domaine tant qu’aucune règle officielle n’est validée.

Le système doit toutefois permettre plus tard :

- coupon ;
- credit ;
- promotion ;
- upgrade.

---

# 77. Erreurs métier

Codes principaux :

```text
ENTITLEMENT_REQUIRED
ENTITLEMENT_EXPIRED
ENTITLEMENT_REVOKED
ENTITLEMENT_WRONG_SCOPE
FEATURE_DISABLED
QUOTA_EXCEEDED
OUTING_NOT_LINKED
ORGANIZER_INCLUDED_SCOPE_MISMATCH
PURCHASE_NOT_CONFIRMED
DUPLICATE_PURCHASE
```

---

# 78. Paywall

Le paywall est une conséquence UI d’un :

```text
EntitlementDecision.allowed = false
```

Le paywall ne calcule pas les droits.

Il reçoit :

- reason ;
- upgrade target ;
- contexte.

---

# 79. Paywalls contextuels

Préférer :

```text
Modifier mon Plan
→ Race Pass
```

```text
Activer Nutrition
→ Race Pass
```

```text
Créer une sortie libre
→ PLUKA+
```

plutôt qu’un énorme mur premium générique.

---

# 80. Pas de blur trompeur

Free doit rester réellement utile.

Le paywall ne doit pas cacher volontairement :

- informations officielles ;
- sources ;
- matériel obligatoire ;
- Plan initial.

Le premium porte sur la transformation avancée en préparation personnelle.

---

# 81. Texte commercial canonique

Principe :

> **PLUKA ne fait pas payer l’accès à l’information de course. PLUKA fait payer sa transformation en préparation personnelle avancée.**

Cette phrase guide les décisions de paywall.

---

# 82. Sources toujours accessibles

Une source liée à une information Free doit rester accessible au Free.

Un Race Pass ne doit jamais être requis uniquement pour :

> voir d’où vient une information de course.

---

# 83. Alertes officielles toujours accessibles

Même règle pour :

- kit froid ;
- modification parcours ;
- safety notice.

Un paywall ne peut pas empêcher une information de sécurité officielle.

---

# 84. Demander à PLUKA

Le droit doit être contextuel.

### Free

Peut poser des questions sur les informations de course accessibles.

### Premium

Peut exploiter les données personnelles premium autorisées :

- Plan détaillé ;
- Conditions ;
- Assistance propre ;
- etc.

Le moteur Q&A applique lui aussi les droits du scope.

---

# 85. Exemple Q&A Free

Question :

> Les bâtons sont-ils autorisés ?

Si le RaceFact est accessible :

réponse autorisée.

---

# 86. Exemple Q&A Conditions

Question :

> Quel temps aurai-je au Rawil ?

Free :

- peut voir une notice officielle ;
- pas de forecast personnel.

Race Pass / PLUKA+ / Organizer Included :

- forecast personnel J-14 si disponible.

---

# 87. Race Pass et 2 sorties liées

Création :

```text
canCreateLinkedOuting(participantRace)
```

Decision :

```text
Race Pass actif
AND
usageCount < 2
```

Après consommation :

```text
usageCount = 2
→ QUOTA_EXCEEDED
```

---

# 88. PLUKA+ et linked outings

PLUKA+ ne consomme pas le quota Race Pass pour limiter ses propres sorties.

Si un Race Pass historique existe également :

le contexte PLUS gagne.

---

# 89. Organizer Included et PLUKA+

Même règle.

Si le user est PLUKA+ :

- droits PLUS ;
- pas de quota 2 sur ses sorties.

Le grant Organizer Included reste enregistré.

---

# 90. Concurrence de grants

Le resolver doit produire une vue effective.

Exemple :

```ts
type EntitlementContext = {
  userId: string

  globalAccess: {
    plus: boolean
    betaFull: boolean
  }

  participantRaceAccess: {
    racePass: boolean
    organizerIncluded: boolean
    betaFull: boolean
  }

  effectiveTier:
    | 'free'
    | 'race_pass'
    | 'plus'
    | 'organizer_included'
    | 'beta'

  sourceEntitlements: string[]
}
```

Le type exact peut évoluer.

---

# 91. Cache

Les entitlement reads peuvent être cachés brièvement.

Mais :

- révocation ;
- webhook achat ;
- activation PLUS ;

doivent invalider le cache.

Une mutation sensible doit revérifier les droits depuis une source suffisamment fraîche.

---

# 92. Client cache

Le client peut garder un contexte pour afficher les CTA.

Il ne peut jamais considérer ce cache comme autorisation serveur.

---

# 93. RLS

Les entitlements ne doivent pas nécessairement être directement modifiables par l’utilisateur.

Écriture :

- service serveur ;
- webhook ;
- admin ;
- organisation pour grants autorisés via use case contrôlé.

Lecture :

- le user peut éventuellement lire ses propres entitlements ;
- jamais ceux des autres.

Les détails appartiennent à `03_PRIVACY_RLS.md`.

---

# 94. service_role

Le `service_role` peut écrire les grants via backend.

Il ne doit pas être exposé au navigateur.

Le fait d’utiliser `service_role` ne dispense pas des règles métier.

---

# 95. Admin PLUKA

Un admin peut :

- créer un entitlement support ;
- révoquer ;
- corriger un scope ;
- prolonger.

Chaque action doit être auditée.

---

# 96. Support entitlement

Pour corriger un problème client :

source :

```text
support
```

et `reason` interne obligatoire.

Éviter les modifications manuelles directes SQL sans audit.

---

# 97. Promotions

Une promotion commerciale peut :

- réduire le prix ;
- offrir un Race Pass ;
- offrir PLUKA+ temporairement.

Elle crée toujours le même type d’entitlement final.

Le moteur de droits ne dépend pas du prix payé.

---

# 98. Code promotionnel

Si ajouté :

```text
promo
→ checkout / grant
→ entitlement
```

Pas :

```text
promoCode checked in every feature
```

---

# 99. Data Model — concepts attendus

Le schéma doit permettre au minimum :

```text
entitlements
purchases / billing references
entitlement_usage
organization participant grants
```

Les noms exacts doivent rester alignés avec `02_DATA_MODEL.md`.

---

# 100. Écarts Data Model à vérifier

Avant implémentation commerciale, vérifier que le schéma actuel couvre explicitement :

- `source` de l’entitlement ;
- scope global / participant_race ;
- organization source ;
- starts_at / ends_at ;
- revoked_at / reason ;
- external reference ;
- usage ledger idempotent ;
- quota lié aux sorties ;
- historique d’achat ;
- beta access.

Si certains éléments manquent :

mettre à jour `02_DATA_MODEL.md` et créer une migration.

Ne pas gérer ces règles dans un JSON de session.

---

# 101. Recommandation `entitlement_usage`

Si absent du SQL actuel, ajouter :

```sql
create table public.entitlement_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  entitlement_id uuid references public.entitlements(id),
  capability text not null,
  scope_type text not null,
  scope_id uuid,
  usage_key text not null,
  occurred_at timestamptz not null default now(),
  unique (user_id, capability, usage_key)
);
```

Le SQL réel devra :

- utiliser les enums / conventions du projet ;
- ajouter RLS ;
- indexer correctement ;
- respecter les FK de scope.

---

# 102. Événements métier

Événements utiles :

```text
entitlement.granted
entitlement.activated
entitlement.expired
entitlement.revoked
entitlement.usage_consumed
purchase.completed
purchase.refunded
```

---

# 103. Downstream après grant

Après :

```text
Race Pass activé
```

pas besoin de modifier des données personnelles existantes.

Les features deviennent autorisées.

---

# 104. Downstream après expiration

Après expiration PLUS :

- invalider cache ;
- mettre à jour UI ;
- ne pas supprimer les données ;
- préserver les grants scoped existants.

---

# 105. Refund

Le remboursement ne signifie pas toujours suppression immédiate de tout droit sans politique commerciale.

V1 doit avoir une règle explicite dans le use case Billing.

Recommandation simple :

```text
refund confirmé
→ entitlement concerné revoked
```

sauf override support.

L’historique reste conservé.

---

# 106. Chargeback

Même principe, avec statut / audit.

Ne pas laisser le client décider.

---

# 107. Tests fondamentaux

## E01 — Free

User sans entitlement.

Attendu :

```text
course.read = true
plan.read = true
plan.edit = false
nutrition.edit = false
```

---

## E02 — Race Pass bonne Race

Attendu :

premium course = true.

---

## E03 — Race Pass autre Race

Attendu :

```text
ENTITLEMENT_WRONG_SCOPE
```

---

## E04 — PLUS

Attendu :

premium toutes races / sorties personnelles.

---

## E05 — Organizer Included

Attendu :

premium uniquement course couverte.

---

# 108. Tests cumul

## E06 — Race Pass + PLUS

Attendu :

effective PLUS.

---

## E07 — Organizer Included + PLUS

Attendu :

effective PLUS.

---

## E08 — Beta + Free

Attendu :

droits beta selon scope.

---

# 109. Tests expiration

## E09 — PLUS expiré

Attendu :

nouvelles actions PLUS refusées.

Données existantes non supprimées.

---

## E10 — Race Pass historique

Après course.

Attendu :

consultation historique toujours autorisée selon règle V1.

---

# 110. Tests quotas sorties

## E11 — Race Pass, 0 sortie

Attendu :

remaining = 2.

---

## E12 — Race Pass, 1 sortie consommée

Attendu :

remaining = 1.

---

## E13 — Race Pass, 2 sorties

Attendu :

```text
QUOTA_EXCEEDED
```

---

## E14 — Sortie supprimée

Usage ledger conserve la consommation.

Attendu :

quota non rendu automatiquement.

---

## E15 — PLUKA+

Attendu :

aucun quota commercial 2.

---

# 111. Tests Conditions

## E16 — Race Pass J-15

Entitlement valide mais J-14 non atteint.

Attendu :

entitlement oui, feature fonctionnelle non disponible.

Le code doit distinguer les deux raisons.

---

## E17 — Race Pass J-7

Attendu :

Conditions autorisées si données disponibles.

---

## E18 — Free avec official notice

Attendu :

notice visible.

Forecast personnalisé refusé.

---

# 112. Tests Organizer Included

## E19 — Invitation Orga

Attendu :

aucun pricing onboarding.

---

## E20 — autre Race

Attendu :

Organizer Included non applicable.

---

## E21 — linked outings

2 max sans PLUS.

---

# 113. Tests billing

## E22 — webhook dupliqué

Attendu :

un seul entitlement.

---

## E23 — paiement pending

Attendu :

aucun accès premium définitif.

---

## E24 — webhook confirmé

Attendu :

entitlement actif.

---

## E25 — refund

Attendu :

révocation selon politique.

---

# 114. Tests feature flags

## E26 — entitlement valide mais feature disabled

Attendu :

```text
FEATURE_DISABLED
```

---

## E27 — Race Intelligence

Un entitlement B2C n’active pas Race Intelligence B2B.

---

# 115. Tests sécurité

## E28 — modifier payload client

Le client envoie :

```text
tier = plus
```

Attendu :

ignoré.

Le serveur résout les droits réels.

---

## E29 — autre user

Impossible d’utiliser l’entitlement d’un autre user.

---

## E30 — service_role non client

Aucun secret accessible navigateur.

---

# 116. Tests read-only post-expiration

## E31 — ancienne Nutrition

PLUS expiré.

Attendu :

lecture historique selon politique, édition refusée si aucun autre entitlement.

---

## E32 — ancienne Outing

Attendu :

lecture conservée, nouvelle création refusée.

---

# 117. Tests Q&A

## E33 — Free question Course

Attendu :

facts Free utilisables.

---

## E34 — Free question Weather personnalisée

Attendu :

pas de forecast personnel.

---

## E35 — Race Pass question Weather de sa Race

Attendu :

autorisé J-14.

---

# 118. Tests déterminisme

## E36 — même user / même scope / même instant logique

Attendu :

même décision.

---

## E37 — entitlement expiré à la frontière

Tester précisément :

```text
now == ends_at
```

Recommandation :

```text
ends_at exclusive
```

donc entitlement inactif.

---

# 119. Tests audit

## E38 — support grant

Attendu :

source / reason conservés.

---

## E39 — revoke

Attendu :

revoked_at / audit.

---

# 120. Performance

Le resolver est appelé fréquemment.

Il doit être :

- simple ;
- indexé ;
- cachable ;
- sans dépendance réseau externe.

Il ne doit pas appeler le provider paiement à chaque requête.

---

# 121. Indexes recommandés

Sur entitlements :

```text
(user_id, status)
(user_id, participant_race_id, status)
(type, status)
(ends_at)
```

Sur usage :

```text
(user_id, capability, usage_key)
(entitlement_id, capability)
```

---

# 122. Clock

Le serveur utilise une horloge injectée / abstraction testable.

Éviter de disperser :

```text
new Date()
```

dans toute la logique.

Le resolver peut recevoir :

```text
now
```

dans ses fonctions pures pour le déterminisme des tests.

---

# 123. Package recommandé

```text
packages/domain/src/entitlements/
├── capabilities.ts
├── types.ts
├── resolver.ts
├── policy.ts
├── quotas.ts
├── usage.ts
├── errors.ts
└── tests/
```

Un package séparé est possible, mais pas nécessaire V1.

---

# 124. API pure de policy

```ts
evaluateCapability(
  context: EntitlementContext,
  capability: Capability,
  scope: CapabilityScope,
  now: Date
): EntitlementDecision
```

Cette partie doit être pure.

Les repositories assemblent le contexte.

---

# 125. Use cases

Use cases typiques :

```text
grantRacePass
grantPlus
grantOrganizerIncluded
grantBetaAccess
revokeEntitlement
consumeEntitlementUsage
resolveEntitlements
```

---

# 126. UI

L’UI doit pouvoir connaître :

- effectiveTier ;
- capabilities ;
- quota remaining ;
- reason.

Elle ne doit pas recevoir plus de détails billing que nécessaire.

---

# 127. Wording UI

Utiliser :

```text
Inclus dans Race Pass
Inclus avec PLUKA+
Inclus par l’organisation
Disponible avec PLUKA+
```

Éviter :

```text
permission denied
```

dans l’expérience utilisateur.

---

# 128. Paywall Race Pass

Message :

> **Prépare cette course jusqu’au bout.**

Pas :

> débloque des features premium.

---

# 129. Paywall PLUKA+

Message :

> **Prépare toutes tes courses et tes sorties toute l’année.**

---

# 130. Organizer Included

Afficher discrètement :

> **Inclus par l’organisation**

Pas de prix.

---

# 131. Bêta

Afficher si nécessaire :

> **Accès testeur — fonctionnalités ouvertes pendant la bêta**

Ne pas laisser croire que le pricing commercial est annulé.

---

# 132. Analytics commerciales

Mesures possibles :

- Race Pass achetés ;
- PLUS actifs ;
- Organizer Included activés ;
- usage linked outings ;
- conversion contextual paywall.

Ne pas envoyer de détails sensibles de préparation.

---

# 133. Non-régression obligatoire

Une évolution ne peut pas être mergée si elle :

- autorise une feature premium uniquement parce que le bouton est visible ;
- donne un Race Pass à une autre Race ;
- transforme Organizer Included en PLUS ;
- masque une alerte officielle derrière un paywall ;
- autorise Conditions avant J-14 via entitlement seul ;
- laisse le client définir son tier ;
- appelle le provider de paiement comme authorization engine ;
- perd l’historique d’un entitlement ;
- rend le quota Race Pass contournable par suppression d’Outing ;
- supprime les données lors d’une expiration ;
- mélange role organisation et entitlement participant ;
- utilise un prix comme identifiant produit ;
- implémente un crédit Race Pass→PLUS non validé.

---

# 134. Critères d’acceptation pour Claude Code

L’implémentation Entitlements V1 est considérée correcte lorsque :

1. Free est implicite ;
2. Race Pass est scoped à une participation ;
3. PLUS est global ;
4. Organizer Included est scoped à une participation ;
5. Beta est explicitement modélisé ;
6. la matrice fonctionnelle est centralisée ;
7. les capabilities sont centralisées ;
8. chaque mutation premium revérifie le serveur ;
9. le client ne peut pas déclarer son tier ;
10. le provider paiement n’est pas interrogé à chaque action ;
11. les webhooks sont idempotents ;
12. les grants sont auditables ;
13. les entitlements expirés sont refusés ;
14. `ends_at` est traité de manière déterministe ;
15. plusieurs grants produisent l’union des droits ;
16. PLUS prend fonctionnellement le dessus sur Race Pass ;
17. Organizer Included ne donne pas accès aux autres courses ;
18. les alertes officielles restent Free ;
19. le Plan initial reste Free ;
20. l’édition du Plan est premium ;
21. Nutrition complète est premium ;
22. Assistance complète est premium ;
23. Conditions personnelles sont premium et toujours soumises à J-14 ;
24. Race Pass autorise 2 sorties liées ;
25. Organizer Included autorise 2 sorties liées ;
26. PLUKA+ autorise les sorties personnelles ;
27. le quota Race Pass est traçable via un usage ledger ;
28. supprimer une Outing ne restitue pas automatiquement le quota ;
29. les données existantes ne sont pas supprimées à expiration ;
30. les accès historiques peuvent être lus selon les policies prévues ;
31. Race Pass / Organizer Included ne sont pas confondus avec les rôles B2B ;
32. les features flags sont distincts des entitlements ;
33. un user PLUS ne peut pas acheter inutilement un Race Pass sans traitement explicite ;
34. les prix ne pilotent pas la logique métier ;
35. les promotions produisent des entitlements normaux ;
36. les tests E01–E39 passent.

---

# 135. Mise à jour du Data Model à prévoir

Après validation de cette spec, vérifier et compléter `02_DATA_MODEL.md` + SQL avec :

```text
entitlements.source
entitlements.scope_type
entitlements.organization_id
entitlements.starts_at
entitlements.ends_at
entitlements.revoked_at / revoke_reason
entitlements.external_reference
```

ainsi qu’une table / structure :

```text
entitlement_usage
```

si elle n’existe pas déjà.

La migration doit également formaliser les contraintes de scope.

Ne pas modifier une migration déjà appliquée ; créer une nouvelle migration.

---

# 136. Consigne finale

Le moteur d’entitlements doit rester extrêmement simple dans son principe :

> **Le produit décide ce qui est inclus. Le serveur calcule le droit. L’interface ne fait qu’expliquer le résultat.**

Les règles absolues sont :

> **Free conserve l’information de course essentielle.**

> **Race Pass s’applique à une seule course.**

> **PLUKA+ s’applique à toute la saison.**

> **Organizer Included n’est jamais un PLUKA+ caché.**

> **Une alerte officielle n’est jamais paywallée.**

> **Un entitlement n’autorise jamais l’accès à une donnée que la Privacy/RLS interdit.**

---

**Fin — PLUKA Entitlements V1**
