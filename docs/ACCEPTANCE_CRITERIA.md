# PLUKA — Acceptance Criteria V1

**Fichier de référence :** `docs/ACCEPTANCE_CRITERIA.md`  
**Statut :** Référence transverse de validation — Product / Engineering / QA  
**Date de consolidation :** 2026-09-03  
**Principe :** une fonctionnalité n’est pas terminée parce qu’elle “marche sur l’écran” ; elle est terminée lorsque le comportement produit, les données, la sécurité, les moteurs, les routes et l’UX respectent ensemble les spécifications

---

# 0. Rôle de ce document

Ce document définit les **critères d’acceptation transverses de PLUKA V1**.

Il sert à répondre à quatre questions :

1. Une feature est-elle réellement terminée ?
2. Une PR peut-elle être mergée ?
3. Une brique peut-elle être ouverte à des testeurs ?
4. PLUKA V1 peut-il être mis en production ?

Il ne remplace pas les tests détaillés des autres spécifications.

Il les rassemble dans une grille de validation unique et ajoute les scénarios end-to-end nécessaires pour vérifier que les briques fonctionnent **ensemble**.

---

## 0.1 Documents de référence

Les critères de ce document doivent être lus avec :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/03_PRIVACY_RLS.md`
- `docs/04_ENTITLEMENTS.md`
- `docs/05_ROUTES_AND_FLOWS.md`
- `docs/06_DESIGN_SYSTEM.md`
- `docs/engines/PLAN_ENGINE.md`
- `docs/engines/NUTRITION_ENGINE.md`
- `docs/engines/SOURCES_EXTRACTION.md`
- `docs/engines/WEATHER_CONDITIONS.md`
- `docs/engines/RACE_INTELLIGENCE.md`
- `supabase/migrations/*`
- le prototype figé de référence.

Le prototype sert de référence UX/UI.

Il ne sert jamais de source de vérité pour une règle métier, un seuil moteur, une policy RLS ou un entitlement.

---

## 0.2 Ordre de priorité

En cas de contradiction :

1. `03_PRIVACY_RLS.md` bloque toute implémentation qui élargirait une donnée interdite ;
2. `00_PRODUCT_SPEC.md` fait foi sur le comportement produit ;
3. la spec moteur concernée fait foi sur le calcul ;
4. `04_ENTITLEMENTS.md` fait foi sur les droits commerciaux ;
5. `05_ROUTES_AND_FLOWS.md` fait foi sur les parcours et gardes ;
6. `01_ARCHITECTURE.md` fait foi sur les frontières techniques ;
7. `02_DATA_MODEL.md` + migrations font foi sur la structure persistée ;
8. `06_DESIGN_SYSTEM.md` fait foi sur la grammaire UI ;
9. le prototype fait foi sur l’intention d’écran.

Une contradiction non résolue est un **NO GO**, pas une invitation à choisir arbitrairement dans le code.

---

# 1. Définition de “Done”

Une tranche fonctionnelle est considérée **Done** uniquement lorsque :

```text
COMPORTEMENT PRODUIT
+
AUTORISATION
+
PRIVACY
+
PERSISTANCE
+
MOTEUR / DOMAINE
+
UI
+
TESTS
+
OBSERVABILITÉ
=
VALIDÉS
```

Une feature visible dans le navigateur mais :

- non sécurisée ;
- non testée ;
- non persistée correctement ;
- dépendante d’une fixture ;
- ou incohérente avec la spec ;

n’est pas terminée.

---

# 2. Niveaux de priorité

## P0 — Bloquant production

Violation possible de :

- Privacy ;
- sécurité ;
- intégrité de données ;
- paiement / entitlement ;
- données officielles ;
- déterminisme d’un moteur critique ;
- provenance ;
- corruption Plan / Nutrition ;
- données de démonstration en production.

Un P0 ouvert interdit la mise en production.

## P1 — Bloquant la feature

La feature ne remplit pas son contrat principal.

Elle reste derrière un feature flag ou hors release.

## P2 — Important mais non bloquant Core

Amélioration nécessaire, mais peut être décalée si :

- le produit reste cohérent ;
- aucune promesse principale n’est cassée ;
- aucune dette dangereuse n’est créée.

Exemple V1 :

```text
Communauté légère
```

est une brique non bloquante du Core launch.

---

# 3. Niveaux de validation

Chaque feature doit être couverte par les niveaux pertinents.

## 3.1 Unit

Pour :

- moteurs ;
- helpers ;
- policies de domaine ;
- calculs ;
- normalisation ;
- mapping.

Outil de référence :

```text
Vitest
```

## 3.2 Integration

Pour :

- repositories ;
- use cases ;
- worker ;
- providers mockés ;
- Supabase local ;
- outbox ;
- queue.

## 3.3 Database / RLS

Pour :

- migrations ;
- contraintes ;
- policies ;
- grants ;
- isolation multi-user / multi-org.

Outil de référence :

```text
pgTAP + tests d’intégration SQL
```

## 3.4 E2E

Pour les flows critiques réels.

Outil de référence :

```text
Playwright
```

## 3.5 Visual / Accessibility

Pour :

- UI critique ;
- responsive ;
- clavier ;
- contrastes ;
- focus ;
- états.

## 3.6 Manual product acceptance

Pour :

- cohérence métier ;
- wording ;
- impression de simplicité ;
- qualité des premiers résultats ;
- calibration moteurs.

---

# 4. Gates de PR

Une PR ne doit pas être mergée si elle échoue à l’un des critères applicables suivants :

```text
build
typecheck
lint
unit tests
integration tests concernés
migrations reset
RLS tests concernés
E2E critique concerné
```

Toute modification d’une règle métier doit :

- modifier ou ajouter un test ;
- mettre à jour la spec si le comportement change volontairement.

Toute modification d’un moteur versionné qui change le résultat doit :

- changer la version appropriée ;
- mettre à jour les fixtures / tests ;
- documenter le changement.

---

# 5. Gate global V1 Core

PLUKA V1 Core peut être ouvert à des utilisateurs réels lorsque les briques suivantes sont opérationnelles :

| Brique | Gate Core |
|---|---|
| Auth / compte | Obligatoire |
| Course / Facts / Sources | Obligatoire |
| Profil trailer | Obligatoire |
| Objectif utilisateur | Obligatoire |
| Plan initial | Obligatoire |
| Plan premium éditable | Obligatoire pour Race Pass |
| Préparation | Obligatoire |
| Nutrition | Obligatoire pour Race Pass |
| Assistance | Obligatoire pour Race Pass |
| Conditions J-14 | Obligatoire pour premium annoncé |
| Ma saison | Obligatoire |
| Sorties liées Race Pass | Obligatoire |
| Sorties PLUKA+ | Obligatoire si PLUKA+ commercialisé |
| Entitlements | Obligatoire |
| Privacy / RLS | Obligatoire |
| B2B sources / participants / Brief | Obligatoire pour pilote B2B |
| Race Intelligence | Beta autorisée uniquement selon gate spécifique |
| Communauté | Non bloquante Core |
| Repère PLUKA | Non requis, feature flag |
| API ITRA / UTMB | Non requise |
| Live / PC course | Hors scope |

« Obligatoire » qualifie la **présence de la brique dans le Core**, pas son remplissage par
chaque coureur avant son Plan. Le Profil trailer doit exister, être renseignable et
persistant ; il n'est pas pour autant un préalable universel. `00_PRODUCT_SPEC.md` §7.3 ne le
demande pas dans l'onboarding d'un participant invité — §3.2 veut ce parcours « plus court,
car les informations de course sont déjà connues » — et le profil se renseigne plus tard, comme
l'Assistance de §15.1.

---

# 6. Gate “pas de faux produit”

Avant toute bêta réelle :

1. aucune donnée de démo n’est mélangée aux données réelles ;
2. aucun chiffre du prototype n’est utilisé comme seuil métier sans spec ;
3. aucune course réelle ne semble partenaire si elle ne l’est pas ;
4. toute démonstration non partenaire est clairement identifiée ;
5. aucun texte ne prétend qu’une feature existe si elle est seulement mockée ;
6. aucune donnée météo de fixture n’est affichée comme prévision réelle ;
7. aucun résultat Race Intelligence simulé n’est affiché comme calcul réel.

---

# 7. Acceptance — Auth & Account

## AC-AUTH-01 — Création de compte

Étant donné un nouvel utilisateur,

quand il termine l’authentification,

alors :

- une identité Supabase Auth existe ;
- `public.users` existe ;
- `platform_role = user` ;
- aucune donnée admin ne peut venir du metadata client ;
- le user est redirigé vers le contexte attendu.

## AC-AUTH-02 — Session

Une route `/app/*` sans session :

```text
→ auth
→ returnTo sécurisé
→ route d’origine après login
```

## AC-AUTH-03 — Cross user

User A ne peut jamais :

- lire ;
- modifier ;
- supprimer ;

un objet privé de User B en changeant un UUID.

## AC-AUTH-04 — Suppression / logout

Le logout invalide la session client.

Les données restent protégées côté serveur.

---

# 8. Acceptance — Course / Event / Edition

## AC-COURSE-01

La hiérarchie :

```text
Event
→ Edition
→ Race
```

est explicite et réellement utilisée.

## AC-COURSE-02

Deux éditions d’un même événement sont deux scopes distincts.

## AC-COURSE-03

Deux distances d’une même édition sont deux Race distinctes.

## AC-COURSE-04

Une Race publique peut être consultée selon sa visibilité.

## AC-COURSE-05

Une Race `unlisted` / `private` ne devient pas listable publiquement par connaissance de son UUID.

## AC-COURSE-06

La timezone de la Race est stockée et utilisée dans les calculs temporels.

---

# 9. Acceptance — Onboarding coureur

Le flow canonique est :

```text
COURSE
→ PROFIL EXPRESS
→ OBJECTIF
→ COHÉRENCE
→ PLAN
```

## AC-ONB-01 — Pas de questionnaire inutile

Un user possédant déjà un Trail Profile n’est pas obligé de tout ressaisir.

## AC-ONB-02 — Profil court

Le flow de profil reste suffisamment compact pour ne pas devenir un questionnaire de prédiction type coaching.

Il ne demande pas par défaut :

- VO2max ;
- VMA ;
- FC max ;
- charge Garmin ;
- puissance.

## AC-ONB-03 — Objectif choisi

L’utilisateur choisit son objectif `HH:MM`.

PLUKA ne lui substitue pas un chrono calculé.

## AC-ONB-04 — Premier Plan

Après confirmation :

- un Plan est calculé ;
- le Plan initial est visible en Free ;
- les heures de passage sont cohérentes ;
- les cutoffs sont affichables.

## AC-ONB-05 — Organizer Included

Un participant invité avec accès organisation inclus :

- ne voit pas de pricing dans le tunnel ;
- arrive au même produit ;
- conserve la même confidentialité.

---

# 10. Acceptance — Plan

La suite détaillée `PLAN-P01` à `PLAN-P22` de `PLAN_ENGINE.md` est obligatoire.

Elle est complétée par les critères transverses suivants.

## AC-PLAN-01 — Objectif respecté

À génération initiale :

```text
temps segments
+
stops
=
objectif
```

à la précision déterministe prévue.

## AC-PLAN-02 — Relief réel

Un parcours avec relief ne peut pas produire une répartition strictement proportionnelle à la distance si les pentes diffèrent.

## AC-PLAN-03 — Aucun moteur physiologique caché

Le moteur ne lit pas directement :

- ITRA ;
- UTMB Index ;
- météo ;
- Nutrition ;
- profil cardio.

## AC-PLAN-04 — Override protégé

Une durée de segment explicitement modifiée ne change pas lors d’un recalcul tant que l’override existe.

## AC-PLAN-05 — Lock protégé

Une heure verrouillée reste exacte ou produit un conflit explicite.

## AC-PLAN-06 — Stop protégé

Un stop manuel ne peut pas être écrasé silencieusement.

## AC-PLAN-07 — Dérive

En mode :

```text
Conserver ce Plan
```

le finish peut dériver.

## AC-PLAN-08 — Rebalance

En mode :

```text
Rééquilibrer
```

le finish revient à l’objectif si les contraintes le permettent.

## AC-PLAN-09 — Cutoff

La marge respecte :

```text
arrival
```

ou :

```text
departure
```

selon le cutoff.

## AC-PLAN-10 — Multi-jour

Une course dépassant minuit conserve des elapsed monotones et de vraies dates.

## AC-PLAN-11 — Déterminisme

Même input logique + mêmes versions :

```text
→ même résultat
→ même input_hash
```

## AC-PLAN-12 — Aucun weather pacing

Une modification Weather n’altère jamais automatiquement :

- target ;
- segment duration ;
- stop ;
- lock.

---

# 11. Acceptance — Plan UX

## AC-PLAN-UX-01

Le Plan affiche au minimum :

- objectif ;
- finish prévu ;
- profil ;
- waypoints ;
- ETA ;
- stops ;
- cutoffs / marges.

## AC-PLAN-UX-02

Les actions avancées Free déclenchent un paywall contextuel, pas un écran opaque avant toute valeur.

## AC-PLAN-UX-03

Une preview ne crée pas une version persistée.

## AC-PLAN-UX-04

La confirmation crée une nouvelle version persistée et déclenche les downstream.

## AC-PLAN-UX-05

Les données verrouillées sont identifiables autrement que par la couleur.

---

# 12. Acceptance — Nutrition

La suite détaillée `NUTRITION-N01` à `NUTRITION-N38` est obligatoire.

## AC-NUT-01 — Cibles utilisateur

Le moteur ne modifie jamais automatiquement :

- glucides g/h ;
- hydratation ml/h ;
- sodium mg/h ;
- caféine totale.

## AC-NUT-02 — Temps

Les besoins sont calculés sur la durée réelle prévue.

## AC-NUT-03 — Produits avant génération

Une proposition produit avancée n’utilise que :

- produits choisis ;
- eau ;
- contenus ravito acceptés.

## AC-NUT-04 — Multidimensionnel

Une boisson énergétique contribue simultanément à :

- glucides ;
- hydratation ;
- sodium ;

sans double comptage.

## AC-NUT-05 — Caféine

Une plage Nuit peut changer la distribution temporelle.

Elle ne change pas le total caféine.

## AC-NUT-06 — Conditions

Chaud / Froid s’appliquent uniquement :

- sur une période bornée ;
- sur les dimensions configurées ;
- après validation utilisateur lorsqu’issus de Conditions.

## AC-NUT-07 — Jalons personnalisés

Un jalon personnalisé n’est jamais déplacé silencieusement.

## AC-NUT-08 — Produit orphelin

Un recalcul qui supprime un jalon ne supprime jamais silencieusement ses produits.

## AC-NUT-09 — Réserve

La réserve :

```text
augmente À préparer
```

mais :

```text
n’augmente pas la consommation planifiée
```

## AC-NUT-10 — Logistique

Le moteur permet de distinguer :

```text
À consommer
À remplir
À emporter
```

## AC-NUT-11 — Outing

Le même moteur fonctionne sur une sortie.

Une sortie liée ne modifie jamais automatiquement la stratégie Race.

---

# 13. Acceptance — Préparation

## AC-PREP-01

Le matériel officiel distingue :

```text
mandatory
conditional
recommended
```

## AC-PREP-02

Une suggestion PLUKA ne devient jamais `mandatory`.

## AC-PREP-03

Une suggestion Conditions ajoutée à la checklist conserve :

```text
origin = conditions
```

ou équivalent.

## AC-PREP-04

Les suggestions sont dédupliquées contre :

- obligatoire ;
- matériel personnel ;
- items déjà ajoutés.

## AC-PREP-05

Les bags sont privés.

## AC-PREP-06

`À préparer` Nutrition peut alimenter bags / Assistance sans exposer toute la stratégie à l’organisation.

---

# 14. Acceptance — Assistance

## AC-ASST-01

Assistance n’est pas une étape obligatoire du premier onboarding.

## AC-ASST-02

Un user peut déclarer :

```text
Oui
Non
Plus tard
```

## AC-ASST-03

Un rendez-vous ne peut être créé que sur un point autorisé par les règles de course.

## AC-ASST-04

L’heure du rendez-vous dérive du Plan.

## AC-ASST-05

Après modification du Plan :

- ETA Assistant change ;
- instructions manuelles restent ;
- aucun live tracking n’est créé.

## AC-ASST-06

Le lien privé :

- utilise un token opaque ;
- stocke uniquement son hash ;
- peut expirer ;
- peut être révoqué.

## AC-ASST-07

La page Assistant n’affiche que le strict nécessaire.

## AC-ASST-08

L’organisation n’a aucun accès à l’Assistance individuelle.

## AC-ASST-09

Le contact d’urgence reste séparé et privé.

---

# 15. Acceptance — Conditions météo

La suite détaillée `WEATHER-W01` à `WEATHER-W39` est obligatoire.

## AC-WX-01 — J-14 strict

À J-15 :

```text
aucun forecast personnalisé
aucun appel provider
aucune tendance
```

À J-14 :

la fonctionnalité peut devenir éligible.

## AC-WX-02 — Officiel toujours visible

Une notice organisation :

- reste visible avant J-14 ;
- reste visible en Free ;
- est affichée avant une prévision PLUKA.

## AC-WX-03 — Personnalisation

Chaque point visible est lié à :

- lat ;
- lon ;
- altitude de parcours ;
- vraie date/heure de passage.

## AC-WX-04 — Point-by-point utile

La feature n’échantillonne pas chaque point GPX pour l’UI.

Elle utilise :

- waypoints ;
- points significatifs ;
- checkpoints virtuels si nécessaire.

## AC-WX-05 — Pas de valeur inventée

Un champ provider absent reste absent.

## AC-WX-06 — Altitude

L’altitude affichée est celle du parcours.

Aucune correction générique non spécifiée n’est inventée.

## AC-WX-07 — Période

Une Condition possède toujours :

```text
start
end
```

## AC-WX-08 — Nuit

La Nuit est calculée à partir des vraies dates/positions.

## AC-WX-09 — Proposal

Une Conditions peut proposer une adaptation.

Elle ne l’applique jamais seule.

## AC-WX-10 — Plan change

Un nouveau Plan recale les Conditions.

Les Conditions ne changent pas le Plan.

## AC-WX-11 — Trust

L’UI distingue clairement :

```text
Décision organisation
Prévision externe
Interprétation PLUKA
Suggestion PLUKA
```

## AC-WX-12 — Stale / failed

Un provider en erreur :

- ne bloque pas le Plan ;
- ne produit pas de données fictives ;
- n’affiche pas un ancien run comme récent.

---

# 16. Acceptance — Sorties

## AC-OUT-01

Une Outing est un objet distinct d’une Race.

## AC-OUT-02

Création minimum :

- nom ;
- trace / données parcours ;
- durée prévue.

## AC-OUT-03

Conditions exige aussi :

- date ;
- heure ;
- J-14.

## AC-OUT-04

Race Pass permet au maximum 2 usages de création de sorties liées selon le ledger.

## AC-OUT-05

Supprimer une sortie Race Pass consommée ne restitue pas automatiquement le quota.

## AC-OUT-06

PLUKA+ permet les sorties personnelles sans quota commercial V1.

## AC-OUT-07

`Tester ma stratégie` copie / adapte explicitement des données utiles.

Il ne modifie pas la Race source.

## AC-OUT-08

Feedback sortie → Race :

```text
proposition
→ confirmation
```

jamais auto-apply.

---

# 17. Acceptance — Sources & Extraction

La suite détaillée `SOURCES-S01` à `SOURCES-S25` est obligatoire.

## AC-SRC-01 — Snapshot

Une Source logique peut avoir plusieurs snapshots immuables.

## AC-SRC-02 — Hash

Chaque snapshot utilisable possède un hash de contenu.

## AC-SRC-03 — PDF

Extraction texte native avant OCR.

## AC-SRC-04 — OCR

OCR uniquement en fallback et identifiable.

## AC-SRC-05 — GPX

Le GPX utilise le pipeline géospatial, pas un LLM.

## AC-SRC-06 — IA

L’IA produit des candidats structurés.

Elle ne publie jamais seule.

## AC-SRC-07 — Provenance

Chaque candidat / version publiée critique peut revenir à une preuve exacte.

## AC-SRC-08 — Conflit

Deux informations contradictoires ne sont jamais fusionnées / arbitrées automatiquement.

## AC-SRC-09 — Publication

Une publication crée :

```text
RaceFactVersion N+1
```

et ne modifie pas la version N.

## AC-SRC-10 — Officielle

Seul le workflow organisation autorisé peut donner le niveau Official.

## AC-SRC-11 — Changement

Une nouvelle source n’écrase jamais silencieusement un Fact publié.

## AC-SRC-12 — Impact

Un changement critique peut identifier les Plans potentiellement impactés.

Il ne les modifie pas automatiquement.

## AC-SRC-13 — SSRF

Une source URL ne peut pas atteindre un réseau privé / localhost.

## AC-SRC-14 — Prompt injection

Un contenu documentaire ne peut jamais donner des instructions exécutables au système.

---

# 18. Acceptance — Demander à PLUKA

## AC-ASK-01

Q&A privilégie :

1. facts publiés ;
2. sources des facts ;
3. chunks complémentaires.

## AC-ASK-02

Information absente :

> **Je n’ai pas trouvé cette information dans les sources disponibles.**

Pas d’invention.

## AC-ASK-03

Une réponse peut citer la source exacte.

## AC-ASK-04

Une question météo avant J-14 ne contourne pas la règle Weather.

## AC-ASK-05

Une question premium n’accède qu’aux données du user et selon entitlement.

## AC-ASK-06

L’organisation ne lit jamais les conversations individuelles.

---

# 19. Acceptance — Communauté

Communauté est V1 non bloquante Core.

Si elle est activée :

## AC-COM-01

Scope Race / Edition.

## AC-COM-02

Pas de :

- followers ;
- stories ;
- DM ;
- feed global.

## AC-COM-03

Aucun post ne révèle automatiquement :

- email ;
- Plan ;
- Nutrition ;
- Assistance.

## AC-COM-04

Le contenu communautaire reste distinct d’un Fact officiel.

---

# 20. Acceptance — Après-course

## AC-POST-01

Le user peut enregistrer :

- statut ;
- résultat ;
- ressenti ;
- retour Plan ;
- Nutrition ;
- Assistance ;
- matériel ;
- note privée.

## AC-POST-02

La note privée reste privée.

## AC-POST-03

Une publication communautaire crée un snapshot explicite limité.

## AC-POST-04

DNS / DNF ne détruisent pas l’historique.

---

# 21. Acceptance — Entitlements

La suite détaillée `ENTITLEMENTS-E01` à `ENTITLEMENTS-E39` est obligatoire.

## AC-ENT-01

Free est implicite.

## AC-ENT-02

Race Pass :

```text
user + participantRace
```

## AC-ENT-03

PLUKA+ :

```text
global user
```

## AC-ENT-04

Organizer Included :

```text
participantRace
```

et non global.

## AC-ENT-05

Beta est modélisée explicitement, sans changer la définition de Free.

## AC-ENT-06

Le client ne peut jamais définir :

```text
tier = plus
```

pour obtenir le droit.

## AC-ENT-07

Chaque mutation premium revérifie le serveur.

## AC-ENT-08

Les feature flags restent distincts des entitlements.

## AC-ENT-09

Une alerte officielle n’est jamais paywallée.

## AC-ENT-10

PLUS + Race Pass :

```text
droits PLUS
```

sans supprimer l’historique Race Pass.

## AC-ENT-11

Organizer Included ne donne pas à l’organisation accès aux données privées.

## AC-ENT-12

Le paiement externe crée un entitlement uniquement après confirmation serveur / webhook idempotent.

## AC-ENT-13

Une expiration retire les nouvelles actions premium mais ne détruit pas les données.

---

# 22. Acceptance — Billing

Si le paiement est activé en V1 commercial :

## AC-BILL-01

Les produits sont identifiés par des clés stables :

```text
race_pass
plus_annual
```

pas par leurs prix.

## AC-BILL-02

Un webhook dupliqué ne crée pas deux droits.

## AC-BILL-03

Un paiement pending ne donne pas un accès définitif.

## AC-BILL-04

Un user déjà PLUS ne peut pas acheter inutilement un Race Pass sans traitement explicite.

## AC-BILL-05

Une Race Organizer Included ne pousse pas un achat Race Pass.

## AC-BILL-06

Le crédit Race Pass → PLUS n’est pas implémenté tant qu’il n’est pas officiellement figé.

---

# 23. Acceptance — Privacy / RLS

La suite détaillée `PRIVACY-P01` à `PRIVACY-P73` est obligatoire avant bêta externe.

## AC-PRIV-01

RLS est activée sur toutes les tables applicatives pertinentes.

## AC-PRIV-02

Le comportement par défaut est deny.

## AC-PRIV-03

Le schéma `private` est inaccessible à `anon` et `authenticated`.

## AC-PRIV-04

Aucune clé `service_role` n’atteint le navigateur.

## AC-PRIV-05

L’organisation ne lit jamais directement :

- RacePlan ;
- PlanWaypoint ;
- PlanSegment ;
- Nutrition ;
- Assistance ;
- Outings ;
- WeatherRun personnel ;
- Q&A personnel ;
- post-race privé.

## AC-PRIV-06

Un Owner organisation n’est pas propriétaire des données participant.

## AC-PRIV-07

Le B2B utilise des payloads safe / agrégés.

## AC-PRIV-08

Le seuil de sous-groupe B2B minimum est :

```text
10
```

## AC-PRIV-09

Les breakdowns JSON respectent également ce seuil.

## AC-PRIV-10

Aucun filtre B2B ne permet d’isoler un participant.

## AC-PRIV-11

Les tokens :

- Assistance ;
- Brief ;
- Invitation ;

sont hashés.

## AC-PRIV-12

Les URLs tokenisées :

- noindex ;
- referrer protégé ;
- analytics sans token brut.

## AC-PRIV-13

Les fichiers privés utilisent signed URLs.

## AC-PRIV-14

Le GPX personnel Outing n’est jamais lisible par l’organisation.

## AC-PRIV-15

Les use cases serveur revérifient le métier même avec `service_role`.

---

# 24. Acceptance — Data Model

Les 18 critères de `02_DATA_MODEL.md` sont obligatoires.

En complément :

## AC-DATA-01

Toutes les migrations peuvent reconstruire la base depuis zéro :

```text
supabase db reset
```

ou mécanisme équivalent.

## AC-DATA-02

Aucune donnée fonctionnelle importante n’existe uniquement dans :

- React state ;
- localStorage ;
- JSON temporaire non documenté.

## AC-DATA-03

Les nouvelles exigences identifiées dans les specs sont représentables avant de coder leurs workflows complets.

Cela concerne notamment :

- Nutrition diff / stable keys ;
- Weather engine/config versions ;
- Race Intelligence run inputs privés ;
- Entitlement usage ledger.

## AC-DATA-04

Une migration déjà appliquée n’est pas réécrite arbitrairement.

Créer une nouvelle migration.

## AC-DATA-05

Les FK critiques sont indexées.

## AC-DATA-06

Les valeurs calculées nécessitant reproductibilité conservent :

- engine version ;
- config version si applicable ;
- input hash ;
- snapshot lorsque requis.

---

# 25. Acceptance — Architecture

Les 20 critères de `01_ARCHITECTURE.md` sont obligatoires.

## AC-ARCH-01

Plan Engine peut tourner sans :

- Next.js ;
- Supabase ;
- IA ;
- réseau.

## AC-ARCH-02

Nutrition Engine possède la même indépendance.

## AC-ARCH-03

Conditions sépare :

```text
pur domain
provider adapter
I/O
```

## AC-ARCH-04

Sources sépare :

```text
fetch / parse
extraction
validation
publication
```

## AC-ARCH-05

Race Intelligence Engine ne dépend pas du BO React.

## AC-ARCH-06

PostgreSQL reste la source de vérité.

## AC-ARCH-07

Les traitements longs utilisent worker / queue.

## AC-ARCH-08

Les jobs sont idempotents.

## AC-ARCH-09

Les mutations critiques utilisent outbox / mécanisme équivalent afin de ne pas perdre les effets downstream.

## AC-ARCH-10

Chaque provider externe est derrière une interface remplaçable.

## AC-ARCH-11

Une panne provider dégrade la feature concernée sans corrompre le domaine principal.

---

# 26. Acceptance — Routes

Les 60 critères de `05_ROUTES_AND_FLOWS.md` sont obligatoires.

## AC-ROUTE-01

Navigation course :

```text
Plan
Préparation
Assistance
Course
```

et seulement ces quatre destinations principales.

## AC-ROUTE-02

Nutrition vit sous :

```text
/plan/nutrition
```

ou structure équivalente.

## AC-ROUTE-03

Conditions vit sous :

```text
/plan/conditions
```

## AC-ROUTE-04

Il n’existe pas de route principale globale :

```text
/app/weather
/app/nutrition
```

## AC-ROUTE-05

B2B :

```text
Accueil
Ma course
Analyse
Participants
```

## AC-ROUTE-06

Sources est une sous-expérience de Ma course.

## AC-ROUTE-07

Race Intelligence est une sous-expérience d’Analyse.

## AC-ROUTE-08

Les routes tokenisées passent toujours par le serveur.

## AC-ROUTE-09

Les pages privées sont `noindex`.

## AC-ROUTE-10

Un deep link repasse par tous les guards.

## AC-ROUTE-11

Les guards vérifient Privacy avant entitlement afin de ne pas révéler un objet privé d’un autre user.

---

# 27. Acceptance — Design System

Les 35 critères du `06_DESIGN_SYSTEM.md` sont obligatoires pour les écrans de production.

## AC-DS-01

Palette canonique uniquement, hors exception documentée.

## AC-DS-02

Fonts :

```text
Archivo
Hanken Grotesk
Martian Mono
```

selon leur rôle.

## AC-DS-03

Radius standard :

```text
2–3 px
```

## AC-DS-04

Pas d’ombre décorative sur chaque surface.

## AC-DS-05

Un seul CTA Lichen dominant par zone décisionnelle.

## AC-DS-06

Aube sert à la prochaine échéance / prochain jalon.

## AC-DS-07

Les listes privilégient les filets et blocs bord à bord.

## AC-DS-08

Le topo reste discret.

## AC-DS-09

Le profil d’altitude est un composant signature.

## AC-DS-10

Aucun emoji métier à la place d’une iconographie cohérente.

## AC-DS-11

L’état officiel / estimation / prévision est toujours textuellement identifiable.

## AC-DS-12

B2B et B2C utilisent la même identité.

---

# 28. Acceptance — Accessibilité

## AC-A11Y-01

Cible de production :

```text
WCAG 2.2 AA
```

## AC-A11Y-02

Tous les contrôles principaux sont accessibles au clavier.

## AC-A11Y-03

Focus visible.

## AC-A11Y-04

Cible tactile principale :

```text
>= 44 × 44 px
```

## AC-A11Y-05

La couleur n’est jamais le seul moyen de transmettre un état.

## AC-A11Y-06

Les formulaires possèdent des labels réels.

## AC-A11Y-07

Les erreurs sont reliées au champ.

## AC-A11Y-08

Les graphiques importants ont une alternative textuelle.

## AC-A11Y-09

Le profil d’altitude possède une représentation accessible des passages.

## AC-A11Y-10

`prefers-reduced-motion` est respecté.

## AC-A11Y-11

Les contrastes sont vérifiés sur les paires réellement utilisées.

## AC-A11Y-12

Aucun overflow horizontal non intentionnel sur les vues mobile critiques.

---

# 29. Acceptance — Responsive

## AC-RESP-01

B2C est réellement utilisable à environ 375 px de largeur.

## AC-RESP-02

Les tables B2C critiques deviennent une représentation mobile exploitable.

## AC-RESP-03

La bottom navigation course reste accessible sans chevauchement.

## AC-RESP-04

Le Plan conserve :

- profil ;
- ETA ;
- actions ;

sans zoom navigateur.

## AC-RESP-05

B2B desktop présente les analyses détaillées.

## AC-RESP-06

B2B mobile présente au minimum :

- conclusions ;
- Brief ;
- alertes ;

sans tenter de miniaturiser toute la data.

---

# 30. Acceptance — Performance frontend

Objectifs à mesurer, pas à deviner.

## AC-PERF-01

Une page normale ne bloque pas sur :

- ingestion ;
- Race Intelligence ;
- refresh météo ;
- génération Brief.

## AC-PERF-02

Les jobs asynchrones exposent un état de progression / fraîcheur.

## AC-PERF-03

Le dernier snapshot valide peut rester visible pendant recalcul lorsqu’il est encore pertinent.

## AC-PERF-04

Les assets topo / photo ne provoquent pas un chargement démesuré.

## AC-PERF-05

Les fonts sont chargées de manière optimisée.

## AC-PERF-06

Le mobile ne télécharge pas inutilement de gros payloads B2B / course.

---

# 31. Acceptance — Offline / Race Pack

Si Race Pack offline est livré dans le scope initial :

## AC-OFF-01

Les données offline sont explicitement identifiées comme snapshotées.

## AC-OFF-02

L’UI indique la dernière synchronisation.

## AC-OFF-03

Une météo offline n’est pas présentée comme récente.

## AC-OFF-04

Les données privées ne sont pas mises dans un cache public.

## AC-OFF-05

La sortie du compte purge les données locales sensibles selon la stratégie définie.

Si Race Pack offline n’est pas livré au premier incrément, il doit rester feature-flaggé sans simulation.

---

# 32. Acceptance — B2B Participants

## AC-B2B-PART-01

L’organisation peut importer une liste de participants par fichier.

## AC-B2B-PART-02

Le mapping de colonnes est visible avant validation.

## AC-B2B-PART-03

Les lignes invalides sont signalées.

## AC-B2B-PART-04

Un import ne modifie jamais la Race d’une autre organisation.

## AC-B2B-PART-05

Le BO affiche uniquement les PII nécessaires au workflow.

## AC-B2B-PART-06

L’organisation peut inviter ses participants.

## AC-B2B-PART-07

Une invitation Organizer Included peut créer le grant prévu.

## AC-B2B-PART-08

Le BO ne montre jamais :

- Plan ;
- objectif ;
- Nutrition ;
- Assistance.

---

# 33. Acceptance — B2B Enrichment

## AC-B2B-ENR-01

V1 fonctionne sans API ITRA / UTMB.

## AC-B2B-ENR-02

Un fichier enrichi peut être importé.

## AC-B2B-ENR-03

Un matching ambigu exige une validation.

## AC-B2B-ENR-04

ITRA et UTMB restent des providers distincts.

## AC-B2B-ENR-05

Les signaux finaux sont persistés dans le domaine privé prévu.

## AC-B2B-ENR-06

L’organisation ne reçoit pas un leaderboard des indices dans Analyse.

---

# 34. Acceptance — B2B Sources

## AC-B2B-SRC-01

L’organisation ajoute un PDF / URL sans configurer un pipeline technique.

## AC-B2B-SRC-02

L’analyse est asynchrone.

## AC-B2B-SRC-03

Le BO remonte :

- ce qui a changé ;
- ce qui se contredit ;
- ce qui mérite validation.

## AC-B2B-SRC-04

L’organisation ne voit pas les détails techniques IA inutiles.

## AC-B2B-SRC-05

Un fact publié devient immédiatement disponible dans le référentiel Course.

---

# 35. Acceptance — B2B Question Insights

## AC-B2B-Q-01

Les questions individuelles restent privées.

## AC-B2B-Q-02

Un insight ne devient visible que sous forme agrégée respectant le seuil de confidentialité.

## AC-B2B-Q-03

Une question répétée sans Fact fiable peut être identifiée comme :

```text
information manquante potentielle
```

## AC-B2B-Q-04

Une question répétée avec Fact existant devient plutôt :

```text
information beaucoup demandée
```

## AC-B2B-Q-05

L’organisation peut publier une réponse officielle.

## AC-B2B-Q-06

La réponse devient ensuite utilisable par Q&A / Course.

---

# 36. Acceptance — Brief organisateur

## AC-BRIEF-01

Le Brief est construit depuis des données safe / agrégées.

## AC-BRIEF-02

Il présente les conclusions avant les détails.

## AC-BRIEF-03

Il ne contient aucune PII participant.

## AC-BRIEF-04

Il ne contient aucun Plan individuel.

## AC-BRIEF-05

Le partage utilise un token hashé.

## AC-BRIEF-06

Le token est révocable.

## AC-BRIEF-07

La route partagée est noindex.

## AC-BRIEF-08

Le Brief peut rester utile même si Race Intelligence Flow est insuffisante, en affichant les autres blocs valides.

---

# 37. Acceptance — Race Intelligence Beta

La suite détaillée `RI-RI01` à `RI-RI44` est obligatoire pour le moteur Beta.

## AC-RI-01

Race Intelligence n’est jamais nécessaire pour faire fonctionner la préparation coureur.

## AC-RI-02

Un Plan individuel peut servir de signal serveur.

Il n’est jamais exposé à l’organisation.

## AC-RI-03

ITRA et UTMB ne sont jamais moyennés.

## AC-RI-04

Aucun index n’est converti directement en chrono via une formule arbitraire.

## AC-RI-05

La cohorte Plan sert d’ancrage temporel V1.

## AC-RI-06

Participant performance-only :

```text
percentile provider
→ quantile cohort Plan
```

selon la spec.

## AC-RI-07

Participant sans signal :

```text
generic pool agrégé
```

et aucun ETA individuel dérivé persisté.

## AC-RI-08

Pas assez de Plans :

```text
Flow unavailable
```

et aucun graphe fictif.

## AC-RI-09

La couverture est toujours affichable / disponible avec le résultat.

## AC-RI-10

Les flow buckets utilisent des contributions probabilistes agrégées.

## AC-RI-11

`lower / upper` sont des plages modèle.

Ils ne sont pas présentés comme intervalle de confiance scientifique.

## AC-RI-12

Les cutoffs restent agrégés.

Aucun “coureur à risque”.

## AC-RI-13

Weather exposure seulement à J-14.

## AC-RI-14

Weather exposure reste agrégée.

## AC-RI-15

Privacy Mask est appliqué avant l’API B2B.

## AC-RI-16

Minimum groupe :

```text
10
```

## AC-RI-17

Chaque run completed est immuable.

## AC-RI-18

Recompute batché.

## AC-RI-19

Input snapshot public ne contient aucune PII.

## AC-RI-20

Les références individuelles de reproductibilité restent dans `private`.

---

# 38. Gate Race Intelligence Production

Race Intelligence peut être utilisé en `beta` après :

```text
spec
+
tests
+
privacy
+
pilote
```

Race Intelligence ne peut passer en `production` que si :

1. `algorithm_version` est figée ;
2. `config_version` est figée ;
3. `calibration_version` existe ;
4. les backtests sont documentés ;
5. les seuils d’erreur sont acceptés ;
6. le biais de cohorte PLUKA a été évalué ;
7. Privacy Review est validée ;
8. RLS / safe API sont testées ;
9. aucun output individuel n’existe ;
10. le wording est validé ;
11. le feature flag production est activé côté serveur.

Sans cela :

```text
mode = beta
```

ou feature désactivée.

---

# 39. Acceptance — Météo B2B

## AC-RI-WX-01

Aucune tendance avant J-14.

## AC-RI-WX-02

Le B2B n’utilise pas une route qui expose les WeatherRuns personnels.

## AC-RI-WX-03

L’exposition du peloton indique son dénominateur / couverture.

## AC-RI-WX-04

Une Condition météo n’active jamais un kit officiel.

## AC-RI-WX-05

Une décision officielle publiée par l’organisation prend visuellement le dessus.

---

# 40. Acceptance — Design / produit “simple”

Ce critère nécessite une validation humaine.

## AC-SIMPLE-01 — Coureur

Après quelques minutes de test, un utilisateur doit pouvoir reformuler :

> **PLUKA prend ma course et mon objectif, construit mon Plan, puis m’aide à organiser tout ce qu’il faut autour.**

## AC-SIMPLE-02 — Organisation

Après quelques minutes, un organisateur doit pouvoir reformuler :

> **Je fournis les données que je possède déjà. PLUKA me remonte ce qui mérite mon attention et aide mes participants à mieux se préparer.**

## AC-SIMPLE-03

Aucun testeur ne doit avoir besoin de comprendre les noms :

- RaceFactVersion ;
- extraction run ;
- kernel ;
- entitlement ;
- weather run ;

pour utiliser le produit.

## AC-SIMPLE-04

Le BO ne doit pas donner l’impression d’être un outil supplémentaire à administrer quotidiennement.

---

# 41. E2E critique — Coureur Free

## E2E-C01 — Première préparation

```text
Homepage
→ choisir Race
→ Profil express
→ objectif
→ Plan initial
```

Attendu :

- aucun paiement requis avant premier Plan ;
- Plan lisible ;
- sources Course accessibles ;
- matériel obligatoire accessible.

## E2E-C02 — Action premium

Depuis le Plan Free :

```text
Modifier objectif
→ paywall Race Pass
```

Le contenu Free reste visible.

---

# 42. E2E critique — Race Pass

## E2E-C03 — Achat Race Pass

```text
Paywall
→ checkout
→ webhook
→ entitlement
→ retour action
→ modification Plan
```

Attendu :

- un seul entitlement ;
- retour au bon contexte ;
- modification autorisée serveur.

## E2E-C04 — Nutrition

```text
Plan
→ Nutrition
→ cibles
→ produits
→ génération
→ édition
→ confirmation
```

Attendu :

- stratégie persistée ;
- couverture ;
- `À préparer`.

## E2E-C05 — Assistance

```text
Assistance
→ ajouter assistant
→ rendez-vous
→ partager
→ ouvrir lien privé
```

Attendu :

- payload safe ;
- ETA issue du Plan ;
- aucun compte Assistant requis.

---

# 43. E2E critique — Conditions

## E2E-C06 — J-15

Race Pass actif.

Attendu :

```text
aucune prévision
```

## E2E-C07 — J-14

```text
Accueil
→ Vérifier les premières conditions
→ Conditions
```

Attendu :

- point-by-point ;
- ETA ;
- altitude ;
- updatedAt.

## E2E-C08 — Weather → Nutrition

```text
Condition
→ voir impact
→ proposal
→ appliquer
```

Attendu :

- cible / profil utilisateur utilisé ;
- mutation seulement après confirmation.

## E2E-C09 — Weather → Préparation

```text
Condition
→ suggestion
→ Ajouter à checklist
```

Attendu :

- suggestion distincte de l’obligatoire.

---

# 44. E2E critique — Plan downstream

## E2E-C10

User modifie un segment.

Attendu :

```text
Plan vN+1
↓
Assistance ETA recalée
↓
Conditions recalées
↓
Nutrition diff si nécessaire
```

Aucune personnalisation Nutrition n’est silencieusement écrasée.

---

# 45. E2E critique — Race Pass Outings

## E2E-C11

```text
Race
→ Tester ma stratégie
→ Outing liée #1
→ Nutrition adaptée
→ feedback
```

La Race reste inchangée.

## E2E-C12

Après deux usages :

```text
création #3
→ quota exceeded / upgrade
```

Supprimer #1 ne libère pas automatiquement le quota.

---

# 46. E2E critique — PLUKA+

## E2E-C13

User PLUS :

```text
Ma saison
→ nouvelle Race
→ premium accessible
```

sans nouvel achat.

## E2E-C14

```text
Sorties
→ créer Outing personnelle
→ Conditions J-14
→ Nutrition
```

autorisé.

---

# 47. E2E critique — Invitation organisateur

## E2E-C15

```text
/invite/token
→ preview
→ auth
→ claim
→ Organizer Included
→ objectif
→ Plan
```

Attendu :

- pas de pricing ;
- claim unique ;
- token invalidé / consommé ;
- Plan toujours privé vis-à-vis de l’organisation.

---

# 48. E2E critique — Source change

## E2E-S01

```text
Org ajoute source
→ ingestion
→ extraction
→ candidat
→ validation
→ publish
```

Attendu :

- Fact versionné ;
- provenance ;
- impact analysable.

## E2E-S02

Nouvelle source contredit un Fact.

Attendu :

```text
conflict
```

pas d’auto-publish.

---

# 49. E2E critique — Organisateur

## E2E-O01 — Setup course

```text
login org
→ Accueil
→ Ma course
→ Sources
→ Participants
```

Le BO reste compréhensible sans formation technique.

## E2E-O02 — Import participants

```text
CSV
→ mapping
→ preview
→ validation
→ import
```

Attendu :

- erreurs visibles ;
- aucune cross-org.

## E2E-O03 — Invitations

```text
Participants
→ sélectionner
→ inviter
```

Attendu :

- statuses ;
- aucun accès aux Plans après activation.

---

# 50. E2E critique — Race Intelligence

## E2E-O04 — Couverture insuffisante

Attendu :

```text
Analyse
→ couverture
→ “pas assez de données”
```

Pas de faux flow.

## E2E-O05 — Beta prête

Avec cohorte suffisante :

```text
Analyse
→ À retenir
→ Peloton
→ Flux
→ Barrières
```

Attendu :

- aucun identifiant participant ;
- coverage visible ;
- langage prudent.

## E2E-O06 — J-14 Weather exposure

Attendu :

- exposition agrégée ;
- aucune décision kit automatique.

---

# 51. E2E critique — Question Insight

## E2E-O07

```text
questions similaires
→ snapshot agrégé
→ insight parking
→ organisation ajoute réponse officielle
→ Fact publié
→ Ask PLUKA répond avec cette information
```

Aucune conversation individuelle n’est exposée.

---

# 52. E2E critique — Brief

## E2E-O08

```text
Accueil
→ Générer Brief
→ preview
→ partager
→ /brief/token
```

Attendu :

- agrégats safe ;
- pas de PII ;
- token hashé ;
- révocation fonctionnelle.

---

# 53. Acceptance — Failure modes

PLUKA doit échouer proprement.

## AC-FAIL-01 — Weather

Provider down :

```text
Plan reste disponible
Conditions indisponibles
```

## AC-FAIL-02 — AI extraction

Extraction échoue :

```text
source status erreur
Facts publiés existants inchangés
```

## AC-FAIL-03 — Race Intelligence

Run échoue :

```text
dernier snapshot valide reste daté
```

ou état indisponible.

Aucune donnée partielle présentée comme complète.

## AC-FAIL-04 — Billing

Webhook retardé :

```text
paiement en confirmation
```

pas de faux entitlement.

## AC-FAIL-05 — Worker retry

Retry n’entraîne aucun doublon métier.

---

# 54. Acceptance — Time & timezone

## AC-TIME-01

Les horaires Course sont stockés en `timestamptz` lorsqu’ils représentent un instant réel.

## AC-TIME-02

La timezone IANA est conservée.

## AC-TIME-03

Un ultra multi-jour fonctionne dans :

- Plan ;
- Nutrition ;
- Conditions ;
- Assistance.

## AC-TIME-04

Aucun moteur ne reset l’elapsed à minuit.

## AC-TIME-05

Le passage heure d’été / fuseau ne repose pas sur une addition de chaînes `HH:MM`.

---

# 55. Acceptance — Provenance & trust

## AC-TRUST-01

Une information critique visible possède un moyen d’accéder à sa provenance lorsqu’elle en a une.

## AC-TRUST-02

Les catégories suivantes restent distinctes :

```text
Officielle
Validée PLUKA
Communautaire
Prévision externe
Estimation
```

## AC-TRUST-03

Une valeur estimée n’est jamais stylée / sérialisée comme officielle.

## AC-TRUST-04

Une prévision météo n’est jamais labellisée “Officielle”.

## AC-TRUST-05

Une décision organisateur prend priorité sur une suggestion PLUKA.

---

# 56. Acceptance — Observabilité

## AC-OBS-01

Chaque run moteur possède un identifiant / version utile au diagnostic.

## AC-OBS-02

Plan conserve :

- engine version ;
- input hash.

## AC-OBS-03

Nutrition conserve les versions / hash prévus une fois la migration alignée.

## AC-OBS-04

Weather conserve :

- provider ;
- fetchedAt ;
- forecastIssuedAt si disponible ;
- input hash ;
- versions de config requises.

## AC-OBS-05

Race Intelligence conserve :

- algorithm ;
- config ;
- calibration ;
- input hash.

## AC-OBS-06

Les logs ne contiennent pas de PII inutile.

## AC-OBS-07

Les erreurs provider peuvent être diagnostiquées sans exposer de secrets.

---

# 57. Acceptance — Sécurité applicative

## AC-SEC-01

Aucun secret dans Git.

## AC-SEC-02

Aucune variable `NEXT_PUBLIC_*` ne contient un secret serveur.

## AC-SEC-03

SSRF protégé.

## AC-SEC-04

Open redirect `returnTo` protégé.

## AC-SEC-05

Tokens cryptographiquement aléatoires.

## AC-SEC-06

Rate limiting sur endpoints tokenisés / sensibles.

## AC-SEC-07

CSP / headers sécurité adaptés en production.

## AC-SEC-08

Les logs / error reporting scrubent :

- token ;
- email ;
- téléphone ;
- signed URL ;
- contenu privé.

---

# 58. Acceptance — Données réelles / environnements

## AC-ENV-01

Local utilise des seeds fictifs.

## AC-ENV-02

Staging ne pointe pas sur la base Production.

## AC-ENV-03

Aucune PII réelle n’est copiée en staging sans processus autorisé.

## AC-ENV-04

Les environnements possèdent des clés provider séparées lorsque nécessaire.

## AC-ENV-05

Un reset local reproduit le schéma et les données de test.

---

# 59. Acceptance — CI minimale

La CI doit au minimum exécuter les catégories correspondant aux changements.

Référence de stack :

```text
pnpm
Turborepo
Vitest
Playwright
Supabase local
pgTAP
```

Une pipeline cible doit permettre :

```text
install
→ lint
→ typecheck
→ unit
→ db reset / migrations
→ RLS tests
→ integration
→ build
→ E2E critiques
```

L’ordre précis peut être optimisé.

---

# 60. Quality Gate avant bêta coureur

**GO** uniquement si :

- Auth OK ;
- Course / Facts OK ;
- onboarding OK ;
- Plan tests passent ;
- Plan initial Free fonctionne ;
- entitlements Race Pass fonctionnent ;
- Nutrition tests passent ;
- Préparation fonctionne ;
- Assistance privée fonctionne ;
- Conditions J-14 fonctionne si annoncée à la bêta ;
- RLS testée ;
- cross-user impossible ;
- aucun service key leak ;
- responsive mobile validé ;
- sources critiques accessibles ;
- erreurs provider dégradent proprement.

---

# 61. Quality Gate avant bêta organisateur

En plus du gate coureur :

- membership org testé ;
- cross-org impossible ;
- import participants safe ;
- invitations safe ;
- Sources / validation fonctionnent ;
- Official publishing audité ;
- Insights agrégés respectent le seuil 10 ;
- Brief safe ;
- aucune donnée Plan accessible ;
- Race Intelligence reste beta / feature flag selon readiness.

---

# 62. Quality Gate avant paiement réel

En plus du Core :

- produit catalog stable ;
- Race Pass scope testé ;
- PLUS global testé ;
- Organizer Included testé ;
- webhooks signés / idempotents ;
- refund policy codée ;
- entitlements auditables ;
- usage ledger quota sorties ;
- aucune feature premium n’est sécurisée uniquement dans l’UI.

---

# 63. Quality Gate avant Weather réel

- provider choisi ;
- licence / usage validé ;
- interface provider ;
- cache / quota ;
- timestamps ;
- point-by-point ;
- J-14 ;
- stale / failed ;
- aucune correction altitude inventée ;
- Conditions proposals non automatiques ;
- tests W01–W39 ;
- migration metadata moteur/config alignée.

---

# 64. Quality Gate avant Race Intelligence Beta

- spec `RACE_INTELLIGENCE.md` implémentée ;
- private inputs safe ;
- coverage ;
- Plan anchor cohort ;
- mapping provider ;
- generic pool ;
- flows ;
- cutoff ;
- Privacy Mask ;
- seuil 10 ;
- safe API ;
- aucun ETA individuel dérivé persisté ;
- fixtures demo séparées ;
- tests RI01–RI44 ;
- pilote explicitement en `beta`.

---

# 65. Quality Gate avant Race Intelligence Production

En plus du Beta :

- données pilotes suffisantes ;
- backtests ;
- calibration ;
- `calibration_version` ;
- seuils approuvés ;
- biais cohorte étudié ;
- wording approuvé ;
- Privacy review ;
- revue métier organisateur ;
- activation serveur explicite.

Sans ces éléments :

```text
NO GO production
```

---

# 66. Quality Gate avant lancement public V1

Le lancement public est autorisé uniquement si :

### Produit

- promesse coureur compréhensible ;
- promesse organisateur compréhensible ;
- pas d’usine à gaz ;
- pas de feature non terminée annoncée.

### Tech

- production build stable ;
- migrations reproductibles ;
- monitoring ;
- backups ;
- providers ;
- jobs.

### Sécurité

- RLS complète ;
- tests cross-user / cross-org ;
- tokens ;
- secrets ;
- error scrub.

### Business

- entitlements ;
- checkout si activé ;
- CGU / Privacy / mentions nécessaires ;
- pricing cohérent.

### Data trust

- source provenance ;
- versioning ;
- aucune auto-publication IA ;
- aucune mutation silencieuse.

---

# 67. NO GO absolus

La production est interdite si l’un de ces points existe :

1. une organisation peut lire un Plan individuel ;
2. une organisation peut lire Nutrition ;
3. une organisation peut lire Assistance ;
4. un user peut modifier son entitlement depuis le client ;
5. le `service_role` est accessible au navigateur ;
6. une RaceFactVersion publiée peut être modifiée en place ;
7. une extraction IA peut publier seule ;
8. une nouvelle source remplace silencieusement un Fact ;
9. Weather modifie automatiquement le pacing ;
10. Weather s’affiche avant J-14 comme tendance personnalisée ;
11. Conditions modifie Nutrition sans confirmation ;
12. un produit Nutrition est supprimé silencieusement lors d’un recalcul ;
13. un override Plan est écrasé ;
14. un token privé est stocké en clair ;
15. Race Intelligence expose un participant ;
16. Race Intelligence utilise une conversion index → chrono non calibrée ;
17. un groupe B2B <10 est exposé ;
18. des fixtures prototype sont utilisées comme vérité production ;
19. un paiement query param crée un droit ;
20. les migrations ne peuvent pas reconstruire la base.

---

# 68. Definition of Done d’une story Claude Code

Pour chaque story, Claude Code doit fournir / vérifier :

```text
[ ] scope compris
[ ] specs lues
[ ] contradiction signalée si présente
[ ] code minimal
[ ] aucune feature adjacente inventée
[ ] types
[ ] validation input
[ ] authorization server
[ ] RLS concernée revue
[ ] persistence correcte
[ ] tests unitaires
[ ] tests intégration si I/O
[ ] E2E si flow critique
[ ] état loading
[ ] état empty
[ ] état error
[ ] responsive nécessaire
[ ] accessibilité
[ ] observabilité minimale
[ ] docs mises à jour si comportement modifié
[ ] aucune donnée demo en logique métier
```

---

# 69. Template d’acceptance pour une nouvelle story

Chaque future tâche peut utiliser :

```md
## Story

En tant que ...
Je veux ...
Afin de ...

## Scope

IN:
- ...

OUT:
- ...

## Acceptance Criteria

AC-01
Given ...
When ...
Then ...

AC-02
...

## Security

- ownership:
- roles:
- entitlement:
- RLS:

## Data

- tables:
- migrations:
- versioning:

## Tests

- unit:
- integration:
- RLS:
- E2E:

## UX

- route:
- loading:
- empty:
- error:
- mobile:
- accessibility:

## Observability

- events:
- logs:
- metrics:
```

---

# 70. Suites de tests héritées obligatoires

Les suites détaillées suivantes restent les références spécialisées et ne doivent pas être supprimées sous prétexte que ce document existe :

```text
PLAN_ENGINE
P01 → P22
+ property tests

NUTRITION_ENGINE
N01 → N38

SOURCES_EXTRACTION
S01 → S25

WEATHER_CONDITIONS
W01 → W39

RACE_INTELLIGENCE
RI01 → RI44

ENTITLEMENTS
E01 → E39

PRIVACY_RLS
P01 → P73

ROUTES_AND_FLOWS
60 critères

DESIGN_SYSTEM
35 critères

ARCHITECTURE
20 critères

DATA_MODEL
18 critères
```

Dans les rapports de test, utiliser un namespace pour éviter l’ambiguïté :

```text
PLAN-P01
PRIVACY-P01
```

---

# 71. Traceability Matrix recommandée

Maintenir progressivement un fichier ou tableau CI permettant de relier :

```text
Requirement
→ Code
→ Test
```

Exemple :

| Requirement | Spec | Test |
|---|---|---|
| J-14 strict | Weather §6 | `WEATHER-W01`, E2E-C06 |
| Org ne lit pas Plan | Privacy §31 | `PRIVACY-P20` |
| Race Pass 2 outings | Entitlements §27 | `ENT-E11..E14` |
| Plan deterministic | Plan §35 | `PLAN-P14` |
| Source immutable | Sources §33–35 | `SOURCES-S09..S10` |

Cette matrice peut être légère au début.

Elle ne doit pas devenir une administration manuelle lourde.

---

# 72. Priorité de construction / acceptation

Ordre conseillé des gates :

```text
1. Repo / CI / Supabase local
2. Auth
3. Data Model corrections
4. Privacy / RLS
5. Course / Sources
6. ParticipantRace / onboarding
7. Plan Engine
8. Plan UI
9. Preparation
10. Nutrition Engine + UI
11. Assistance
12. Conditions
13. Ma saison / Outings
14. Entitlements / Billing
15. Ask PLUKA
16. B2B participants / sources
17. Question Insights / Brief
18. Race Intelligence Beta
19. Community / polish non bloquant
20. calibration / production hardening
```

L’ordre peut évoluer par petits lots, mais :

> **Privacy, modèle de données et moteur Plan ne doivent pas être repoussés derrière un long travail cosmétique.**

---

# 73. Validation finale produit

Avant de considérer le prototype transformé en produit réel, effectuer une recette humaine sur au moins :

### Coureur

- nouveau user ;
- Free ;
- Race Pass ;
- PLUS ;
- Organizer Included ;
- mobile ;
- J-15 ;
- J-7 ;
- jour J simulé ;
- course terminée.

### Organisation

- Owner ;
- Viewer ;
- deuxième organisation ;
- import ;
- sources ;
- conflicts ;
- participants ;
- analyse insuffisante ;
- analyse beta ;
- Brief.

### Sécurité

- autre user ;
- autre org ;
- UUID modifié ;
- token expiré ;
- entitlement absent ;
- service use case non autorisé.

---

# 74. Critère de réussite V1

PLUKA V1 est réussi si le produit réel respecte cette double promesse.

## Coureur

> **Je comprends ma course, j’ai un Plan concret et je sais quoi préparer sans multiplier les fichiers, notes et outils.**

## Organisation

> **Je fournis les données que je possède déjà et PLUKA me remonte ce qui mérite mon attention, sans devenir un outil complexe à administrer.**

La réussite technique est au service de ces deux résultats.

---

# 75. Consigne finale

Claude Code ne doit jamais chercher à “faire passer les tests” en affaiblissant une règle métier.

Lorsque l’implémentation révèle une contradiction :

```text
STOP
→ signaler
→ décider
→ mettre à jour la spec
→ coder
```

et non :

```text
choisir l’option la plus simple
→ cacher la différence
```

Les règles finales sont :

> **Aucune feature n’est terminée sans ses tests.**

> **Aucune donnée privée n’est exposée pour faciliter le développement.**

> **Aucune donnée officielle n’est remplacée silencieusement.**

> **Aucun moteur critique ne dépend d’une fixture ou d’un LLM caché.**

> **Aucun paywall ne masque une information officielle essentielle.**

> **Aucune complexité interne ne doit devenir une complexité inutile pour le coureur ou l’organisation.**

---

**Fin — PLUKA Acceptance Criteria V1**
