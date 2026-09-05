# PLUKA — Product Specification V1

**Fichier de référence :** `docs/00_PRODUCT_SPEC.md`  
**Statut :** Référence fonctionnelle — Product Design Freeze V1  
**Date :** 2026-09-03  
**Langue de référence :** français

---

## 0. Rôle de ce document

Ce document est la **référence fonctionnelle principale de PLUKA V1**. Il décrit ce que le produit doit faire, pour qui, avec quelles règles métier et quelles limites.

Il ne décrit pas en détail :

- l’architecture technique ;
- le schéma de base de données ;
- les politiques RLS ;
- les algorithmes détaillés des moteurs Plan, Nutrition, Sources, Conditions ou Race Intelligence ;
- l’implémentation UI composant par composant.

Ces sujets sont décrits dans les documents spécialisés du dossier `/docs`.

### 0.1 Sources de vérité

En cas d’ambiguïté :

1. **`00_PRODUCT_SPEC.md`** fait foi pour le périmètre fonctionnel, les droits, les rôles et les comportements produit.
2. Les specs spécialisées dans `/docs/engines/` font foi pour le comportement détaillé de leurs moteurs.
3. **Le prototype figé** dans `/reference/prototype/` fait foi pour l’expérience, la hiérarchie visuelle, les parcours et l’intention UI.
4. `02_DATA_MODEL.md`, `03_PRIVACY_RLS.md` et les migrations SQL font foi pour l’implémentation des données et des droits techniques.
5. Si deux références se contredisent, **ne pas arbitrer silencieusement dans le code**. Signaler la contradiction et la résoudre dans la documentation avant implémentation.

### 0.2 Prototype de référence

Le prototype canonique est :

- `reference/prototype/PLUKA.dc.html`
- `reference/prototype/PLUKA Homepage.dc.html`
- `reference/prototype/PLUKA Organisateurs.dc.html`
- `reference/prototype/PLUKA Charte Graphique v2.dc.html`

Les données de démonstration associées à des courses ou organisations réelles sont **simulées** et ne prouvent aucune affiliation ni utilisation réelle de PLUKA par ces organisations.

---

# 1. Vision produit

PLUKA est le **cockpit personnel de préparation avant-course du trailer**.

Le produit intervient principalement **après l’inscription à une course** : lorsque le coureur connaît l’épreuve qu’il va courir mais doit encore transformer les informations dispersées de l’organisation en un plan concret et personnel.

La promesse centrale côté coureur est :

> **Ta course. Ton plan. Tout au même endroit.**

La formulation marketing principale peut être :

> **Prépare ta course. PLUKA organise le reste.**

PLUKA transforme :

- les informations officielles de course ;
- le parcours et son profil ;
- l’objectif du coureur ;
- ses préférences de préparation ;

…en :

- Plan de course ;
- temps de passage ;
- Nutrition ;
- Préparation / matériel / sacs ;
- Assistance ;
- Conditions de course ;
- informations fiables et sourcées.

PLUKA doit répondre à la question :

> **« Je suis inscrit. Comment vais-je concrètement gérer cette course ? »**

---

# 2. Ce que PLUKA n’est pas

PLUKA V1 n’est pas :

- une application d’entraînement ;
- un coach sportif ;
- un plan d’entraînement adaptatif ;
- un substitut à Nolio, Runna, Garmin ou Strava ;
- un outil d’analyse de VO2max, charge d’entraînement ou fréquence cardiaque ;
- un réseau social sportif ;
- un service de live tracking ;
- un outil de chronométrage ;
- un PC course ;
- une plateforme d’inscription ;
- un outil médical ;
- un outil de prescription nutritionnelle ou médicale.

PLUKA ne doit pas modifier automatiquement l’objectif ou le pacing d’un coureur en fonction d’une IA, de la météo ou d’un score opaque.

---

# 3. Utilisateurs et rôles

## 3.1 Coureur

Utilisateur principal B2C. Il prépare :

- une course officielle ;
- une sortie personnelle / sortie longue ;
- sa saison de courses.

Il reste propriétaire de ses données personnelles de préparation.

## 3.2 Participant invité par une organisation

Coureur ayant reçu une invitation PLUKA liée à une course financée ou activée par l’organisation.

Il bénéficie des droits prévus par l’offre **Organizer Included** sur la course concernée.

Son onboarding doit être plus court, car les informations de course sont déjà connues.

## 3.3 Assistant / accompagnant

Personne invitée par le coureur à consulter une page privée liée à son assistance.

L’assistant n’a pas besoin de créer un compte dans le MVP.

Il accède uniquement aux informations explicitement partagées avec lui.

## 3.4 Organisation

Entité organisatrice d’un événement ou d’une course.

Ses utilisateurs peuvent avoir plusieurs rôles, à préciser dans `03_PRIVACY_RLS.md`, avec au minimum :

- Owner ;
- Admin ;
- Editor ;
- Viewer.

L’organisation gère ses informations de course et accède uniquement à des analyses participants agrégées autorisées.

## 3.5 Administrateur PLUKA

Rôle interne PLUKA permettant notamment :

- validation de données ;
- administration de la base courses ;
- gestion des sources ;
- gestion d’organisations ;
- actions de support nécessaires.

Les pouvoirs exacts sont décrits dans les règles de sécurité et d’administration.

---

# 4. Modèle conceptuel de course

La hiérarchie fonctionnelle de référence est :

**Event → Edition → Race**

Exemple conceptuel :

- Event : Wildstrubel by UTMB
- Edition : 2026
- Race : Wild 70

Une **Race** représente une épreuve précise d’une édition.

Une course possède notamment :

- nom ;
- date ;
- heure(s) de départ ;
- distance ;
- D+ / D- ;
- GPX ;
- points du parcours ;
- ravitaillements ;
- barrières horaires ;
- règles d’assistance ;
- matériel obligatoire ;
- informations de retrait dossard ;
- transports ;
- sécurité ;
- règlement ;
- sources associées.

Les données générales de course sont partagées entre les participants.

Les données personnelles suivantes appartiennent au participant :

- objectif ;
- Plan ;
- Nutrition ;
- matériel personnel ;
- sacs ;
- Assistance ;
- notes ;
- sorties ;
- retours après-course.


## 4.1 Cycle de vie d'une Race

Une Race possède un statut explicite. Les transitions ci-dessous sont les seules autorisées ;
toute autre est refusée avec `invalid_state`.

```text
draft ──► published ──► completed ──► archived
             │                            ▲
             └────────► cancelled ────────┘
```

| Statut | Sens |
| --- | --- |
| `draft` | En préparation. Non visible publiquement. |
| `published` | Diffusée. Visible et préparable. |
| `cancelled` | Annulée par l'organisation ou par PLUKA. Reste visible. |
| `completed` | Course courue. Déclarée, jamais automatique. |
| `archived` | Sortie de la circulation courante. Réversible. |

### Qui peut faire quoi

| Transition | Autorisé |
| --- | --- |
| `draft → published` | `editor` de l'organisation gestionnaire, ou `pluka_admin` |
| `published → cancelled` | `admin` de l'organisation gestionnaire, ou `pluka_admin` |
| `published → completed` | `pluka_admin` uniquement |
| `completed → archived` | `pluka_admin` uniquement |
| `cancelled → archived` | `pluka_admin` uniquement |
| `archived → completed` / `archived → cancelled` | `pluka_admin` uniquement — retour au statut antérieur à l'archivage |

Un événement sans organisation gestionnaire n'est administrable que par `pluka_admin`.

L'annulation reste possible tant que la course n'est ni `completed` ni `archived`, y compris
après la date de départ : une course peut être annulée sur place le jour J.

`completed` n'est jamais déclenché par le passage de la date. Une course non déclarée reste
`published` — l'échéance seule ne dit pas qu'elle a eu lieu.

### Effets d'une annulation

Une course annulée **reste visible** pour tous les coureurs concernés, avec une mention
« Annulée » explicite partout où elle apparaît : Ma saison, page de course, Race Pack.

Elle n'est jamais masquée ni retirée de l'espace du coureur. Le travail de préparation
appartient au coureur, pas à l'organisation.

Les données personnelles rattachées — Plan, Nutrition, Préparation, Assistance, sacs, notes,
sorties — **restent accessibles et modifiables**. Le coureur peut continuer à les consulter,
à les exporter et à les réutiliser pour une autre course.

Aucune donnée personnelle n'est supprimée, dégradée ni verrouillée par une annulation.

Les moteurs restent utilisables sur une course annulée. PLUKA ne recalcule ni ne réinitialise
quoi que ce soit lors de la transition.

### Effets d'un archivage

Une course archivée sort des listes courantes et de la recherche publique. Elle reste
accessible par lien direct et dans l'espace des coureurs concernés.

L'archivage est réversible par `pluka_admin`, qui la ramène à son statut antérieur.

### Invariants

- Une Race n'est publiquement lisible que si elle est `published`, `cancelled`, `completed`
  ou `archived`, **et** que son Edition est diffusée, **et** que son Event l'est aussi.
- Une Race `draft` n'est jamais lisible publiquement, quelle que soit la chaîne au-dessus.
- Une transition non listée ci-dessus est refusée avec `invalid_state`.
- Un changement de statut est journalisé : qui, quand, depuis quel statut.

> **Point ouvert.** Une course annulée reste-t-elle inscriptible ? La réponse évidente est non,
> mais le mécanisme d'inscription n'est pas encore spécifié — à trancher au lot B2B.

---

# 5. Navigation B2C

## 5.1 Navigation globale

L’espace personnel annuel contient :

- **Accueil**
- **Ma saison**
- **Sorties**
- **Bibliothèque**
- **Communauté**
- **Demander à PLUKA** comme action transversale, et non comme simple chatbot isolé.

## 5.2 Navigation dans une course

Le contexte d’une course contient quatre espaces principaux :

- **Plan**
- **Préparation**
- **Assistance**
- **Course**

### Nutrition

La Nutrition est une **couche du Plan** avec un flow dédié. Elle ne doit pas devenir un onglet principal concurrent du Plan.

### Conditions

Les Conditions de course sont une **sous-vue du Plan**, accessibles à partir de J-14 lorsque les droits le permettent.

Il ne doit pas exister un cinquième onglet principal « Météo ».

---

# 6. Modèle commercial et entitlements

Les détails exhaustifs sont maintenus dans `04_ENTITLEMENTS.md`.

## 6.1 PLUKA Free — 0 €

Objectif : **comprendre et commencer à préparer**.

Le Free doit être réellement utile, pas un aperçu artificiellement flouté.

Il comprend au minimum :

- informations de course ;
- sources consultables ;
- alertes officielles de l’organisation ;
- matériel obligatoire ;
- profil altimétrique ;
- **Plan initial consultable** ;
- temps de passage initiaux ;
- barrières et marges correspondantes lorsque disponibles.

Le Free ne donne pas accès à l’exécution avancée complète : édition avancée du Plan, Nutrition complète, sacs, Assistance complète, Conditions personnalisées, sorties premium, etc.

## 6.2 Race Pass — 14,90 € / course

Objectif : **préparer cette course jusqu’au bout**.

Le Race Pass débloque sur une course :

- Plan complet et éditable ;
- recalculs ;
- Nutrition ;
- Préparation ;
- matériel personnel ;
- sacs ;
- TODO ;
- Assistance ;
- Conditions point par point à partir de J-14 ;
- après-course ;
- exports / Race Pack lorsque disponibles dans le MVP technique ;
- jusqu’à **2 sorties de préparation liées à cette course**.

Les deux sorties liées peuvent utiliser le moteur Nutrition et les Conditions lorsque leur date est à J-14 ou moins et que les prérequis sont renseignés.

## 6.3 PLUKA+ — 44,90 € / an

Facturation annuelle, pas d’abonnement mensuel dans la V1.

Objectif : **préparer toute sa saison**.

PLUKA+ comprend :

- toutes les courses ;
- toutes les fonctions Race Pass ;
- sorties personnelles illimitées ;
- Conditions sur les courses et sorties éligibles ;
- stratégies réutilisables ;
- bibliothèque de produits / matériel / modèles ;
- historique et mémoire de saison.

## 6.4 Organizer Included

Une organisation peut financer ou inclure PLUKA pour une course.

Sur cette course, le participant bénéficie d’un niveau fonctionnel équivalent au Race Pass, incluant :

- préparation complète ;
- Conditions à partir de J-14 ;
- jusqu’à 2 sorties liées.

Ce droit ne donne pas accès aux sorties personnelles illimitées non liées. Celles-ci restent un avantage PLUKA+.

Le participant invité ne doit pas voir de pricing dans son onboarding pour les fonctionnalités financées par l’organisation.

## 6.5 Philosophie du paywall

Règle de référence :

> **PLUKA ne fait pas payer l’accès à l’information de course. PLUKA fait payer sa transformation en préparation personnelle avancée.**

Conséquences :

- pas de grandes zones volontairement floutées ;
- paywalls contextuels au moment d’une action premium ;
- les alertes officielles de sécurité restent accessibles au Free ;
- l’information officielle ne doit jamais être retenue derrière un paywall.

---

# 7. Onboarding coureur

## 7.1 Nouveau coureur

Flow cible :

**Recherche / sélection course → fiche course → Profil trailer → Objectif → cadrage / aperçu → création compte / offre → Plan**

Le produit doit montrer de la valeur avant de demander une configuration lourde.

## 7.2 Profil trailer existant

Si le profil existe déjà :

**Course → confirmer / ajuster profil → Objectif → Plan**

Éviter de reposer systématiquement toutes les questions.

## 7.3 Invitation organisateur

Flow cible :

**Invitation → vérifier les informations préremplies → choisir l’objectif → générer le Plan**

Ne pas demander l’Assistance dans cet onboarding.

L’Assistance sera configurée plus tard depuis son module.

---

# 8. Profil trailer

Le Profil trailer sert à comprendre suffisamment le niveau et l’expérience du coureur pour contextualiser sa préparation, sans devenir un diagnostic physiologique.

Il est **persistant entre les courses**.

## 8.1 Informations principales

Le profil peut demander :

- effort récent représentatif : course ou sortie longue ;
- distance ;
- D+ ;
- durée ;
- date facultative ;
- à défaut, repère d’allure trail ;
- volume moyen km / semaine ;
- D+ moyen / semaine ;
- appréciation compacte de l’aisance en montée / descente ;
- expérience longue distance via quelques choix simples.

L’ensemble doit pouvoir être rempli rapidement, idéalement en moins de 45 secondes à 2 écrans environ dans le flow principal.

## 8.2 Informations exclues du cœur V1

Ne pas demander par défaut :

- VO2max ;
- VMA ;
- zones cardiaques ;
- historique détaillé d’entraînement ;
- puissance ;
- charge d’entraînement.

## 8.3 ITRA / UTMB

Un enrichissement ITRA ou UTMB peut être utilisé plus tard comme signal complémentaire lorsqu’il existe une méthode contractuellement et techniquement fiable.

Il ne doit pas être nécessaire pour utiliser PLUKA.

---

# 9. Objectif et Repère PLUKA

## 9.1 Objectif utilisateur

Le coureur choisit l’objectif qu’il veut préparer, en HH:MM.

Le produit peut proposer des raccourcis de saisie, mais ne doit pas faire croire qu’un chrono précis est automatiquement recommandé sans données suffisantes.

L’objectif reste **la décision du coureur**.

## 9.2 Repère PLUKA

Le Repère PLUKA est une information secondaire et indicative.

Il peut apparaître sur l’écran Objectif sous forme de plage, par exemple :

> Repère PLUKA : 12h45–14h15

Il ne doit jamais être présenté comme :

- une prédiction exacte ;
- une garantie de performance ;
- un objectif imposé.

Le flow ne doit pas contenir un écran autonome obligatoire « Repère PLUKA ».

### Statut du moteur

Le moteur de Repère n’est **pas considéré comme spécifié / calibré par le prototype**.

Tant qu’une spec séparée et une validation appropriée n’existent pas, la production doit :

- soit le placer derrière un feature flag ;
- soit le masquer ;
- soit utiliser uniquement une implémentation explicitement approuvée.

Ne pas transcrire en production une formule de démonstration présente dans le prototype.

---

# 10. Accueil coureur

L’Accueil est un **dashboard d’action**, pas un tableau de statistiques sportives.

Il doit prioriser :

- prochaine course ;
- objectif actuel ;
- arrivée estimée selon le Plan ;
- marge de barrière la plus serrée ;
- état de préparation ;
- tâches urgentes ;
- prochaine sortie liée ;
- changements officiels récents ;
- Conditions uniquement à partir de J-14.

Le coureur doit comprendre rapidement :

> « Qu’est-ce qui mérite mon attention maintenant ? »

Les actions doivent être contextualisées, par exemple :

- compléter matériel obligatoire ;
- vérifier une information officielle ;
- finaliser Nutrition ;
- préparer un sac ;
- consulter une modification ;
- vérifier les Conditions lorsque la fenêtre J-14 est ouverte.

---

# 11. Ma saison

Ma saison fournit une vue annuelle des courses du coureur.

États possibles :

- À préparer
- En préparation
- Prête
- Terminée
- DNS
- DNF

L’objectif n’est pas de créer un calendrier d’entraînement.

Ma saison sert à :

- visualiser les courses passées et futures ;
- reprendre une préparation ;
- accéder à l’historique ;
- capitaliser sur les stratégies et retours antérieurs.

---

# 12. Plan de course

Le Plan est la **feature signature** de PLUKA.

La spec détaillée du moteur est dans `engines/PLAN_ENGINE.md`.

## 12.1 Principe

Le coureur donne un objectif de durée.

PLUKA construit une répartition cohérente sur le parcours à partir notamment de :

- GPX ;
- distance ;
- D+ / D- ;
- pentes ;
- caractéristiques de sections ;
- ravitaillements ;
- barrières ;
- arrêts ;
- paramètres utilisateurs disponibles.

Le moteur Plan doit être **déterministe et testable**. Aucun LLM ne doit calculer le pacing.

## 12.2 Informations affichées

Le Plan affiche notamment :

- profil altimétrique ;
- segments ;
- waypoints ;
- distance ;
- altitude ;
- durées de section ;
- ETA ;
- arrêts ;
- barrières ;
- marges ;
- arrivée estimée ;
- points Assistance lorsqu’ils existent.

## 12.3 Édition premium

Un utilisateur éligible peut notamment :

- modifier l’objectif ;
- modifier une durée de section ;
- modifier un arrêt ;
- fixer une heure de passage ;
- verrouiller des contraintes ;
- demander un recalcul ;
- choisir de rééquilibrer le Plan ou conserver une nouvelle arrivée selon le cas défini par le moteur.

Les contraintes explicites doivent être respectées.

## 12.4 Comportement

Une modification doit recalculer les éléments dépendants de façon cohérente.

Les ETA doivent rester temporellement cohérentes.

Les marges barrières sont recalculées.

Les autres modules dépendants du Plan, notamment Conditions, Nutrition et Assistance, doivent utiliser les nouvelles ETA lorsque nécessaire.

## 12.5 Interdits

PLUKA ne doit pas :

- prétendre que le Plan est une prédiction physiologique parfaite ;
- changer automatiquement l’objectif à cause de la météo ;
- utiliser un LLM pour calculer les horaires ;
- masquer les hypothèses nécessaires à l’utilisateur.

---

# 13. Nutrition

La Nutrition est une couche du Plan.

La spec détaillée est dans `engines/NUTRITION_ENGINE.md`.

## 13.1 Principe

PLUKA aide le coureur à transformer des objectifs de consommation en stratégie concrète sur le parcours.

Dimensions principales :

- glucides (g/h) ;
- hydratation (ml/h) ;
- sodium (mg/h) ;
- caféine totale et répartition temporelle.

Le produit doit parler de **base appropriée à ajuster**, pas d’« optimum » médical ou nutritionnel.

## 13.2 Produits

Le coureur choisit les produits qu’il souhaite utiliser avant génération avancée de la stratégie.

Un produit peut contribuer à plusieurs dimensions :

- glucides ;
- eau / liquide ;
- sodium ;
- caféine.

La boisson énergétique doit notamment être comptabilisée correctement sans double comptage entre hydratation et apports nutritionnels.

## 13.3 Placement

PLUKA peut proposer un placement intelligent des prises.

Le coureur peut ajuster chaque prise.

Une vue avancée par intervalle peut exister sans être nécessaire dans le flow simple.

## 13.4 Ravitaillements

Les ravitaillements officiels peuvent préremplir les possibilités disponibles lorsqu’une information fiable existe.

Sinon l’utilisateur peut ajouter manuellement des éléments.

Le produit doit distinguer :

- À consommer ici
- À remplir
- À emporter

Les aliments génériques de ravitaillement peuvent être représentés avec portions estimées si cette estimation est clairement indiquée.

## 13.5 Préparation de course

La Nutrition doit produire une vue « À préparer pour cette course » comprenant des quantités utiles.

Une marge de réserve peut être définie :

- aucune ;
- +10 % ;
- personnalisée.

La réserve ne doit pas être comptée comme consommée automatiquement.

## 13.6 Sous-couverture

Si la stratégie ne couvre pas les objectifs déclarés :

- afficher un avertissement ;
- proposer une correction ;
- ne jamais modifier silencieusement la stratégie.

## 13.7 Conditions

Les périodes Chaud / Froid / Nuit peuvent influencer la stratégie selon les règles du moteur.

Les conditions météo détectées à partir de J-14 ne peuvent produire qu’une **proposition explicite**, avec :

- période concernée ;
- avant ;
- proposition ;
- impact total ;
- choix Appliquer / Conserver.

Une période météo doit avoir une vraie fin : elle ne doit pas s’étendre jusqu’à l’arrivée si la condition n’y existe plus.

La nuit peut notamment servir à la répartition temporelle de la caféine sans imposer automatiquement un changement de g/h.

---

# 14. Préparation

L’espace Préparation centralise ce qu’il faut avoir, préparer et répartir avant la course.

## 14.1 Matériel officiel

Le matériel obligatoire provient d’une information de course sourcée.

Il doit être distingué visuellement de toute suggestion PLUKA.

Le coureur peut le cocher dans sa checklist.

## 14.2 Matériel personnel

Le coureur peut ajouter :

- matériel choisi ;
- accessoires ;
- éléments complémentaires.

## 14.3 Suggestions PLUKA

PLUKA peut suggérer des éléments selon :

- nuit ;
- froid ;
- chaleur ;
- conditions prévues ;
- contexte de course.

Une suggestion ne devient jamais matériel obligatoire.

Le produit doit éviter les doublons : ne pas suggérer une frontale supplémentaire si la configuration déjà présente couvre le besoin.

## 14.4 Sacs

La Préparation gère au minimum :

- départ ;
- sacs / drop bags autorisés ;
- sacs Assistance ;
- arrivée.

La Nutrition et l’Assistance peuvent alimenter les besoins de ces sacs.

## 14.5 TODO

PLUKA peut générer des tâches de préparation et le coureur peut ajouter ses propres tâches.

---

# 15. Assistance

L’Assistance est une fonctionnalité de préparation des rendez-vous avec un accompagnant.

PLUKA ne propose pas de mise en relation communautaire avec des assistants dans la V1.

## 15.1 Activation progressive

L’Assistance n’est pas demandée dans le cœur de l’onboarding.

Lorsque l’utilisateur ouvre le module, il peut choisir :

- ajouter un assistant ;
- indiquer qu’il sera autonome ;
- décider plus tard.

## 15.2 Assistant

Informations possibles :

- prénom ;
- nom ;
- téléphone ;
- informations nécessaires au partage.

L’architecture doit pouvoir supporter plusieurs assistants même si le MVP UX commence simplement.

## 15.3 Points d’assistance

Seuls les points où l’assistance est autorisée doivent pouvoir être utilisés comme rendez-vous officiels.

Chaque rendez-vous peut contenir :

- lieu ;
- ETA / fenêtre ;
- accès ;
- parking si connu ;
- instructions ;
- sacs ;
- besoins Nutrition ;
- prochain rendez-vous.

## 15.4 Lien privé

Le coureur peut partager une page privée sans compte avec son assistant.

La page doit être mobile-first et centrée sur :

- prochain rendez-vous ;
- heure / fenêtre ;
- accès ;
- ce qu’il faut apporter ;
- Conditions compactes si disponibles.

Pas de live tracking dans le MVP.

## 15.5 Contact d’urgence

Un contact d’urgence éventuel est distinct du rôle d’assistant et nécessite un consentement explicite.

---

# 16. Course — informations de référence

L’espace Course contient la connaissance structurée de l’épreuve.

Il peut couvrir notamment :

- général ;
- départ ;
- retrait dossard ;
- parcours ;
- GPX ;
- ravitaillements ;
- barrières ;
- matériel ;
- assistance ;
- sacs ;
- transports ;
- sécurité ;
- abandon ;
- règlement ;
- contacts.

Chaque information importante doit pouvoir exposer sa provenance.

---

# 17. Sources, confiance et publication

La spec détaillée est dans `engines/SOURCES_EXTRACTION.md`.

## 17.1 Niveaux de confiance

Trois niveaux fonctionnels principaux :

### Officielle

Information publiée ou explicitement validée par une organisation autorisée dans PLUKA.

### Validée PLUKA

Information vérifiée par PLUKA à partir d’une ou plusieurs sources identifiées.

### Communautaire

Information, conseil ou expérience fournie par un participant / membre de la communauté.

Le produit doit éviter de donner à une donnée communautaire le même poids qu’à une décision officielle.

## 17.2 Sources

Une source peut être notamment :

- URL ;
- PDF ;
- GPX ;
- page ;
- extrait ;
- snapshot ;
- article.

La provenance exacte doit être conservée.

## 17.3 Versioning

Une information publiée ne doit pas être silencieusement remplacée par une extraction plus récente.

Le système doit supporter :

- information stable ;
- versions immuables ;
- sources associées ;
- version courante ;
- dépendances des Plans lorsque nécessaire.

## 17.4 Changements critiques

Lorsqu’une information importante change :

- identifier ce qui peut être affecté ;
- signaler les Plans / préparations potentiellement concernés ;
- ne pas muter silencieusement les données personnelles ;
- afficher l’information officielle aux personnes concernées.

---

# 18. Conditions de course

La spec détaillée est dans `engines/WEATHER_CONDITIONS.md`.

## 18.1 Positionnement

PLUKA ne montre pas simplement la météo d’une ville.

PLUKA montre :

> **les conditions que le coureur devrait rencontrer là où il devrait être, au moment où il devrait y être selon son Plan.**

## 18.2 Fenêtre temporelle

Règle absolue :

- avant J-14 : aucune prévision PLUKA ;
- J-14 à J-8 : prévision lointaine · à confirmer ;
- J-7 à J-4 : prévision intermédiaire ;
- J-3 à J-1 : prévision rapprochée ;
- jour J : dernière actualisation / information la plus récente disponible.

Aucun faux pourcentage de confiance.

Une décision officielle de l’organisation reste accessible même avant J-14 si elle existe, car elle n’est pas une prévision PLUKA.

## 18.3 Données par point

Pour chaque point météo pertinent :

- position ;
- latitude / longitude ;
- altitude du parcours ;
- date/heure locale prévue de passage ;
- température ;
- température ressentie ;
- précipitations pertinentes ;
- vent ;
- rafales ;
- direction si utile ;
- date de mise à jour.

Le `plannedDatetime` doit être une vraie date/heure localisée et supporter les courses dépassant minuit.

## 18.4 Granularité

« Point par point » signifie :

- points significatifs du Plan ;
- ravitos ;
- cols / sommets ;
- Assistance ;
- points ajoutés ;
- points météo virtuels lorsque la distance entre deux repères est trop importante.

Ne pas afficher une météo pour chaque point GPS du GPX.

Les points virtuels doivent avoir des identifiants uniques et être situés sur le parcours.

## 18.5 Recalage

Si le Plan change :

- les ETA changent ;
- les Conditions sont recalées sur les nouvelles heures ;
- les impacts dépendants sont recalculés.

Le fournisseur météo n’est pas « recalculé » ; PLUKA remappe les prévisions disponibles à la nouvelle temporalité.

## 18.6 Impacts

Les Conditions peuvent produire des propositions dans :

- Nutrition ;
- Préparation / matériel ;
- Assistance ;
- Accueil ;
- mode Jour J ;
- Demander à PLUKA.

Aucune proposition ne doit modifier silencieusement le pacing ou la stratégie.

## 18.7 Décision officielle

Une décision organisation du type :

- kit froid ;
- kit chaud ;
- modification parcours ;
- alerte sécurité ;

est toujours hiérarchiquement supérieure à la prévision PLUKA.

Elle est accessible aux utilisateurs Free.

---

# 19. Sorties personnelles

Une sortie personnelle est un objet distinct d’une course officielle.

Elle représente une sortie longue, reconnaissance ou test de stratégie.

## 19.1 Création

Flow simple :

- nom ;
- GPX ;
- distance / D+ / D- extraits ;
- durée prévue ;
- date facultative ;
- heure de départ facultative ;
- conditions manuelles chaud / froid / nuit si besoin.

Le produit peut analyser le profil de la trace.

## 19.2 Points

L’utilisateur peut ajouter des points simples :

- eau ;
- ravito ;
- autre.

## 19.3 Nutrition

Les sorties éligibles utilisent le même moteur Nutrition dans une interface plus légère.

## 19.4 Conditions

Les Conditions sont disponibles uniquement si :

- l’utilisateur y a droit ;
- une date est définie ;
- la sortie est à J-14 ou moins ;
- une heure de départ est définie ;
- la trace et une durée permettent de calculer les heures de passage.

Sinon PLUKA demande l’information manquante ou indique la date d’ouverture de la fenêtre.

## 19.5 Tester ma stratégie

Pour une course, un utilisateur éligible peut créer une sortie de test liée.

Le but est de :

- reprendre une stratégie ;
- l’adapter à la sortie ;
- tester Nutrition / matériel ;
- recueillir un retour ;
- proposer ensuite éventuellement des changements sur la course.

Aucun changement ne doit être réappliqué automatiquement à la course sans confirmation.

---

# 20. Bibliothèque

La Bibliothèque sert principalement à PLUKA+ pour capitaliser sur les éléments réutilisables.

Elle peut contenir notamment :

- produits Nutrition ;
- matériel ;
- stratégies ;
- modèles de sacs / préparation ;
- éléments réutilisables entre courses et sorties.

L’objectif est de réduire la re-saisie d’une préparation à l’autre.

---

# 21. Communauté

La communauté V1 doit rester légère et centrée sur une édition / course.

Thèmes possibles :

- préparation ;
- course ;
- logistique ;
- matériel et Nutrition ;
- assistance ;
- retours.

PLUKA V1 ne doit pas devenir un réseau social :

- pas de followers ;
- pas de stories ;
- pas de feed général ;
- pas de messagerie privée complexe.

Les faits de course doivent rester séparés des conseils communautaires.

---

# 22. Demander à PLUKA

« Demander à PLUKA » est une capacité transversale.

Ce n’est pas un chatbot généraliste.

## 22.1 Sources de réponse

Les réponses doivent privilégier :

- faits structurés publiés ;
- sources associées ;
- extraits de sources ;
- données personnelles autorisées du Plan ;
- Conditions lorsque la fenêtre J-14 est ouverte.

## 22.2 Comportement

Si l’information fiable est insuffisante :

> **« Je n’ai pas trouvé une information suffisamment fiable. »**

PLUKA ne doit pas inventer une réponse.

## 22.3 Citations

Les réponses factuelles sur la course doivent permettre à l’utilisateur de vérifier la source.

## 22.4 Interdits

L’IA ne doit pas calculer le pacing du Plan.

Elle ne doit pas transformer une information communautaire en règle officielle.

---

# 23. Après-course

Après une course, le coureur peut enregistrer un retour simple.

Informations possibles :

- statut ;
- temps réel manuel ;
- objectif vs résultat ;
- ressenti ;
- précision perçue du Plan ;
- Nutrition ;
- Assistance ;
- matériel ;
- ce qui est à répéter ;
- ce qui est à changer ;
- note privée ;
- partage communautaire facultatif.

Le MVP ne nécessite pas une analyse avancée de données wearable.

Les retours doivent pouvoir alimenter la mémoire personnelle de saison sans produire automatiquement de prescription.

---

# 24. Expérience organisateur — principes

PLUKA Organisateur doit apporter une valeur propre à l’organisation, sans devenir un outil opérationnel lourd.

Promesse :

> **L’organisation fournit les données qu’elle possède déjà. PLUKA analyse et remonte ce qui mérite son attention.**

Règle produit :

> **La puissance est sous le capot. La simplicité est à l’écran.**

PLUKA doit demander le moins de travail possible à l’organisation.

L’organisation reste le décideur.

---

# 25. Navigation organisateur

La navigation principale V1 est volontairement courte :

- **Accueil**
- **Ma course**
- **Analyse**
- **Participants**
- **Paramètres** en secondaire

Ne pas réintroduire comme onglets principaux indépendants :

- Peloton ;
- Prévisions ;
- Barrières ;
- Conditions ;
- Enrichissement ;
- Insights ;
- Partenaires.

Ces capacités restent des contenus, drill-downs ou actions ponctuelles.

---

# 26. Accueil organisateur

L’Accueil est un **centre d’attention**.

Il répond à :

> **« Qu’est-ce qui mérite mon attention aujourd’hui ? »**

## 26.1 Priorités

Afficher au maximum 3 à 4 sujets majeurs, classés par :

- À faire
- À vérifier
- À savoir

Exemples :

- contradiction de source ;
- information manquante ;
- vague particulièrement hétérogène ;
- point de parcours avec pic notable ;
- question participant sans réponse officielle ;
- exposition météo significative à partir de J-14.

Ne pas créer une alerte pour chaque observation.

## 26.2 Résumé

Une ligne synthétique peut afficher :

- participants ;
- couverture analysable ;
- vagues ;
- adoption PLUKA ;
- état des informations.

Pas de dashboard SaaS rempli de KPI équivalents.

---

# 27. Brief organisateur

PLUKA génère automatiquement un **Brief avant-course**.

L’organisation ne configure pas ce brief manuellement.

## 27.1 Contenu possible

- état des informations de course ;
- incohérences restantes ;
- synthèse du peloton ;
- principaux flux ;
- barrières à surveiller ;
- principaux sujets participants ;
- Conditions à partir de J-14 ;
- changements récents.

## 27.2 Temporalité

Le brief évolue selon la proximité de la course :

- J-60 : informations / participants ;
- J-30 : peloton / principaux flux ;
- J-14 : Conditions ;
- J-3 : changements récents, Conditions et sujets participants critiques.

## 27.3 Partage

Le brief doit pouvoir être :

- consulté ;
- copié / partagé ;
- imprimé ou exporté selon l’implémentation.

Il ne contient que des données autorisées et agrégées.

---

# 28. Ma course — organisation

« Ma course » représente :

> **ce que PLUKA sait officiellement de l’événement.**

Il regroupe notamment :

- Informations
- Sources
- Épreuves
- éléments secondaires d’événement / partenaires si nécessaires

## 28.1 Informations

L’organisation peut :

- consulter les faits structurés ;
- valider ;
- corriger ;
- publier ;
- gérer un conflit ;
- voir la provenance.

L’écran doit mettre les exceptions en avant plutôt que demander de surveiller un pipeline technique.

## 28.2 Sources

L’organisation peut fournir :

- site ;
- PDF ;
- GPX ;
- autres documents supportés.

Flow attendu :

**Importer → PLUKA analyse → exceptions → validation humaine → publication**

---

# 29. Participants — organisation

L’espace Participants regroupe :

- liste ;
- import ;
- invitations ;
- questions / compréhension ;
- adoption ;
- enrichissement ponctuel facultatif.

## 29.1 Import

Le MVP doit fonctionner sans intégration à un outil d’inscription.

Import CSV avec mapping et gestion des erreurs / doublons.

Champs utiles :

- prénom ;
- nom ;
- email ;
- épreuve ;
- dossard facultatif ;
- vague facultative ;
- sexe facultatif ;
- date de naissance facultative ;
- nationalité facultative ;
- identifiants / indices de performance facultatifs.

## 29.2 Invitations

L’organisation peut inviter les participants à activer PLUKA.

L’invitation est personnalisée à l’événement.

L’activation doit ouvrir un onboarding court et co-brandé.

## 29.3 Enrichissement ITRA / UTMB

L’enrichissement est facultatif et doit rester simple.

La V1 ne doit pas dépendre d’une API publique non contractuelle ou de scraping.

Le workflow produit supporte notamment :

- import d’une Startlist ITRA enrichie obtenue par l’organisation ;
- import d’un fichier contenant des données UTMB Index obtenu légitimement par l’organisation ;
- continuer sans enrichissement.

Après import, PLUKA fait le matching et demande une intervention uniquement sur les exceptions.

ITRA Performance Index et UTMB Index restent des signaux de sources distinctes et ne doivent pas être présentés comme un indice unique interchangeable.

---

# 30. Analyse organisateur

La page Analyse fusionne :

- compréhension du peloton ;
- principaux flux ;
- barrières ;
- Conditions.

Elle doit commencer par des **conclusions**, puis permettre un drill-down.

La spec du moteur réel est dans `engines/RACE_INTELLIGENCE.md`.

## 30.1 Statut du moteur Race Intelligence

Le prototype contient des données simulées servant à valider l’UX.

Elles ne constituent pas une spécification mathématique valide.

Tant que `RACE_INTELLIGENCE.md` n’est pas spécifié et validé :

- ne pas transformer les formules de démonstration en moteur production ;
- utiliser un feature flag, un mode beta ou des données explicites de démonstration pour les écrans concernés.

## 30.2 À retenir

En haut de page : maximum trois enseignements utiles, par exemple :

- vague plus hétérogène ;
- principal pic de passage ;
- barrière à surveiller.

## 30.3 Peloton

Afficher notamment :

- nombre de participants ;
- proportion disposant de données exploitables ;
- distribution globale ;
- comparaison simple des vagues.

L’interface nominale doit privilégier des conclusions comme :

- relativement homogène ;
- plus dispersée ;
- couverture limitée.

Les détails mathématiques ne sont disponibles qu’en drill-down.

## 30.4 Sources du modèle

Les prévisions peuvent utiliser conceptuellement, par ordre de signal utile :

1. Plan PLUKA existant ;
2. donnée de performance disponible ;
3. vague / historique disponible ;
4. distribution générique lorsque nécessaire.

L’organisation ne voit jamais les Plans individuels.

## 30.5 Couverture

Toujours afficher la couverture du modèle sous une forme lisible :

- bonne ;
- partielle ;
- limitée ;

avec la proportion de participants disposant de données exploitables.

Ne pas afficher de fausse précision du type « fiabilité 94,7 % ».

---

# 31. Flux prévisionnels organisateur

Les flux servent à anticiper les **périodes de charge** avant la course.

Ils ne remplacent pas le suivi temps réel.

## 31.1 Support principal

Le profil altimétrique de la course est la scène principale.

Les principaux points sont sélectionnables :

- départ ;
- ravitos ;
- barrières ;
- assistance ;
- arrivée.

## 31.2 Vue synthétique

Par point :

- premiers passages ;
- cœur du peloton ;
- pic attendu ;
- fin du flux principal.

Préférer des plages et des formulations d’estimation plutôt que des chiffres inutilement exacts.

## 31.3 Drill-down

Le détail peut afficher :

- courbe par tranche de temps ;
- intervalle estimé ;
- ventilation par vague ;
- couverture de données.

Pas de filtre permettant de reconstituer le Plan d’un individu.

---

# 32. Barrières — organisation

Les barrières sont intégrées à l’Analyse et au profil de course.

Elles ne sont pas un module principal distinct.

Une barrière peut être qualifiée comme « à surveiller » si le modèle agrégé le justifie.

Le drill-down peut afficher la répartition des marges estimées, par exemple :

- > 60 min ;
- 30–60 min ;
- < 30 min ;
- au-delà dans le scénario.

PLUKA ne doit jamais produire une liste nominative de « coureurs à risque » ou de « risque DNF ».

---

# 33. Conditions — organisation

À partir de J-14, l’Analyse peut croiser :

- Conditions ;
- zone du parcours ;
- fenêtre temporelle ;
- flux prévisionnels.

Exemple fonctionnel :

> Froid + vent probable au Rawil de 15:30 à 19:00. Environ 68 % du peloton devrait traverser la zone pendant cette période.

La ventilation par vague peut être affichée si les seuils de confidentialité sont respectés.

Cette analyse éclaire une décision, mais ne déclenche jamais automatiquement :

- kit froid ;
- changement de parcours ;
- consigne sécurité.

La décision officielle appartient à l’organisation.

---

# 34. Questions et compréhension participants

PLUKA peut agréger les questions posées par les participants pour aider l’organisation à améliorer son information.

## 34.1 Vue agrégée

Afficher notamment :

- thèmes les plus demandés ;
- questions fréquentes ;
- question sans réponse officielle fiable ;
- sujet pourtant documenté mais générant encore de nombreuses questions.

## 34.2 Boucle d’amélioration

Flow :

**Question récurrente → manque détecté → réponse organisation → publication → information structurée → meilleures réponses participants**

L’organisation peut ajouter une réponse officielle et éventuellement une source.

Une fois publiée, cette information peut être exploitée dans :

- Course ;
- Assistance si pertinent ;
- Demander à PLUKA.

## 34.3 Ton

PLUKA ne doit pas dire « votre communication est mauvaise ».

Préférer :

> « Cette règle continue de générer beaucoup de questions. »

---

# 35. Changements officiels et impact

Lorsqu’une information officielle est modifiée :

- conserver l’historique ;
- identifier les préparations potentiellement concernées ;
- diffuser l’information selon les canaux du produit ;
- permettre de suivre des agrégats de consultation.

Le coureur peut couper les notifications d’un changement officiel pour une course donnée
(`participant_race_settings.notifications_enabled`, actif par défaut). Ce réglage ne
concerne que la diffusion : l’impact reste visible dans l’application, qui est le canal
ne dépendant d’aucun fournisseur. Une préférence ne doit jamais empêcher un coureur de
constater qu’une information de sa course a changé.

Exemples d’agrégats organisation :

- préparations concernées ;
- notifications / communications envoyées ;
- consultation de la modification ;
- Plans revérifiés après changement.

Ne jamais exposer une liste nominative des comportements privés de préparation.

---

# 36. Adoption organisateur

Les analytics d’adoption restent secondaires par rapport à la valeur métier.

Exemples :

- participants invités ;
- activés ;
- Plans créés ;
- Nutrition commencée ;
- Assistance configurée.

Ils servent à mesurer la valeur du service, mais ne doivent pas redevenir le centre du BO.

---

# 37. Confidentialité B2B

Règle absolue : l’organisation ne voit jamais :

- objectif individuel ;
- Plan individuel ;
- ETA individuel ;
- stratégie Nutrition ;
- produits consommés ;
- sacs ;
- détails de l’Assistance privée ;
- notes personnelles ;
- retours privés ;
- profil sportif détaillé individuel utilisé pour la préparation.

Les capacités Race Intelligence utilisent des données :

- agrégées ;
- anonymisées / non exposées individuellement ;
- soumises aux règles de confidentialité définies dans `03_PRIVACY_RLS.md`.

## 37.1 Seuil de groupe

Ne pas afficher une analyse de sous-groupe si elle concerne moins de **10 participants**.

Si le filtre produit un groupe trop petit :

> « Groupe trop petit pour afficher une analyse agrégée. »

---

# 38. Back-office PLUKA

Le back-office interne PLUKA est distinct de l’espace organisateur.

Il doit permettre les opérations nécessaires à :

- validation / publication ;
- administration des courses ;
- gestion des sources ;
- support ;
- gestion des organisations ;
- contrôle des droits / entitlements si nécessaire.

Les détails UI et droits sont documentés séparément.

---

# 39. Intelligence artificielle — règles fonctionnelles

L’IA / LLM peut être utilisée pour :

- extraction assistée de documents ;
- classification ;
- détection de conflits candidats ;
- synthèse ;
- Q&A « Demander à PLUKA » avec sources ;
- aides textuelles clairement encadrées.

Elle ne doit pas être le moteur direct pour :

- Plan / pacing ;
- calcul des ETA ;
- Nutrition déterministe ;
- entitlements ;
- règles de confidentialité ;
- décision officielle organisation ;
- calcul météo fournisseur ;
- accès aux données.

Les moteurs critiques doivent être déterministes, testables et explicables.

---

# 40. Offline, exports et Race Pack

L’objectif fonctionnel à terme V1 est de permettre au participant premium d’accéder à l’essentiel de sa préparation même dans des conditions de réseau dégradées.

Le Race Pack peut inclure selon la tranche technique retenue :

- Plan ;
- points clés ;
- Nutrition ;
- matériel ;
- Assistance ;
- informations officielles importantes ;
- export PDF ;
- GPX lorsque pertinent.

Les détails d’implémentation PWA / offline appartiennent à `01_ARCHITECTURE.md`.

---

# 41. Mobile et responsive — intention fonctionnelle

Le B2C est mobile-first.

Priorités :

- lecture rapide ;
- interactions accessibles ;
- bottom sheets lorsque pertinent ;
- cibles tactiles suffisamment grandes ;
- profil altimétrique exploitable ;
- parcours course simple ;
- Assistance utilisable en mobilité.

Le BO organisateur est desktop-first, mais le mobile doit permettre au minimum :

- consulter les priorités ;
- lire le Brief ;
- valider / publier une information simple ;
- consulter un insight important.

Les analyses complexes peuvent être simplifiées sur mobile.

---

# 42. Règles de langage et confiance

## 42.1 Préférer

- Prévision PLUKA
- Selon ton Plan actuel
- Passage prévu vers…
- Repère indicatif
- À vérifier
- PLUKA te suggère
- Voir l’impact
- Appliquer
- Conserver ma stratégie
- Données agrégées
- Couverture des données
- Période de charge
- Marge estimée

## 42.2 Éviter

- prévision exacte ;
- garanti ;
- optimal ;
- PLUKA sait qu’il fera… ;
- pacing corrigé automatiquement ;
- risque DNF individuel ;
- coureur à risque ;
- IA révolutionnaire ;
- précision 98 % ;
- prédiction certaine.

---

# 43. Données de démonstration

Les données présentes dans le prototype servent à montrer des états UX.

Elles ne doivent pas être copiées dans les moteurs métier comme règles ou vérités.

En particulier :

- chiffres de Race Intelligence ;
- distributions de peloton ;
- ETA de démonstration ;
- météo de démonstration ;
- formule éventuelle de Repère ;
- exemples de questions ;
- exemples Wildstrubel.

Les environnements de développement peuvent utiliser des seeds clairement identifiés comme **demo / fixture**.

---

# 44. Périmètre à ne pas implémenter dans le MVP sans nouvelle validation

Les éléments suivants ne doivent pas être ajoutés spontanément :

- plan d’entraînement ;
- live GPS ;
- PC course ;
- tracking organisateur temps réel ;
- classement social ;
- followers / DM ;
- matching communautaire d’assistance ;
- prédiction individuelle de DNF ;
- médical ;
- gestion stocks ravito automatique ;
- gestion bénévoles ;
- gestion transports complète ;
- billetterie / inscription ;
- simulateur avancé de vagues en expérience MVP principale ;
- intégration ITRA / UTMB par scraping ;
- changement automatique de pacing à cause de la météo ;
- prescription nutritionnelle ;
- intégration wearable analytique poussée.

---

# 45. Statut fonctionnel des grandes briques

| Brique | Statut produit V1 |
|---|---|
| Course / sources / faits | **Core** |
| Onboarding / Profil trailer | **Core** |
| Objectif utilisateur | **Core** |
| Plan | **Core** |
| Préparation / matériel / sacs | **Core** |
| Nutrition | **Core** |
| Assistance | **Core** |
| Conditions J-14 | **Core premium** |
| Ma saison | **Core** |
| Sorties liées Race Pass | **Core premium** |
| Sorties illimitées PLUKA+ | **Core premium** |
| Bibliothèque | **PLUKA+ / V1** |
| Demander à PLUKA | **V1** |
| Communauté légère | **V1 non bloquante** |
| Après-course | **V1** |
| B2B informations / sources | **Core B2B** |
| Import / invitations participants | **Core B2B** |
| Questions participants agrégées | **Core B2B** |
| Brief organisateur | **Core B2B** |
| Race Intelligence UI | **Cible V1 / beta** |
| Race Intelligence moteur réel | **À spécifier avant production** |
| Repère PLUKA moteur | **À calibrer / feature flag** |
| Enrichissement ITRA / UTMB fichier | **Optionnel B2B** |
| API ITRA / UTMB | **Non requise V1** |
| Simulateur de vagues | **Hors MVP visible** |
| Live / PC course | **Hors scope** |

---

# 46. Principes de développement à préserver

Même si les détails sont dans `AGENTS.md` et `01_ARCHITECTURE.md`, toute implémentation doit respecter ces principes fonctionnels :

1. **Ne jamais inventer une feature absente de cette spec ou du prototype figé.**
2. **Ne jamais utiliser une fixture de prototype comme logique métier.**
3. **Ne jamais exposer une donnée privée à l’organisation pour rendre Race Intelligence plus facile à coder.**
4. **Ne jamais remplacer une décision officielle par une déduction PLUKA.**
5. **Ne jamais modifier silencieusement un Plan ou une stratégie à cause d’une extraction, d’une météo ou d’une suggestion.**
6. **Toujours conserver la provenance des informations critiques.**
7. **Faire apparaître la complexité uniquement lorsqu’elle apporte une valeur claire à l’utilisateur.**
8. **Côté organisation : conclusions d’abord, données ensuite.**
9. **Côté coureur : le Plan est le centre ; le reste s’organise autour.**
10. **En cas d’incertitude documentaire, demander une résolution de spec plutôt que décider dans le code.**

---

# 47. Critère de réussite produit

## Côté coureur

Après quelques minutes, un utilisateur doit comprendre :

> « PLUKA prend ma course et mon objectif, construit mon Plan, puis m’aide à organiser tout ce qu’il faut autour pour arriver préparé le jour J. »

## Côté organisation

Après quelques minutes, un organisateur doit comprendre :

> « Je fournis les données que je possède déjà. PLUKA me remonte ce qui mérite mon attention et aide mes participants à mieux se préparer. »

PLUKA doit donner une impression de **préparation structurée**, pas de complexité supplémentaire.

---

# 48. Documents complémentaires attendus

Cette spec doit être complétée par :

- `01_ARCHITECTURE.md`
- `02_DATA_MODEL.md`
- `03_PRIVACY_RLS.md`
- `04_ENTITLEMENTS.md`
- `05_ROUTES_FLOWS.md`
- `06_DESIGN_SYSTEM.md`
- `engines/PLAN_ENGINE.md`
- `engines/NUTRITION_ENGINE.md`
- `engines/SOURCES_EXTRACTION.md`
- `engines/WEATHER_CONDITIONS.md`
- `engines/RACE_INTELLIGENCE.md`
- `ACCEPTANCE_CRITERIA.md`

---

**Fin — PLUKA Product Specification V1**
