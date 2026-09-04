# PLUKA — Nutrition Engine V1

**Fichier de référence :** `docs/engines/NUTRITION_ENGINE.md`  
**Statut :** Spécification fonctionnelle et algorithmique de référence — V1  
**Date de consolidation :** 2026-09-03  
**Version moteur de départ :** `nutrition-v1.0.0`  
**Principe :** déterministe, explicable, éditable, versionné — aucune prescription nutritionnelle automatique

---

# 0. Rôle de ce document

Ce document définit le **moteur Nutrition V1 de PLUKA** : ses responsabilités, ses entrées, ses sorties, son modèle de besoins temporels, ses Conditions Chaud / Froid / Nuit, son placement de jalons, la contribution des produits, la couverture, la réserve, les interactions avec les ravitaillements, l’Assistance, les sorties personnelles, les Conditions météo et les recalculs après modification du Plan.

Le moteur transforme :

> **une chronologie de course ou de sortie + des cibles définies par le coureur + des produits choisis**

en :

> **une stratégie opérationnelle de Nutrition positionnée sur le parcours.**

Le moteur organise des objectifs définis ou validés par le coureur.

Il ne remplace pas :

- un professionnel de santé ;
- un diététicien ;
- un nutritionniste ;
- l’expérience personnelle du coureur ;
- la connaissance de sa tolérance digestive.

PLUKA ne doit jamais présenter le résultat comme une stratégie médicalement « optimale ».

---

## 0.1 Documents de référence

Cette spec complète :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/04_ENTITLEMENTS.md`
- `docs/engines/PLAN_ENGINE.md`
- `docs/engines/WEATHER_CONDITIONS.md`
- `docs/ACCEPTANCE_CRITERIA.md`

Le prototype figé sert de référence UX/UI, **jamais de référence algorithmique ou médicale**.

### Ordre de priorité

En cas de contradiction :

1. `00_PRODUCT_SPEC.md` fait foi sur le produit ;
2. ce document fait foi sur le calcul Nutrition ;
3. `PLAN_ENGINE.md` fait foi sur les horaires du Plan ;
4. `WEATHER_CONDITIONS.md` fait foi sur la détection des Conditions ;
5. `01_ARCHITECTURE.md` fait foi sur les frontières techniques ;
6. `02_DATA_MODEL.md` et les migrations font foi sur la persistance existante ;
7. le prototype fait foi sur l’intention UX.

Une contradiction doit être signalée avant implémentation.

---

## 0.2 Origine et consolidation

Cette version Markdown consolide la **Spécification moteur Nutrition V1 du 27 août 2026** et l’aligne avec le Product Design Freeze actuel.

Les principes initiaux sont conservés :

- cibles définies par le coureur ;
- Nutrition comme couche du Plan ;
- calcul fondé sur le temps ;
- jalons adaptatifs ;
- préférence pour les ravitaillements utiles ;
- contributions multidimensionnelles des produits ;
- caféine traitée séparément ;
- personnalisation protégée ;
- recalcul par diff ;
- moteur déterministe et sans LLM.

Les évolutions produit intégrées dans cette version sont notamment :

- le même moteur fonctionne aussi sur les **sorties personnelles** ;
- les produits sont choisis **avant** la génération avancée ;
- la stratégie distingue `consommer`, `remplir` et `emporter` ;
- les contenus de ravitaillement officiels peuvent alimenter les propositions ;
- les aliments génériques de ravitaillement sont possibles avec valeurs clairement estimées ;
- une **réserve** peut être ajoutée à ce qu’il faut préparer sans être considérée comme consommée ;
- les Conditions météo à partir de J-14 peuvent proposer des **plages temporelles**, mais ne modifient jamais la stratégie sans confirmation ;
- la Nuit peut provenir de l’astronomie / des heures de passage ;
- une sortie de test peut reprendre puis adapter une stratégie de course ;
- aucune modification issue d’une sortie de test n’est réappliquée automatiquement à la course.

---

# 1. Décision structurante

> **Le coureur fixe ses cibles. PLUKA organise leur mise en œuvre sur le parcours.**

Le moteur V1 ne doit pas :

- inventer automatiquement un objectif de glucides en g/h ;
- inventer automatiquement un objectif d’hydratation en ml/h ;
- inventer automatiquement un objectif de sodium en mg/h ;
- inventer automatiquement une dose totale de caféine ;
- augmenter automatiquement une cible parce qu’il fait chaud ;
- diminuer automatiquement une cible parce qu’il fait froid ;
- augmenter automatiquement la caféine parce qu’une partie de la course est de nuit.

PLUKA peut :

- aider à matérialiser les conséquences des cibles choisies ;
- montrer une couverture insuffisante ;
- proposer une meilleure répartition des produits déjà sélectionnés ;
- proposer d’appliquer un profil Chaud / Froid / Nuit déjà défini par l’utilisateur ou une stratégie explicitement choisie ;
- demander confirmation avant toute modification.

---

# 2. Objectifs V1

Le moteur doit :

1. accepter des cibles de base en glucides, hydratation et sodium ;
2. accepter une cible totale facultative de caféine ;
3. calculer les besoins cumulés sur le temps réel prévu ;
4. gérer plusieurs plages Chaud / Froid / Nuit ;
5. proratiser correctement les besoins lorsqu’une plage commence au milieu d’une section ;
6. générer des jalons pratiques à partir de la timeline ;
7. rapprocher les jalons des ravitaillements lorsqu’il est pertinent de le faire ;
8. permettre un mode de placement avancé par intervalle choisi par l’utilisateur ;
9. utiliser uniquement les produits sélectionnés par le coureur pour les propositions personnelles ;
10. compter chaque produit sur toutes ses dimensions sans double comptage ;
11. gérer l’eau comme un produit particulier disponible en volume ;
12. intégrer les produits disponibles officiellement aux ravitaillements ;
13. distinguer produits exacts et aliments / portions estimés ;
14. calculer la couverture par intervalle, section et course ;
15. détecter une sous-couverture par rapport aux cibles utilisateur ;
16. proposer une correction de répartition sans modifier les cibles ;
17. calculer ce qu’il faut préparer au départ, dans les sacs et pour l’Assistance ;
18. ajouter une réserve à la préparation sans la comptabiliser comme consommation planifiée ;
19. protéger tous les jalons et produits personnalisés ;
20. produire un diff après modification du Plan ;
21. fonctionner sur une Race et sur une Outing ;
22. être déterministe, versionné et testable ;
23. ne faire aucun appel réseau ni LLM dans le cœur de calcul.

---

# 3. Hors périmètre V1

Le moteur ne fait pas :

- prescription nutritionnelle automatique ;
- diagnostic médical ;
- gestion d’allergies comme moteur clinique ;
- détection de pathologie ;
- gestion automatisée de troubles digestifs ;
- recommandation personnalisée à partir du poids, du sexe ou d’une donnée médicale ;
- adaptation temps réel selon consommation réellement ingérée ;
- ingestion live depuis une montre ;
- stock domestique ;
- historique d’achat ;
- commande e-commerce ;
- marketplace ;
- prix ou affiliation ;
- validation communautaire automatique d’un produit ;
- apprentissage automatique sur les habitudes de consommation ;
- correction automatique de la stratégie de course à partir d’un retour de sortie ;
- optimisation scientifique de mélange de produits.

Les futures notions de :

- tolérance digestive ;
- préférence sucré / salé ;
- fatigue gustative ;

restent hors moteur V1 tant qu’elles ne possèdent pas une spécification dédiée.

---

# 4. Principes non négociables

| Principe | Règle V1 |
|---|---|
| Cibles utilisateur | PLUKA organise des cibles définies / validées par le coureur |
| Nutrition = couche temporelle | Pas de planning indépendant du Plan ou de la timeline Outing |
| Temps avant distance | Les besoins sont intégrés sur le temps ; la distance positionne les jalons |
| Produits choisis avant génération | Le moteur ne pioche pas librement dans tout le catalogue |
| Ravitos utiles | Un jalon peut se fusionner avec un ravito proche |
| Produits multidimensionnels | Une boisson peut contribuer simultanément à hydratation, glucides et sodium |
| Caféine séparée | Cible totale + répartition temporelle |
| Personnalisation protégée | Aucun jalon ou produit utilisateur n’est déplacé silencieusement |
| Conditions explicites | Chaud / Froid / Nuit n’agissent que sur les dimensions réellement renseignées |
| Météo non prescriptive | La météo fournit une période ; elle n’invente pas une cible Nutrition |
| Réserve séparée | Réserve = à préparer en plus, pas à consommer automatiquement |
| Valeurs estimées visibles | Une portion générique de ravito reste explicitement estimée |
| Pas de faux exact | Un jalon est un repère pratique estimé, pas une injonction à la minute |

---

# 5. Deux scopes supportés

Le moteur fonctionne sur :

```text
race_plan
```

ou :

```text
outing
```

Il ne doit pas posséder deux moteurs différents.

La différence est dans le snapshot temporel fourni au moteur.

---

# 6. Timeline générique

Le cœur Nutrition doit dépendre d’un contrat temporel générique.

```ts
type NutritionTimelineSnapshot = {
  scope:
    | { type: 'race_plan'; racePlanId: string; participantRaceId: string }
    | { type: 'outing'; outingId: string }

  timezone: string
  startAt: string | null
  finishElapsedSeconds: number

  sections: NutritionTimelineSection[]
  points: NutritionTimelinePoint[]
}
```

Le moteur Nutrition n’interroge pas directement les tables Plan ou Outing.

Le domaine construit ce snapshot.

---

# 7. Timeline Race

Pour une course, la timeline provient d’une version précise de `RacePlan`.

Le snapshot comprend notamment :

- départ effectif ;
- durée du Plan actuel ;
- PlanWaypoints ;
- PlanSegments ;
- stops ;
- RaceWaypoints ;
- ravitaillements ;
- points Assistance utiles ;
- positions sur le GPX.

Une nouvelle version active de RacePlan ne doit jamais réécrire silencieusement l’ancienne stratégie Nutrition confirmée.

---

# 8. Timeline Outing

Pour une sortie, la timeline provient de :

- durée prévue ;
- trace ;
- waypoints personnels ;
- éventuels points eau / ravito ;
- heure de départ si elle existe.

Nutrition peut fonctionner même sans date réelle, puisque le cœur travaille en temps écoulé.

En revanche :

- Conditions météo ;
- Nuit astronomique ;
- vraie heure affichée ;

peuvent nécessiter une date et une heure.

---

# 9. Entrées du moteur

| Entrée | Source | Minimum |
|---|---|---|
| Timeline | Plan / Outing | durée, sections, points |
| Cibles | utilisateur | carbs, hydratation, sodium, caféine facultative |
| Conditions | utilisateur / stratégie appliquée | type, début, fin, overrides |
| Produits | Mes produits | portions et contributions |
| Ravitos | référentiel Course / Outing | position, contenus disponibles |
| Placement | utilisateur / config | smart ou interval |
| Réserve | utilisateur | pourcentage |
| Personnalisations | stratégie courante | jalons, locks, produits |
| EngineConfig | serveur | heuristiques versionnées |

---

# 10. Cibles de base

```ts
type NutritionTargets = {
  carbsGPerHour: number
  hydrationMlPerHour: number
  sodiumMgPerHour: number
  caffeineTotalMg: number | null
}
```

Contraintes :

```text
carbs >= 0
hydration >= 0
sodium >= 0
caffeine == null ou >= 0
```

Le moteur ne valide pas la pertinence médicale d’une valeur.

Il valide seulement :

- le type ;
- la cohérence structurelle ;
- les bornes techniques définies par le contrat.

Aucune borne médicale arbitraire ne doit être introduite sans nouvelle validation produit.

---

# 11. Calcul des besoins horaires

Pour chaque dimension horaire :

```text
d ∈ {carbs, hydration, sodium}
```

la cible effective est une fonction du temps :

```text
T_d(t)
```

Le besoin entre `a` et `b` est :

```text
need_d(a,b) =
  ∫[a,b] T_d(t) dt / 3600
```

Si la cible est constante :

```text
need =
  target_per_hour
  × duration_seconds
  / 3600
```

Le calcul se fait avec des nombres décimaux sans arrondi intermédiaire volontaire.

L’arrondi n’est appliqué qu’au rendu ou à la transformation en portions physiques.

---

# 12. Besoins cumulés

À un temps `t` :

```text
cumulative_need_d(t) =
  Σ needs over all subintervals [0,t]
```

Le moteur doit pouvoir produire :

- besoin depuis le départ ;
- besoin depuis le dernier jalon ;
- besoin sur une section ;
- besoin restant jusqu’au prochain ravito ;
- besoin total de la course / sortie.

---

# 13. Conditions Nutrition

Types V1 :

```text
hot
cold
night
```

Une `NutritionCondition` peut contenir plusieurs plages.

Une plage possède toujours :

```text
start_elapsed_seconds
end_elapsed_seconds
```

avec :

```text
end > start
```

La plage peut également référencer une `condition_period` venant du moteur Conditions.

---

# 14. Chaud

Une plage `hot` peut remplacer, uniquement sur sa durée :

- glucides g/h ;
- hydratation ml/h ;
- sodium mg/h.

Une dimension absente conserve la cible de base.

Exemple conceptuel :

```text
base hydration = H
hot range hydration = H_hot

avant plage → H
pendant plage → H_hot
après plage → H
```

Le moteur n’invente pas `H_hot`.

---

# 15. Froid

Même comportement que Chaud.

Une plage `cold` peut fournir des overrides pour :

- glucides ;
- hydratation ;
- sodium.

Une valeur non renseignée hérite de la cible de base.

---

# 16. Nuit

Une plage `night` agit principalement sur la **distribution temporelle de la caféine**.

Elle possède :

```text
caffeine_distribution_weight
```

Règle :

> la Nuit ne modifie jamais automatiquement la quantité totale de caféine.

Si aucun poids différent de `1` n’est configuré / validé :

```text
weight = 1
```

et la plage Nuit n’altère pas la distribution.

Le moteur ne doit pas inventer un poids « nuit » en production à partir d’une fixture du prototype.

---

# 17. Composition des Conditions

Autorisé :

```text
night + hot
night + cold
```

Les effets se combinent par dimension.

Exemple :

```text
cold → targets carbs/hydration/sodium
night → caffeine distribution
```

Interdit / contradictoire par défaut :

```text
hot + cold
```

sur le même intervalle.

Résultat :

```text
HOT_COLD_OVERLAP
```

La stratégie ne peut pas être confirmée tant que le conflit n’est pas résolu.

---

# 18. Sous-intervalles exacts

Lorsqu’une Condition commence au milieu d’une section :

```text
section 04:00 → 06:00
hot     04:40 → 05:20
```

le moteur découpe logiquement :

```text
04:00 → 04:40 : base
04:40 → 05:20 : hot
05:20 → 06:00 : base
```

Le calcul est proratisé exactement.

Aucun jalon de section ne doit être déplacé artificiellement au début d’une Condition uniquement pour simplifier le calcul.

---

# 19. Plage hors timeline

### Partiellement hors timeline

Tronquer à :

```text
[0, finish]
```

et produire :

```text
RANGE_TRUNCATED
```

### Entièrement hors timeline

Ignorer le range et produire un warning / info de configuration.

Ne jamais étendre automatiquement une plage jusqu’à l’arrivée.

---

# 20. Conditions météo

Le moteur Nutrition **ne reçoit jamais de météo brute**.

Il ne lit pas :

- température ;
- vent ;
- pluie ;
- provider weather.

Le pipeline est :

```text
Weather Provider
→ Weather Conditions Engine
→ ConditionPeriod
→ ConditionProposal
→ confirmation utilisateur
→ NutritionConditionRange
→ Nutrition Engine
```

Ainsi le moteur Nutrition reste indépendant du provider météo.

---

# 21. Règle J-14

La règle J-14 appartient à `WEATHER_CONDITIONS.md`.

Nutrition n’a pas besoin de connaître J-14.

Il reçoit seulement les Conditions déjà autorisées / appliquées.

Avant confirmation utilisateur, une `condition_proposal` n’est pas une entrée Nutrition active.

---

# 22. Météo : ce qui peut être proposé

Une période météo peut proposer :

> appliquer le profil Chaud / Froid existant sur cette période

ou :

> utiliser cette période dans ma stratégie

Elle ne peut pas inventer une nouvelle cible médicale.

Exemple valide :

```text
L'utilisateur a défini :
Profil chaud = hydratation H_hot

Météo :
période chaude 14:20 → 17:05

PLUKA propose :
appliquer le profil chaud 14:20 → 17:05
```

Exemple invalide :

```text
Il fera 27°C
→ PLUKA invente automatiquement 742 ml/h
```

---

# 23. Nuit automatique

Le moteur Conditions peut détecter la Nuit à partir :

- du coucher du soleil ;
- du lever du soleil ;
- des heures de passage.

Il crée alors une `ConditionPeriod` de source `astronomy`.

Nutrition peut proposer d’utiliser cette plage.

La plage ne devient active qu’après la règle d’application définie par le produit.

Aucune dose totale de caféine n’est augmentée automatiquement.

---

# 24. Caféine

La caféine est une enveloppe totale :

```text
C_total
```

Le moteur définit une fonction de poids :

```text
W(t) >= 0
```

Par défaut :

```text
W(t) = 1
```

Une Condition Nuit ou un réglage explicite peut modifier `W(t)`.

La quantité théorique allouée à `[a,b]` est :

```text
caffeine_share(a,b) =
  C_total
  ×
  integral(W(t), a, b)
  /
  integral(W(t), 0, finish)
```

---

# 25. Invariants caféine

1. Si `caffeineTotalMg == null`, la dimension caféine cible est désactivée.
2. Une Condition ne modifie jamais `C_total`.
3. La somme théorique de la distribution reste `C_total`.
4. Les produits réels créent une couverture discrète pouvant différer de la cible théorique.
5. Le moteur affiche l’écart.
6. Le moteur ne force pas automatiquement l’ajout d’un produit caféiné.
7. Un produit caféiné sélectionné par l’utilisateur reste autorisé même si aucune cible totale n’est définie ; dans ce cas, sa caféine est comptabilisée comme apport réel mais aucune couverture-cible caféine n’est calculée.

---

# 26. Produits

Le moteur travaille avec des **snapshots de produits**.

```ts
type NutritionProductSnapshot = {
  userProductId: string | null
  canonicalProductId: string | null

  label: string
  servingLabel: string | null
  servingQuantity: number | null
  servingUnit: string | null

  carbsG: number
  hydrationMl: number
  sodiumMg: number
  caffeineMg: number

  estimated: boolean
  sourceType: 'user_product' | 'canonical' | 'aid_station_generic' | 'water'
}
```

Le snapshot garantit qu’une modification future du catalogue ne change pas rétroactivement une stratégie confirmée.

---

# 27. Produits sélectionnés avant génération

Règle produit :

> **Le coureur choisit d’abord ce qu’il accepte d’utiliser. PLUKA organise ensuite ces produits.**

La génération avancée ne doit pas sélectionner arbitrairement un produit inconnu dans tout le catalogue PLUKA.

Le set de candidats est limité à :

- Mes produits sélectionnés ;
- eau ;
- contenus de ravitaillement que l’utilisateur accepte d’intégrer ;
- aliments génériques explicitement utilisés / acceptés.

Si aucune sélection produit n’existe :

- le moteur peut générer le profil de besoins et les jalons ;
- mais il ne doit pas prétendre que la couverture produit est complète.

---

# 28. Contributions multidimensionnelles

Pour `q` portions :

```text
planned_carbs =
  q × serving_carbs

planned_hydration =
  q × serving_hydration

planned_sodium =
  q × serving_sodium

planned_caffeine =
  q × serving_caffeine
```

Un même produit contribue à toutes les dimensions pertinentes.

Il n’est compté qu’une fois.

---

# 29. Boisson énergétique

Exemple structurel :

```text
boisson iso 500 ml

carbs = 35 g
hydration = 500 ml
sodium = 450 mg
```

Une portion produit simultanément :

```text
+35 g glucides
+500 ml hydratation
+450 mg sodium
```

Le moteur ne doit pas ensuite ajouter automatiquement `+500 ml` d’eau supplémentaire pour représenter le même liquide.

C’est une règle majeure de non-double-comptage.

---

# 30. Eau

L’eau est un produit spécial.

Elle peut être représentée en ml.

Contributions :

```text
carbs = 0
hydration = volume
sodium = 0
caffeine = 0
```

Elle peut être :

- portée ;
- consommée ;
- remplie à un point d’eau / ravito.

---

# 31. Produits génériques de ravitaillement

PLUKA peut représenter :

- soupe ;
- banane ;
- orange ;
- fromage ;
- gâteau ;
- boisson générique ;
- autre aliment disponible annoncé.

Si la valeur nutritionnelle n’est pas fournie officiellement :

- une estimation peut être utilisée ;
- `estimated = true` ;
- la portion doit être décrite ;
- le produit doit être visuellement marqué comme estimation.

Une estimation ne devient jamais une donnée officielle parce qu’elle est utilisée dans un calcul.

---

# 32. Contenu officiel des ravitos

Le référentiel Course peut fournir :

```text
race_aid_station_items
```

Le moteur peut les utiliser pour savoir :

- qu’un produit / aliment est annoncé à un waypoint ;
- où un remplissage est théoriquement possible.

Il ne doit pas supposer qu’un produit sera réellement disponible si la donnée de course ne le dit pas.

Si aucun contenu officiel fiable n’est disponible :

- permettre une configuration manuelle ;
- ne pas inventer le contenu du ravito.

---

# 33. Actions Nutrition

Chaque item opérationnel possède une action :

```text
consume
refill
carry
```

### `consume`

Consommer ici / autour du jalon.

### `refill`

Remplir / récupérer ici pour la suite.

### `carry`

Emporter après ce point.

Cette distinction est particulièrement importante aux ravitaillements et points Assistance.

---

# 34. Besoin vs logistique

Ne pas confondre :

```text
besoin à consommer pendant une section
```

et :

```text
produit à emporter au début de la section
```

Exemple :

```text
Lenk → Iffigenalp
besoin prévu : X

au ravito Lenk :
- consommer ici
- remplir
- emporter pour la section suivante
```

Le moteur doit pouvoir produire ces deux niveaux.

---

# 35. Génération des jalons — mode Smart

Mode par défaut :

```text
placementMode = smart
```

Le moteur ne crée pas simplement un rappel fixe « toutes les 30 minutes ».

Pipeline :

1. construire la courbe de besoins cumulés ;
2. parcourir la timeline ;
3. identifier les opportunités officielles :
   - ravito ;
   - eau ;
   - Assistance si pertinente ;
4. identifier les longues périodes sans opportunité ;
5. générer des candidats de jalon lorsque suffisamment de besoin s’accumule ;
6. fusionner si pertinent avec un waypoint proche ;
7. éviter les jalons trop proches ;
8. éviter un jalon artificiel au milieu d’un arrêt déjà représenté ;
9. projeter les jalons intermédiaires sur le parcours ;
10. générer une `stableKey` déterministe.

Les seuils de déclenchement sont des heuristiques de placement versionnées, pas des recommandations nutritionnelles.

---

# 36. Génération — mode Intervalle avancé

Le produit peut proposer un mode avancé :

```text
placementMode = interval
```

L’utilisateur choisit une cadence.

Exemple conceptuel :

```text
intervalSeconds = N
```

Le moteur :

1. crée des candidats selon cette cadence ;
2. peut rapprocher un candidat d’un ravito dans la fenêtre de fusion ;
3. ne change pas les cibles ;
4. ne présente pas la cadence comme une recommandation médicale.

Ce mode est volontairement secondaire.

---

# 37. Fenêtre de fusion ravito

Valeur de référence héritée de la spec initiale :

```text
±10 minutes
```

autour du candidat.

Cette valeur est un paramètre d’ergonomie du moteur :

```text
aidMergeWindowSeconds = 600
```

Elle est versionnée dans `engine_config_version`.

Ce n’est pas une recommandation de fréquence d’alimentation.

---

# 38. Placement d’un jalon intermédiaire

Un jalon non lié à un waypoint officiel doit posséder :

- temps écoulé ;
- vraie heure si disponible ;
- distance interpolée ;
- position sur la section ;
- position géographique si nécessaire à l’UI ;
- `stableKey` unique.

Le moteur ne réutilise jamais une clé globale générique.

Exemple :

```text
nutrition-auto-seg-05-02
```

La clé exacte est libre, mais doit être déterministe à input identique.

---

# 39. Première génération et allocation des produits

La première génération est séparée logiquement en deux étapes :

```text
A. besoins + jalons
B. proposition de couverture produit
```

Cette séparation est importante :

- les besoins existent indépendamment des produits ;
- l’utilisateur peut modifier les produits sans reconstruire le pacing ;
- un défaut de produit ne change pas la cible.

---

# 40. Allocateur produit V1

L’allocateur V1 n’est pas un « optimiseur nutritionnel ».

Il cherche simplement une combinaison discrète de produits sélectionnés qui couvre raisonnablement les cibles **déjà définies par l’utilisateur**.

Pour chaque intervalle opérationnel :

1. calculer le vecteur de besoin ;
2. soustraire les produits déjà verrouillés / personnalisés ;
3. déterminer les déficits restants ;
4. construire un ensemble borné de combinaisons avec les produits éligibles ;
5. évaluer les combinaisons ;
6. choisir la meilleure de façon déterministe ;
7. conserver un gap plutôt que forcer une combinaison excessive.

---

# 41. Fonction d’évaluation de couverture

Pour chaque dimension active `d` :

```text
deficit_d = max(need_d - planned_d, 0)
overshoot_d = max(planned_d - need_d, 0)
```

Normalisation :

```text
norm_d =
  max(need_d, epsilon)
```

Puis :

```text
undercoverage_score =
  Σ deficit_d / norm_d

overcoverage_score =
  Σ overshoot_d / norm_d
```

Critères lexicographiques V1 :

1. minimiser la sous-couverture ;
2. à sous-couverture équivalente, minimiser la sur-couverture ;
3. à couverture équivalente, minimiser le nombre de portions / actions ;
4. à égalité, respecter l’ordre stable des produits sélectionnés ;
5. dernier tie-break : identifiant stable.

La caféine n’entre dans cette optimisation que si une cible caféine existe.

Cette formule ne dit pas qu’une combinaison est médicalement meilleure : elle mesure seulement son écart aux objectifs fournis.

---

# 42. Recherche bornée

L’allocateur doit rester déterministe et rapide.

Une approche possible V1 :

- génération bornée de combinaisons ;
- beam search déterministe ;
- ou programmation dynamique discrète.

La stratégie technique exacte peut être choisie pendant l’implémentation à condition de respecter :

- les critères de score ci-dessus ;
- les mêmes résultats à input identique ;
- une limite explicite du nombre de portions explorées ;
- aucune explosion combinatoire ;
- conservation d’un gap si aucune solution raisonnable n’existe.

Les limites de recherche sont versionnées dans `engine_config_version`.

---

# 43. Produit non divisible

Lorsque le produit se consomme par portion entière :

```text
quantity = integer
```

par défaut.

Lorsque le produit est divisible / mesurable :

- eau en ml ;
- poudre en mesure / grammes si le modèle produit le permet ;
- boisson en ml ;

la granularité de quantité doit provenir du produit / contrat utilisateur.

Le moteur ne doit pas arrondir arbitrairement toutes les quantités à l’unité entière.

---

# 44. Couverture

La couverture doit être calculable :

- entre deux jalons ;
- par section ;
- cumulativement ;
- sur toute la course.

Dimensions :

- glucides ;
- hydratation ;
- sodium ;
- caféine si cible active.

Le moteur conserve les valeurs numériques.

Les libellés UI sont dérivés avec des tolérances versionnées.

---

# 45. Statuts de couverture

Libellés produit :

```text
À compléter
Presque atteint
Dans ta cible
Au-dessus de la cible définie
```

Les seuils exacts sont :

- des tolérances UX ;
- versionnés ;
- non médicaux.

Ils ne doivent jamais être présentés comme :

> zone de santé optimale.

---

# 46. Sous-couverture

Si les produits sélectionnés ne couvrent pas une cible :

```text
TARGET_COVERAGE_GAP
```

Le moteur doit :

- montrer la dimension concernée ;
- montrer l’ampleur du gap ;
- conserver la cible ;
- ne pas ajouter un produit non sélectionné sans consentement.

CTA produit possible :

> **Proposer une correction**

---

# 47. Proposer une correction

Une correction porte sur :

- quantité ;
- répartition ;
- placement ;
- refill / carry ;
- éventuellement choix parmi les produits déjà sélectionnés.

Elle ne porte pas automatiquement sur :

- une nouvelle cible g/h ;
- une nouvelle cible ml/h ;
- une nouvelle cible sodium ;
- une dose caféine supérieure.

Le résultat doit être présenté comme un diff.

L’utilisateur confirme avant application.

---

# 48. Sur-couverture

Une proposition produit peut dépasser une cible parce que les produits sont discrets.

Le moteur doit :

- afficher l’écart ;
- éviter une sur-couverture inutile via son score ;
- ne pas supprimer un produit explicitement imposé par l’utilisateur.

Le libellé doit rester :

> Au-dessus de ta cible définie

et non :

> dangereux

sauf spécification médicale future inexistante en V1.

---

# 49. Réserve

`reserve_percent` appartient à la stratégie.

Valeurs produit possibles :

```text
0 %
10 %
custom
```

mais le moteur accepte structurellement tout pourcentage autorisé par le Data Model.

Règle :

> **La réserve augmente ce qu’il faut préparer, pas ce que PLUKA prévoit de consommer.**

Ainsi :

```text
planned_consumption != prepared_with_reserve
```

---

# 50. Calcul de réserve

Par produit / unité logistique :

```text
reserve_quantity =
  confirmed_quantity × reserve_percent / 100

prepare_quantity =
  confirmed_quantity + reserve_quantity
```

L’arrondi final dépend de la granularité du produit.

### Portion indivisible

Arrondir vers le haut au nombre de portions nécessaires.

### Volume / quantité divisible

Conserver la granularité définie pour le produit.

Le moteur doit pouvoir exposer séparément :

- planifié ;
- réserve ;
- total à préparer.

---

# 51. Réserve non consommée

La réserve :

- n’entre pas dans `planned_carbs` ;
- n’entre pas dans `planned_hydration` ;
- n’entre pas dans `planned_sodium` ;
- n’entre pas dans `planned_caffeine`.

Elle ne corrige donc pas artificiellement un gap de couverture.

Elle est une couche logistique.

---

# 52. “À préparer pour cette course”

Le moteur agrège les items confirmés.

Sortie :

- produit ;
- unité ;
- quantité de consommation planifiée ;
- réserve ;
- total à préparer ;
- quantité affectée au départ ;
- quantité affectée à un sac ;
- quantité affectée à l’Assistance ;
- quantité non affectée.

Cette vue ne représente pas le stock domestique du coureur.

---

# 53. Destinations

Destinations V1 :

```text
start
bag
assistance
unassigned
```

Un même produit peut être réparti sur plusieurs destinations.

Invariant :

```text
assigned + unassigned = prepare_quantity
```

à la granularité utilisée.

---

# 54. Bags

Un item Nutrition peut être projeté dans `bag_items`.

La relation doit permettre de retrouver :

- quel besoin / jalon Nutrition est à l’origine ;
- quelle quantité est préparée dans quel sac.

Le moteur Nutrition calcule les besoins.

Le domaine Préparation effectue la projection / persistance de sac.

---

# 55. Assistance

Un produit prévu après un point Assistance peut être affecté à l’Assistance correspondante.

L’accompagnant voit seulement ce qui est utile :

- à apporter ;
- à donner ;
- à récupérer ;
- quantité ;
- instructions.

Il ne doit pas voir automatiquement :

- objectifs g/h ;
- cible sodium ;
- cible caféine totale ;
- stratégie Nutrition complète.

---

# 56. Conflit logistique Assistance

Si un recalcul du Plan / Nutrition déplace le besoin avant le point qui devait fournir le produit :

```text
ASSISTANCE_LOGISTICS_CONFLICT
```

PLUKA doit :

- conserver le produit ;
- signaler que la logistique n’est plus cohérente ;
- proposer une réaffectation.

Ne jamais supprimer silencieusement l’affectation.

---

# 57. Personnalisation des jalons

Un jalon doit conceptuellement distinguer :

```text
origin
isCustomized
isLocked
```

Origines utiles :

```text
auto
merged_race_waypoint
manual
```

Un jalon auto peut être recalculé.

Un jalon manuel ou personnalisé est protégé.

---

# 58. Actions utilisateur sur un jalon

| Action | Comportement |
|---|---|
| Ajouter | crée un jalon manuel |
| Déplacer | jalon personnalisé / verrouillé |
| Supprimer auto | suppression respectée |
| Fusionner ravito | suit le waypoint concerné |
| Modifier produits | affectations personnalisées protégées |
| Modifier quantité | quantité personnalisée protégée |
| Modifier cible | génère un diff avant application |

---

# 59. Suppression d’un jalon auto

Si l’utilisateur supprime explicitement un jalon auto :

- le moteur doit mémoriser cette personnalisation dans la version / recalcul ;
- il ne doit pas recréer immédiatement le même jalon au même endroit uniquement parce que l’heuristique est identique.

Si la nouvelle timeline rend l’absence de jalon problématique :

- proposer un nouveau jalon ;
- expliquer le gap ;
- ne pas réappliquer silencieusement l’ancien.

---

# 60. Stable keys

Les jalons auto doivent posséder une clé stable.

But :

- comparer ancienne et nouvelle génération ;
- préserver les items ;
- produire des diffs compréhensibles.

La clé ne doit pas dépendre d’un UUID aléatoire.

Elle peut incorporer :

- scope ;
- segment logique ;
- opportunité / waypoint ;
- index déterministe.

---

# 61. Recalcul après modification du Plan

Événement :

```text
plan.updated
```

Pipeline :

```text
ancien NutritionPlan
+
nouveau RacePlan
↓
recalcul besoins
↓
nouveaux jalons auto candidats
↓
matching stable
↓
protection personnalisations
↓
NutritionDiff
↓
confirmation utilisateur
↓
nouvelle stratégie appliquée
```

Le moteur ne persiste pas immédiatement les changements proposés.

---

# 62. Recalcul d’une Outing

Le même principe s’applique si l’utilisateur modifie :

- durée prévue ;
- timeline ;
- waypoints ;
- trace lorsque cela change la chronologie.

La sortie reste indépendante de la course liée.

Un recalcul d’une sortie de test ne modifie pas la stratégie de la Race.

---

# 63. Matching ancien → nouveau jalon

Ordre de préférence :

1. `stableKey` exacte ;
2. même waypoint officiel / outing waypoint ;
3. jalon personnalisé verrouillé ;
4. correspondance temporelle / section suffisamment proche selon config ;
5. sinon nouveau jalon.

Le matching est déterministe.

---

# 64. Priorité de préservation

Lors d’un recalcul, préserver en priorité :

1. jalons manuels ;
2. jalons verrouillés ;
3. jalons personnalisés ;
4. jalons fusionnés à un waypoint officiel ;
5. jalons possédant des produits personnalisés ;
6. jalons auto non personnalisés.

Une personnalisation peut provoquer un gap.

Le moteur doit montrer le gap plutôt que déplacer la personnalisation.

---

# 65. Diff Nutrition

Types conceptuels :

```text
kept
time_shifted
move_proposed
remove_proposed
add_proposed
item_kept
item_reassignment_required
coverage_changed
condition_changed
```

Chaque changement doit pouvoir contenir :

- before ;
- after ;
- reason ;
- impact sur couverture.

---

# 66. Application du diff

Le produit doit demander une action explicite :

> **Appliquer les modifications**

ou permettre de conserver la stratégie actuelle lorsque le résultat reste cohérent.

Un jalon auto non personnalisé peut être recalculé dans la preview.

La persistance définitive intervient seulement après confirmation globale ou action explicitement autorisée.

---

# 67. Conditions → Nutrition

Lorsque le moteur Conditions produit une proposition :

```text
before_payload
proposed_payload
impact_payload
```

l’utilisateur doit pouvoir voir :

- période concernée ;
- cible avant ;
- cible proposée ;
- impact total estimé.

Exemple de structure :

```text
Période :
16:30 → 18:40

Avant :
hydration = H

Proposition :
hydration = H_hot

Impact :
+ X ml sur cette période
```

Les nombres proviennent de la stratégie / configuration utilisateur, pas d’une règle météo improvisée.

---

# 68. Période Conditions correcte

Une Condition météo / Nuit utilisée par Nutrition doit avoir :

- un début ;
- une fin.

Interdit :

```text
cold starts at Rawil
→ apply until finish
```

si la Condition détectée s’arrête avant.

La plage Nutrition doit suivre la vraie période proposée / acceptée.

---

# 69. Changement de forecast

Si un nouveau forecast modifie une `condition_period` déjà utilisée :

- ne pas modifier silencieusement `nutrition_condition_ranges` ;
- créer une nouvelle proposition ;
- montrer le diff ;
- laisser l’utilisateur appliquer ou conserver.

Les anciennes décisions utilisateur restent auditables.

---

# 70. Sortie test liée à une course

Pour une sortie liée à une Race Pass / PLUKA+ :

l’utilisateur peut :

1. reprendre une stratégie de course ;
2. l’adapter à la durée / trace de la sortie ;
3. tester ses produits ;
4. enregistrer un feedback ;
5. obtenir après la sortie des changements potentiels à revoir.

Le passage :

```text
outing feedback
→ race nutrition
```

est toujours :

```text
proposition
→ confirmation
```

Jamais application automatique.

---

# 71. Templates / Bibliothèque

Une stratégie réutilisable peut servir de source :

```text
strategy_template
```

pour :

- cibles ;
- conditions ;
- produits préférés ;
- réserve ;
- placement.

Un template n’est pas une stratégie active.

Lorsqu’il est appliqué :

- les valeurs sont copiées / snapshotées ;
- une modification ultérieure du template ne change pas rétroactivement la course.

---

# 72. Contrat TypeScript principal

Package :

```text
packages/nutrition-engine
```

API principale :

```ts
generateNutritionPlan(
  input: NutritionGenerationInput
): NutritionGenerationResult
```

Autres opérations pures :

```ts
recalculateNutritionPlan(...)
computeNutritionNeeds(...)
generateNutritionWaypoints(...)
allocateNutritionProducts(...)
computeNutritionCoverage(...)
computePreparationSummary(...)
diffNutritionPlans(...)
```

Le package :

- ne dépend pas de React ;
- ne dépend pas de Next.js ;
- ne dépend pas de Supabase ;
- ne dépend pas du provider météo ;
- ne dépend pas d’un LLM ;
- ne fait aucun appel réseau.

---

# 73. Structure d’entrée indicative

```ts
type NutritionGenerationInput = {
  timeline: NutritionTimelineSnapshot

  targets: {
    carbsGPerHour: number
    hydrationMlPerHour: number
    sodiumMgPerHour: number
    caffeineTotalMg: number | null
  }

  conditions: NutritionConditionInput[]

  selectedProducts: NutritionProductSnapshot[]

  aidStations: NutritionAidStationInput[]

  existingStrategy?: NutritionExistingStrategySnapshot

  settings: {
    placementMode: 'smart' | 'interval'
    intervalSeconds?: number
    reservePercent: number
  }

  engineConfig: NutritionEngineConfig
}
```

---

# 74. Condition input indicative

```ts
type NutritionConditionInput = {
  type: 'hot' | 'cold' | 'night'

  ranges: Array<{
    id: string
    source: 'manual' | 'weather_proposal' | 'strategy_template'

    sourceConditionPeriodId?: string | null

    startElapsedSeconds: number
    endElapsedSeconds: number

    carbsGPerHour?: number | null
    hydrationMlPerHour?: number | null
    sodiumMgPerHour?: number | null

    caffeineDistributionWeight?: number
  }>
}
```

---

# 75. Aid station input

```ts
type NutritionAidStationInput = {
  pointId: string
  elapsedSeconds: number
  plannedAt: string | null

  items: Array<{
    product: NutritionProductSnapshot
    availabilityNotes?: string | null
  }>
}
```

L’existence d’un item n’oblige jamais l’utilisateur à le consommer.

---

# 76. Sortie du moteur

```ts
type NutritionGenerationResult = {
  status: 'ok' | 'error'

  effectiveTargetIntervals: NutritionTargetInterval[]

  cumulativeNeeds: NutritionNeedSeries
  sectionSummaries: NutritionSectionSummary[]

  waypoints: NutritionWaypointResult[]

  coverage: NutritionCoverageSummary
  preparation: NutritionPreparationSummary

  warnings: NutritionIssue[]
  conflicts: NutritionIssue[]

  metadata: {
    engineVersion: string
    engineConfigVersion: string
    inputHash: string
    scopeType: 'race_plan' | 'outing'
    generatedAt?: string
  }
}
```

`generatedAt` est ajouté par l’orchestrateur ; il ne doit pas influencer le calcul.

---

# 77. NutritionWaypointResult

Concept minimum :

```ts
type NutritionWaypointResult = {
  stableKey: string

  origin:
    | 'auto'
    | 'merged_race_waypoint'
    | 'manual'

  planWaypointId: string | null
  outingWaypointId: string | null

  label: string

  elapsedSeconds: number
  plannedAt: string | null

  distanceKm: number | null
  latitude: number | null
  longitude: number | null

  isCustomized: boolean
  isLocked: boolean

  needsSincePrevious: NutritionVector
  items: NutritionWaypointItemResult[]
  coverage: NutritionCoverageVector
}
```

---

# 78. Item result

```ts
type NutritionWaypointItemResult = {
  product: NutritionProductSnapshot

  action: 'consume' | 'refill' | 'carry'

  quantity: number
  unit: string | null

  contributions: {
    carbsG: number
    hydrationMl: number
    sodiumMg: number
    caffeineMg: number
  }

  customized: boolean
}
```

---

# 79. Input hash

Même principe que Plan Engine :

1. payload canonique ;
2. pas de timestamp volatil ;
3. ordre stable des collections ;
4. snapshots produits inclus ;
5. targets incluses ;
6. Conditions incluses ;
7. version de timeline incluse ;
8. config version incluse ;
9. SHA-256 hex.

Même input logique + mêmes versions = même résultat.

---

# 80. Versionnement

Persistances minimales recommandées :

```text
engine_version
engine_config_version
input_hash
input_snapshot
generated_at
confirmed_at
```

Le moteur doit pouvoir expliquer :

- quelle version de RacePlan a été utilisée ;
- quelles cibles ;
- quelles Conditions ;
- quels snapshots de produits ;
- quelle configuration de placement.

---

# 81. Mapping vers le Data Model actuel

Tables actuelles principales :

```text
nutrition_plans
nutrition_conditions
nutrition_condition_ranges
nutrition_waypoints
nutrition_waypoint_items
nutrition_products
user_nutrition_products
race_aid_station_items
condition_periods
condition_proposals
```

Le moteur pur ne connaît pas ces tables.

Le service de domaine assure le mapping.

---

# 82. Écart identifié avec le schéma SQL actuel

**Important avant implémentation Nutrition.**

Le schéma `0001_initial_schema.sql` actuel permet la stratégie de base, mais ne persiste pas encore toutes les informations nécessaires aux invariants de cette spec.

Avant le lot Nutrition, une migration corrective doit être préparée.

Minimum à prévoir / confirmer :

### `nutrition_plans`

Ajouter ou équivalent :

```text
engine_config_version
input_snapshot
input_hash
generated_at
confirmed_at
```

### `nutrition_waypoints`

Ajouter ou équivalent :

```text
origin
stable_key
is_customized
is_locked
distance_km
latitude / longitude ou position projetable
```

Un jalon virtuel doit être localisable sans dépendre d’un waypoint officiel.

### `nutrition_waypoint_items`

Les contributions sont déjà snapshotées numériquement dans le schéma actuel.

Ajouter cependant, si nécessaire à la reproductibilité de l’affichage :

```text
product_snapshot / product_label_snapshot
customized
```

### Diff / recalcul

Prévoir un objet persistant permettant de conserver :

```text
old nutrition state
new proposed state
diff
status proposed / applied / rejected
```

Le nom peut être :

```text
nutrition_recalculations
```

ou un mécanisme de version / proposition équivalent.

Cette migration doit ensuite mettre à jour `02_DATA_MODEL.md`.

Claude Code ne doit pas contourner ces besoins en mettant toute la logique de préservation uniquement dans l’état React.

---

# 83. Entitlements

Le moteur ne connaît pas :

- Free ;
- Race Pass ;
- PLUKA+ ;
- Organizer Included.

Le domaine vérifie le droit avant :

- activation Nutrition ;
- génération avancée ;
- sortie Nutrition ;
- réutilisation de stratégie.

Le moteur reçoit seulement une commande autorisée.

---

# 84. Confidentialité

Nutrition est privée.

L’organisation ne peut pas lire :

- cibles ;
- produits ;
- jalons ;
- caféine ;
- quantités ;
- réserve ;
- couverture ;
- feedback Nutrition.

L’Assistance peut voir uniquement les items explicitement projetés dans un rendez-vous.

Race Intelligence ne doit pas publier des stratégies Nutrition individuelles.

---

# 85. Analytics

Ne pas envoyer dans les analytics B2B :

- `75 g/h` d’un utilisateur ;
- produit précis d’un utilisateur ;
- dose caféine ;
- quantité de sodium ;
- contenu individuel d’un sac.

Des métriques produit internes peuvent compter :

- Nutrition activée ;
- stratégie confirmée ;
- recalcul accepté ;

sans recopier le contenu sensible.

---

# 86. Erreurs et warnings

| Code | Niveau | Comportement |
|---|---|---|
| `NUTRITION_TIMELINE_MISSING` | ERROR | impossible de calculer |
| `INVALID_TARGET` | ERROR | cible structurellement invalide |
| `CONDITION_RANGE_INVALID` | ERROR | plage invalide |
| `HOT_COLD_OVERLAP` | CONFLICT | correction requise |
| `RANGE_TRUNCATED` | WARNING | plage tronquée |
| `PRODUCT_DATA_INCOMPLETE` | WARNING | couverture partielle |
| `NO_SELECTED_PRODUCTS` | INFO | besoins calculés, allocation non complète |
| `TARGET_COVERAGE_GAP` | INFO/WARNING | cible utilisateur non couverte |
| `WAYPOINT_CUSTOMIZED_CONFLICT` | WARNING | recalcul en conflit avec personnalisation |
| `PRODUCT_REASSIGNMENT_REQUIRED` | WARNING | produit devenu orphelin |
| `ASSISTANCE_LOGISTICS_CONFLICT` | WARNING | fourniture Assistance incohérente |
| `AID_STATION_DATA_UNCERTAIN` | INFO | valeur / disponibilité estimée |
| `CONDITION_UPDATE_AVAILABLE` | INFO | nouvelle proposition Conditions |
| `INTERVAL_MODE_INVALID` | ERROR | cadence avancée invalide |

---

# 87. Déterminisme

À :

```text
même input logique
+
même engine_version
+
même engine_config_version
```

le moteur doit produire :

- mêmes besoins ;
- mêmes jalons auto ;
- mêmes stable keys ;
- même allocation produit ;
- même couverture ;
- même préparation hors timestamp technique.

Interdits :

- random ;
- Date.now dans le calcul ;
- LLM ;
- appel météo ;
- lecture catalogue en cours de calcul ;
- ordre non stable des produits.

---

# 88. Performance

Objectif qualitatif V1 :

- génération interactive sur une course standard ;
- recalcul suffisamment rapide pour une preview / diff ;
- pas de calcul sur chaque point GPX brut ;
- calcul sur timeline, sections et jalons.

L’allocateur produit doit être borné.

Si le nombre de produits sélectionnés est très élevé :

- appliquer les limites de recherche versionnées ;
- produire le meilleur résultat trouvé selon l’heuristique ;
- ne pas bloquer l’application.

---

# 89. Tests fondamentaux — besoins

## N01 — Cible constante

10 h avec :

```text
carbs = C
hydration = H
sodium = S
```

Attendu :

```text
carbs total = 10 × C
hydration total = 10 × H
sodium total = 10 × S
```

sans arrondi intermédiaire.

---

## N02 — Condition partielle

Plage Chaud :

```text
04:10 → 10:40
```

Attendu :

seules les dimensions renseignées utilisent les valeurs spécifiques sur cette plage.

---

## N03 — Condition au milieu d’une section

Attendu :

proratisation exacte sur les sous-intervalles.

---

## N04 — Nuit + froid

Attendu :

- froid agit sur ses dimensions ;
- nuit agit sur caféine ;
- composition correcte.

---

## N05 — Chaud + froid

Attendu :

```text
HOT_COLD_OVERLAP
```

avant confirmation.

---

# 90. Tests caféine

## N06 — Total stable

Une plage Nuit modifie `W(t)`.

Attendu :

```text
sum theoretical caffeine = C_total
```

---

## N07 — Pas de cible

`caffeineTotalMg = null`.

Attendu :

- distribution cible désactivée ;
- caféine réelle des produits toujours comptable.

---

## N08 — Poids Nuit = 1

Attendu :

aucune différence avec distribution de base.

---

# 91. Tests jalons

## N09 — Fusion ravito

Candidat à moins de 10 min d’un ravito.

Attendu :

fusion selon la config V1.

---

## N10 — Jalon manuel

Recalcul du Plan.

Attendu :

jalon conservé.

---

## N11 — Jalon auto

Petite variation de pacing.

Attendu :

jalon auto non personnalisé peut être déplacé dans le diff.

---

## N12 — Stable key

Deux générations identiques.

Attendu :

mêmes stable keys.

---

## N13 — Mode intervalle

Cadence utilisateur valide.

Attendu :

candidats réguliers puis fusion ravito selon config.

---

# 92. Tests produits

## N14 — Boisson iso

Produit :

```text
35 g carbs
500 ml hydration
450 mg sodium
```

Attendu :

une portion contribue une seule fois à ces trois dimensions.

---

## N15 — Eau

500 ml.

Attendu :

```text
hydration += 500
```

et aucune autre dimension.

---

## N16 — Produit générique

Aliment de ravito avec estimation.

Attendu :

- contribution utilisée ;
- `estimated = true`.

---

## N17 — Snapshot

Modifier le catalogue après confirmation.

Attendu :

ancienne stratégie conserve les valeurs snapshotées.

---

# 93. Tests couverture

## N18 — Couverture parfaite

Produits = cibles.

Attendu :

gap nul.

---

## N19 — Sous-couverture

Produits sélectionnés insuffisants.

Attendu :

```text
TARGET_COVERAGE_GAP
```

Le moteur n’ajoute pas un produit hors sélection.

---

## N20 — Correction

Demander une correction.

Attendu :

proposition parmi les produits sélectionnés, sans modifier les cibles.

---

## N21 — Produit imposé

Produit personnalisé générant une sur-couverture.

Attendu :

produit conservé ; sur-couverture affichée.

---

# 94. Tests réserve

## N22 — Réserve 0 %

Attendu :

```text
prepare = planned
```

---

## N23 — Réserve 10 %

Attendu :

`À préparer` augmente selon la granularité.

La couverture consommation reste inchangée.

---

## N24 — Réserve et caféine

Attendu :

la caféine contenue dans la réserve n’est pas comptée comme caféine planifiée.

---

# 95. Tests recalcul

## N25 — Plan modifié

Ancien waypoint :

```text
08:40
```

Nouveau :

```text
08:47
```

Attendu :

diff explicite.

---

## N26 — Jalon personnalisé

Nouveau pacing change fortement la section.

Attendu :

aucun déplacement silencieux.

---

## N27 — Produit orphelin

Jalon auto proposé à suppression avec 2 gels affectés.

Attendu :

```text
PRODUCT_REASSIGNMENT_REQUIRED
```

Les gels ne disparaissent pas.

---

## N28 — Course raccourcie

Des jalons dépassent désormais l’arrivée.

Attendu :

suppression proposée + conservation / réaffectation des items.

---

# 96. Tests Conditions météo

## N29 — Proposition non acceptée

Condition météo chaude détectée.

Attendu :

aucune modification Nutrition active.

---

## N30 — Profil chaud existant accepté

Période :

```text
14:20 → 17:05
```

Attendu :

application strictement sur cette période.

---

## N31 — Fin de période

Froid cesse à 18:40.

Attendu :

la cible froide revient à la cible normale à 18:40.

Jamais « jusqu’à l’arrivée » par défaut.

---

## N32 — Forecast révisé

Nouvelle période différente.

Attendu :

nouvelle proposition ; stratégie existante inchangée tant que non confirmée.

---

# 97. Tests Outing

## N33 — Outing sans date

Attendu :

Nutrition fonctionne sur elapsed time.

---

## N34 — Outing avec météo

Date / heure / Conditions disponibles.

Attendu :

même pipeline de ConditionProposal que Race.

---

## N35 — Sortie test

Adapter une stratégie Race sur une Outing.

Attendu :

la Race originale reste inchangée.

---

# 98. Tests Assistance / préparation

## N36 — À préparer

Somme exacte des items confirmés + réserve séparée.

---

## N37 — Répartition destinations

Attendu :

```text
start + bags + assistance + unassigned
=
prepare total
```

---

## N38 — Conflit Assistance

Produit nécessaire avant son futur point de fourniture.

Attendu :

warning logistique.

---

# 99. Tests sécurité

1. Une organisation ne peut pas lire Nutrition via RLS.
2. Un autre coureur ne peut pas lire Nutrition.
3. Un assistant ne reçoit que les items explicitement exposés.
4. Un lien Assistant ne révèle pas les cibles.
5. Les analytics B2B ne contiennent aucun contenu Nutrition individuel.
6. `service_role` ne remplace pas les contrôles métier serveur.
7. Un produit privé reste privé.
8. Les ConditionProposals appartiennent au bon user / scope.

---

# 100. Calibration V1

La calibration porte sur :

- placement des jalons ;
- stabilité du diff ;
- fusion ravito ;
- comportement de l’allocateur discret ;
- clarté de la couverture ;
- ergonomie de la réserve.

Elle ne porte pas sur :

- « trouver le bon g/h » pour le coureur ;
- « trouver le bon sodium » ;
- prescrire de la caféine.

---

# 101. Protocole de calibration

Utiliser environ :

- 10 à 20 parcours ;
- formats courts à ultra ;
- faible / fort D+ ;
- nombreuses / rares opportunités de ravitaillement ;
- objectifs temporels différents.

Mesurer notamment :

- nombre de jalons générés ;
- taux de jalons déplacés par les testeurs ;
- taux de fusion ravito ;
- nombre de corrections produit nécessaires ;
- stabilité lors d’une variation légère du pacing ;
- nombre de produits orphelins après recalcul.

Toute évolution d’heuristique modifie :

```text
engine_config_version
```

Une évolution de contrat / sens métier modifie :

```text
engine_version
```

---

# 102. Organisation du package recommandée

```text
packages/nutrition-engine/
├── src/
│   ├── index.ts
│   ├── contracts.ts
│   ├── config.ts
│   ├── validation.ts
│   ├── target-profile.ts
│   ├── conditions.ts
│   ├── needs.ts
│   ├── caffeine.ts
│   ├── waypoint-generator.ts
│   ├── waypoint-matcher.ts
│   ├── product-allocator.ts
│   ├── coverage.ts
│   ├── preparation.ts
│   ├── diff.ts
│   ├── hash.ts
│   └── issues.ts
│
└── tests/
    ├── fixtures/
    ├── needs.test.ts
    ├── conditions.test.ts
    ├── caffeine.test.ts
    ├── waypoint-generator.test.ts
    ├── product-allocator.test.ts
    ├── coverage.test.ts
    ├── reserve.test.ts
    ├── diff.test.ts
    ├── determinism.test.ts
    └── acceptance.test.ts
```

---

# 103. Commands applicatives associées

La couche domaine peut exposer :

```text
activateNutrition
setNutritionTargets
selectNutritionProducts
generateNutritionStrategy
updateNutritionWaypoint
moveNutritionWaypoint
lockNutritionWaypoint
removeNutritionWaypoint
assignNutritionProduct
updateNutritionQuantity
setNutritionReserve
setNutritionConditionRange
applyConditionProposal
dismissConditionProposal
requestNutritionCorrection
applyNutritionDiff
reuseNutritionStrategy
adaptRaceStrategyToOuting
```

Chaque commande :

- vérifie le scope ;
- vérifie l’entitlement ;
- reconstruit un input autorisé ;
- appelle le moteur ;
- persiste après confirmation ;
- ne contourne pas les protections de personnalisation.

---

# 104. UI : résultats nécessaires

Le moteur doit permettre à l’UI de construire :

### Ma stratégie

- cibles ;
- totaux ;
- couverture ;
- réserve.

### Par section

- besoins ;
- produits ;
- ravitos ;
- remplissage / emport.

### Profil

- jalons projetés sur le parcours.

### Ravito

- À consommer ici ;
- À remplir ;
- À emporter.

### À préparer

- quantités ;
- réserve ;
- sacs ;
- Assistance ;
- manquants.

Le moteur ne décide pas :

- de la mise en page ;
- des couleurs ;
- du wording marketing ;
- du paywall.

---

# 105. Terminologie utilisateur

Préférer :

- ta cible
- stratégie
- besoin prévu
- couverture
- à compléter
- presque atteint
- dans ta cible
- au-dessus de ta cible définie
- proposition PLUKA
- voir l’impact
- appliquer
- conserver ma stratégie
- estimation
- à préparer

Éviter :

- dose optimale
- prescription
- PLUKA recommande médicalement
- quantité parfaite
- nutrition idéale
- tu dois consommer
- sécurité garantie

---

# 106. Non-régression obligatoire

Une évolution ne peut être mergée si elle :

- modifie une cible utilisateur sans action explicite ;
- double-compte une boisson ;
- compte la réserve comme consommation ;
- augmente la caféine totale à cause de la Nuit ;
- applique une Condition météo sans confirmation ;
- étend une Condition jusqu’à l’arrivée sans justification ;
- déplace un jalon personnalisé ;
- supprime silencieusement un produit ;
- sélectionne un produit non autorisé par le coureur ;
- transforme une valeur générique estimée en valeur officielle ;
- modifie une stratégie Race depuis une Outing sans confirmation ;
- introduit un LLM dans le calcul ;
- dépend d’une fixture du prototype comme règle métier.

---

# 107. Critères d’acceptation pour Claude Code

Le moteur Nutrition V1 est considéré correctement implémenté lorsque :

1. le package tourne sans Next.js ;
2. le package tourne sans Supabase ;
3. aucun appel réseau n’est nécessaire ;
4. aucun LLM n’intervient ;
5. le même input produit le même résultat ;
6. les cibles sont toujours celles du coureur ;
7. les besoins sont intégrés sur le temps ;
8. Chaud / Froid ne remplacent que les dimensions définies ;
9. Nuit ne modifie jamais automatiquement le total caféine ;
10. les plages sont proratisées exactement ;
11. Chaud + Froid en chevauchement est détecté ;
12. les produits sont choisis avant l’allocation avancée ;
13. une boisson contribue correctement à plusieurs dimensions sans double comptage ;
14. l’eau est gérée en volume ;
15. les produits génériques peuvent être marqués estimés ;
16. les ravitos sont utilisés comme opportunités mais jamais inventés ;
17. le mode Smart ne repose pas uniquement sur une cadence fixe ;
18. le mode Intervalle reste une option utilisateur avancée ;
19. les jalons auto possèdent une stable key ;
20. les jalons personnalisés sont protégés ;
21. les produits personnalisés sont protégés ;
22. un changement de Plan produit un diff avant application ;
23. un produit orphelin n’est jamais supprimé ;
24. la couverture est calculée par dimension ;
25. une sous-couverture ne change pas la cible ;
26. « Proposer une correction » reste dans les produits autorisés ;
27. la réserve augmente la préparation mais pas la consommation ;
28. `À préparer` se répartit entre départ / sacs / Assistance / non affecté ;
29. l’Assistance ne voit que les items nécessaires ;
30. une proposition météo n’est jamais appliquée automatiquement ;
31. une période météo a toujours une vraie fin ;
32. la Nuit peut provenir de l’astronomie sans inventer de dose ;
33. Nutrition fonctionne aussi sur Outing ;
34. une Outing liée ne modifie jamais la Race automatiquement ;
35. les snapshots produits rendent l’historique reproductible ;
36. `input_hash`, `engine_version` et `engine_config_version` sont persistables ;
37. l’organisation n’a aucun accès au détail Nutrition ;
38. les tests N01–N38 passent.

---

# 108. Blocage à traiter avant le lot Nutrition

Avant de coder l’ensemble de la personnalisation / recalcul Nutrition, aligner le schéma SQL avec la section **82 — Écart identifié avec le schéma SQL actuel**.

Ce point est important : la spec fonctionnelle exige la préservation et le diff, alors que le schéma initial actuel ne possède pas encore tous les champs nécessaires pour les représenter proprement.

Ne pas résoudre ce décalage en stockant des états importants uniquement dans le frontend.

---

# 109. Consigne finale

Le moteur Nutrition V1 n’a pas pour mission de dire :

> **« Voilà ce que tu dois manger. »**

Il doit dire :

> **« Voilà comment les objectifs et produits que tu as choisis se répartissent concrètement sur ton Plan, ce qui est couvert, ce qui manque et ce qu’il faut préparer. »**

Le cœur de valeur est donc :

```text
CIBLES CHOISIES
+
PLAN / SORTIE
+
PRODUITS CHOISIS
+
CONDITIONS VALIDÉES
↓
STRATÉGIE OPÉRATIONNELLE
```

avec trois règles absolues :

> **Pas de prescription cachée.**

> **Pas de personnalisation écrasée.**

> **Pas de modification automatique issue de la météo ou d’une sortie test.**

---

**Fin — PLUKA Nutrition Engine V1**
