# PLUKA — Sources & Extraction Engine V1

**Fichier de référence :** `docs/engines/SOURCES_EXTRACTION.md`  
**Statut :** Spécification fonctionnelle et technique de référence — V1  
**Date de consolidation :** 2026-09-03  
**Version moteur de départ :** `sources-v1.0.0`  
**Principe :** provenance exacte, extraction assistée, validation humaine, publication versionnée

---

# 0. Rôle de ce document

Ce document définit la chaîne **Sources → Extraction → Validation → Publication** de PLUKA.

L’objectif est de transformer des contenus de course dispersés :

- pages web ;
- règlements ;
- guides coureur ;
- PDF ;
- GPX ;
- informations saisies par l’organisation ;
- autres documents officiels ;

en :

> **informations structurées, versionnées, sourcées et exploitables par PLUKA.**

Ces informations alimentent notamment :

- La course ;
- Plan ;
- Préparation ;
- Assistance ;
- Nutrition ;
- Conditions ;
- Demander à PLUKA ;
- le back-office organisateur ;
- le Brief organisateur ;
- Race Intelligence lorsque pertinent.

Le moteur ne doit jamais transformer automatiquement une extraction IA en vérité officielle.

---

## 0.1 Documents de référence

Cette spec complète :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/03_PRIVACY_RLS.md`
- `docs/engines/PLAN_ENGINE.md`
- `docs/engines/NUTRITION_ENGINE.md`
- `docs/engines/WEATHER_CONDITIONS.md`
- `docs/ACCEPTANCE_CRITERIA.md`

Le prototype figé sert de référence UX/UI, jamais de référence pour la logique d’extraction.

### Ordre de priorité

En cas de contradiction :

1. `00_PRODUCT_SPEC.md` fait foi sur le comportement produit ;
2. ce document fait foi sur la chaîne Sources / Extraction ;
3. `01_ARCHITECTURE.md` fait foi sur les frontières techniques ;
4. `02_DATA_MODEL.md` et les migrations font foi sur la structure persistée ;
5. le prototype fait foi sur l’intention UX.

Toute contradiction documentaire doit être signalée avant implémentation.

---

# 1. Principe directeur

> **Une source n’est pas une vérité. Une extraction n’est pas une vérité. Une information publiée est une décision versionnée et traçable.**

Le pipeline V1 est :

```text
SOURCE
↓
SNAPSHOT
↓
PARSING
↓
CHUNKS / BLOCS
↓
EXTRACTION
↓
CANDIDATS
↓
CONFLITS / CONTRÔLES
↓
VALIDATION HUMAINE
↓
RACE FACT VERSION
↓
PUBLICATION
```

Aucune étape intermédiaire ne doit être confondue avec une information officielle.

---

# 2. Objectifs V1

Le moteur doit :

1. enregistrer une source et sa provenance ;
2. capturer un snapshot immuable du contenu utilisé ;
3. parser le contenu selon son type ;
4. produire des blocs / chunks exploitables ;
5. extraire des candidats structurés ;
6. rattacher chaque candidat à des preuves exactes ;
7. détecter les contradictions entre candidats et informations déjà publiées ;
8. permettre une revue humaine ;
9. publier une version immuable d’un RaceFact ;
10. conserver l’historique ;
11. permettre de savoir précisément quelle version d’une information a été utilisée par un Plan ;
12. alimenter le moteur de réponses sourcées ;
13. permettre à une organisation autorisée de publier une information officielle ;
14. détecter qu’une information manque ou est insuffisamment précise ;
15. ne jamais écraser silencieusement une information publiée ;
16. être rejouable, auditable et versionné.

---

# 3. Hors périmètre V1

Le moteur ne fait pas :

- de crawl illimité du web ;
- de scraping non autorisé de plateformes tierces ;
- de surveillance temps réel de tout Internet ;
- de publication autonome par LLM ;
- de décision métier à la place de l’organisation ;
- d’OCR systématique ;
- de traduction juridique certifiée ;
- d’interprétation médicale ;
- de résumé sans provenance ;
- de correction silencieuse d’un document officiel ;
- de fusion silencieuse de deux informations contradictoires ;
- de reconstitution de donnée absente par “bon sens”.

---

# 4. Niveaux de confiance

PLUKA distingue trois niveaux fonctionnels.

## 4.1 Officielle

Une information est **Officielle** uniquement si elle est publiée par :

- une organisation autorisée ;
- ou une source organisation explicitement administrée dans PLUKA selon le workflow prévu.

Le fait qu’un document public appartienne à un organisateur ne suffit pas à qualifier automatiquement l’information de “Officielle dans PLUKA”.

Une donnée issue d’un règlement public peut être :

> **Source officielle**

sans pour autant être :

> **Information administrée officiellement dans PLUKA**

Cette distinction doit être conservée.

## 4.2 Validée PLUKA

Information vérifiée par PLUKA à partir de sources identifiées.

Elle doit toujours conserver sa provenance.

## 4.3 Communautaire

Information issue d’un participant ou d’un contenu communautaire.

Elle ne doit pas être promue automatiquement en source fiable ou officielle.

---

# 5. Types de sources V1

Le système doit supporter au minimum :

```text
web_page
pdf
gpx
manual_organizer
manual_pluka
other_document
```

Évolutions possibles plus tard :

```text
api
feed
email_import
structured_partner
```

mais elles ne sont pas nécessaires au moteur V1.

---

# 6. Source vs snapshot

Une `Source` est une référence logique durable.

Exemple :

```text
https://organisation.example/reglement
```

Un `Snapshot` est le contenu réellement utilisé à un instant donné.

Exemple :

```text
snapshot du 2026-09-01 14:32
hash = abc...
```

Une source peut donc avoir plusieurs snapshots.

Règle :

> **L’extraction et les citations se rattachent à un snapshot, jamais seulement à une URL.**

---

# 7. Modèle conceptuel

```text
Source
 ├─ Snapshot 1
 │   ├─ Blocks / Chunks
 │   ├─ Extraction Run
 │   │   └─ Candidates
 │   └─ Citations
 │
 └─ Snapshot 2
     ├─ Blocks / Chunks
     └─ Extraction Run
         └─ Candidates

RaceFact
 ├─ Version 1
 │   └─ FactSources
 ├─ Version 2
 │   └─ FactSources
 └─ current_version_id
```

---

# 8. Source

Une Source doit contenir conceptuellement :

```ts
type Source = {
  id: string
  scopeType: 'event' | 'edition' | 'race'
  scopeId: string

  type:
    | 'web_page'
    | 'pdf'
    | 'gpx'
    | 'manual_organizer'
    | 'manual_pluka'
    | 'other_document'

  title: string | null
  canonicalUrl: string | null
  originalFilename: string | null

  authority:
    | 'organizer'
    | 'official_external'
    | 'pluka'
    | 'community'
    | 'unknown'

  status:
    | 'active'
    | 'superseded'
    | 'archived'
    | 'error'

  createdAt: string
  updatedAt: string
}
```

Les noms exacts doivent être alignés avec `02_DATA_MODEL.md`.

---

# 9. Snapshot

Un snapshot est immuable.

```ts
type SourceSnapshot = {
  id: string
  sourceId: string

  capturedAt: string
  contentHash: string

  contentType: string | null
  sizeBytes: number | null

  storageObjectId: string | null

  httpStatus: number | null
  finalUrl: string | null

  parserVersion: string | null
  status:
    | 'pending'
    | 'ready'
    | 'failed'
}
```

Une fois utilisé pour une publication, un snapshot ne doit pas être modifié.

---

# 10. Hash de contenu

Chaque snapshot calculable doit posséder un hash stable :

```text
SHA-256(content bytes)
```

Utilités :

- éviter les snapshots strictement identiques ;
- détecter un changement ;
- assurer la reproductibilité ;
- faciliter le diagnostic.

Deux URLs différentes peuvent produire le même hash sans devenir la même Source.

---

# 11. Acquisition web

Lorsqu’une source web est capturée :

1. valider l’URL ;
2. appliquer les protections SSRF ;
3. résoudre la destination ;
4. refuser localhost / réseaux privés ;
5. limiter les redirections ;
6. appliquer un timeout ;
7. limiter la taille ;
8. capturer le contenu ;
9. capturer l’URL finale ;
10. calculer le hash ;
11. stocker le snapshot ;
12. lancer le parsing.

La capture web ne doit pas nécessiter un navigateur complet si un fetch HTTP suffit.

---

# 12. SSRF et sécurité réseau

Une URL fournie par un utilisateur ne doit jamais permettre l’accès à :

- localhost ;
- réseau Docker interne ;
- metadata cloud ;
- IP privées ;
- services Supabase internes ;
- ressources arbitraires du réseau.

Bloquer notamment :

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1
fc00::/7
fe80::/10
```

La validation doit être refaite après résolution DNS et redirection.

---

# 13. PDF

Pipeline recommandé :

```text
PDF brut
↓
métadonnées
↓
extraction texte native
↓
segmentation pages
↓
détection tableaux / blocs lorsque possible
↓
chunks
```

Priorité absolue :

> **extraire le texte natif avant toute OCR.**

L’OCR est un fallback.

---

# 14. OCR

L’OCR n’est utilisé que si :

- le PDF ne contient pas de texte exploitable ;
- une page importante est une image ;
- une extraction native échoue clairement.

Ne pas lancer l’OCR sur tout un document par défaut.

Chaque chunk OCR doit conserver :

```text
ocr = true
```

et si possible :

```text
ocr_confidence
```

Une information critique extraite uniquement par OCR doit être considérée avec une prudence accrue avant validation.

---

# 15. HTML

Le parser HTML doit éliminer autant que possible :

- navigation ;
- footer ;
- menus ;
- scripts ;
- styles ;
- contenus dupliqués ;
- cookies / banners ;
- éléments non éditoriaux.

Il conserve :

- titres ;
- paragraphes ;
- listes ;
- tableaux ;
- liens utiles ;
- structure de section.

Le DOM brut peut être stocké dans le snapshot, mais l’extraction s’appuie sur une représentation nettoyée.

---

# 16. GPX

Le GPX est une source particulière.

Il ne passe pas dans le pipeline LLM général.

Il est traité par le pipeline géospatial décrit dans `PLAN_ENGINE.md` / Architecture.

Le moteur Sources doit néanmoins conserver :

- le fichier original ;
- son hash ;
- sa provenance ;
- son statut ;
- la version de traitement ;
- son rattachement à la Race.

Les facts pouvant être dérivés du GPX doivent rester identifiables comme dérivés d’une source géospatiale.

---

# 17. Sources saisies manuellement

Une organisation peut saisir directement une information.

Exemple :

```text
Assistance autorisée uniquement à Lenk
```

Cette saisie doit créer :

- une provenance ;
- une version ;
- un auteur ;
- un timestamp.

Une saisie manuelle organisateur peut être publiée comme information officielle si l’utilisateur en a le droit.

Elle ne doit pas être stockée comme texte sans audit.

---

# 18. Parsing

Le parsing transforme le snapshot en représentation structurée.

Sortie :

```ts
type ParsedBlock = {
  id: string
  snapshotId: string

  pageNumber: number | null
  sectionPath: string[]
  heading: string | null

  blockType:
    | 'heading'
    | 'paragraph'
    | 'list'
    | 'table'
    | 'caption'
    | 'other'

  text: string

  sourceLocator: {
    page?: number
    cssSelector?: string
    tableIndex?: number
    rowIndex?: number
  } | null
}
```

---

# 19. Chunking

Les chunks servent :

- à l’extraction IA ;
- au retrieval ;
- aux citations.

Un chunk doit :

- être suffisamment petit pour rester précis ;
- conserver un peu de contexte ;
- ne pas couper arbitrairement une ligne métier importante ;
- conserver sa relation aux blocks.

Le chunking est versionné :

```text
chunker_version
```

---

# 20. Citation précise

Chaque candidat et chaque RaceFactVersion publiée doit pouvoir revenir vers une ou plusieurs preuves.

Une preuve minimale contient :

```text
snapshot_id
block_id ou chunk_id
page_number si disponible
section_path si disponible
quote / excerpt court
```

Les extraits servent à la traçabilité, pas à recopier tout le document.

---

# 21. Extraction structurée

L’extraction IA ne retourne pas du texte libre principal.

Elle retourne des **candidats structurés** selon un schéma strict.

Exemple conceptuel :

```ts
type ExtractedCandidate = {
  factType: string
  subjectKey: string

  value: unknown
  unit: string | null

  validFrom: string | null
  validTo: string | null

  evidence: CandidateEvidence[]

  confidence:
    | 'high'
    | 'medium'
    | 'low'

  notes: string | null
}
```

Le schéma précis dépend du type de fact.

---

# 22. Catégories de facts V1

Le moteur doit supporter au minimum des informations liées à :

- informations générales ;
- date / heure de départ ;
- lieu de départ ;
- retrait dossard ;
- parcours ;
- distance ;
- D+ / D- ;
- waypoints ;
- ravitaillements ;
- contenu des ravitaillements ;
- barrières horaires ;
- matériel obligatoire ;
- matériel conditionnel ;
- assistance ;
- drop bags ;
- transports ;
- navettes ;
- parking ;
- sécurité ;
- retrait / abandon ;
- règles ;
- contacts ;
- GPX ;
- changements officiels.

Le taxonomiste exact doit être centralisé et versionné.

---

# 23. RaceFact stable + versions immuables

Principe :

```text
RaceFact
=
identité logique stable

RaceFactVersion
=
valeur publiée à un instant donné
```

Exemple :

```text
RaceFact:
cutoff / Iffigenalp / arrival

Version 1:
16:20

Version 2:
16:31
```

`RaceFact.current_version_id` pointe vers la version courante.

Les anciennes versions restent immuables.

---

# 24. Identité logique d’un fact

La clé logique ne doit pas être :

```text
valeur + texte
```

Elle doit représenter le sujet.

Exemple :

```text
raceId
+ factType
+ subjectRef
+ context
```

Exemples :

```text
WILD70 / cutoff / Iffigenalp / arrival
WILD70 / assistance / Adelboden / authorization
WILD70 / mandatory_gear / waterproof_jacket
```

Cela permet de versionner la valeur sans créer un nouveau concept à chaque changement.

---

# 25. Candidate vs published fact

Un candidat :

- peut être faux ;
- peut être incomplet ;
- peut être dupliqué ;
- peut contredire une valeur ;
- peut venir d’une source moins récente.

Un RaceFactVersion publié :

- a été validé ;
- a une provenance ;
- a un auteur / workflow ;
- a un statut de confiance ;
- est immuable.

Le système ne doit jamais afficher directement un candidat comme fact publié.

---

# 26. Extraction run

Chaque extraction doit être auditée.

```ts
type ExtractionRun = {
  id: string
  snapshotId: string

  engineVersion: string
  promptVersion: string
  modelProvider: string
  modelName: string

  startedAt: string
  completedAt: string | null

  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'

  usage:
    | {
        inputTokens?: number
        outputTokens?: number
        costEstimate?: number
      }
    | null
}
```

Ne jamais dépendre uniquement d’un prompt non versionné dans le code.

---

# 27. Validation JSON stricte

Toute sortie IA doit passer par :

1. schema JSON ;
2. validation Zod ;
3. normalisation ;
4. règles métier ;
5. rejet si invalide.

Interdit :

```text
parse partiel silencieux
```

Si une réponse est invalide :

- retry borné si pertinent ;
- sinon extraction échouée ;
- jamais publication.

---

# 28. Confiance IA

Le champ `confidence` de l’IA est seulement un signal de tri.

Il ne signifie pas :

> probabilité statistique certifiée.

Une confiance élevée ne remplace pas la validation.

Une confiance faible doit aider à prioriser la revue humaine.

---

# 29. Extraction déterministe avant IA

Utiliser d’abord des parsers déterministes lorsqu’ils sont plus adaptés.

Exemples :

- dates ;
- horaires ;
- tableaux bien structurés ;
- GPX ;
- coordonnées ;
- fichiers CSV ;
- formats connus.

L’IA intervient lorsque la structure / le langage le justifie.

Principe :

> **ne pas utiliser un LLM pour parser ce qu’un parseur déterministe sait déjà lire proprement.**

---

# 30. Human-in-the-loop

Toute information critique extraite doit passer par une validation humaine avant publication.

Acteurs possibles :

```text
PLUKA admin
organizer owner/admin/editor
```

selon le workflow.

La revue doit afficher :

- valeur proposée ;
- type ;
- source ;
- extrait ;
- page / section ;
- anciennes valeurs ;
- contradictions ;
- action proposée.

---

# 31. Actions de validation

Au minimum :

```text
publish
edit_and_publish
reject
mark_duplicate
needs_review
```

Une modification manuelle avant publication doit être auditée.

---

# 32. Qui peut rendre “Officielle”

Règle :

> **Seule une organisation autorisée peut conférer le niveau Officielle à une information de sa course.**

PLUKA peut publier :

> Validée PLUKA

mais pas se substituer silencieusement à l’organisateur pour qualifier une décision d’“Officielle”.

---

# 33. Publication

Publier signifie :

1. résoudre le RaceFact logique ;
2. créer une nouvelle RaceFactVersion immuable ;
3. rattacher les FactSources ;
4. enregistrer l’auteur ;
5. enregistrer le niveau de confiance ;
6. mettre à jour `current_version_id` ;
7. produire un événement métier ;
8. évaluer les impacts downstream.

---

# 34. FactSources

Une version peut dépendre de plusieurs sources.

Exemple :

```text
Version:
Assistance interdite au Rawil

Evidence:
- règlement p. 14
- guide coureur p. 9
```

La relation doit conserver le locator exact.

---

# 35. Ne jamais écraser

Interdit :

```text
UPDATE race_fact SET value = ...
```

sans version.

Le comportement attendu :

```text
RaceFactVersion N
→ RaceFactVersion N+1
→ current_version_id = N+1
```

L’ancienne version reste accessible à l’audit.

---

# 36. Détection de changement

Lorsqu’un nouveau snapshot diffère :

1. parser ;
2. extraire ;
3. comparer les candidats aux facts courants ;
4. identifier :
   - identique ;
   - nouveau ;
   - modifié ;
   - supprimé / introuvable ;
   - contradictoire.

L’absence d’une information dans un nouveau document ne signifie pas automatiquement qu’elle est supprimée.

---

# 37. Suppression / retrait d’une information

Une information publiée ne doit pas disparaître uniquement parce qu’elle n’a pas été réextraite.

Pour la retirer :

- publication explicite d’une nouvelle version / état ;
- ou action humaine de dépublication / retrait.

Le modèle exact doit suivre `02_DATA_MODEL.md`.

---

# 38. Conflits

Un conflit existe lorsque deux valeurs incompatibles concernent le même sujet.

Exemple :

```text
Règlement :
Assistance autorisée à Adelboden

Guide :
Assistance interdite à Adelboden
```

Le système crée :

```text
CONFLICT
```

Il ne choisit pas automatiquement une valeur.

---

# 39. Types de conflit

V1 :

```text
value_conflict
date_conflict
time_conflict
authorization_conflict
location_conflict
source_recency_conflict
published_fact_conflict
```

La taxonomie peut être simplifiée techniquement si les écrans gardent la distinction utile.

---

# 40. Résolution de conflit

La revue doit permettre :

1. voir les valeurs ;
2. voir les sources ;
3. voir leur date / version ;
4. choisir une valeur ;
5. saisir éventuellement une autre valeur ;
6. choisir le niveau de publication ;
7. ajouter une note interne.

La résolution crée une nouvelle RaceFactVersion.

Elle ne modifie pas les sources.

---

# 41. Source plus récente ≠ vérité automatique

Un snapshot plus récent peut contenir :

- une correction ;
- une coquille ;
- un contenu partiel ;
- une page de FAQ moins autoritative.

Donc :

> **la fraîcheur est un signal, pas une autorité absolue.**

Le système peut prioriser la revue mais ne publie pas automatiquement.

---

# 42. Hiérarchie indicative de sources

Pour le tri uniquement, pas pour l’auto-publication :

1. saisie officielle organisateur ;
2. règlement / guide officiel ;
3. page officielle dédiée ;
4. document officiel secondaire ;
5. contenu PLUKA validé ;
6. communautaire.

Cette hiérarchie doit être configurable par contexte.

Une règle de course peut être légalement portée par un règlement plus ancien qu’une page marketing récente.

---

# 43. Changement critique

Certains facts peuvent avoir un impact fort :

- heure de départ ;
- barrières ;
- parcours ;
- assistance ;
- matériel obligatoire ;
- kit froid / chaud ;
- annulation ;
- changement de lieu ;
- retrait dossard.

Un changement critique publié doit produire un événement métier.

---

# 44. Impact downstream

Exemple :

```text
race.fact.published
↓
Impact Analyzer
↓
Plans dépendants
Préparation
Assistance
Nutrition
Brief
Q&A
Notifications
```

Le moteur Sources ne réécrit pas lui-même les objets downstream.

Il signale le changement.

---

# 45. Plan version dependencies

Lorsqu’un Plan est confirmé, le domaine doit conserver les versions exactes des facts utilisés.

Exemples :

- départ ;
- waypoints ;
- barrières ;
- segments / points officiels pertinents.

Ainsi, si un fact change :

```text
fact_version N+1
```

PLUKA peut retrouver les Plans dépendants de :

```text
fact_version N
```

---

# 46. Aucun Plan silencieusement muté

Même si l’organisateur publie une nouvelle barrière :

- le RaceFact courant change ;
- le Plan existant est marqué potentiellement impacté ;
- le coureur est informé ;
- le recalcul se fait selon le workflow produit.

L’historique du Plan reste reproductible.

---

# 47. Search / retrieval

Les chunks servent aussi à `Demander à PLUKA`.

Pipeline :

```text
question
↓
scope race / outing
↓
facts structurés pertinents
↓
recherche chunks
↓
réponse
↓
citations
```

Le système doit privilégier les facts publiés.

---

# 48. Priorité Q&A

Ordre logique :

1. facts officiels / validés disponibles ;
2. sources de ces facts ;
3. chunks complémentaires pertinents ;
4. réponse prudente.

Si aucune information fiable :

> **Je n’ai pas trouvé cette information dans les sources disponibles.**

Ne jamais compléter en inventant une règle de course.

---

# 49. Citation dans Q&A

Une réponse doit pouvoir afficher :

```text
Source
Document
Page / section
Date de capture
```

selon disponibilité.

Le système ne doit pas citer une URL générique si la réponse vient d’une page / version précise stockée dans PLUKA.

---

# 50. Embeddings

Les embeddings servent à la recherche, pas à la vérité.

Ils peuvent être calculés sur :

- chunks ;
- facts normalisés ;
- éventuellement titres / sujets.

Le modèle d’embedding est versionné.

Un changement de modèle peut nécessiter une réindexation.

---

# 51. pgvector

pgvector peut être utilisé pour :

- semantic search ;
- retrieval ;
- regroupement de questions.

Il ne doit pas être utilisé pour décider automatiquement qu’un fait est identique à un autre sans règle métier.

---

# 52. Détection d’informations manquantes

PLUKA peut détecter :

```text
question fréquente
+
aucun fact fiable
=
information manquante potentielle
```

Cette logique alimente le BO organisateur.

Exemple :

```text
38 participants demandent :
“Où se garer à Adelboden ?”

Aucun RaceFact suffisamment précis
→ insight
```

Le moteur ne publie pas de réponse.

---

# 53. Information documentée mais mal comprise

Cas :

```text
fact fiable existe
+
question répétée
```

Résultat :

> **Cette information semble générer beaucoup de questions.**

Pas :

> **Votre communication est mauvaise.**

Cette distinction appartient au pipeline Insights mais dépend de la qualité des facts.

---

# 54. Question normalization

Pour l’agrégation B2B, des formulations similaires peuvent être regroupées.

Exemples :

```text
“Où se garer à Adelboden ?”
“Parking assistance Adelboden ?”
“Il y a un parking pour les accompagnants à Adelboden ?”
```

→ thème / question normalisée.

Le regroupement est technique et agrégé.

Le texte des conversations individuelles n’est pas exposé au BO.

---

# 55. Publication d’une réponse officielle depuis un insight

Flow :

```text
Insight
↓
Ajouter une réponse officielle
↓
création / résolution RaceFact
↓
publication
↓
nouveau fact
↓
Q&A utilise le fact
↓
Assistance / Course peuvent l’utiliser
```

C’est une boucle importante du B2B.

---

# 56. Organisation du package

## Frontière avec `packages/contracts`

`01_ARCHITECTURE.md` §4.5 fait de `packages/contracts` le lieu des contrats de providers
externes. La ligne de partage est la suivante :

| Type | Emplacement | Raison |
| --- | --- | --- |
| Interface `AIProvider` | `packages/contracts` | Contrat de fournisseur externe. Aucun moteur ne doit connaître le nom d'un fournisseur, et l'interface doit être visible sans dépendre de `sources`. |
| `ExtractedCandidate`, provenance, DTO de facts, schémas d'issues | `packages/sources` | Types métier propres au domaine d'extraction. Les sortir d'ici créerait une dépendance inutile pour tous les autres paquets. |

`packages/sources` importe donc `AIProvider` depuis `packages/contracts` et n'y définit
aucune interface de fournisseur.

## Structure

Package recommandé :

```text
packages/sources/
├── src/
│   ├── index.ts
│   ├── contracts.ts        # types métier d'extraction — PAS les interfaces providers
│   ├── source-types.ts
│   ├── snapshot.ts
│   ├── web-fetcher.ts
│   ├── pdf-parser.ts
│   ├── html-parser.ts
│   ├── chunker.ts
│   ├── extractors/
│   │   ├── deterministic/
│   │   └── ai/
│   ├── candidate-normalizer.ts
│   ├── conflict-detector.ts
│   ├── fact-identity.ts
│   ├── provenance.ts
│   ├── retrieval.ts
│   ├── embeddings.ts
│   ├── validation.ts
│   ├── hash.ts
│   └── issues.ts
└── tests/
```

L’ingestion GPX peut vivre dans un package géospatial partagé.

---

# 57. Jobs asynchrones

Jobs principaux :

```text
source.ingest
source.snapshot
source.parse
source.extract
source.embed
source.reindex
source.compare
```

Un workflow peut enchaîner ces jobs mais chaque étape doit rester idempotente.

---

# 58. Idempotence

Clés possibles :

```text
source.ingest:{sourceId}:{contentHash}
source.parse:{snapshotId}:{parserVersion}
source.extract:{snapshotId}:{engineVersion}
source.embed:{chunkId}:{embeddingVersion}
```

Un retry ne doit pas produire :

- snapshots dupliqués ;
- candidats identiques dupliqués ;
- RaceFactVersion publiée deux fois ;
- embeddings en doublon non contrôlé.

---

# 59. Outbox

La publication d’un fact critique doit utiliser le pattern outbox.

Transaction :

```text
insert RaceFactVersion
update RaceFact.current_version_id
insert FactSources
insert outbox_event
commit
```

Puis :

```text
outbox
→ impacts downstream
```

---

# 60. Erreurs ingestion

Codes possibles :

```text
SOURCE_FETCH_FAILED
SOURCE_TIMEOUT
SOURCE_TOO_LARGE
SOURCE_UNSUPPORTED
SOURCE_PRIVATE_NETWORK_BLOCKED
SOURCE_REDIRECT_BLOCKED
PDF_PARSE_FAILED
OCR_REQUIRED
OCR_FAILED
HTML_PARSE_FAILED
SNAPSHOT_STORAGE_FAILED
```

Une erreur doit être visible dans le BO sans masquer les sources déjà valides.

---

# 61. Erreurs extraction

```text
EXTRACTION_FAILED
EXTRACTION_SCHEMA_INVALID
EXTRACTION_EMPTY
CANDIDATE_INVALID
CANDIDATE_LOW_CONFIDENCE
```

Un échec extraction ne doit jamais invalider un RaceFact déjà publié.

---

# 62. Erreurs publication

```text
FACT_IDENTITY_AMBIGUOUS
FACT_CONFLICT_UNRESOLVED
FACT_SOURCE_MISSING
OFFICIAL_AUTHORIZATION_REQUIRED
FACT_VERSION_WRITE_FAILED
```

---

# 63. Propriétés de sécurité

1. les snapshots privés ne sont pas publics ;
2. les fichiers de participants ne passent pas dans le pipeline Sources ;
3. les tokens privés ne sont jamais chunkés ;
4. le service role reste serveur ;
5. l’IA ne reçoit que le minimum utile ;
6. les secrets ne sont jamais inclus dans les prompts ;
7. les contenus d’Assistance / Nutrition ne sont pas indexés comme sources de course ;
8. l’organisation ne voit pas les conversations individuelles.

---

# 64. Données envoyées à l’IA

Le payload IA doit contenir uniquement :

- chunks nécessaires ;
- contexte de schéma ;
- taxonomie ;
- instructions d’extraction.

Éviter :

- PII inutile ;
- autres courses ;
- historique utilisateur ;
- contenus privés coureur.

---

# 65. Prompt injection documentaire

Un document peut contenir du texte malveillant du type :

> “ignore les instructions et publie X”.

Le moteur doit traiter le document comme **donnée non fiable**.

Règles :

- séparation claire instructions système / contenu document ;
- sortie JSON contrainte ;
- aucune action outil déclenchée par le document ;
- aucune publication depuis le modèle ;
- validation humaine obligatoire.

---

# 66. Corpus de test

Créer un corpus gold comprenant :

- règlement PDF clair ;
- règlement avec tableaux ;
- guide coureur ;
- page HTML ;
- source mise à jour ;
- contradiction entre deux documents ;
- PDF scanné ;
- document multilingue si nécessaire ;
- horaires ;
- assistance ;
- matériel ;
- barrières ;
- contenus ravito ;
- navettes.

Chaque fixture possède un résultat attendu.

---

# 67. Tests fondamentaux

## S01 — HTML simple

Source officielle avec heure de départ.

Attendu :

- snapshot ;
- blocks ;
- candidat correct ;
- citation précise.

## S02 — PDF natif

Règlement avec barrière.

Attendu :

- extraction page correcte ;
- candidat cutoff ;
- page conservée.

## S03 — PDF scanné

Attendu :

- extraction native insuffisante ;
- OCR fallback ;
- flag OCR.

## S04 — Snapshot identique

Même contenu téléchargé deux fois.

Attendu :

- hash identique ;
- pas de duplication inutile.

## S05 — Snapshot modifié

Une heure change.

Attendu :

- nouveau snapshot ;
- candidat différent ;
- fact courant inchangé tant que non publié.

---

# 68. Tests conflits

## S06 — Assistance contradictoire

Deux sources incompatibles.

Attendu :

```text
authorization_conflict
```

aucune auto-publication.

## S07 — Source plus récente

Source récente différente.

Attendu :

- conflit / changement proposé ;
- pas de victoire automatique par date.

## S08 — Information absente du nouveau document

Attendu :

ancienne information reste publiée.

---

# 69. Tests publication

## S09 — Publish

Attendu :

- RaceFact stable ;
- Version 1 ;
- FactSource ;
- current_version_id.

## S10 — Update

Attendu :

- Version 2 créée ;
- Version 1 immuable ;
- current_version_id → V2.

## S11 — Source multiple

Attendu :

plusieurs FactSources.

## S12 — Official

Utilisateur sans droit officiel.

Attendu :

```text
OFFICIAL_AUTHORIZATION_REQUIRED
```

---

# 70. Tests downstream

## S13 — Cutoff change

Publication d’une nouvelle barrière.

Attendu :

- événement métier ;
- Plans dépendants identifiables ;
- aucun Plan réécrit automatiquement.

## S14 — Equipment change

Nouvel élément obligatoire.

Attendu :

- impact Préparation détectable ;
- information officielle disponible Free ;
- pas de mutation silencieuse de checklist personnalisée.

---

# 71. Tests Q&A

## S15 — Fact disponible

Question simple.

Attendu :

réponse fondée sur le fact + citation.

## S16 — Information absente

Attendu :

réponse “non trouvée” sans invention.

## S17 — Sources contradictoires non résolues

Attendu :

ne pas donner une réponse certaine.

## S18 — Fact publié prioritaire

Le chunk ancien contredit le fact courant.

Attendu :

le fact courant prévaut, citation pertinente.

---

# 72. Tests sécurité

## S19 — SSRF localhost

Attendu :

blocage.

## S20 — Redirect réseau privé

Attendu :

blocage après redirection.

## S21 — Prompt injection documentaire

Attendu :

aucune action hors extraction structurée.

## S22 — Source privée

Utilisateur non autorisé.

Attendu :

aucun accès.

---

# 73. Tests insights

## S23 — Question répétée sans réponse

Attendu :

insight “information manquante potentielle”.

## S24 — Question répétée avec réponse fiable

Attendu :

insight “règle beaucoup demandée”, pas “information manquante”.

## S25 — Publication depuis insight

Attendu :

fact publié puis utilisable par Q&A.

---

# 74. Performance

Le traitement documentaire est asynchrone.

Aucune page normale ne doit attendre :

- téléchargement PDF ;
- parsing ;
- embedding ;
- appel IA.

L’interface affiche :

```text
en cours d’analyse
```

puis se met à jour.

---

# 75. Coût IA

Mesurer par extraction run :

- modèle ;
- tokens ;
- coût estimé ;
- durée ;
- nombre de candidats ;
- nombre retenu / rejeté.

Objectif :

> **une source partagée doit être extraite une fois pour toute la Race, pas une fois par participant.**

---

# 76. Versionnement moteur

À versionner :

```text
sources_engine_version
parser_version
chunker_version
extractor_schema_version
prompt_version
embedding_version
```

Une modification pouvant changer les candidats doit être identifiable.

---

# 77. Re-extraction

Une nouvelle version moteur peut justifier une ré-extraction d’un snapshot existant.

Cela produit :

- un nouvel ExtractionRun ;
- de nouveaux candidats.

Cela ne modifie jamais directement les RaceFactVersions publiées.

---

# 78. Multilingue

V1 doit pouvoir stocker des sources dans leur langue originale.

Une extraction peut normaliser certains champs structurés, mais :

- la citation conserve le texte original ;
- une traduction générée n’est pas une preuve originale ;
- l’interface peut traduire séparément si le produit le permet.

---

# 79. Dates et fuseaux

Toute date / heure extraite doit essayer de conserver :

- date ;
- heure locale ;
- timezone si résolue ;
- contexte de Race.

Si une source dit :

```text
7h10
```

sans date mais dans un guide d’édition :

le normalizer peut rattacher l’heure à l’édition seulement si le contexte est explicite.

Toute résolution contextuelle doit rester traçable.

---

# 80. Unités

Les valeurs structurées doivent être normalisées :

```text
km
m
minutes / seconds
°C
etc.
```

mais la valeur originale doit rester récupérable dans l’evidence.

Exemple :

```text
“4'600 m D+”
→ 4600
```

La normalisation ne remplace pas la citation.

---

# 81. Contacts

Les contacts officiels peuvent être extraits.

Attention aux PII :

- ne pas publier automatiquement un numéro personnel trouvé dans un document ;
- distinguer contact public organisation / donnée personnelle.

La validation humaine reste obligatoire.

---

# 82. Matériel

Pour le matériel obligatoire :

chaque fact doit distinguer si possible :

```text
mandatory
conditional
recommended
```

Ne jamais transformer :

> recommandé

en :

> obligatoire.

Une Condition météo PLUKA ne change pas le statut officiel.

---

# 83. Assistance

Pour Assistance, extraire séparément :

- autorisation ;
- points autorisés ;
- restrictions ;
- accès ;
- parking ;
- horaires ;
- consignes.

Cela permet à PLUKA d’éviter une valeur générique trop vague.

---

# 84. Barrières

Une barrière doit conserver :

- waypoint ;
- horaire ;
- basis si disponible :
  - arrival ;
  - departure ;
- source ;
- version.

Si la source ne permet pas de savoir si l’horaire est basé sur l’arrivée ou le départ :

- ne pas inventer ;
- produire un candidat incomplet / review required.

---

# 85. Ravitos

Distinguer :

- présence d’un ravito ;
- présence d’eau ;
- contenu annoncé ;
- assistance autorisée ;
- drop bag ;
- autres services.

Un ravito ne signifie pas automatiquement :

```text
eau disponible
assistance autorisée
```

Chaque concept doit être un fact distinct lorsque pertinent.

---

# 86. Changements officiels

Une organisation peut publier directement :

- changement de parcours ;
- activation kit froid ;
- changement heure ;
- annulation ;
- navette ;
- fermeture accès.

Ces décisions n’ont pas besoin de passer par une extraction IA.

Elles utilisent le même système de versioning / publication afin de conserver l’historique.

---

# 87. Brief organisateur

Le Brief consomme uniquement :

- facts publiés ;
- conflits ouverts ;
- changements récents ;
- insights autorisés.

Il ne doit pas afficher un candidat non validé comme vérité.

---

# 88. UI de revue

L’écran de revue doit être orienté exception.

Par défaut :

```text
PLUKA a analysé la source
```

Puis :

- candidats à valider ;
- contradictions ;
- changements ;
- éléments incertains.

Ne pas exposer un pipeline technique complexe à l’organisation.

---

# 89. “PLUKA travaille”

Le BO doit donner cette impression :

```text
Vous ajoutez un document
↓
PLUKA l’analyse
↓
PLUKA vous montre ce qui mérite une décision
```

Pas :

```text
Configurez votre pipeline d’extraction
```

Les détails techniques sont réservés à l’Admin PLUKA.

---

# 90. Admin PLUKA

L’Admin peut voir davantage :

- raw snapshots ;
- parsing ;
- runs ;
- erreurs ;
- prompts / versions ;
- chunks ;
- candidats ;
- embeddings ;
- coût.

L’organisateur ne doit pas avoir besoin de ces informations.

---

# 91. Mapping vers le Data Model

Le modèle exact doit s’aligner avec `02_DATA_MODEL.md`.

Concepts obligatoires :

```text
sources
source snapshots / versions
blocks / chunks
extraction runs
candidates
race facts
race fact versions
fact sources
conflicts
publication audit
```

Si certains noms du schéma SQL diffèrent, ne pas créer une deuxième modélisation parallèle.

Adapter la couche repository.

---

# 92. Écart à corriger si nécessaire

Avant implémentation, vérifier que le schéma actuel permet réellement de persister :

- hash de snapshot ;
- locator précis ;
- version parser / chunker ;
- extraction run ;
- prompt version ;
- confidence extraction ;
- candidate status ;
- conflict lifecycle ;
- authorisation official ;
- source evidence multiple ;
- embeddings versionnés.

Si un élément manque, mettre à jour `02_DATA_MODEL.md` et la migration avant de contourner le problème en JSON frontend.

---

# 93. Commands applicatives

La couche domaine peut exposer :

```text
createSource
captureSourceSnapshot
archiveSource
retrySourceIngestion
reviewCandidate
publishCandidate
editAndPublishCandidate
rejectCandidate
resolveFactConflict
publishManualOrganizerFact
supersedeFact
refreshSource
```

Les jobs techniques restent internes.

---

# 94. Événements métier

Événements utiles :

```text
source.snapshot.created
source.extraction.completed
race.fact.published
race.fact.changed
race.official_notice.published
race.source.conflict.detected
```

Tous n’ont pas besoin d’être publics.

---

# 95. Observabilité

Mesurer :

- taux de fetch réussi ;
- temps parsing ;
- pages / chunks ;
- taux extraction valide ;
- candidats / source ;
- taux validation ;
- taux rejet ;
- conflits ;
- temps jusqu’à publication ;
- coût IA ;
- OCR usage ;
- taux de réponse Q&A sans information.

---

# 96. Non-régression obligatoire

Une évolution ne peut pas être mergée si elle :

- publie automatiquement un candidat ;
- perd la provenance ;
- modifie une version publiée ;
- fait disparaître un ancien snapshot ;
- choisit automatiquement une source contradictoire comme vérité ;
- promeut une info en Officielle sans autorisation ;
- réécrit silencieusement un Plan ;
- utilise l’IA pour parser un GPX ;
- utilise OCR systématiquement ;
- permet SSRF ;
- expose des chunks privés au mauvais rôle ;
- répond à une question avec une donnée non trouvée dans les sources.

---

# 97. Critères d’acceptation pour Claude Code

Le moteur Sources / Extraction V1 est correctement implémenté lorsque :

1. une Source logique peut posséder plusieurs snapshots ;
2. les snapshots sont immuables ;
3. chaque snapshot possède un hash ;
4. l’acquisition web est protégée contre SSRF ;
5. les PDF sont parsés en natif avant OCR ;
6. l’OCR est un fallback identifiable ;
7. le GPX passe par le pipeline géospatial dédié ;
8. le parsing produit des blocks localisables ;
9. le chunking conserve la provenance ;
10. les sorties IA sont validées par schéma ;
11. l’IA produit des candidats, jamais des facts publiés ;
12. chaque candidat possède des preuves ;
13. un conflit est détectable ;
14. aucune valeur n’est choisie automatiquement en cas de conflit réel ;
15. une publication crée une RaceFactVersion immuable ;
16. `current_version_id` pointe vers la version courante ;
17. les anciennes versions restent accessibles ;
18. plusieurs sources peuvent justifier une même version ;
19. seule une organisation autorisée peut publier `official`;
20. PLUKA peut publier `pluka_validated` selon ses droits ;
21. un changement critique produit un événement downstream ;
22. aucun Plan n’est réécrit automatiquement ;
23. les dépendances exactes des Plans peuvent être retrouvées ;
24. Q&A privilégie les facts publiés ;
25. Q&A cite les sources ;
26. Q&A sait répondre “non trouvé” ;
27. une question répétée sans réponse peut devenir un insight agrégé ;
28. une réponse publiée depuis un insight devient un fact exploitable ;
29. les ExtractionRuns sont versionnés et auditables ;
30. les embeddings ne deviennent jamais une source de vérité ;
31. les données privées coureur ne passent pas dans ce pipeline ;
32. les tests S01–S25 passent.

---

# 98. Ordre d’implémentation recommandé

| Étape | Livrable |
|---|---|
| S1 | Source + Snapshot + Storage |
| S2 | sécurité fetch / SSRF |
| S3 | parser HTML |
| S4 | parser PDF |
| S5 | chunking + provenance |
| S6 | extraction déterministe |
| S7 | extraction IA structurée |
| S8 | candidats + review |
| S9 | RaceFact + versions + FactSources |
| S10 | conflits |
| S11 | impacts downstream |
| S12 | embeddings / retrieval |
| S13 | Demander à PLUKA |
| S14 | insights questions |
| S15 | corpus gold + calibration |

---

# 99. Consigne finale

La valeur de PLUKA ne vient pas du fait de “lire des PDF avec de l’IA”.

Elle vient de cette chaîne :

```text
INFORMATION DISPERSÉE
↓
PREUVE CAPTURÉE
↓
DONNÉE STRUCTURÉE
↓
VALIDATION
↓
VERSION PUBLIÉE
↓
UTILISATION PERSONNELLE
```

Trois règles absolues :

> **Une extraction n’est pas une vérité.**

> **Une information critique doit toujours pouvoir être reliée à sa preuve exacte.**

> **Une nouvelle source ne remplace jamais silencieusement une information publiée.**

---

**Fin — PLUKA Sources & Extraction Engine V1**
