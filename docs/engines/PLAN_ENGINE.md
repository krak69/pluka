# PLUKA — Plan Engine V1

**Fichier de référence :** `docs/engines/PLAN_ENGINE.md`  
**Statut :** Spécification fonctionnelle et algorithmique de référence — V1  
**Date de consolidation :** 2026-09-03  
**Version moteur de départ :** `plan-v1.0.0`  
**Principe :** déterministe, explicable, éditable, versionné — aucun LLM dans le pacing

---

## 0. Rôle de ce document

Ce document définit le **moteur Plan V1 de PLUKA** : son périmètre, ses entrées, ses sorties, ses invariants, son modèle de coût relatif, son solveur de contraintes, ses comportements de recalcul, ses erreurs, ses événements downstream et ses tests d’acceptation.

Le Plan est la feature signature de PLUKA.

Le moteur transforme :

> **un parcours structuré + un objectif choisi par le coureur + des contraintes temporelles**

en :

> **une chronologie personnelle cohérente, explicable et éditable sur le parcours réel.**

Le moteur ne cherche pas à prédire la performance réelle du coureur. Il organise un objectif choisi par l’utilisateur. Cette règle est fonctionnelle et non négociable.

---

## 0.1 Documents de référence

Cette spec complète :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/04_ENTITLEMENTS.md`
- `docs/engines/NUTRITION_ENGINE.md`
- `docs/engines/WEATHER_CONDITIONS.md`
- `docs/ACCEPTANCE_CRITERIA.md`

Le prototype figé sert de référence UX/UI, **jamais de référence algorithmique**.

### Ordre de priorité

En cas de contradiction :

1. `00_PRODUCT_SPEC.md` fait foi sur le besoin produit ;
2. ce document fait foi sur le calcul Plan ;
3. `01_ARCHITECTURE.md` fait foi sur les frontières techniques ;
4. `02_DATA_MODEL.md` et les migrations font foi sur la structure persistée ;
5. le prototype fait foi sur l’intention d’interface.

Toute contradiction doit être signalée avant modification du moteur.

---

## 0.2 Origine et consolidation

Cette version Markdown consolide la précédente **Spécification du moteur Plan V1** et l’aligne avec le Product Design Freeze actuel.

Les changements de cadrage récents ne modifient pas le principe du moteur :

- Conditions météo fait désormais partie du produit V1 premium, mais **ne devient pas une entrée de pacing** ;
- Conditions consomme les ETA du Plan et se recale si le Plan change ;
- le Profil trailer et le Repère PLUKA restent séparés du calcul temporel V1 ;
- le B2B Race Intelligence peut utiliser des agrégats issus des Plans côté serveur, mais ne modifie pas les Plans individuels ;
- les entitlements contrôlent l’accès aux éditions premium **en dehors** du moteur.

Quelques clarifications d’implémentation nécessaires à un moteur déterministe ont été rendues explicites ici, notamment l’arrondi entier, le calcul de hash canonique et la résolution du départ effectif.

---

# 1. Décision structurante

> **Le coureur choisit son objectif. PLUKA organise cet objectif. PLUKA ne dit pas au coureur ce qu’il est capable de faire.**

Le moteur V1 :

- ne prédit pas un chrono cible ;
- ne calcule pas une « performance probable » ;
- ne se substitue pas au jugement du coureur ;
- ne prétend pas reproduire une physiologie individuelle ;
- ne change jamais automatiquement l’objectif à cause de la météo.

La première proposition est un **scénario temporel relatif** construit à partir du parcours et normalisé sur l’objectif utilisateur.

Deux coureurs visant des temps différents sur le même parcours peuvent donc recevoir une structure relative de difficulté proche, avec une échelle temporelle différente.

---

# 2. Objectifs V1

Le moteur doit :

1. transformer un objectif total `HH:MM` en temps de passage par section et waypoint ;
2. tenir réellement compte du relief, et non répartir le temps proportionnellement à la distance ;
3. utiliser la distance, la pente, le D+/D-, la technicité connue et la progression dans la course ;
4. intégrer les arrêts planifiés ;
5. calculer les heures d’arrivée et de départ aux waypoints ;
6. calculer les marges aux barrières horaires ;
7. accepter des durées de segments manuellement imposées ;
8. accepter des arrêts manuellement modifiés ;
9. accepter plusieurs heures de passage verrouillées ;
10. résoudre les contraintes sans écraser les personnalisations explicites ;
11. permettre soit de conserver la dérive de l’arrivée, soit de rééquilibrer vers l’objectif ;
12. produire des résultats downstream explicites pour Nutrition, Assistance et Conditions ;
13. être pur, déterministe, testable et versionné ;
14. être reproductible à entrées et `engine_version` identiques.

---

# 3. Hors périmètre du moteur Plan V1

Le moteur Plan V1 ne fait pas :

- de prédiction physiologique à partir de VO2max ;
- de calibration par fréquence cardiaque ;
- de VMA ;
- de charge d’entraînement ;
- de puissance ;
- de synchronisation Garmin / Strava pour calibrer automatiquement le pacing ;
- de machine learning pour choisir un objectif ;
- de calcul du Repère PLUKA ;
- d’adaptation automatique du pacing à la météo ;
- de tracking GPS temps réel ;
- de recalage live selon la position réelle ;
- de prédiction individuelle de DNF ;
- de conseil médical ;
- de garantie sur l’heure réelle de passage le jour J.

Les Conditions météo sont bien une fonctionnalité PLUKA V1, mais l’architecture est :

```text
Plan
→ ETA
→ Conditions
→ éventuelles propositions de préparation
```

et jamais :

```text
Météo
→ modification automatique du Plan
```

---

# 4. Concepts et invariants

| Concept | Définition | Invariant |
|---|---|---|
| Objectif | Durée totale visée par le coureur entre départ et arrivée | Inclut les arrêts planifiés |
| Plan initial | Première proposition calculée pour l’objectif | Finish = objectif si calcul possible |
| Plan actuel | Chronologie après personnalisations | Peut dériver de l’objectif en mode préservation |
| RaceWaypoint | Point commun de la course | Jamais modifié par le Plan personnel |
| PlanWaypoint | Projection temporelle personnelle d’un RaceWaypoint | Porte ETA, stop et verrou éventuel |
| RaceSegment | Portion de course entre deux waypoints de référence | Donnée partagée |
| PlanSegment | Projection temporelle personnelle d’un RaceSegment | Durée calculée ou imposée |
| Micro-segment | Unité interne de coût issue du GPX normalisé | Non exposée comme objet produit |
| Ancre | Heure d’arrivée verrouillée à un waypoint | Découpe le solveur en intervalles |
| Arrêt | Temps passé au waypoint après l’arrivée | Décale le départ du segment suivant |
| Barrière | Contrainte temporelle officielle | Produit une marge / un warning, ne bloque pas le solveur |
| Override | Durée manuelle d’un segment | Reste fixe tant que l’utilisateur ne la retire pas |
| Rééquilibrage | Redistribution du delta sur les portions flexibles | Respecte les contraintes dures |
| Dérive | Conservation d’une modification sans forcer l’arrivée à l’objectif | Le finish peut avancer / reculer |

---

# 5. Référentiel temporel

## 5.1 Temps interne

Tous les calculs du moteur utilisent :

> **des secondes écoulées depuis le départ effectif.**

Exemples :

```text
0
3600
18600
45230
```

Les heures calendaires sont une représentation dérivée.

Cela permet de supporter proprement :

- une course passant minuit ;
- une course > 24 h ;
- un ultra sur plusieurs jours ;
- les changements de date ;
- les fuseaux horaires.

## 5.2 Départ effectif

Le service applicatif résout le départ effectif avant l’appel moteur.

Ordre de priorité :

```text
participant_race.personal_start_datetime
→ heure de vague applicable
→ race.start_datetime
```

Le moteur reçoit ensuite un `startAt` non ambigu.

## 5.3 Conversion vers une date réelle

Pour un waypoint :

```text
planned_arrival_at = startAt + planned_elapsed_seconds
planned_departure_at = planned_arrival_at + stop_duration_seconds
```

Les intégrations météo et Assistance utilisent les vraies dates/heures dérivées.

---

# 6. Contrat d’entrée

Le moteur reçoit un **snapshot cohérent**.

Il ne lit directement :

- ni PostgreSQL ;
- ni un PDF ;
- ni un écran React ;
- ni une URL ;
- ni une source brute ;
- ni un provider météo.

Le service de domaine assemble et valide les données avant l’appel.

## 6.1 Entrées minimales

| Famille | Champs principaux | Rôle |
|---|---|---|
| Race | `raceId`, `timezone`, `startAt` | Référentiel |
| Parcours | micro-segments prétraités | Coût relatif |
| Waypoints | id, ordre, position, distance | Chronologie |
| Segments | id, from, to, micro-segments | Agrégation |
| Cutoffs | waypoint, datetime/elapsed, basis | Marges |
| Objectif | `targetDurationSeconds` | Budget total |
| Stops | waypoint + durée | Temps fixe |
| Overrides | segment + durée | Contrainte manuelle |
| Anchors | waypoint + elapsed verrouillé | Contrainte horaire |
| Configuration moteur | facteurs versionnés | Reproductibilité |
| Mode | préservation ou rééquilibrage | Comportement après édition |

## 6.2 Ce qui n’est pas une entrée du calcul V1

Le cœur Plan ne doit pas utiliser directement :

- Trail Profile ;
- UTMB Index ;
- ITRA PI ;
- Repère PLUKA ;
- Nutrition ;
- météo ;
- matériel ;
- Assistance ;
- questions PLUKA ;
- Race Intelligence ;
- entitlement commercial.

Ces domaines peuvent utiliser le résultat Plan ou conditionner l’accès aux actions, mais ne modifient pas la formule V1.

---

# 7. Préconditions bloquantes

Avant calcul :

1. le parcours prétraité existe ;
2. la géométrie est exploitable ;
3. départ et arrivée sont raccordés au parcours ;
4. les waypoints sont ordonnés de façon monotone ;
5. les RaceSegments forment une chaîne cohérente ;
6. l’objectif est strictement positif ;
7. les stops sont `>= 0` ;
8. les overrides de segment sont `> 0` ;
9. les ancres suivent l’ordre du parcours ;
10. les ancres ont des temps strictement cohérents ;
11. tous les waypoints / segments / cutoffs appartiennent à la même Race ;
12. la version moteur est fournie côté serveur.

Une violation structurante produit une `ERROR`, pas une approximation silencieuse.

---

# 8. Prétraitement GPX

Le prétraitement GPX est effectué **lors de l’import / validation du parcours**, pas à chaque recalcul du Plan.

Le moteur Plan consomme une représentation normalisée et stable.

## 8.1 Pipeline de référence V1

1. valider la géométrie ;
2. supprimer les doublons évidents et points aberrants manifestes ;
3. calculer la distance cumulée par géodésie ;
4. lisser l’altitude sur une fenêtre horizontale cible de **50 m** ;
5. ré-échantillonner environ tous les **25 m** ;
6. construire des micro-segments d’environ **100 m** ;
7. forcer une coupure aux waypoints de référence ;
8. calculer pour chaque micro-segment :
   - distance ;
   - delta altitude ;
   - pente moyenne ;
   - D+ ;
   - D- ;
   - progression relative ;
9. raccorder les RaceWaypoints au GPX ;
10. calculer les contrôles qualité ;
11. persister / cacher le résultat prétraité avec sa version de processeur.

Les valeurs 50 m / 25 m / 100 m sont des constantes de preprocessing V1 et doivent rester configurables/versionnées.

---

# 9. Contrôles qualité GPX V1

| Contrôle | Seuil V1 | Comportement |
|---|---:|---|
| Waypoint ↔ GPX | > 200 m | Erreur / validation requise avant Plan |
| Distance GPX vs officielle | > 10 % | Warning qualité |
| D+ GPX vs officiel | > 15 % | Warning qualité |
| Altitude manquante | > 5 % des points | Parcours non éligible au modèle relief V1 |
| Pente brute extrême | `|grade| > 60 %` | Conserver le signal mais caper le modèle à ±40 % |

## 9.1 Ne pas corriger silencieusement

Si le GPX et une valeur officielle divergent :

- le moteur ne falsifie pas le GPX ;
- il ne modifie pas artificiellement le D+ ;
- il ne répartit pas l’écart sur les altitudes ;
- il produit un état de qualité à résoudre.

La provenance et la qualité du référentiel Course sont traitées en amont du calcul personnel.

---

# 10. Modèle de coût relatif

Le moteur attribue un poids temporel relatif à chaque micro-segment.

Formule V1 :

```text
weight_i =
  distance_i
  × grade_factor(grade_i)
  × technicality_factor_i
  × fatigue_factor(progress_i)
```

avec :

- `distance_i` dans une unité cohérente sur tout le parcours ;
- `grade_i` en ratio, ex. `0.10` pour +10 % ;
- `progress_i ∈ [0,1]` ;
- tous les facteurs strictement positifs.

Le poids n’est pas une durée.

La durée n’apparaît qu’au moment de la normalisation sur le budget utilisateur.

---

# 11. Facteur de pente

La V1 utilise une courbe de calibration versionnée, interpolée linéairement entre les points d’ancrage.

| Pente | Facteur temps relatif |
|---:|---:|
| -40 % | 1.40 |
| -30 % | 1.20 |
| -20 % | 0.95 |
| -15 % | 0.86 |
| -10 % | 0.82 |
| -5 % | 0.90 |
| 0 % | 1.00 |
| +5 % | 1.25 |
| +10 % | 1.60 |
| +15 % | 2.10 |
| +20 % | 2.80 |
| +30 % | 4.10 |
| +40 % | 5.50 |

## 11.1 Interpolation

Entre deux points :

```text
factor(g) =
  f1 + (f2 - f1) × (g - g1) / (g2 - g1)
```

## 11.2 Cap

Pour le modèle :

```text
grade_used = clamp(raw_grade, -0.40, +0.40)
```

La pente brute peut rester conservée dans les données de diagnostic.

## 11.3 Interprétation

La courbe exprime seulement une **difficulté temporelle relative** :

- une descente modérée peut être plus rapide qu’un plat ;
- une descente très raide redevient coûteuse ;
- une montée raide concentre davantage de temps.

Ces facteurs ne constituent pas une vérité physiologique universelle.

Toute modification de la courbe implique une nouvelle `engine_version`.

---

# 12. Technicité

Classes V1 :

| Niveau | Facteur | Usage |
|---|---:|---|
| `smooth` | 1.00 | route, piste roulante, chemin très facile |
| `standard` | 1.05 | trail standard |
| `technical` | 1.12 | terrain cassant, pierres, racines, ralentissements durables |
| `very_technical` | 1.22 | section durablement très technique |

## 12.1 Donnée absente

Si la technicité n’est pas connue :

```text
technicality_factor = 1.00
```

Le moteur **n’invente pas** une technicité.

## 12.2 Origine

La technicité est une donnée de RaceSegment / référentiel, configurée et versionnée hors moteur personnel.

---

# 13. Fatigue de progression

Formule V1 :

```text
fatigue_factor(p) = 1 + alpha × p²
```

avec :

```text
alpha = 0.10
p ∈ [0,1]
```

La progression est évaluée le long du parcours.

Effet :

- proche du départ : facteur proche de `1.00` ;
- proche de l’arrivée : jusqu’à `1.10`.

Comme l’ensemble est ensuite normalisé sur le budget disponible, ce facteur :

- **ne rallonge pas l’objectif** ;
- déplace légèrement davantage de temps vers la seconde partie.

`alpha` est une constante de calibration versionnée.

---

# 14. Configuration du moteur

La configuration `plan-v1.0.0` doit être explicitement définie dans le package moteur.

Exemple conceptuel :

```ts
type PlanEngineConfig = {
  engineVersion: 'plan-v1.0.0'
  gradeCurve: Array<{ grade: number; factor: number }>
  technicalityFactors: {
    smooth: number
    standard: number
    technical: number
    very_technical: number
  }
  fatigueAlpha: number
  cutoffThresholds: {
    comfortableSeconds: number
    watchSeconds: number
  }
  preprocessingVersion: string
}
```

Le client ne peut jamais fournir cette configuration arbitrairement.

La version est choisie côté serveur.

---

# 15. Génération initiale

Sans contraintes intermédiaires :

```text
stop_budget = Σ planned_stop_duration
moving_budget = target_duration - stop_budget
```

Condition bloquante :

```text
moving_budget <= 0
→ TARGET_TOO_SHORT
```

Puis :

```text
seconds_per_weight = moving_budget / Σ weight_i

exact_duration_i = seconds_per_weight × weight_i
```

Les micro-durées sont agrégées en segments du Plan.

L’arrivée finale doit égaler l’objectif à la précision entière définie.

---

# 16. Arrondi déterministe

Les données persistées utilisent des secondes entières.

Afin d’éviter :

- des dérives de quelques secondes ;
- des différences selon runtime ;
- un finish différent de l’objectif ;

l’arrondi V1 doit être déterministe.

## 16.1 Méthode de référence

Pour chaque intervalle résolu :

1. calculer les durées exactes en flottants ;
2. agréger les durées exactes au niveau des segments persistés ;
3. prendre le `floor` de chaque durée flexible ;
4. calculer le nombre de secondes restantes pour atteindre exactement le budget d’intervalle ;
5. distribuer ces secondes selon le plus grand reste fractionnaire ;
6. en cas d’égalité, départager par `sortOrder` croissant.

Ainsi :

```text
Σ planned_duration_seconds
+ Σ stops
= budget de l’intervalle
```

à la seconde près lorsque l’intervalle possède une ancre finale.

Cette règle fait partie du déterminisme V1.

---

# 17. Construction de la timeline

Pour le départ :

```text
arrival_0 = 0
departure_0 = stop_0
```

Pour chaque segment `j` :

```text
arrival_(j+1) =
  departure_j
  + segment_duration_j

departure_(j+1) =
  arrival_(j+1)
  + stop_(j+1)
```

Invariants :

```text
arrival_(j+1) > arrival_j
departure_j >= arrival_j
planned_elapsed_seconds monotone
```

Les stops appartiennent au waypoint d’arrivée et sont consommés avant le segment suivant.

---

# 18. Contraintes temporelles et ancres

Une heure de passage verrouillée devient une **ancre dure**.

Le solveur ne normalise plus nécessairement toute la course d’un bloc.

Il résout chaque intervalle entre ancres compatibles.

## 18.1 Ancres implicites

### Départ

Toujours :

```text
elapsed = 0
```

### Arrivée

L’arrivée est ancrée à l’objectif seulement lorsque le mode demande un rééquilibrage vers cet objectif.

### Waypoint verrouillé

Une heure d’arrivée verrouillée est une ancre dure.

### Segment imposé

Un segment avec durée manuelle est une contrainte fixe de durée, **pas une ancre horaire**.

---

# 19. Solveur d’un intervalle A → B

Pour un intervalle possédant une ancre d’arrivée B :

```text
interval_budget =
    arrival_B
  - departure_A_reference
  - Σ stops internes applicables
  - Σ fixed_segment_durations
```

La formulation exacte dépend de la représentation choisie, mais un temps ne doit être soustrait qu’une fois.

La règle fonctionnelle est :

> le budget restant entre deux ancres est distribué uniquement sur les segments flexibles de cet intervalle.

Ensuite :

```text
flexible_scale =
  interval_budget
  / Σ flexible_weights
```

et :

```text
exact_duration_i =
  flexible_scale × weight_i
```

pour chaque segment flexible.

Les autres intervalles ne changent pas.

---

# 20. Conflits d’ancres

Le calcul est bloqué lorsque :

- une ancre située plus loin sur le parcours a un elapsed incompatible avec l’ancre précédente ;
- le budget d’un intervalle ne permet pas de contenir les stops fixes ;
- les durées de segments fixes dépassent le budget ;
- un segment imposé a une durée `<= 0` ;
- deux contraintes temporelles ne peuvent être satisfaites simultanément.

Codes principaux :

```text
ANCHOR_ORDER_CONFLICT
FIXED_DURATION_CONFLICT
```

Le moteur ne doit jamais résoudre un conflit en supprimant automatiquement une contrainte utilisateur.

---

# 21. Éditions utilisateur

## 21.1 Changer l’objectif

L’utilisateur définit une nouvelle durée cible.

Effet :

- nouvelle référence d’objectif ;
- recalcul des portions flexibles ;
- respect de toutes les ancres et overrides compatibles ;
- nouvelles marges aux barrières.

L’objectif n’est pas choisi par le moteur.

## 21.2 Modifier un segment

Le segment devient :

```text
manual_override = true
```

avec une durée fixe.

Cette durée ne sera pas modifiée par un recalcul tant que l’utilisateur ne retire pas l’override.

## 21.3 Modifier un arrêt

La nouvelle durée devient fixe jusqu’à modification ultérieure.

## 21.4 Verrouiller un waypoint

Création / mise à jour de :

```text
is_locked = true
locked_elapsed_seconds = X
```

Le waypoint devient une ancre.

## 21.5 Déverrouiller

La contrainte horaire disparaît.

Le waypoint redevient dérivé au recalcul suivant.

## 21.6 Réinitialiser

Le scope sélectionné revient vers la proposition PLUKA :

- suppression de l’override segment concerné ;
- restauration du stop de référence si une référence existe ;
- suppression d’une ancre personnelle ;
- ou reset complet des personnalisations selon la commande utilisée.

La commande exacte doit être explicite ; pas de reset silencieux de toute la course.

---

# 22. Deux modes après une modification

Après une modification qui crée un delta temporel, l’expérience produit doit pouvoir proposer deux comportements.

## 22.1 `preserve_manual_changes`

Libellé produit :

> **Conserver ce Plan**

Le moteur :

- respecte toutes les contraintes explicites ;
- conserve les durées flexibles non concernées selon le scope de recalcul prévu ;
- laisse l’heure d’arrivée dériver si aucune ancre finale ne l’impose.

Exemple :

```text
segment +10 min
→ finish ≈ +10 min
```

hors autres contraintes affectées.

## 22.2 `rebalance_to_target`

Libellé produit :

> **Rééquilibrer pour finir en HH:MM**

L’arrivée cible devient une ancre.

Le delta est absorbé uniquement par les segments flexibles des intervalles concernés, au prorata de leurs poids.

Les éléments suivants ne sont jamais modifiés :

- durée d’un segment override ;
- stop explicite ;
- waypoint verrouillé.

## 22.3 Génération initiale

La génération initiale utilise de fait :

```text
rebalance_to_target
```

puisque le moteur doit produire un Plan terminant sur l’objectif utilisateur.

---

# 23. Scope de recalcul

L’objectif est de préserver la stabilité du Plan.

Une modification ne doit pas recalculer inutilement toute la course si les contraintes permettent un scope plus petit.

Exemples :

### Stop modifié sans ancre intermédiaire

En mode dérive :

```text
changedRange = waypoint modifié → arrivée
```

### Segment modifié + arrivée réancrée

En mode rééquilibrage :

```text
changedRange = intervalle d’ancres contenant le segment
```

### Waypoint verrouillé

Les intervalles adjacents deviennent les scopes de résolution pertinents.

Le résultat doit exposer un `changedRange` pour les consommateurs downstream.

---

# 24. Pas de modification silencieuse

Règle critique :

> **Toute personnalisation explicite reste une contrainte jusqu’à ce que l’utilisateur la retire.**

Un recalcul ne doit pas écraser :

- un segment manuel ;
- un stop manuel ;
- un waypoint verrouillé.

Si la contrainte rend le Plan impossible :

- retourner un conflit ;
- expliquer quelle contrainte est incompatible ;
- laisser l’utilisateur décider.

---

# 25. Barrières horaires

Une barrière appartient au référentiel Course.

Sa marge appartient au Plan.

Chaque cutoff doit préciser son `basis` :

```text
arrival
```

ou :

```text
departure
```

## 25.1 Calcul

```text
planned_reference =
  arrival_time      si basis = arrival
  departure_time    si basis = departure

margin_seconds =
  cutoff_datetime
  - planned_reference
```

En interne, les deux instants doivent être comparés sur le même référentiel temporel.

---

# 26. Statuts de marge V1

Seuils par défaut V1 :

| Statut | Règle | Libellé |
|---|---:|---|
| `comfortable` | marge >= 60 min | Marge confortable |
| `watch` | 30 min <= marge < 60 min | À surveiller |
| `critical` | 0 <= marge < 30 min | Marge critique |
| `missed` / `exceeded` | marge < 0 | Barrière dépassée |

Le vocabulaire SQL canonique doit suivre l’enum réellement déployé. Si la base utilise `exceeded`, le mapping domaine → DB doit utiliser `exceeded`.

Les seuils 60 / 30 min sont des constantes V1 configurables et versionnées.

## 26.1 Une barrière dépassée

Une barrière dépassée :

- ne rend pas automatiquement le calcul mathématique invalide ;
- produit un warning fort ;
- est clairement affichée ;
- peut amener l’utilisateur à modifier son objectif.

Le moteur ne décide pas que le coureur « ne finira pas ».

---

# 27. Arrivée et objectif initial

Le modèle distingue :

```text
initial_target_duration_seconds
```

et :

```text
target_duration_seconds
```

L’objectif initial est conservé pour permettre notamment :

- la comparaison historique ;
- l’après-course ;
- la distinction objectif de départ / Plan actuel.

Une modification de segment ou de stop en mode dérive ne modifie pas nécessairement `target_duration_seconds`.

Le Plan peut donc avoir :

```text
target_duration_seconds = 13h30
planned_finish = 13h42
```

tant que l’utilisateur n’a pas demandé un rééquilibrage ou changé son objectif.

---

# 28. Contrat TypeScript

Le package cible est :

```text
packages/plan-engine
```

API principale :

```ts
calculatePlan(
  input: PlanCalculationInput
): PlanCalculationResult
```

Le package :

- ne dépend pas de React ;
- ne dépend pas de Next.js ;
- ne dépend pas de Supabase ;
- ne lit pas l’heure système pour influencer le résultat ;
- ne fait aucun appel réseau ;
- ne fait aucun appel IA.

---

# 29. Structure d’entrée indicative

```ts
type PlanCalculationInput = {
  race: {
    id: string
    timezone: string
    startAt: string
  }

  course: {
    preprocessingVersion: string
    microSegments: PlanMicroSegment[]
    raceSegments: PlanRaceSegmentInput[]
    waypoints: PlanWaypointInput[]
    cutoffs: PlanCutoffInput[]
  }

  targetDurationSeconds: number

  stops: Array<{
    waypointId: string
    durationSeconds: number
    origin: 'default' | 'manual'
  }>

  segmentOverrides: Array<{
    segmentId: string
    durationSeconds: number
  }>

  anchors: Array<{
    waypointId: string
    arrivalElapsedSeconds: number
  }>

  mode:
    | 'preserve_manual_changes'
    | 'rebalance_to_target'

  engineConfig: PlanEngineConfig
}
```

Ce contrat est indicatif : les noms TypeScript peuvent être raffinés au bootstrap, mais les concepts et invariants ne doivent pas changer sans modification de cette spec.

---

# 30. Micro-segment indicatif

```ts
type PlanMicroSegment = {
  id: string
  raceSegmentId: string
  sortOrder: number

  distanceMeters: number
  elevationDeltaMeters: number
  elevationGainMeters: number
  elevationLossMeters: number

  rawGrade: number
  modelGrade: number

  progress: number

  technicality:
    | 'smooth'
    | 'standard'
    | 'technical'
    | 'very_technical'
    | null
}
```

Le moteur peut calculer les facteurs à partir de ces données.

---

# 31. Sortie du moteur

```ts
type PlanCalculationResult = {
  status: 'ok' | 'error'

  targetDurationSeconds: number
  finishElapsedSeconds: number | null

  planSegments: PlanSegmentResult[]
  planWaypoints: PlanWaypointResult[]
  cutoffStatuses: PlanCutoffStatusResult[]

  warnings: PlanIssue[]
  conflicts: PlanIssue[]

  changedRange: {
    fromWaypointId: string
    toWaypointId: string
  } | null

  calculationMetadata: {
    engineVersion: string
    preprocessingVersion: string
    inputHash: string
    totalWeight: number
    stopBudgetSeconds: number
    fixedSegmentBudgetSeconds: number
    solvedIntervals: number
  }
}
```

Une erreur structurante peut retourner un résultat sans timeline confirmable.

---

# 32. PlanSegmentResult

Minimum :

```ts
type PlanSegmentResult = {
  raceSegmentId: string
  sortOrder: number

  initialDurationSeconds: number
  plannedDurationSeconds: number

  manualOverride: boolean

  relativeWeight: number
}
```

`relativeWeight` est utile au diagnostic moteur mais n’est pas forcément exposé au produit.

---

# 33. PlanWaypointResult

Minimum :

```ts
type PlanWaypointResult = {
  raceWaypointId: string
  sortOrder: number

  plannedElapsedSeconds: number
  plannedArrivalAt: string

  stopDurationSeconds: number

  plannedDepartureElapsedSeconds: number
  plannedDepartureAt: string

  isLocked: boolean
  lockedElapsedSeconds: number | null
}
```

Les champs de départ peuvent être recalculés plutôt que persistés si le modèle de données canonique ne les stocke pas.

---

# 34. Hash d’entrée

La reproductibilité exige un `input_hash`.

Méthode de référence :

1. construire un payload logique sans données volatiles ;
2. ordonner les clés de manière canonique ;
3. conserver l’ordre métier des tableaux là où il a du sens ;
4. normaliser les nombres ;
5. sérialiser en UTF-8 ;
6. calculer SHA-256 ;
7. produire un hex de 64 caractères.

Ne doivent pas entrer dans le hash :

- `calculatedAt` ;
- request id ;
- métriques de performance ;
- valeurs UI ;
- ordre non sémantique d’un objet.

Même input logique + même version moteur = même hash.

---

# 35. Déterminisme

À :

```text
même PlanCalculationInput logique
+
même engineVersion
+
même preprocessingVersion
```

le moteur doit produire le même résultat à la seconde définie.

Interdits :

- `Math.random()` ;
- dépendance à `Date.now()` ;
- appel externe ;
- modèle IA ;
- locale implicite ;
- itération non déterministe sur des objets non ordonnés.

Les collections sont triées explicitement par `sortOrder` avant calcul.

---

# 36. Versionnement du Plan

Le modèle canonique persiste plusieurs `race_plans` pour une participation.

Une seule version est active.

Chaque Plan confirmé conserve au minimum :

- `version` ;
- `engine_version` ;
- `initial_target_duration_seconds` ;
- `target_duration_seconds` ;
- `planned_finish_datetime` ;
- `input_snapshot` ;
- `input_hash` ;
- `generated_at`.

La chaîne historique est déterminée au minimum par :

```text
participant_race_id + version
```

La spec moteur ne suppose pas l’existence d’un `parent_plan_id` si le schéma canonique ne le contient pas.

---

# 37. Preview vs confirmation

Une interaction UI peut produire un calcul de preview.

Exemples :

- slider objectif ;
- modification de stop ;
- saisie de durée ;
- verrouillage horaire.

Une preview :

- peut être calculée en mémoire ;
- ne crée pas automatiquement une version persistée ;
- ne déclenche pas les consommateurs downstream définitifs.

À confirmation utilisateur :

1. autorisation vérifiée ;
2. input canonique reconstruit serveur ;
3. calcul définitif serveur ;
4. nouvelle version persistée ;
5. ancienne version archivée selon le modèle ;
6. dépendances de faits persistées ;
7. événement `plan.updated` émis via l’outbox.

---

# 38. Persistance et mapping SQL

Le service applicatif mappe le résultat vers :

```text
race_plans
plan_waypoints
plan_segments
plan_cutoff_statuses
plan_version_dependencies
```

Le moteur pur ne connaît pas ces tables.

## 38.1 `race_plans`

Stocke le résumé et les métadonnées.

## 38.2 `plan_waypoints`

Stocke les ETA, stops et locks.

## 38.3 `plan_segments`

Stocke les durées initiales et actuelles, ainsi que l’override manuel.

## 38.4 `plan_cutoff_statuses`

Stocke les marges calculées.

## 38.5 `plan_version_dependencies`

Le service de domaine rattache au Plan les versions exactes des RaceFacts dont l’entrée dépend.

Le moteur ne choisit pas les sources.

---

# 39. Changement officiel d’une donnée Course

Si une nouvelle RaceFactVersion modifie :

- une barrière ;
- un waypoint ;
- une heure de départ ;
- une section ;
- une règle structurelle utilisée par le Plan ;

PLUKA doit pouvoir détecter les Plans dépendant d’une ancienne version.

Règle :

> **un changement officiel ne réécrit jamais silencieusement un Plan personnel existant.**

Le Plan est marqué comme potentiellement impacté.

L’utilisateur doit voir le changement et déclencher / confirmer l’action adaptée lorsque nécessaire.

---

# 40. Downstream — Nutrition

Le Plan actif est la source temporelle de référence de Nutrition.

Après changement confirmé :

```text
Plan
→ diff temporel
→ Nutrition Engine
→ proposition de diff
```

Règle :

- les besoins temporels peuvent être recalculés ;
- un jalon auto peut être reproposé ;
- un jalon personnalisé ou un produit personnalisé ne doit jamais être déplacé silencieusement.

Le Plan Engine ne modifie jamais directement Nutrition.

---

# 41. Downstream — Assistance

Assistance dérive ses ETA du Plan actif.

Après un Plan confirmé :

- les rendez-vous conservent leur waypoint ;
- les heures estimées sont recalculées ;
- les fenêtres de planification sont recalculées ;
- l’accompagnant voit les nouvelles heures ;
- aucun tracking fictif n’est créé.

Le Plan Engine ne stocke pas la donnée Assistance.

---

# 42. Fenêtre Assistance de référence

La règle de planification initialement définie est :

```text
half_window =
  clamp(
    0.075 × elapsed_time,
    15 min,
    60 min
  )

window_start =
  estimated_arrival - half_window

window_end =
  estimated_arrival + half_window
```

Cette valeur est :

- une marge de planification ;
- pas un intervalle probabiliste certifié ;
- pas une donnée live.

Terminologie produit :

> passage estimé

> fenêtre probable / fenêtre de planification

Ne jamais écrire, sans tracking réel :

> arrive dans 18 minutes

Cette formule appartient conceptuellement au domaine Assistance, mais son entrée `elapsed_time` vient du Plan.

---

# 43. Downstream — Conditions météo

Les Conditions sont maintenant un consommateur direct de la timeline Plan.

Après modification confirmée :

```text
nouveaux ETA
→ remapping des prévisions disponibles
→ nouvelles Conditions point par point
```

Le service Conditions peut déclencher un refresh provider selon sa propre politique.

Le Plan Engine :

- ne lit aucune météo ;
- ne change aucune durée à cause de la météo ;
- ne décide d’aucun matériel ;
- ne modifie aucune cible Nutrition.

---

# 44. Événement métier

Après confirmation :

```ts
type PlanCalculatedEvent = {
  type: 'plan.updated'

  participantRaceId: string
  racePlanId: string
  planVersion: number

  engineVersion: string
  inputHash: string

  changedRange: {
    fromWaypointId: string
    toWaypointId: string
  } | null

  createdAt: string
}
```

Le nom exact de l’événement dans l’implémentation doit rester cohérent avec `01_ARCHITECTURE.md`.

Consommateurs possibles :

- Nutrition ;
- Assistance ;
- Conditions ;
- Race Pack ;
- analytics internes ;
- Race Intelligence agrégée lorsque activée.

---

# 45. Entitlements et moteur

Le moteur ne connaît pas :

- Free ;
- Race Pass ;
- PLUKA+ ;
- Organizer Included.

Le service applicatif contrôle les droits.

Exemple :

### Free

Peut générer / consulter le Plan initial selon la Product Spec.

### Premium

Peut utiliser les commandes d’édition autorisées.

La sécurité ne doit jamais être :

```text
bouton masqué côté UI seulement
```

Chaque mutation premium est revérifiée serveur.

---

# 46. Profil trailer et Repère PLUKA

Le Profil trailer est un objet fonctionnel important, mais **il ne doit pas être transformé implicitement en coefficients de pacing V1**.

Le Repère PLUKA est encore un moteur distinct à calibrer / feature flagger.

Donc :

```text
Trail Profile
≠ Plan Engine coefficient V1
```

et :

```text
Repère PLUKA
≠ objectif automatiquement appliqué au Plan
```

Si une version future personnalise la distribution à partir du Profil trailer :

- la formule devra avoir sa propre spécification ;
- les nouveaux paramètres seront versionnés ;
- `engine_version` changera ;
- aucun comportement historique ne sera modifié silencieusement.

---

# 47. Stratégies prudent / régulier / ambitieux

Le moteur peut conserver un point d’extension conceptuel pour :

```text
prudent
regular
ambitious
```

mais cette fonctionnalité n’est pas nécessaire à la génération initiale V1.

La stratégie ne doit jamais changer l’objectif final.

Elle ne pourrait modifier que la **forme relative de progression**.

Tant que cette transformation n’a pas été calibrée et validée :

- ne pas l’exposer dans l’onboarding ;
- ne pas appliquer de coefficient non documenté ;
- utiliser le comportement de référence V1.

---

# 48. Erreurs, warnings et conflits

## 48.1 Niveaux

### ERROR

Empêche la confirmation du résultat.

### WARNING

Le calcul reste possible mais l’information doit être exposée.

### CONFLICT

Une ou plusieurs contraintes explicites sont incompatibles et nécessitent une décision utilisateur.

---

# 49. Codes principaux

| Code | Niveau | Comportement |
|---|---|---|
| `GPX_INVALID` | ERROR | parcours inexploitable |
| `WAYPOINT_OFF_ROUTE` | ERROR | waypoint critique trop éloigné |
| `TARGET_TOO_SHORT` | ERROR | budget temporel <= contraintes fixes |
| `ANCHOR_ORDER_CONFLICT` | CONFLICT | ancres incompatibles |
| `FIXED_DURATION_CONFLICT` | CONFLICT | durées fixes dépassent le budget |
| `GPX_DISTANCE_MISMATCH` | WARNING | écart distance > seuil |
| `GPX_GAIN_MISMATCH` | WARNING | écart D+ > seuil |
| `CUTOFF_CRITICAL` | WARNING | marge critique |
| `CUTOFF_MISSED` | WARNING | passage calculé après barrière |
| `EXTREME_REBALANCE` | WARNING | redistribution très éloignée de la proposition de référence |

Le seuil précis d’`EXTREME_REBALANCE` doit rester dans la configuration calibrée. Aucun chiffre non validé ne doit être inventé dans l’UI ou le domaine.

---

# 50. Objectif très ambitieux

Le moteur n’utilise pas de modèle physiologique absolu.

Donc un objectif peut être :

- mathématiquement calculable ;
- mais sportivement très ambitieux.

Le moteur Plan ne doit pas produire artificiellement :

```text
TARGET_PHYSIOLOGICALLY_IMPOSSIBLE
```

s’il ne possède aucun modèle validé permettant de l’affirmer.

Le produit peut contextualiser l’objectif via un autre mécanisme validé, mais ce mécanisme est hors Plan Engine V1.

---

# 51. Données de diagnostic

Chaque calcul doit permettre d’observer au minimum :

- temps de calcul ;
- nombre de micro-segments ;
- nombre de RaceSegments ;
- nombre de waypoints ;
- nombre d’ancres ;
- nombre d’overrides ;
- nombre de stops ;
- total weight ;
- budgets d’intervalle ;
- facteurs de normalisation ;
- warnings ;
- conflits ;
- écarts distance / D+ qualité ;
- `engine_version` ;
- `preprocessing_version` ;
- `input_hash`.

Ces données sont techniques.

Elles ne doivent pas exposer inutilement des données personnelles dans les logs.

---

# 52. Objectif de performance

Après prétraitement du parcours :

> **viser < 500 ms côté serveur pour le calcul complet d’un trail allant jusqu’à environ 200 km.**

Le GPX brut peut contenir jusqu’à environ 10 000 points avant prétraitement dans le scénario de référence.

Cette cible est un objectif d’implémentation, pas un SLA contractuel.

Le moteur doit d’abord être correct et reproductible.

---

# 53. Tests unitaires fondamentaux

Le package `plan-engine` doit disposer de fixtures synthétiques indépendantes de toute course réelle.

## P01 — Plat

**Entrée**

10 km plat, 2 segments égaux, aucun stop.

**Attendu**

- durées quasi égales ;
- finish = objectif ;
- aucun warning.

---

## P02 — Montée

**Entrée**

5 km plat + 5 km montée raide.

**Attendu**

La montée reçoit une part de temps nettement supérieure.

---

## P03 — Descente

**Entrée**

Descente modérée puis descente très raide.

**Attendu**

La descente modérée reçoit un coût plus faible ; la très raide redevient plus coûteuse.

---

## P04 — Stop + rééquilibrage

Ajout d’un stop de 10 minutes.

**Attendu**

- budget moving réduit de 10 min ;
- finish reste objectif en `rebalance_to_target`.

---

## P05 — Segment +10 min / dérive

Override d’un segment avec +10 min.

**Mode**

`preserve_manual_changes`

**Attendu**

Finish dérive d’environ +10 min hors autres contraintes.

---

## P06 — Segment +10 min / rebalance

Même modification.

**Mode**

`rebalance_to_target`

**Attendu**

- finish reste objectif ;
- segment manuel inchangé ;
- delta absorbé par segments flexibles concernés.

---

## P07 — Une ancre

Waypoint verrouillé à 12:00.

**Attendu**

Les intervalles avant / après sont résolus indépendamment.

---

## P08 — Ancres incompatibles

Deux ancres impossibles.

**Attendu**

`ANCHOR_ORDER_CONFLICT` ou `FIXED_DURATION_CONFLICT`.

---

## P09 — Cutoff

Barrière 16:31, passage de référence 15:54.

**Attendu**

```text
marge = 37 min
statut = watch
```

---

## P10 — Passage minuit

Course dépassant minuit.

**Attendu**

- elapsed seconds monotones ;
- dates calendaires correctes ;
- aucun reset à 00:00.

---

## P11 — Divergence D+

D+ GPX différent de 20 % de la valeur officielle.

**Attendu**

Warning qualité ; aucune correction artificielle silencieuse.

---

## P12 — Nutrition customisée

Modification du Plan avec Nutrition personnalisée.

**Attendu**

- événement downstream ;
- diff Nutrition ;
- aucune personnalisation déplacée sans confirmation.

---

## P13 — Assistance

Modification du Plan avec rendez-vous Assistance.

**Attendu**

- ETA Assistance mises à jour ;
- fenêtres mises à jour ;
- aucun tracking fictif.

---

## P14 — Déterminisme

Même input logique + même versions.

**Attendu**

Résultat identique à la précision définie.

---

# 54. Tests supplémentaires issus du Product Freeze

## P15 — Conditions

Modifier un Plan de sorte qu’un passage passe de 17:08 à 18:02.

**Attendu**

- le Plan ne change qu’en fonction de ses contraintes ;
- événement downstream Conditions produit ;
- aucune donnée météo n’influence la durée du segment.

---

## P16 — Stop + waypoint verrouillé

Ajouter 8 min d’arrêt avant une ancre future.

**Attendu**

- l’ancre reste exacte ;
- les segments flexibles de l’intervalle absorbent le delta en rebalance ;
- conflit si le budget devient négatif.

---

## P17 — Override protégé

Créer un override, puis changer l’objectif.

**Attendu**

L’override reste identique ; seules les portions flexibles sont recalculées.

---

## P18 — Déverrouillage

Supprimer une ancre utilisateur.

**Attendu**

Le waypoint redevient flexible au recalcul suivant.

---

## P19 — Cutoff departure

Barrière basée sur le départ du ravito.

**Attendu**

La marge utilise :

```text
arrival + stop
```

et non l’arrivée seule.

---

## P20 — Arrondi

Créer un intervalle dont les durées exactes produisent plusieurs fractions de seconde.

**Attendu**

- somme entière exacte au budget ;
- répartition des secondes déterministe ;
- aucun finish +1/-1 aléatoire.

---

## P21 — Changement d’objectif

Changer 13h30 → 14h30.

**Attendu**

- nouvel objectif = 14h30 ;
- finish = 14h30 si rebalance possible ;
- overrides et locks respectés ;
- marges barrières recalculées.

---

## P22 — Objectif mathématiquement agressif

Objectif très court mais `target > fixed budgets`.

**Attendu**

Le moteur calcule le Plan sans inventer de diagnostic physiologique.

---

# 55. Tests de propriétés

En complément des scénarios :

## 55.1 Monotonie temporelle

Pour tout Plan valide :

```text
arrival[i+1] > arrival[i]
```

## 55.2 Stops non négatifs

```text
stop[i] >= 0
```

## 55.3 Durées segment positives

```text
duration[i] > 0
```

## 55.4 Budget sous ancre finale

Pour tout intervalle ancré :

```text
Σ flexible
+ Σ fixed
+ Σ stops concernés
= interval_budget
```

à la seconde près.

## 55.5 Préservation des contraintes

Une ancre / override explicite n’est jamais modifié par le solveur.

## 55.6 Déterminisme

Deux exécutions identiques produisent le même résultat.

---

# 56. Calibration avant bêta

Les constantes V1 doivent être testées sur des parcours réels sans changer le contrat général du moteur.

Protocole recommandé :

1. sélectionner **10 à 20 trails** aux profils différents :
   - roulant ;
   - montagne ;
   - technique ;
   - longues descentes ;
   - ultra ;
2. construire plusieurs objectifs plausibles par course ;
3. comparer la forme des splits à des roadbooks / résultats publics lorsque disponibles ;
4. faire relire les répartitions à **5 à 10 trailers expérimentés** ;
5. relever les sections jugées irréalistes ;
6. ajuster uniquement les constantes prévues :
   - courbe de pente ;
   - fatigue ;
   - technicité ;
7. relancer l’intégralité des tests ;
8. versionner toute modification ;
9. geler une première version calibrée `plan-v1.0.0`.

## 56.1 Critère de réussite

La V1 n’a pas besoin d’être « prédictive ».

Elle doit :

> **produire une répartition que des trailers jugent cohérente, puis permettre de la corriger très facilement sans casser le reste du Plan.**

---

# 57. Données réelles de calibration

Les données terrain peuvent servir à améliorer les constantes, mais ne doivent pas créer implicitement une nouvelle promesse produit.

Une calibration peut analyser par exemple :

- splits de résultats publics ;
- roadbooks ;
- retours utilisateurs ;
- différences prévues / réelles après-course.

Toute évolution qui introduit :

- profil individuel ;
- niveau ITRA / UTMB ;
- ML ;
- modèle statistique prédictif ;

sort du contrat `plan-v1.0.x` et exige une nouvelle spécification.

---

# 58. Sécurité

Le client ne peut fournir directement :

- `grade_factor` ;
- `fatigue_alpha` ;
- facteurs de technicité ;
- seuils moteur ;
- `engine_version` arbitraire.

Les commandes utilisateur autorisées portent uniquement sur des concepts métier :

- objectif ;
- stop ;
- durée segment ;
- verrou horaire ;
- reset ;
- choix rebalance / dérive.

Le serveur :

1. contrôle l’utilisateur ;
2. contrôle l’entitlement ;
3. reconstruit l’input à partir de données autorisées ;
4. choisit la version moteur ;
5. calcule ;
6. persiste.

---

# 59. Frontières de confidentialité

Le moteur reçoit uniquement les données de la participation en cours.

Il ne lit pas les Plans d’un autre utilisateur.

L’organisation :

- ne reçoit pas les ETA individuelles ;
- ne reçoit pas les objectifs individuels ;
- ne reçoit pas les overrides personnels.

Race Intelligence, lorsqu’activée, possède un pipeline serveur d’agrégation séparé.

---

# 60. Observabilité et données personnelles

Les logs moteur peuvent contenir :

- IDs techniques ;
- versions ;
- durées ;
- counts ;
- codes warnings ;
- hash.

Éviter de loguer :

- nom du coureur ;
- email ;
- notes privées ;
- Nutrition ;
- téléphone Assistance.

Les logs doivent permettre le diagnostic sans devenir une copie du Plan personnel.

---

# 61. Ordre d’implémentation recommandé

| Étape | Livrable |
|---|---|
| P1 | GPX preprocessing |
| P2 | génération initiale : pente + technicité + fatigue |
| P3 | stops + timeline + cutoffs |
| P4 | overrides segments / stops |
| P5 | anchors et solveur par intervalles |
| P6 | rebalance / dérive |
| P7 | versionnement + `input_hash` |
| P8 | persistance Data Model |
| P9 | événements downstream Nutrition / Assistance / Conditions |
| P10 | tests de calibration terrain |
| P11 | freeze `plan-v1.0.0` |

Chaque étape doit ajouter ses tests avant de poursuivre.

---

# 62. Organisation du package recommandée

```text
packages/plan-engine/
├── src/
│   ├── index.ts
│   ├── contracts.ts
│   ├── config.ts
│   ├── grade-factor.ts
│   ├── technicality.ts
│   ├── fatigue.ts
│   ├── weights.ts
│   ├── solver.ts
│   ├── timeline.ts
│   ├── cutoffs.ts
│   ├── rounding.ts
│   ├── validation.ts
│   ├── issues.ts
│   └── hash.ts
│
└── tests/
    ├── fixtures/
    ├── grade-factor.test.ts
    ├── generation.test.ts
    ├── solver.test.ts
    ├── cutoffs.test.ts
    ├── rounding.test.ts
    ├── determinism.test.ts
    └── acceptance.test.ts
```

Le preprocessing GPX peut vivre dans un package géospatial / domaine Course séparé s’il est partagé avec Conditions et Race Intelligence.

L’important est qu’il ne soit pas recomputé à chaque édition du Plan.

---

# 63. Commands applicatives associées

La couche domaine peut exposer :

```text
generateRacePlan
changePlanTarget
updatePlanSegmentDuration
removePlanSegmentOverride
updatePlanStop
lockPlanWaypoint
unlockPlanWaypoint
rebalancePlanToTarget
preserveCurrentPlan
resetPlanScope
```

Ces commandes :

- contrôlent l’autorisation ;
- construisent le snapshot ;
- appellent le moteur ;
- persistent uniquement après validation ;
- déclenchent les effets downstream.

---

# 64. UI : ce que le moteur doit permettre

Sans imposer le design exact, le résultat doit permettre au frontend d’afficher :

- objectif ;
- arrivée actuelle ;
- profil altimétrique ;
- durée de chaque section ;
- ETA de chaque waypoint ;
- temps écoulé ;
- stop ;
- état verrouillé ;
- barrières ;
- marges ;
- point ayant la marge la plus faible ;
- warnings ;
- différence éventuelle entre objectif et Plan actuel.

Le moteur ne produit pas :

- textes marketing ;
- couleurs ;
- composants ;
- décisions de paywall.

---

# 65. Terminologie utilisateur

Préférer :

- Plan
- objectif
- passage estimé
- heure prévue
- arrêt
- section
- marge
- à surveiller
- rééquilibrer
- conserver ce Plan

Éviter :

- prédiction exacte
- chrono garanti
- rythme optimal
- capacité maximale
- PLUKA sait que tu passeras à…
- risque DNF

---

# 66. Non-régression obligatoire

Une évolution de `plan-v1.0.0` ne peut être mergée si elle :

- change un résultat sans changement de version ;
- casse un scénario P01–P22 ;
- modifie une contrainte manuelle ;
- laisse un finish non déterministe ;
- rend les elapsed non monotones ;
- change un cutoff basis ;
- injecte une donnée météo dans le pacing ;
- introduit un LLM ;
- dépend du prototype pour une constante métier.

---

# 67. Critères d’acceptation pour Claude Code

L’implémentation du moteur Plan V1 est considérée correcte lorsque :

1. le package tourne sans Next.js ;
2. le package tourne sans Supabase ;
3. le package ne fait aucun appel externe ;
4. la même entrée donne le même résultat ;
5. l’objectif initial inclut les stops ;
6. le relief influence réellement la répartition ;
7. le temps n’est pas réparti uniquement selon la distance ;
8. la technicité inconnue n’est pas inventée ;
9. la fatigue déplace légèrement le coût vers la fin sans rallonger l’objectif ;
10. les durées entières somment exactement au budget sous contrainte ;
11. les anchors découpent le solveur ;
12. un override n’est jamais écrasé ;
13. un stop manuel n’est jamais écrasé ;
14. une ancre incompatible produit un conflit explicite ;
15. le mode dérive laisse l’arrivée dériver ;
16. le mode rebalance conserve l’objectif lorsque possible ;
17. les cutoffs utilisent correctement arrival/departure ;
18. les marges sont recalculées à chaque modification ;
19. une barrière dépassée produit un warning sans diagnostic DNF ;
20. une course multi-jour fonctionne en elapsed seconds ;
21. `input_hash` est reproductible ;
22. `engine_version` est choisi serveur ;
23. le résultat se mappe vers le Data Model actuel ;
24. un Plan confirmé déclenche ses consommateurs downstream ;
25. Conditions ne modifie jamais le pacing ;
26. Nutrition ne modifie jamais le Plan ;
27. Assistance ne modifie jamais le Plan ;
28. le Repère PLUKA n’est pas utilisé comme formule cachée ;
29. toutes les constantes moteur sont versionnées ;
30. les tests P01–P22 passent.

---

# 68. Consigne finale

Le moteur Plan V1 doit rester simple dans son ambition et strict dans son exécution.

Il ne doit pas essayer de résoudre une question qu’il ne possède pas les données pour résoudre.

Sa responsabilité est :

> **répartir intelligemment et de manière éditable un objectif utilisateur sur un parcours de trail réel.**

Pas :

> **prédire ce que le coureur fera réellement.**

La qualité de PLUKA repose autant sur la cohérence des recalculs et la protection des choix utilisateur que sur la première proposition.

---

**Fin — PLUKA Plan Engine V1**
