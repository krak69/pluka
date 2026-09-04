# PLUKA — Weather Conditions Engine V1

**Fichier de référence :** `docs/engines/WEATHER_CONDITIONS.md`  
**Statut :** Spécification fonctionnelle et technique de référence — V1  
**Date de consolidation :** 2026-09-03  
**Version moteur de départ :** `conditions-v1.0.0`  
**Principe :** la météo suit le Plan ; elle informe et propose, elle ne modifie jamais silencieusement la préparation

---

# 0. Rôle de ce document

Ce document définit la fonctionnalité **Conditions de course** de PLUKA et son moteur associé.

PLUKA ne doit pas afficher une météo générique de ville.

La valeur produit est :

> **croiser le parcours, l’altitude et l’heure de passage personnelle pour montrer les conditions que le coureur devrait rencontrer là où il devrait se trouver au moment où il devrait y être.**

Le moteur transforme :

```text
TRACE / POINTS DU PARCOURS
+
PLAN / TIMELINE
+
DATE ET HEURE
+
PRÉVISION MÉTÉO EXTERNE
+
ASTRONOMIE UTILE
```

en :

```text
CONDITIONS POINT PAR POINT
+
PÉRIODES SIGNIFICATIVES
+
POINTS À SURVEILLER
+
PROPOSITIONS NUTRITION / PRÉPARATION
```

Cette fonctionnalité est une **couche du Plan**.

Elle ne constitue pas un cinquième onglet principal de course.

---

## 0.1 Documents de référence

Cette spec complète :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/03_PRIVACY_RLS.md`
- `docs/04_ENTITLEMENTS.md`
- `docs/engines/PLAN_ENGINE.md`
- `docs/engines/NUTRITION_ENGINE.md`
- `docs/ACCEPTANCE_CRITERIA.md`

Le prototype figé sert de référence UX/UI, jamais de référence pour :

- les seuils de détection météo ;
- les règles scientifiques ;
- le choix du provider ;
- une correction d’altitude ;
- une confiance numérique.

### Ordre de priorité

En cas de contradiction :

1. `00_PRODUCT_SPEC.md` fait foi sur le produit ;
2. ce document fait foi sur Conditions ;
3. `PLAN_ENGINE.md` fait foi sur les ETA ;
4. `NUTRITION_ENGINE.md` fait foi sur l’application Nutrition d’une Condition ;
5. `01_ARCHITECTURE.md` fait foi sur les frontières techniques ;
6. `02_DATA_MODEL.md` et les migrations font foi sur la persistance existante ;
7. le prototype fait foi sur l’intention UX.

Une contradiction doit être signalée, jamais arbitrée silencieusement dans le code.

---

# 1. Décision structurante

> **La météo est projetée sur le Plan ; le Plan n’est pas recalculé à partir de la météo.**

Pipeline canonique :

```text
Plan / Outing timeline
↓
points significatifs du parcours
↓
plannedDatetime
↓
WeatherProvider
↓
forecast normalisé
↓
ConditionPeriods
↓
résumé / vigilances
↓
ConditionProposals
↓
validation utilisateur
↓
Nutrition / Préparation
```

Interdit :

```text
Météo
→ changement automatique de pacing
```

Interdit :

```text
Météo
→ changement automatique de cible Nutrition
```

Interdit :

```text
Météo
→ ajout automatique de matériel obligatoire
```

---

# 2. Objectifs V1

Le moteur doit :

1. respecter strictement la fenêtre J-14 ;
2. ne montrer aucune tendance personnalisée avant J-14 ;
3. fonctionner sur une Race avec Plan ;
4. fonctionner sur une Outing datée ;
5. associer chaque forecast visible à une vraie date/heure de passage ;
6. associer chaque forecast à la latitude, longitude et altitude de parcours ;
7. produire une météo point par point sur des points utiles, pas sur tous les points GPX ;
8. créer des points virtuels si une portion significative du parcours manque de repère ;
9. présenter température, ressenti, précipitations, vent, rafales et condition ;
10. produire des périodes continues significatives ;
11. traiter la Nuit comme une Condition astronomique indépendante de la météo ;
12. recalculer / remapper les Conditions quand le Plan change ;
13. distinguer prévision externe, interprétation PLUKA et décision officielle ;
14. conserver les forecast runs comme snapshots auditables ;
15. ne jamais inventer une valeur indisponible ;
16. proposer des impacts Nutrition / Préparation uniquement avec validation utilisateur ;
17. alimenter Assistance avec une information compacte ;
18. alimenter le mode Jour J avec le prochain point utile ;
19. alimenter Demander à PLUKA avec données et timestamp de mise à jour ;
20. fournir une couche exploitable par Race Intelligence sous forme agrégée uniquement ;
21. rester indépendant du fournisseur météo concret ;
22. être testable, versionné et observable.

---

# 3. Hors périmètre V1

Le moteur ne fait pas :

- radar météo interactif ;
- nowcasting hyperlocal propriétaire ;
- prévision au mètre ;
- prévision à chaque point GPS ;
- live tracking ;
- position réelle du coureur ;
- changement automatique de Plan ;
- recommandation médicale ;
- calcul scientifique de risque d’hypothermie ;
- prédiction d’orage locale garantie ;
- avalanche ;
- niveau de rivière ;
- état réel du sentier ;
- enneigement détaillé si le provider ne fournit pas une donnée fiable ;
- conseil de sécurité certifié ;
- décision de kit froid ;
- décision de modification de parcours ;
- décision d’annulation ;
- score de confiance fictif ;
- tendance au-delà de J-14 ;
- correction générique d’altitude codée en frontend.

Les notions avancées neige / gel / orage peuvent être ajoutées plus tard si la donnée fournisseur et le besoin produit sont validés.

---

# 4. Terminologie

## 4.1 Prévision météo

Donnée issue d’un provider externe.

Exemples :

- température ;
- ressenti ;
- probabilité de précipitation ;
- quantité de précipitation ;
- vent ;
- rafale.

Elle n’est jamais qualifiée d’**Officielle PLUKA**.

## 4.2 Condition

Interprétation PLUKA d’une ou plusieurs données météo / astronomiques sur une période.

Types V1 :

```text
heat
cold
cold_wind
rain
night
other
```

## 4.3 ConditionPeriod

Période continue significative :

```text
start
→ end
```

Elle possède toujours une vraie fin.

## 4.4 ConditionProposal

Proposition personnalisée à appliquer à :

```text
nutrition
```

ou :

```text
preparation
```

Une proposal n’est jamais appliquée automatiquement.

## 4.5 Décision officielle

Information publiée par une organisation autorisée.

Exemples :

- kit froid obligatoire ;
- kit chaud ;
- parcours de repli ;
- changement de départ ;
- annulation ;
- consigne de sécurité.

Elle est distincte de toute prévision PLUKA.

---

# 5. Hiérarchie de confiance

L’interface et le domaine doivent respecter :

```text
1. Décision officielle de l’organisation
2. Information de course officielle / publiée
3. Prévision météo externe
4. Interprétation PLUKA
5. Suggestion PLUKA
6. Choix final utilisateur
```

Exemple :

```text
DÉCISION ORGANISATEUR
Kit froid obligatoire

PRÉVISION
4 °C · ressenti 1 °C · rafales 38 km/h

SUGGESTION PLUKA
Vérifie tes gants et ta couche chaude
```

Ces trois éléments ne doivent jamais être présentés comme ayant la même autorité.

---

# 6. Règle J-14

## 6.1 Définition

Les Conditions personnalisées sont disponibles lorsque :

```text
0 <= days_to_start <= 14
```

Le calcul doit être fait à partir de la date/heure locale de départ du scope concerné.

Pour une Race :

```text
effective_start_datetime
```

Pour une Outing :

```text
outing.planned_start_datetime
```

Le serveur doit être la source de vérité.

L’UI ne doit pas pouvoir contourner cette règle.

---

# 7. Avant J-14

Avant J-14 :

- aucun forecast point personnalisé ;
- aucune température ;
- aucune tendance ;
- aucune probabilité de pluie ;
- aucun “il devrait faire…” ;
- aucune suggestion basée sur une prévision lointaine.

Le produit peut afficher :

> **Conditions disponibles à partir de J-14.**

ou la date exacte d’ouverture.

---

# 8. Exception : informations officielles

La règle J-14 ne bloque jamais :

- alerte officielle ;
- kit froid officiel ;
- kit chaud officiel ;
- changement de parcours ;
- consigne sécurité ;
- annulation ;
- autre notice organisateur.

Ces informations sont des `race_notices` / facts officiels, pas des Conditions personnalisées.

Elles restent accessibles au Free.

---

# 9. Horizon qualitatif

Aucun pourcentage de confiance météo ne doit être inventé.

Libellés V1 :

| Jours avant départ | Libellé |
|---|---|
| J-14 à J-8 | `Prévision lointaine · à confirmer` |
| J-7 à J-4 | `Prévision intermédiaire` |
| J-3 à J-1 | `Prévision rapprochée` |
| Jour J | `Dernière actualisation` |

Ces libellés sont qualitatifs.

Ils ne remplacent pas le timestamp réel :

```text
Mis à jour à 18:20
```

---

# 10. Entitlements

Le moteur Conditions ne définit pas lui-même les offres.

Le service `EntitlementService` décide si l’utilisateur peut demander / lire une Conditions personnalisée.

Règles fonctionnelles :

## Free

- pas de prévision personnalisée PLUKA ;
- alertes officielles toujours accessibles.

## Race Pass

- Conditions sur la course achetée ;
- Conditions sur les 2 sorties liées autorisées.

## PLUKA+

- Conditions sur toutes les courses éligibles ;
- Conditions sur toutes les sorties personnelles éligibles.

## Organizer Included

- Conditions sur la course financée ;
- Conditions sur les sorties liées prévues par l’offre ;
- pas de sorties personnelles illimitées hors course.

Les droits sont vérifiés côté serveur.

---

# 11. Prérequis Race

Pour générer Conditions sur une Race :

1. participant autorisé ;
2. Race dans la fenêtre J-14 ;
3. Plan actif ;
4. heure de départ résolue ;
5. ETA valides ;
6. trace / géométrie exploitable ;
7. points géolocalisables ;
8. timezone de la Race ;
9. provider disponible.

Si le Plan n’existe pas :

> **Crée ton Plan pour voir les conditions selon tes heures de passage.**

---

# 12. Prérequis Outing

Pour une Outing :

### Pas de date

Afficher :

> **Ajoute une date pour voir les conditions prévues.**

### Date > J-14

Afficher :

> **Conditions disponibles à partir de J-14.**

Aucune tendance.

### Date <= J-14 mais heure absente

Afficher :

> **Ajoute ton heure de départ pour voir les conditions le long de ta sortie.**

### Données suffisantes

Minimum fonctionnel :

- date ;
- heure de départ ;
- trace / parcours ;
- durée prévue ;
- entitlement valide.

Alors Conditions peut être généré.

---

# 13. Référentiel temporel

Le moteur Conditions travaille avec de vraies dates/heures.

Interdit comme frontière provider :

```text
plannedDatetime = 1028 minutes
```

Attendu :

```text
2026-09-11T17:08:00+02:00
```

En stockage PostgreSQL :

```text
timestamptz
```

La timezone IANA du scope reste également conservée.

---

# 14. Multi-jour

Le système doit gérer :

- passage après minuit ;
- date suivante ;
- course > 24 h ;
- ultra multi-jour ;
- heure d’été / timezone locale lorsque applicable.

Un point météo possède toujours son instant réel.

---

# 15. Timeline Race

Le moteur reçoit un snapshot d’une version précise de `RacePlan`.

Il utilise :

- `race_plan_id` ;
- départ effectif ;
- PlanWaypoints ;
- ETA ;
- PlanSegments ;
- géométrie Race ;
- RaceWaypoints ;
- altitude du parcours.

Un forecast run n’est jamais lié conceptuellement à “la participation courante” sans version de Plan.

Il correspond à une version réelle de Plan.

---

# 16. Timeline Outing

Le moteur reçoit :

- `outing_id` ;
- `planned_start_datetime` ;
- durée prévue ;
- géométrie / GPX ;
- outing waypoints ;
- éventuels points eau / ravito / sommet / col ;
- timezone.

Comme `outing` n’est pas versionnée de la même façon qu’un RacePlan dans le schéma initial, `input_hash` doit permettre d’identifier le snapshot logique utilisé.

---

# 17. Point météo

Contrat canonique :

```ts
type WeatherRoutePoint = {
  pointKey: string

  sourceType:
    | 'race_waypoint'
    | 'outing_waypoint'
    | 'virtual_checkpoint'

  raceWaypointId?: string | null
  outingWaypointId?: string | null
  virtualSegmentId?: string | null

  label: string

  distanceKm: number
  latitude: number
  longitude: number
  routeAltitudeM: number | null

  plannedDatetime: string
  elapsedSeconds: number
}
```

`pointKey` est unique dans un run.

---

# 18. Points visibles

Les Conditions point par point doivent s’appuyer sur des points utiles.

Ordre de priorité conceptuel :

1. départ ;
2. waypoints du Plan ;
3. ravitos ;
4. points eau ;
5. Assistance ;
6. sommets / cols ;
7. arrivée ;
8. points virtuels si nécessaire.

Il ne faut pas afficher la météo pour chaque point du GPX.

---

# 19. Point virtuel

Un point virtuel est créé lorsqu’une portion du parcours est trop longue pour qu’une lecture météo uniquement aux waypoints existants reste utile.

Il doit :

- être situé sur la vraie trace ;
- avoir ses propres coordonnées ;
- avoir sa propre altitude ;
- avoir sa propre ETA interpolée à partir du Plan / timeline ;
- avoir un `pointKey` unique ;
- rester identifiable comme point interne.

Exemple de clé :

```text
weather-mid-seg-05-01
```

Interdit :

```text
wxmid
```

réutilisé pour plusieurs points.

---

# 20. Densité des points virtuels

Le **seuil numérique exact** de création de points virtuels n’est pas figé dans les documents fonctionnels actuels.

Il ne doit donc pas être inventé comme vérité métier dans cette spec.

L’implémentation doit utiliser une configuration versionnée, par exemple :

```ts
type WeatherSamplingConfig = {
  maxDistanceGapKm: number
  maxTimeGapSeconds: number
}
```

Avant production, ces valeurs doivent être validées sur des parcours tests.

Le moteur doit pouvoir créer plusieurs points virtuels dans une même longue section si nécessaire.

---

# 21. Interpolation d’un point virtuel

La position ne doit pas être interpolée naïvement entre deux latitudes / longitudes si la trace complète est disponible.

Méthode :

1. identifier le segment de parcours ;
2. choisir une position cumulative sur la géométrie ;
3. extraire le point réel sur la trace PostGIS / GPX normalisé ;
4. récupérer / interpoler l’altitude du parcours ;
5. interpoler le temps à partir de la progression temporelle du segment.

Ainsi le point reste physiquement sur le parcours.

---

# 22. Altitude

Chaque point conserve :

```text
route_altitude_m
```

qui représente l’altitude du parcours.

Le provider peut avoir sa propre altitude de grille / modèle.

Ne jamais remplacer l’altitude du parcours par celle du provider dans l’UI.

---

# 23. Correction d’altitude

La V1 ne doit pas coder une règle générique du type :

```text
-0,65 °C / 100 m
```

dans le frontend ou dans le domaine sans validation du provider.

Si une correction ou interpolation d’altitude est nécessaire :

- elle appartient à l’adapter provider ;
- elle dépend du modèle fournisseur ;
- elle est versionnée ;
- elle est testée ;
- elle reste auditée dans les métadonnées du run.

Le moteur de domaine consomme une donnée normalisée.

---

# 24. WeatherProvider

Interface conceptuelle :

```ts
interface WeatherProvider {
  getForecast(
    request: WeatherProviderRequest
  ): Promise<WeatherProviderResponse>
}
```

Le domaine ne dépend pas du SDK fournisseur.

---

# 25. WeatherProviderRequest

```ts
type WeatherProviderRequest = {
  points: Array<{
    pointKey: string
    latitude: number
    longitude: number
    routeAltitudeM: number | null
    plannedDatetime: string
  }>

  timezone: string
}
```

L’adapter peut regrouper / optimiser les requêtes selon les possibilités du provider.

---

# 26. WeatherProviderResponse

Le format interne normalisé doit permettre au minimum :

```ts
type NormalizedWeatherPoint = {
  pointKey: string

  forecastIssuedAt: string | null
  fetchedAt: string

  temperatureC: number | null
  apparentTemperatureC: number | null

  precipitationProbabilityPct: number | null
  precipitationAmountMm: number | null

  windSpeedKmh: number | null
  windGustKmh: number | null
  windDirectionDeg: number | null

  weatherCode: string | null

  providerPayload?: unknown
}
```

Une propriété indisponible reste `null`.

Interdit :

```text
null → valeur estimée silencieusement
```

---

# 27. Provider V1

Le fournisseur météo concret n’est **pas figé** par les documents produit actuels.

Cette spec ne doit donc pas inventer un fournisseur obligatoire.

Le choix devra être fait selon :

- couverture géographique ;
- horizon ;
- résolution temporelle ;
- résolution spatiale ;
- altitude / topographie ;
- vent / rafales ;
- précipitations ;
- historique de disponibilité ;
- quotas ;
- licence ;
- coût ;
- SLA ;
- droit de stockage / redistribution.

Le contrat `WeatherProvider` rend ce choix remplaçable.

---

# 28. Forecast run

Un `weather_forecast_run` est un snapshot métier.

Il correspond exactement à :

```text
une version de RacePlan
```

ou :

```text
un snapshot logique d’Outing
```

Il ne doit pas être modifié rétroactivement.

---

# 29. Cycle de vie d’un run

Statuts SQL actuels :

```text
active
stale
failed
```

Règles :

### `active`

Run actuellement utilisable.

### `stale`

Ancien run conservé pour audit mais plus représentatif du scope actuel.

### `failed`

Tentative n’ayant pas produit de résultat exploitable.

Un nouveau run ne remplace pas physiquement l’ancien.

---

# 30. Input hash

Le `input_hash` doit couvrir au minimum :

- scope ;
- racePlan id/version ou snapshot Outing ;
- geometry version/hash ;
- points météo ;
- lat/lon ;
- altitude ;
- plannedDatetime ;
- timezone ;
- config sampling ;
- version normalizer ;
- version Conditions.

Ne doivent pas entrer dans le hash :

- fetchedAt ;
- job id ;
- request id ;
- métriques de performance.

Hash recommandé :

```text
SHA-256 payload canonique
```

---

# 31. Refresh d’un forecast

Un refresh peut être déclenché par :

- entrée dans la fenêtre J-14 ;
- politique scheduler ;
- ouverture utilisateur si run absent / trop ancien ;
- modification du Plan ;
- modification Outing ;
- modification de géométrie ;
- changement de provider / config.

Le moteur ne doit pas refetch à chaque rendu d’écran.

---

# 32. Politique de fraîcheur

Le besoin d’une politique de refresh est certain.

En revanche, **les intervalles numériques exacts de refresh ne sont pas figés par la Product Spec actuelle**.

Ils doivent être configurables et mesurés selon :

- horizon J-14 / J-7 / J-3 / Jour J ;
- quotas provider ;
- coût ;
- fraîcheur réelle du modèle fournisseur.

Ne pas enfouir un `refresh every 3h` arbitraire dans le domaine.

---

# 33. Plan modifié

Lorsqu’un `plan.updated` est confirmé :

```text
nouveaux ETA
↓
nouveaux plannedDatetime
↓
nouveau input_hash
↓
remapping / nouveau run si nécessaire
↓
nouvelles Conditions
```

L’ancien forecast run reste conservé.

---

# 34. Remapping vs nouvelle prévision

Il faut distinguer deux opérations.

## Remapping

Le provider possède déjà une grille / série temporelle permettant d’obtenir la valeur pour le nouvel ETA sans nouvel appel externe.

Alors :

- créer un nouveau run logique ou une nouvelle projection selon l’architecture retenue ;
- conserver la provenance provider ;
- produire de nouveaux points associés au nouveau Plan.

## Refresh

Les données provider disponibles ne permettent pas le nouvel instant ou sont trop anciennes.

Alors :

- déclencher un nouveau fetch.

Le domaine ne doit pas appeler le provider inutilement si une projection fiable déjà acquise peut être réutilisée.

---

# 35. Message utilisateur après recalage

Après changement du Plan :

> **Les conditions ont été recalées sur ton Plan.**

Éviter un message technique du type :

> Weather forecast run regenerated.

---

# 36. Aucun recalcul du Plan

Même si le nouveau forecast est défavorable :

- `targetDuration` reste identique ;
- les segments restent identiques ;
- les stops restent identiques ;
- les locks restent identiques.

Conditions peut afficher :

> **Conditions difficiles possibles sur cette section.**

Mais ne change pas les ETA.

---

# 37. Détection des ConditionPeriods

Après normalisation des points, le moteur peut détecter des périodes :

```text
heat
cold
cold_wind
rain
night
```

Une période est une interprétation.

Elle n’est pas une donnée brute provider.

---

# 38. Seuils de détection

Les documents actuels ne figent pas de seuils scientifiques numériques pour :

- chaleur ;
- froid ;
- froid + vent ;
- pluie significative.

Donc cette spec **ne doit pas inventer ces seuils**.

Ils doivent être définis dans une configuration versionnée :

```ts
type ConditionDetectionConfig = {
  heat: {...}
  cold: {...}
  coldWind: {...}
  rain: {...}
}
```

Cette configuration doit être :

- calibrée ;
- documentée ;
- testée ;
- modifiable uniquement via nouvelle `config_version`.

Le prototype n’est pas une source de vérité pour ces seuils.

---

# 39. Conséquence avant calibration

Le moteur V1 peut être implémenté en deux niveaux :

### Niveau A — point-by-point

Peut fonctionner dès intégration provider :

- température ;
- ressenti ;
- pluie ;
- vent ;
- rafales ;
- résumés factuels.

### Niveau B — interprétation automatique

Activation seulement lorsque les seuils `conditions_config_version` sont validés :

- chaleur ;
- froid ;
- froid + vent ;
- pluie significative ;
- propositions automatiques.

Cette séparation évite de transformer une fixture de prototype en règle de sécurité.

---

# 40. Période continue

Une ConditionPeriod doit posséder :

```text
start_datetime
end_datetime
```

et, si le scope possède une timeline :

```text
start_elapsed_seconds
end_elapsed_seconds
```

Invariant :

```text
end > start
```

Interdit :

> Condition détectée au Rawil → fin = arrivée

par défaut.

---

# 41. Construction d’une période

Principe algorithmique :

1. classifier chaque point / intervalle ;
2. détecter les points consécutifs partageant la même Condition ;
3. fusionner les blocs continus ;
4. calculer un début réaliste ;
5. calculer une fin réaliste ;
6. terminer la période lorsque la Condition disparaît ;
7. ne pas traverser artificiellement une longue zone non observée sans règle explicite.

---

# 42. Interpolation temporelle d’une période

Exemple :

```text
Point A 16:00 : normal
Point B 17:00 : froid
Point C 18:00 : froid
Point D 19:00 : normal
```

La période peut être représentée approximativement :

```text
~16:30 → ~18:30
```

si la configuration utilise un franchissement interpolé.

Elle ne doit pas devenir :

```text
17:00 → arrivée
```

La méthode exacte d’interpolation doit être versionnée.

---

# 43. Gaps trop importants

Si deux points météo sont trop espacés :

- ne pas supposer automatiquement que la Condition est continue ;
- créer un point virtuel supplémentaire si possible ;
- ou marquer l’interprétation comme partielle.

Le moteur ne doit pas fabriquer une précision spatiale absente.

---

# 44. Nuit

La Nuit est une Condition spéciale.

Source :

```text
astronomy
```

Elle ne dépend pas d’un WeatherProvider si l’astronomie peut être calculée localement de façon déterministe.

---

# 45. Calcul Nuit

La Nuit doit être déterminée en croisant :

- position du parcours ;
- vraie date ;
- heure locale ;
- lever / coucher du soleil.

Le moteur doit pouvoir gérer :

```text
Nuit au départ
```

et :

```text
Nuit après coucher
```

sur le même scope.

---

# 46. Astronomie

Utiliser une bibliothèque déterministe reconnue ou un adapter dédié.

Le calcul doit :

- être versionné ;
- utiliser latitude / longitude ;
- utiliser la date réelle ;
- produire les instants en timezone correcte.

Ne pas dépendre d’une API météo pour le lever / coucher du soleil si ce n’est pas nécessaire.

---

# 47. Nuit au départ

Exemple :

```text
départ 05:30
lever du soleil 07:05
```

Période :

```text
05:30 → 07:05
```

Cette période peut :

- alimenter Nutrition ;
- alimenter Préparation ;
- apparaître dans le résumé Conditions.

---

# 48. Nuit en fin de course

Exemple :

```text
coucher 19:42
finish 22:10
```

Période :

```text
19:42 → 22:10
```

La fin peut correspondre à l’arrivée car la Condition Nuit reste vraie jusqu’à l’arrivée.

Ce cas est différent d’un froid arbitrairement prolongé jusqu’au finish.

---

# 49. Chevauchements

Les Conditions peuvent se chevaucher.

Autorisé :

```text
night + cold
night + cold_wind
night + rain
```

Un point peut donc appartenir à plusieurs interprétations.

`cold` et `cold_wind` doivent éviter un affichage double inutile.

Si `cold_wind` est la condition plus informative :

- elle peut remplacer `cold` dans la synthèse ;
- le détail peut conserver les facteurs explicatifs.

---

# 50. Résumé de parcours

Conditions doit pouvoir produire un résumé simple :

```text
Température : min → max
Ressenti minimum
Rafales maximum
Pluie significative si présente
Nuit si pertinente
```

Ne pas afficher 15 KPI.

Le résumé doit être orienté :

> **ce qui mérite d’être regardé.**

---

# 51. Point à surveiller

Un point / secteur devient notable si :

- une Condition significative est détectée ;
- un extrême relatif du parcours y apparaît ;
- un changement important de forecast y survient.

Le seuil “significatif” appartient à la config de Conditions.

Ne pas créer une alerte pour chaque nuage.

---

# 52. Forecast point UI minimum

Chaque point pertinent peut afficher :

- nom ;
- km ;
- altitude ;
- passage prévu ;
- condition ;
- température ;
- ressenti ;
- pluie si pertinente ;
- vent ;
- rafales.

L’UI peut masquer les métriques secondaires lorsque non utiles.

---

# 53. Source et fraîcheur

L’écran Conditions doit toujours pouvoir afficher :

```text
Prévision météo externe
Selon ton Plan actuel
Mise à jour : HH:MM
```

Le nom du provider peut être exposé dans un drawer / détail de source selon les règles de licence.

Ne pas afficher :

```text
Officielle
```

sur la prévision.

---

# 54. Donnée indisponible

Si une métrique est indisponible :

- afficher `—` ou omettre ;
- ne pas substituer une valeur moyenne ;
- ne pas utiliser une valeur du point précédent sans règle visible.

Si le forecast complet est indisponible :

> **Conditions indisponibles pour le moment.**

---

# 55. Run partiellement réussi

Un run peut recevoir des données pour certains points mais pas tous.

Le moteur doit distinguer :

```text
complete
partial
failed
```

conceptuellement.

Le schéma SQL initial ne possède actuellement que :

```text
active
stale
failed
```

La complétude peut temporairement être dérivée ou stockée dans metadata, mais une migration peut être préférable.

Ne pas qualifier un run partiel de complet silencieusement.

---

# 56. Weather code

`weather_code` reste le code normalisé / provider nécessaire à l’affichage.

Il doit être mappé vers une taxonomie UI PLUKA indépendante du provider.

Exemples conceptuels :

```text
clear
partly_cloudy
cloudy
fog
drizzle
rain
heavy_rain
snow
storm
unknown
```

Cette taxonomie d’affichage ne doit pas être confondue avec `ConditionType`.

---

# 57. Vent

Conserver séparément :

```text
wind_speed_kmh
wind_gust_kmh
wind_direction_deg
```

Une rafale n’est pas le vent moyen.

L’UI peut mettre en avant la rafale maximale lorsqu’elle est plus utile à la préparation.

---

# 58. Précipitations

Conserver séparément :

```text
precipitation_probability_pct
precipitation_amount_mm
```

Une probabilité n’est pas une quantité.

Le moteur ne doit pas écrire :

> 80 % de pluie

comme si cela signifiait une intensité.

---

# 59. Température et ressenti

Conserver :

```text
temperature_c
apparent_temperature_c
```

Si le provider ne fournit pas de ressenti fiable :

- laisser `null` ;
- ne pas inventer un calcul local sans spec dédiée.

---

# 60. ConditionProposal — principe

Une ConditionPeriod peut produire une proposition pour :

```text
nutrition
preparation
```

Pipeline :

```text
ConditionPeriod
↓
éligibilité
↓
before_payload
↓
proposed_payload
↓
impact_payload
↓
pending
↓
user action
```

---

# 61. Proposal status

Statuts actuels :

```text
pending
applied
dismissed
expired
```

### `pending`

Visible, aucune mutation.

### `applied`

L’utilisateur a accepté.

### `dismissed`

L’utilisateur a explicitement refusé / conservé sa stratégie.

### `expired`

La période / forecast de référence n’est plus actuelle.

---

# 62. Nouvelle prévision

Lorsqu’un nouveau run invalide une proposal pending :

- l’ancienne proposal devient `expired` ;
- une nouvelle peut être créée ;
- ne pas modifier la cible active.

Si une proposal avait été `applied` :

- son effet actuel reste ;
- la nouvelle prévision produit éventuellement une nouvelle proposal ;
- l’utilisateur décide à nouveau.

---

# 63. Nutrition proposal

Conditions ne doit pas inventer une cible Nutrition.

Il peut proposer :

> **Appliquer ton profil Chaud / Froid sur cette période**

ou :

> **Utiliser cette période Nuit dans ta stratégie**

Le payload exact suit `NUTRITION_ENGINE.md`.

---

# 64. Exemple Nutrition

```text
Condition :
Froid + vent
16:30 → 18:40

Avant :
hydratation = valeur actuelle utilisateur

Proposition :
profil Froid déjà configuré

Impact :
diff calculé sur 2h10

Actions :
Appliquer
Conserver ma stratégie
```

La valeur numérique n’est pas définie par Weather Conditions.

---

# 65. Nuit → Nutrition

La Nuit peut proposer :

> **Utiliser cette période dans ma stratégie Nutrition ?**

Impact possible :

```text
Répartition de la caféine
```

Elle ne doit pas :

- augmenter le total caféine ;
- inventer une dose.

---

# 66. Préparation proposal

Une période peut créer une suggestion matériel.

Exemples de catégories conceptuelles :

```text
cold
cold_wind
rain
night
heat
```

Mais les règles exactes de mapping doivent rester dans une configuration métier de Préparation / Conditions.

---

# 67. Obligatoire vs suggéré

Règle absolue :

```text
race_equipment_requirements.mandatory
≠
conditions suggestion
```

Conditions ne peut jamais transformer un item suggéré en matériel obligatoire.

UI :

```text
OBLIGATOIRE PAR L’ORGANISATION
```

vs :

```text
SUGGÉRÉ PAR PLUKA SELON LES CONDITIONS
```

---

# 68. Déduplication matériel

Avant de proposer un item :

1. vérifier matériel obligatoire ;
2. vérifier matériel personnel ;
3. vérifier item déjà planifié / packed ;
4. vérifier suggestions déjà appliquées.

Exemple :

si une frontale est déjà obligatoire :

> ne pas proposer “Ajouter une frontale”.

On peut éventuellement signaler :

> **Déjà prévu**

si le contexte le justifie.

---

# 69. Suggestion matériel appliquée

Lorsqu’un utilisateur accepte :

- créer / mettre à jour le `participant_equipment_item` ;
- origine :

```text
conditions
```

- ne pas modifier la `race_equipment_requirement`.

---

# 70. Assistance

La page coureur et la page privée Assistant peuvent afficher une synthèse compacte au point de rendez-vous.

Exemple :

```text
12 ° · pluie faible
```

ou :

```text
4 ° · ressenti 1 ° · vent
```

selon pertinence.

Ne pas transformer Assistance en application météo.

---

# 71. Source Assistance

L’information affichée à l’Assistant :

- correspond au point / ETA du rendez-vous ;
- vient du run Conditions du participant ;
- ne donne pas accès au reste du Plan ;
- ne révèle pas de données Nutrition non partagées.

---

# 72. Changement du Plan et Assistance

Si le Plan change :

```text
ETA rendez-vous change
↓
Conditions du point change
↓
résumé Assistance change
```

Le rendez-vous reste lié au waypoint.

Aucune position réelle n’est créée.

---

# 73. Jour J

Le mode Jour J peut afficher :

```text
PROCHAIN POINT
Nom
ETA
Altitude
Conditions
```

La définition du “prochain point” V1 peut rester basée sur la timeline prévue si aucun tracking live n’existe.

Ne jamais faire croire que PLUKA connaît la position réelle.

---

# 74. Demander à PLUKA

À partir de J-14, Q&A peut répondre à une question comme :

> **Quel temps aurai-je au Rawil ?**

Réponse attendue :

- passage prévu ;
- altitude ;
- forecast ;
- mise à jour ;
- lien / CTA vers Conditions.

---

# 75. Citation météo dans Q&A

Le Data Model permet de rattacher une réponse à :

```text
weather_forecast_point_id
```

La réponse doit indiquer clairement :

> **Prévision météo selon ton Plan**

et non :

> source officielle organisation.

---

# 76. Avant J-14 dans Q&A

Si l’utilisateur demande une prévision avant J-14 :

> **PLUKA n’affiche pas de prévision de course avant J-14.**

Le système ne doit pas appeler un provider longue échéance juste pour répondre.

---

# 77. Outing Q&A

Pour PLUKA+ / sortie éligible :

> **Quel temps pendant ma sortie samedi ?**

Le système utilise :

- timeline Outing ;
- forecast run Outing ;
- points Conditions.

Même règles de confiance et de fraîcheur.

---

# 78. Accueil coureur

À partir de J-14, l’Accueil peut afficher une action Conditions.

Exemple :

```text
Vérifier les premières conditions de course
```

Plus proche du départ, si un changement notable existe :

```text
Les conditions ont évolué
```

Ne pas afficher un bloc météo avant J-14.

---

# 79. Notifications

Une notification Conditions peut être déclenchée uniquement si le produit a défini un changement réellement utile.

Exemples :

- nouvelle Condition significative ;
- Condition disparue ;
- forecast évolué de manière importante.

Les seuils de changement notable doivent être versionnés.

Ne pas spammer à chaque refresh provider.

---

# 80. Official notice precedence

Si une notice officielle météo / sécurité existe :

elle doit être rendue **avant** la prévision personnalisée.

Exemple :

```text
DÉCISION DE L’ORGANISATION
Kit froid obligatoire

TES CONDITIONS PRÉVUES
...
```

Cette hiérarchie est commune au Free et au Premium.

---

# 81. Free + Conditions screen

Un Free à J-7 peut ouvrir la route / entrée Conditions.

Si une notice officielle existe :

1. afficher la notice ;
2. ensuite afficher le paywall personnalisé.

Exemple :

```text
Kit froid obligatoire
(source organisation)

Puis :

Avec Race Pass,
vois les conditions prévues selon tes heures de passage.
```

---

# 82. Race Intelligence B2B

Race Intelligence peut utiliser :

- forecast course ;
- flux agrégés ;
- zones Conditions ;

pour produire une exposition agrégée.

Exemple :

```text
Froid + vent Rawil
15:30 → 19:00

≈ 68 % du peloton
devrait traverser la zone
pendant cette période
```

---

# 83. Confidentialité B2B

L’organisation ne doit jamais recevoir :

```text
Clément
Rawil
17:08
4°C
```

à partir du Plan personnel.

Elle reçoit uniquement des agrégats satisfaisant le seuil de confidentialité.

Le calcul individuel peut être utilisé côté serveur si autorisé par le modèle de confidentialité, mais la sortie B2B est agrégée.

---

# 84. Décision organisateur B2B

Race Intelligence / Conditions peut éclairer :

```text
kit froid
```

mais ne déclenche jamais la décision.

L’organisation reste seule responsable de :

- kit froid ;
- kit chaud ;
- parcours ;
- départ ;
- annulation ;
- communication officielle.

---

# 85. Architecture package

Package recommandé :

```text
packages/weather/
├── src/
│   ├── index.ts
│   ├── contracts.ts
│   ├── config.ts
│   ├── eligibility.ts
│   ├── route-points.ts
│   ├── virtual-checkpoints.ts
│   ├── timeline-mapper.ts
│   ├── provider.ts
│   ├── normalizer.ts
│   ├── forecast-run.ts
│   ├── condition-detector.ts
│   ├── period-builder.ts
│   ├── astronomy.ts
│   ├── proposals.ts
│   ├── summary.ts
│   ├── hash.ts
│   └── issues.ts
│
└── tests/
    ├── fixtures/
    ├── eligibility.test.ts
    ├── route-points.test.ts
    ├── timeline-mapper.test.ts
    ├── normalizer.test.ts
    ├── period-builder.test.ts
    ├── astronomy.test.ts
    ├── proposals.test.ts
    ├── determinism.test.ts
    └── acceptance.test.ts
```

Adapters externes possibles :

```text
packages/weather-providers/<provider>
```

ou :

```text
packages/weather/src/providers/<provider>
```

selon l’organisation finale du repo.

---

# 86. Séparation pure / I/O

Les fonctions suivantes doivent être pures :

```text
isWeatherEligible
buildWeatherRoutePoints
buildVirtualCheckpoints
mapTimelineToWeatherPoints
normalizeProviderPoint
detectConditionPeriods
buildConditionProposals
buildConditionsSummary
computeWeatherInputHash
```

Les appels provider et DB restent dans les adapters / use cases.

---

# 87. Commandes applicatives

La couche domaine peut exposer :

```text
requestRaceConditions
requestOutingConditions
refreshRaceConditions
refreshOutingConditions
applyConditionProposal
dismissConditionProposal
expireConditionProposals
```

Le recalage après Plan peut être déclenché par événement, pas forcément par commande utilisateur directe.

---

# 88. Jobs asynchrones

Jobs recommandés :

```text
weather.refresh
weather.remap
weather.expire-proposals
weather.update-summaries
```

Le fetch provider ne doit pas bloquer une page normale.

---

# 89. Idempotence

Clés conceptuelles :

```text
weather.refresh:{scope}:{inputHash}:{provider}:{providerConfigVersion}
```

Un retry ne doit pas :

- créer 3 runs identiques ;
- créer 3 proposals identiques ;
- appliquer deux fois une suggestion.

---

# 90. Provider failure

Si le provider échoue :

- run `failed` ;
- conserver le dernier run ancien ;
- ne pas le présenter comme frais ;
- afficher un état indisponible / ancien selon politique.

Ne jamais fabriquer des Conditions à partir d’un run failed.

---

# 91. Provider timeout

Le worker applique :

- timeout ;
- retry borné ;
- backoff ;
- logs.

Le produit ne doit pas bloquer le Plan parce que la météo ne répond pas.

---

# 92. Quotas provider

Le système doit minimiser les appels :

- points utiles seulement ;
- cache / snapshots ;
- batch si provider le permet ;
- pas de refetch au rendu ;
- pas d’appel avant J-14 ;
- pas d’appel pour Free sans entitlement personnalisé ;
- partage prudent de données provider si licence et modèle le permettent.

---

# 93. Mutualisation potentielle

Deux participants peuvent avoir :

- même trace ;
- mêmes points ;
- ETA proches.

Une mutualisation provider peut être techniquement possible.

Cependant la V1 métier conserve des `weather_forecast_runs` rattachés au scope utilisateur afin de préserver la projection sur son Plan.

Un cache provider interne peut mutualiser la donnée brute sans fusionner les snapshots métier.

---

# 94. Cache interne provider

Une couche interne peut indexer :

```text
location bucket
+
forecast timestamp
+
provider model
+
issued_at
```

si la licence l’autorise.

Elle reste technique.

Elle n’est pas une table métier affichée.

---

# 95. Observabilité

Mesurer :

- nombre de scopes éligibles ;
- runs générés ;
- points / run ;
- points virtuels ;
- latence provider ;
- taux de run partiel ;
- taux d’échec ;
- quota / coût ;
- âge moyen des runs ;
- ConditionPeriods générées ;
- proposals générées ;
- taux applied / dismissed ;
- recalages après `plan.updated`.

---

# 96. Données sensibles dans les logs

Les logs peuvent contenir :

- `race_plan_id` ;
- `outing_id` ;
- `weather_run_id` ;
- `point_key` ;
- provider ;
- durée ;
- codes erreurs.

Éviter :

- nom utilisateur ;
- email ;
- téléphone ;
- contenu Nutrition ;
- détails Assistance.

---

# 97. Mapping Data Model actuel

Tables de référence :

```text
weather_forecast_runs
weather_forecast_points
condition_periods
condition_proposals
nutrition_condition_ranges
participant_equipment_items
race_notices
pluka_answer_sources
```

Le package pur ne connaît pas les tables.

Le domaine / repository mappe les résultats.

---

# 98. `weather_forecast_runs`

Le SQL actuel contient :

- scope ;
- race_plan_id ;
- outing_id ;
- provider ;
- provider_model ;
- forecast_issued_at ;
- fetched_at ;
- timezone ;
- input_hash ;
- status.

Ce socle est cohérent avec la spec.

`forecast_issued_at` et `fetched_at` portent ici les **valeurs de référence du run** :
l'émission la plus ancienne et la récupération la plus récente parmi les points obtenus.
L'origine réelle de chaque valeur affichée est portée par le point — voir §99.

---

# 99. `weather_forecast_points`

Le SQL actuel contient notamment :

- `point_key` ;
- race / outing waypoint ;
- segment virtuel ;
- lat / lon ;
- route altitude ;
- vraie `planned_datetime` ;
- température ;
- ressenti ;
- probabilité précipitation ;
- quantité ;
- vent ;
- rafales ;
- direction ;
- weather code ;
- payload provider.

À quoi s'ajoutent, conformément au contrat `NormalizedWeatherPoint` de §26 :

- `forecast_issued_at` (nullable) ;
- `fetched_at`.

Ces deux colonnes font foi sur l'origine temporelle de la valeur affichée. Le run n'en porte
que des valeurs de référence (§98).

Un run partiel ou récupéré en plusieurs appels produit des points d'émissions différentes.
L'interface ne peut donc pas dater une valeur à partir du run : elle lit le point.

Ces colonnes n'entrent jamais dans `input_hash` (§30).

Ce modèle est cohérent avec la V1.

---

# 100. `condition_periods`

Le SQL actuel contient :

- type ;
- source météo / astronomie ;
- label ;
- début / fin datetime ;
- début / fin elapsed ;
- start / end point keys ;
- severity ;
- summary.

Il respecte l’invariant :

> une période possède toujours une vraie fin.

---

# 101. `condition_proposals`

Le SQL actuel contient :

- ConditionPeriod ;
- user ;
- Race ou Outing ;
- cible Nutrition / Préparation ;
- status ;
- before ;
- proposed ;
- impact ;
- timestamps apply / dismiss.

Il correspond bien au workflow :

```text
détection
→ proposition
→ confirmation
```

---

# 102. Écarts à corriger dans le schéma avant lot Weather

Le schéma initial est solide mais la présente spec révèle quelques métadonnées importantes à figer avant implémentation complète.

Ajouter ou représenter explicitement, idéalement sur `weather_forecast_runs` :

```text
conditions_engine_version
conditions_config_version
provider_config_version
sampling_config_version
normalizer_version
```

et éventuellement :

```text
input_snapshot jsonb
completeness_status
failure_code
```

selon la stratégie de persistance choisie.

Pourquoi :

- reproductibilité ;
- calibration des seuils ;
- audit des changements ;
- diagnostic provider ;
- distinction point-by-point / interprétation.

Ne pas contourner ces besoins avec des constantes invisibles dans le frontend.

Mettre ensuite à jour `02_DATA_MODEL.md`.

---

# 103. Écart : run Outing

Une Outing peut être modifiée après un run.

Le `input_hash` est donc indispensable.

Pour une reproductibilité plus forte, envisager :

```text
input_snapshot
```

dans le run, contenant seulement les données météo nécessaires :

- startAt ;
- durée ;
- points ;
- plannedDatetime ;
- geometry/version key.

Ne pas y dupliquer des données personnelles inutiles.

---

# 104. Écart : Condition severity

Le schéma accepte :

```text
severity 1..3
```

La Product Spec actuelle ne définit pas de signification numérique complète.

Donc :

- ne pas exposer “niveau 3” à l’utilisateur ;
- ne pas donner de sens de sécurité non spécifié ;
- garder `severity` interne / optionnelle jusqu’à calibration.

---

# 105. Feature flags

Les Conditions point-by-point font partie du produit premium prévu.

Cependant les sous-capacités peuvent être flaggées séparément pendant l’intégration :

```text
weather_conditions
weather_auto_detection
weather_condition_proposals
weather_b2b_exposure
```

Cela permet :

1. raw point forecast ;
2. puis détection ;
3. puis propositions ;
4. puis B2B.

Les flags ne remplacent pas les entitlements.

---

# 106. Tests — éligibilité

## W01 — J-15 Race

Attendu :

```text
not eligible
```

Aucun appel provider.

## W02 — J-14 Race premium

Attendu :

éligible.

## W03 — Free J-7

Attendu :

pas de forecast personnalisé.

Une notice officielle reste visible.

## W04 — Outing sans date

Attendu :

prérequis manquant.

## W05 — Outing J-5 sans heure

Attendu :

demande heure de départ.

## W06 — Outing J-5 complet

Attendu :

éligible selon entitlement.

---

# 107. Tests — timeline

## W07 — plannedDatetime

Un waypoint à 17:08.

Attendu :

vraie date ISO / timestamptz.

## W08 — Passage minuit

Attendu :

date J+1 correcte.

## W09 — Multi-jour

Attendu :

dates monotones sur plusieurs jours.

## W10 — Plan modifié

Rawil :

```text
17:08 → 18:02
```

Attendu :

nouvel input hash et Conditions recalées.

Aucun changement de pacing par Weather.

---

# 108. Tests — route points

## W11 — Waypoints utiles

Attendu :

départ, points clés, arrivée sélectionnés.

## W12 — Longue section

Config sampling dépassée.

Attendu :

point virtuel sur vraie trace.

## W13 — Plusieurs longues sections

Attendu :

plusieurs `pointKey` uniques.

## W14 — Point virtuel

Attendu :

lat/lon/altitude/ETA propres.

---

# 109. Tests — provider

## W15 — Champ absent

Provider sans ressenti.

Attendu :

`apparentTemperatureC = null`.

## W16 — Provider fail

Attendu :

run failed, aucune valeur inventée.

## W17 — Partial

Certains points absents.

Attendu :

état partiel clairement détectable.

## W18 — Altitude provider différente

Attendu :

`routeAltitudeM` reste l’altitude affichée du parcours.

---

# 110. Tests — periods

## W19 — Condition courte

Froid seulement sur une zone.

Attendu :

période avec vraie fin avant l’arrivée.

## W20 — Période continue

Plusieurs points consécutifs.

Attendu :

fusion en une période.

## W21 — Condition disparaît

Attendu :

fin de période.

## W22 — Gap important

Attendu :

point virtuel ou prudence, pas de continuité inventée.

---

# 111. Tests — Nuit

## W23 — Nuit au départ

Départ avant sunrise.

Attendu :

ConditionPeriod `night` départ → sunrise.

## W24 — Nuit fin de course

Sunset avant finish.

Attendu :

sunset → finish.

## W25 — Nuit + froid

Attendu :

deux Conditions compatibles.

---

# 112. Tests — proposals

## W26 — Proposal Nutrition

Attendu :

pending, aucune mutation.

## W27 — Apply

Attendu :

mutation Nutrition via domaine Nutrition puis `applied`.

## W28 — Dismiss

Attendu :

aucune mutation.

## W29 — Nouveau forecast

Proposal pending ancienne.

Attendu :

expire puis nouvelle proposal éventuelle.

## W30 — Applied + forecast change

Attendu :

ancienne adaptation conservée ; nouvelle proposition explicite.

---

# 113. Tests — préparation

## W31 — Gants déjà prévus

Attendu :

pas de doublon.

## W32 — Suggestion Conditions

Attendu :

origin `conditions`.

Jamais `official_requirement`.

## W33 — Kit froid officiel

Attendu :

notice organisation prioritaire et accessible Free.

---

# 114. Tests — Assistance / Q&A

## W34 — Rendez-vous

Attendu :

météo compacte au point / ETA.

## W35 — Ask PLUKA

Attendu :

réponse avec ETA, conditions, updatedAt et source WeatherPoint.

## W36 — Ask avant J-14

Attendu :

aucune tendance.

---

# 115. Tests — B2B

## W37 — Exposition peloton

Attendu :

agrégat uniquement.

## W38 — Petit groupe

Attendu :

aucune exposition affichée sous le seuil de confidentialité.

## W39 — Décision officielle

Attendu :

PLUKA n’active jamais automatiquement le kit.

---

# 116. Tests — déterminisme

Les parties pures doivent être déterministes :

- route point building ;
- point keys ;
- timeline mapping ;
- input hash ;
- astronomy ;
- period building ;
- proposal construction.

Les données provider peuvent évoluer dans le temps, mais un snapshot identique normalisé doit produire la même interprétation à versions identiques.

---

# 117. Calibration avant production

Avant d’activer `weather_auto_detection` en production :

1. sélectionner plusieurs courses montagne / plaine ;
2. couvrir froid, chaud, pluie, vent ;
3. comparer sorties provider et réalité observée lorsque possible ;
4. vérifier les effets d’altitude ;
5. tester la densité des checkpoints ;
6. tester la stabilité des périodes ;
7. faire relire les résumés à des trailers ;
8. définir les seuils `ConditionDetectionConfig` ;
9. définir les seuils de changement notable ;
10. versionner la config ;
11. geler `conditions-v1.0.0`.

---

# 118. Ce que la calibration ne doit pas faire

Ne pas transformer le moteur en :

- modèle de sécurité montagne certifié ;
- prédiction d’hypothermie ;
- recommandation de survie ;
- moteur médical ;
- moteur de pacing.

La calibration vise :

> **une interprétation utile et prudente de données météo externes sur la chronologie réelle du parcours.**

---

# 119. Ordre d’implémentation recommandé

| Étape | Livrable |
|---|---|
| W1 | eligibility J-14 + entitlements |
| W2 | timeline Race / Outing |
| W3 | route points + virtual checkpoints |
| W4 | WeatherProvider interface |
| W5 | premier adapter provider |
| W6 | forecast runs + points |
| W7 | UI point-by-point |
| W8 | astronomie Nuit |
| W9 | config / detection periods |
| W10 | summaries / watch points |
| W11 | ConditionProposals |
| W12 | intégration Nutrition |
| W13 | intégration Préparation |
| W14 | Assistance / Jour J / Ask PLUKA |
| W15 | Race Intelligence exposure |
| W16 | calibration / hardening |

Cette progression permet de livrer une météo personnalisée utile avant d’activer des interprétations automatiques plus sensibles.

---

# 120. Critères d’acceptation pour Claude Code

Weather Conditions V1 est considéré correctement implémenté lorsque :

1. aucune donnée personnalisée n’est générée avant J-14 ;
2. les notices officielles ne sont jamais bloquées par J-14 ou le paywall météo ;
3. les entitlements sont revérifiés serveur ;
4. Race et Outing utilisent le même domaine Conditions ;
5. une Outing sans date / heure affiche le bon prérequis ;
6. chaque point météo possède une vraie date/heure ;
7. les ultras multi-jour fonctionnent ;
8. chaque point possède lat/lon et altitude de parcours si disponible ;
9. les points virtuels sont placés sur la trace ;
10. leurs `pointKey` sont uniques ;
11. aucun appel n’est fait pour chaque point GPX brut ;
12. le provider est derrière une interface ;
13. un champ provider absent reste absent ;
14. aucune correction altitude générique n’est inventée ;
15. les runs sont snapshotés ;
16. un nouveau run n’écrase pas l’ancien ;
17. le Plan modifié produit de nouveaux ETA Conditions ;
18. Conditions ne modifie jamais le Plan ;
19. les forecast horizons utilisent des libellés qualitatifs ;
20. aucun faux pourcentage de confiance n’est affiché ;
21. une ConditionPeriod possède toujours une fin ;
22. le froid ne s’étend jamais jusqu’au finish sans justification ;
23. la Nuit peut commencer au départ ou en fin de course ;
24. les chevauchements Nuit + météo sont possibles ;
25. les seuils météo sont versionnés et non issus des fixtures ;
26. une proposal n’est jamais appliquée automatiquement ;
27. Nutrition ne reçoit pas la météo brute ;
28. Préparation distingue suggestion et obligation ;
29. les suggestions matériel sont dédupliquées ;
30. Assistance reçoit uniquement une synthèse compacte ;
31. Ask PLUKA peut citer un WeatherForecastPoint ;
32. Free voit les décisions officielles ;
33. B2B ne reçoit que des agrégats ;
34. le provider indisponible n’entraîne aucune valeur inventée ;
35. la fraîcheur du forecast est visible ;
36. `input_hash` est reproductible ;
37. les versions moteur/config/provider sont persistables ;
38. les tests W01–W39 passent.

---

# 121. Consigne finale

La fonctionnalité Conditions de PLUKA ne doit jamais devenir :

> **une application météo à côté du Plan.**

Sa responsabilité est :

> **prendre une prévision externe et la remettre dans le contexte personnel du parcours, de l’altitude et des heures de passage.**

La valeur n’est pas :

```text
“Il fera 4 °C à Crans-Montana.”
```

La valeur est :

```text
“Au Rawil, à 2 429 m,
ton Plan te fait passer vers 17:20.
La prévision actuelle indique 4 °C,
ressenti 1 °C et des rafales importantes.”
```

Puis, uniquement si utile :

```text
“Voici ce que cela pourrait changer dans ta préparation.”
```

avec confirmation utilisateur.

Quatre règles absolues :

> **Pas de météo personnalisée avant J-14.**

> **Pas de valeur inventée quand la donnée manque.**

> **Pas de mutation silencieuse de Plan, Nutrition ou Matériel.**

> **Une décision officielle de l’organisation reste toujours supérieure à l’interprétation PLUKA.**

---

**Fin — PLUKA Weather Conditions Engine V1**
