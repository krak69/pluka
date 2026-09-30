# PLUKA — Routes & Flows V1

**Fichier de référence :** `docs/05_ROUTES_FLOWS.md`  
**Statut :** Référence technique — V1  
**Date de consolidation :** 2026-09-30  
**Principe :** une adresse par chose qu'on veut montrer à quelqu'un ; l'état pour tout le reste

---

# 0. Rôle de ce document

Ce document fixe **l'arborescence de routes** des surfaces PLUKA et le rattachement de chaque écran du prototype figé à une adresse.

Il répond à trois questions :

> **Quelle est l'URL de cet écran ?**
>
> **Cet élément est-il une route ou un état ?**
>
> **Dans quelle application vit-il ?**

Il ne définit ni les droits d'accès — c'est `04_ENTITLEMENTS.md` — ni les données lisibles — c'est `03_PRIVACY_RLS.md`. Une route existe indépendamment du droit d'y voir quelque chose : `04_ENTITLEMENTS.md` §40 est explicite, « ne pas bloquer toute la route par entitlement ».

## 0.1 Documents de référence

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/03_PRIVACY_RLS.md`
- `docs/04_ENTITLEMENTS.md`
- `docs/06_DESIGN_SYSTEM.md`
- `/reference/prototype/PLUKA.dc.html`
- `/reference/prototype/PLUKA Homepage.dc.html`
- `/reference/prototype/PLUKA Organisateurs.dc.html`

### Ordre de priorité

En cas de contradiction :

1. `01_ARCHITECTURE.md` fait foi sur la répartition en applications ;
2. ce document fait foi sur la forme des routes ;
3. `03_PRIVACY_RLS.md` fait foi sur ce qu'une route peut afficher ;
4. `04_ENTITLEMENTS.md` fait foi sur qui peut en obtenir le contenu ;
5. le prototype fait foi uniquement sur l'intention d'écran.

Le prototype ne contient **aucune route** : il est bâti sur un `screen` et un `tab` en mémoire. Il ne peut donc pas trancher la forme d'une URL, seulement l'existence d'un écran.

---

# 1. Les neuf règles

Ces règles tranchent. Tout ce qu'elles ne tranchent pas est listé en §12, sans être décidé.

Les six premières sont d'origine. Les trois dernières tranchent trois cas qui figuraient en §12.

## 1.1 L'espace organisateur vit dans `apps/app`, sous `/org`

`01_ARCHITECTURE.md` §4.2 : « Le B2B reste dans la même application et le même domaine métier. Il ne possède pas son propre backend. »

Il n'y a donc pas d'`apps/organizer`. Le prototype présente l'organisateur comme un shell séparé (`screen: 'org'`, sa propre `orgNav`, sa propre barre latérale) ; c'est une intention d'interface, pas un découpage d'application.

## 1.2 Devient une route tout onglet, et tout élément qu'on veut partager par lien

Un onglet de navigation est une route. Un écran qu'on veut pouvoir envoyer à quelqu'un est une route.

Restent des **états**, jamais des routes :

- les tiroirs et panneaux latéraux ;
- les modales et feuilles ;
- les étapes d'un formulaire.

Le test est le partage, pas la profondeur. Un sous-onglet de troisième niveau est une route ; une modale de premier niveau n'en est pas une.

## 1.3 Conditions est une route, rendue en panneau sur le Plan

`…/plan/conditions` est une adresse réelle. Son rendu reste le panneau que le prototype pose sur le Plan (`tab === 'plan' && wxOpen`).

Route et rendu sont deux choses : l'URL rend le panneau partageable et profondément liable, la composition ne change pas. `04_ENTITLEMENTS.md` §40 parle d'ailleurs bien d'« une route Conditions », qu'un Free doit pouvoir ouvrir pour y voir les notices officielles et le paywall.

## 1.4 La navigation organisateur suit `ORG_GROUPS` ; les identifiants `ORG_LEGACY` deviennent des redirections

Le prototype porte deux générations de navigation. `ORG_GROUPS` est la cible :

```text
overview
course   → infos · sources · epreuves
analyse
parts
settings → event · partenaires
```

Les onze identifiants de `ORG_LEGACY` ne sont pas repris comme routes. Ils deviennent des redirections permanentes vers leur destination canonique (§7.3).

## 1.5 `/a/<token>` est une route publique, hors authentification, dans `apps/app`

La page assistance est adressée par jeton et n'a pas de session. Elle vit dans `apps/app`, pas dans `apps/www` : `01_ARCHITECTURE.md` §4.1 interdit à `www` de lire la base, et cette page lit un payload sûr (`03_PRIVACY_RLS.md` §46).

## 1.6 Les liens entre `app` et `admin` sont des liens absolus

Ce sont deux applications, deux origines. Un passage de l'une à l'autre est un `<a href>` vers `NEXT_PUBLIC_APP_URL` ou `NEXT_PUBLIC_ADMIN_URL`, jamais un `<Link>` ni une transition de routeur.

La même règle vaut de `www` vers `app`.

## 1.7 La participation naît quand le coureur valide sa course

Un `participant_race` est créé au moment où le coureur valide la course qu'il prépare, depuis la fiche épreuve — pas à la génération du plan, pas à l'achat.

Tout ce qui suit dans l'entonnoir est donc scopé : **l'objectif de course est `/courses/[participantRaceId]/objectif`**, et non une route globale.

Deux écrans de l'entonnoir restent globaux, et c'est cohérent avec la même règle :

- `/profil` — le profil trailer est une donnée d'utilisateur, pas de participation. `trail_profiles` est unique par personne, et le prototype le dit lui-même : « Il a servi à préparer tes courses précédentes. » Un seul profil sert toutes les courses.
- `/offre` — le choix d'offre n'est pas un écran de participation. Un Race Pass a une portée `participant_race`, un PLUKA+ une portée `global` ; cette distinction appartient à `04_ENTITLEMENTS.md` §7 et ne change pas la forme de la route. L'entonnoir y entre en portant la participation comme contexte.

## 1.8 La page publique de course vit dans `apps/app`, en route publique hors authentification

Il n'y a **qu'une** fiche épreuve, pas deux. Elle est servie par `apps/app`, sans session, et c'est la même page que celle de l'entonnoir : `screen: 'race'` du prototype.

Conséquences directes, à traiter comme telles :

1. `apps/app` cesse d'être entièrement non indexable. L'en-tête `X-Robots-Tag: noindex` de son `next.config.ts` doit exempter cette route, et elle seule.
2. La visibilité gouverne le rendu. Telle que l'implémentation la traite aujourd'hui : seule une course `public` est lisible sans session et indexable ; `unlisted` et `private` renvoient une 404 à un visiteur anonyme, et ne s'ouvrent qu'au participant, à l'organisation gestionnaire ou à l'admin plateforme. La 404 est volontaire — une page d'erreur d'autorisation révélerait l'existence de la course (§120).

   `03_PRIVACY_RLS.md` §17 décrit pourtant `unlisted` comme accessible « par lien direct ». Ce n'est pas ce que fait le code : `private.race_is_publicly_readable` et `isRacePubliclyReadable` exigent tous deux `public_visibility = 'public'`. L'écart est enregistré en §12.10.
3. La page lit la base sans session. C'est une lecture publique, soumise à la RLS de §16 sur la lecture publique des événements, éditions et courses.

`01_ARCHITECTURE.md` §4.1 enregistre la même décision et ne confie plus les pages publiques de courses à `apps/www`. Les deux documents disent la même chose.

## 1.9 Slugs pour les identifiants publics, UUID pour tout ce qui est privé

Une route publique porte des slugs. Une route privée porte des UUID.

Le schéma les fournit déjà, avec leurs portées d'unicité — `0001_initial_schema.sql` :

| Table           | Colonne | Unicité               |
| --------------- | ------- | --------------------- |
| `organizations` | `slug`  | globale               |
| `events`        | `slug`  | globale               |
| `editions`      | `slug`  | par `event_id`        |
| `races`         | `slug`  | par `edition_id`      |

Un `races.slug` seul ne désigne donc rien : « wild-70 » existe dans chaque édition. Le chemin public d'une course porte les trois niveaux :

```text
/epreuves/[eventSlug]/[editionSlug]/[raceSlug]
```

C'est la plus courte forme que les contraintes d'unicité rendent non ambiguë, et elle reste lisible et stable.

Les jetons ne relèvent d'aucune des deux catégories : `[token]` est un secret opaque, ni slug ni identifiant d'entité.

---

# 2. Les trois applications

| Application  | Origine                 | Indexable          | Session          |
| ------------ | ----------------------- | ------------------ | ---------------- |
| `apps/www`   | `NEXT_PUBLIC_SITE_URL`  | oui                | aucune           |
| `apps/app`   | `NEXT_PUBLIC_APP_URL`   | non, sauf §1.8     | requise, sauf §4 |
| `apps/admin` | `NEXT_PUBLIC_ADMIN_URL` | non                | requise + rôle   |

`apps/worker` n'expose pas de route HTTP de produit.

---

# 3. `apps/www` — site public

```text
/                        Homepage coureur
/organisateurs           Landing organisateurs
```

Deux pages, contenu entièrement statique, aucune donnée privée (`01_ARCHITECTURE.md` §4.1).

Le commutateur d'audience de l'en-tête relie les deux par `<Link>` interne. Tous les appels à l'action renvoient vers `NEXT_PUBLIC_APP_URL` en absolu (§1.6).

Les ancres de section sont normatives : elles sont citées par les menus, par les pieds de page et entre les deux pages.

| Page             | Ancres                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/`              | `#top` `#comment` `#produit` `#autour` `#conditions` `#fiabilite` `#saison` `#organisateurs` `#contact` `#ressources`     |
| `/organisateurs` | `#intelligence` `#fonctionnement` `#backoffice` `#brief` `#conditions` `#participant` `#confidentialite` `#metiers` `#benefices` `#contact` `#faq` |

---

# 4. `apps/app` — zone publique

Cinq routes seulement échappent à la session.

```text
/connexion                                     Connexion par lien magique
/auth/callback                                 Route Handler — échange du jeton
/a/[token]                                     Page assistance, par jeton (§1.5)
/invitation/[token]                            Invitation participant, par jeton
/epreuves/[eventSlug]/[editionSlug]/[raceSlug] Fiche épreuve publique (§1.8, §1.9)
```

## 4.1 `/a/[token]`

Rendu du payload sûr de `03_PRIVACY_RLS.md` §46. Aucune session, aucun compte à créer — c'est la promesse tenue par la homepage (« Un lien privé suffit : pas de compte à créer de son côté »).

Les trois étapes de la page restent l'état interne d'un écran unique.

## 4.2 `/invitation/[token]`

Le lien envoyé par l'organisation. C'est par définition une adresse partagée : elle est une route.

Les trois étapes du prototype (`invStep` 0 à 2) sont des étapes de formulaire, donc un état (§1.2).

**Remarque de confidentialité, hors périmètre de ce document :** le prototype préremplit prénom, nom, email, dossard et vague. `03_PRIVACY_RLS.md` §28 impose de minimiser l'email ; le contenu exact du payload de cette route appartient à `03_PRIVACY_RLS.md`, pas ici.

## 4.3 `/epreuves/[eventSlug]/[editionSlug]/[raceSlug]`

La fiche épreuve, unique et publique (§1.8). C'est à la fois la page indexable de la course et la première étape de l'entonnoir : c'est ici que le coureur valide la course qu'il prépare, et c'est cette validation qui crée la participation (§1.7).

Elle est donc lue dans deux situations :

- **sans session** — elle présente la course et propose de la préparer, ce qui mène à `/connexion` en conservant la destination (§9.4) ;
- **avec session** — la validation crée le `participant_race` et redirige vers `/courses/[participantRaceId]/objectif`.

La visibilité de la course décide du rendu, pas de la route : `public`, `unlisted` ou `private` (§1.8).

C'est la seule route de `apps/app` qui porte des slugs, et la seule qui puisse être indexée.

---

# 5. `apps/app` — espace coureur

## 5.1 Zone globale

```text
/                        Accueil coureur
/saison                  Ma saison
/sorties                 Mes sorties — liste
/sorties/[outingId]      Sortie — aperçu
/sorties/[outingId]/plan
/sorties/[outingId]/nutrition
/sorties/[outingId]/materiel
/bibliotheque            Ma bibliothèque — redirige vers /materiel
/bibliotheque/materiel
/bibliotheque/produits
/bibliotheque/sacs
/bibliotheque/strategies
/produits                Mes produits — banque nutrition personnelle
```

Ces routes ne portent pas de course dans leur chemin : elles correspondent aux cinq entrées de `navGlobal` du prototype, qui vivent au-dessus d'une course particulière.

`/` affiche les actions prioritaires de la course courante, choisie par le sélecteur de l'en-tête. Ce choix est un état, pas un segment d'URL : on ne partage pas son propre accueil.

Les quatre onglets de la bibliothèque (`bTab`) et les quatre onglets d'une sortie (`sortieTab`) sont des onglets, donc des routes (§1.2).

## 5.2 Zone course

```text
/recherche                                  Trouver ma course

/courses/[participantRaceId]                → redirige vers /plan
/courses/[participantRaceId]/objectif        Mon objectif (§1.7)
/courses/[participantRaceId]/plan            Plan de course
/courses/[participantRaceId]/plan/conditions Conditions — panneau sur le Plan (§1.3)
/courses/[participantRaceId]/nutrition
/courses/[participantRaceId]/preparation     → redirige vers /materiel
/courses/[participantRaceId]/preparation/materiel
/courses/[participantRaceId]/preparation/sacs
/courses/[participantRaceId]/preparation/todo
/courses/[participantRaceId]/assistance
/courses/[participantRaceId]/course          La course — informations officielles
/courses/[participantRaceId]/apres-course
```

`/courses/[participantRaceId]` n'a pas d'écran propre : le prototype n'a pas d'accueil de course, il ouvre sur le Plan. La route redirige.

Le segment est un `participant_race_id`, pas un `race_id` : tout ce qui vit sous `/courses/` est la préparation d'une personne, et porte donc un UUID (§1.9). `/epreuves/…` est l'inverse — la course elle-même, avant toute participation, publique et en slugs (§4.3).

`/objectif` est scopé parce que la participation existe déjà quand on y arrive (§1.7). L'aperçu du plan qui le suit dans le prototype — `screen: 'preview'` — n'est pas une route : c'est le premier état de `/plan`.

Les trois onglets de Préparation (`prepTab`) sont des routes. La sous-application Nutrition est une route ; ses quarante clés d'état, dont son assistant en étapes, restent un état.

## 5.3 Entonnoir d'entrée

L'entonnoir traverse les trois zones : public, global, puis scopé à la participation dès qu'elle existe.

```text
/recherche                                      Trouver ma course              global
/epreuves/[eventSlug]/[editionSlug]/[raceSlug]  Fiche épreuve — validation     public
/profil                                         Profil trailer                 global
/courses/[participantRaceId]/objectif           Mon objectif                   participation
/offre                                          Choix de l'offre               global
/courses/[participantRaceId]/plan               Génération, puis premier plan  participation
```

La bascule se fait à la fiche épreuve : la validation crée le `participant_race` (§1.7). Tout ce qui vient après peut donc être scopé, et l'est dès que l'écran porte sur cette course.

`/profil` et `/offre` restent globaux, pour les raisons données en §1.7.

Les quatre étapes du profil trailer (`profStep` : `intro`, `a`, `b`, `recap`, plus l'état `known`) sont des étapes de formulaire, donc un état (§1.2).

Les écrans `building` et `ready` du prototype ne sont pas des routes : ce sont deux états transitoires du Plan — génération en cours, puis premier plan disponible. Ils appartiennent à `/courses/[participantRaceId]/plan`.

L'écran `mobile` du prototype n'est pas une route : c'est une largeur de fenêtre.

## 5.4 Ce qui reste un état

Aucun de ces éléments n'a d'URL.

| Élément du prototype       | Nature                    |
| -------------------------- | ------------------------- |
| `wxOpen`                   | panneau — mais route §1.3 |
| `srcOpen`                  | tiroir de source          |
| `reportFor`                | modale de signalement     |
| `tiersOpen`                | feuille de paywall        |
| `settingsOpen`             | tiroir de réglages        |
| `shareOpen`, `sharePerson` | modale de partage         |
| `racePickerOpen`           | sélecteur d'en-tête       |
| `nutStep`, `nut*`          | étapes et panneaux        |
| `profStep`                 | étapes de formulaire      |
| `invStep`                  | étapes de formulaire      |
| `sortieNew`, `sortieRev`   | formulaires               |
| `plusOpen`                 | menu mobile               |

---

# 6. `apps/app` — espace organisateur, sous `/org`

## 6.1 Arborescence

```text
/org                                       Choix de l'édition
/org/nouvelle-course                       Créer une course

/org/[editionId]                           Accueil organisateur
/org/[editionId]/course                    → redirige vers /informations
/org/[editionId]/course/informations
/org/[editionId]/course/sources
/org/[editionId]/course/epreuves
/org/[editionId]/analyse
/org/[editionId]/participants
/org/[editionId]/parametres                → redirige vers /evenement
/org/[editionId]/parametres/evenement
/org/[editionId]/parametres/partenaires
```

La correspondance avec `ORG_GROUPS` (§1.4) est directe :

| `orgTab` / `orgSub`  | Route                                  |
| -------------------- | -------------------------------------- |
| `overview`           | `/org/[editionId]`                     |
| `course` / `infos`   | `/org/[editionId]/course/informations`  |
| `course` / `sources` | `/org/[editionId]/course/sources`       |
| `course` / `epreuves`| `/org/[editionId]/course/epreuves`      |
| `analyse`            | `/org/[editionId]/analyse`              |
| `parts`              | `/org/[editionId]/participants`          |
| `settings` / `event` | `/org/[editionId]/parametres/evenement` |
| `settings` / `partenaires` | `/org/[editionId]/parametres/partenaires` |

La portée est dans l'URL parce que le partage l'exige (§1.2) : envoyer « regarde l'analyse » sans nommer l'édition n'a pas de sens. **Le choix de l'entité de portée n'est pas tranché — voir §12.1.**

## 6.2 Ce qui reste un état

```text
impStep 1–4          assistant d'import participants
riEnrichStep 0–3     assistant d'enrichissement du peloton
riAnswer             modale de réponse officielle
orgImpact            modale d'analyse d'impact avant publication
orgMailOpen          aperçu du mail d'invitation
orgInvitePreview     aperçu de l'invitation
orgEditOpen          édition d'une information
orgRaceOpen          édition d'une épreuve
riPrivacy            note de confidentialité
createStep 0–5       étapes de création d'une course
```

## 6.3 Aperçu participant

Le prototype offre `previewAs`, qui fait basculer l'organisateur dans le shell coureur.

**Cette fonctionnalité n'a pas de route dans ce document, et ne doit pas en recevoir tant que son contenu n'est pas tranché.** `03_PRIVACY_RLS.md` §5 porte **Jamais** pour l'organisation sur Plan, Préparation, Nutrition et Assistance, et §26 les exclut nommément de l'accès opérationnel. Tel que le prototype est construit, l'aperçu rend ces quatre domaines.

C'est un arbitrage de confidentialité, pas de routage : il appartient à `03_PRIVACY_RLS.md`.

## 6.4 Brief organisateur

`riBrief` est un panneau dans le prototype, donc un état (§1.2).

Mais la landing organisateurs promet explicitement : « Partagez-le avec votre équipe : tout le monde n'a pas besoin d'un compte PLUKA pour en profiter. » **Une route de partage hors compte n'est pas tranchée — voir §12.3.**

---

# 7. `apps/admin` — administration PLUKA

## 7.1 Arborescence

```text
/connexion
/auth/callback
/refuse

/                                Vue d'ensemble
/validation                      File de validation globale
/organisations
/organisations/[organizationId]
/evenements
/evenements/[eventId]
/courses/[raceId]                Administration d'une course
/courses/[raceId]/revue          Revue des extractions de cette course
/sources
/sources/[sourceId]
/produits                        → redirige vers /catalogue
/produits/catalogue
/produits/a-verifier
/produits/signalements
/signalements
/utilisateurs
/utilisateurs/[userId]
/traitements                     Imports et traitements
/journal                         Journal d'audit
```

Les dix entrées de l'`adminNav` du prototype y sont toutes présentes. Les trois sous-onglets de Produits nutrition (`bankTab`) sont des onglets, donc des routes (§1.2).

**L'index de l'application n'est pas tranché — voir §12.5.** **Le rattachement de `/courses/[raceId]` non plus — voir §12.6.**

## 7.2 Tables `private.*`

Aucune route ne lit une table `private.*` depuis un client. `03_PRIVACY_RLS.md` §8 les réserve au `service_role` : `/traitements` et `/journal` passent par un use case serveur.

## 7.3 Redirections héritées de l'organisateur

`ORG_LEGACY` du prototype porte onze identifiants. Aucun n'est une route ; chacun redirige.

| Identifiant hérité | Redirection permanente vers               |
| ------------------ | ----------------------------------------- |
| `infos`            | `/org/[editionId]/course/informations`     |
| `sources`          | `/org/[editionId]/course/sources`          |
| `epreuves`         | `/org/[editionId]/course/epreuves`         |
| `participants`     | `/org/[editionId]/participants`            |
| `invitations`      | `/org/[editionId]/participants`            |
| `analytics`        | `/org/[editionId]/participants`            |
| `insights`         | `/org/[editionId]/participants`            |
| `peloton`          | `/org/[editionId]/analyse`                 |
| `previsions`       | `/org/[editionId]/analyse`                 |
| `partenaires`      | `/org/[editionId]/parametres/partenaires`  |

Quatre identifiants convergent vers `participants` et deux vers `analyse` : la refonte a fusionné des écrans. Une redirection ne préserve donc pas toujours le sous-écran d'origine.

---

# 8. Liens inter-applications

Conformément à §1.6, chacun de ces passages est un lien absolu.

| Départ                                   | Arrivée                              | Origine                   |
| ---------------------------------------- | ------------------------------------ | ------------------------- |
| `www` — tous les appels à l'action       | `apps/app`                           | `NEXT_PUBLIC_APP_URL`     |
| `/org/…` — « Administration PLUKA »      | `apps/admin`                         | `NEXT_PUBLIC_ADMIN_URL`   |
| `/org/…` — « Espace coureur »            | `apps/app` `/`                       | interne, `<Link>`         |
| `admin` — « Espace organisateur »        | `apps/app` `/org`                    | `NEXT_PUBLIC_APP_URL`     |
| `apps/app` — mentions légales, contact   | `apps/www`                           | `NEXT_PUBLIC_SITE_URL`    |

## 8.1 Passages du prototype qui ne sont pas des liens produit

Trois navigations du prototype n'existent que pour la démonstration et ne se traduisent par aucune route ni aucun lien :

- `goBank` — saut de l'écran Nutrition coureur vers `admin → produits`. Un coureur n'a pas de rôle plateforme ; ce raccourci n'a pas d'équivalent produit.
- `screen: 'site'` et `screen: 'siteorg'` — chargement des deux landings dans une iframe depuis le shell de démonstration.
- `demoMenu`, `demoCurrent`, `wxRow`, `b2b()` — le sélecteur de scénarios.

---

# 9. Conventions de forme

## 9.1 Langue et casse

Les segments sont en français, en minuscules, sans accent, séparés par un tiret : `apres-course`, `nouvelle-course`, `a-verifier`. C'est la convention déjà appliquée par le code existant (`/connexion`, `/evenements`, `/courses`, `/revue`).

## 9.2 Segments dynamiques

Un segment dynamique nomme son entité. Jamais `[id]`.

Sa forme suit §1.9 : slug si la route est publique, UUID si elle est privée.

| Segment                                            | Forme  | Zone   |
| -------------------------------------------------- | ------ | ------ |
| `[eventSlug]`, `[editionSlug]`, `[raceSlug]`       | slug   | public |
| `[participantRaceId]`, `[outingId]`                | UUID   | privé  |
| `[eventId]`, `[editionId]`, `[organizationId]`     | UUID   | privé  |
| `[sourceId]`, `[userId]`, `[raceId]`               | UUID   | privé  |
| `[token]`                                          | secret | public |

Un même événement porte donc les deux formes selon la surface : `[eventSlug]` dans la fiche publique, `[eventId]` dans l'administration. Ce n'est pas une incohérence — l'administration n'est pas indexable et n'a pas besoin d'URL lisibles, et un slug administrable changerait sous les liens internes.

## 9.3 Redirection d'un segment sans écran

Un segment de regroupement qui n'a pas d'écran propre redirige vers son premier enfant plutôt que de rendre une page vide : `/courses/[id]` → `/plan`, `/preparation` → `/materiel`, `/bibliotheque` → `/materiel`, `/org/[id]/course` → `/informations`, `/org/[id]/parametres` → `/evenement`, `/produits` → `/catalogue`.

## 9.4 Retour après authentification

Une route protégée atteinte sans session redirige vers `/connexion` en conservant la destination, comme le fait déjà `lib/return-to.ts` dans `apps/app` et `apps/admin`.

## 9.5 Indexation

`apps/www` est indexable. `apps/admin` ne l'est pas.

`apps/app` ne l'est pas non plus, **à une exception près** : la fiche épreuve publique de §4.3, lorsque la visibilité de la course vaut `public`. L'en-tête `X-Robots-Tag: noindex` de `next.config.ts` doit donc être posée par défaut et levée sur cette seule route — pas l'inverse, qui exposerait toute nouvelle route par défaut.

`/a/[token]` et `/invitation/[token]` ne sont jamais indexables. Une course qui n'est pas `public` ne rend rien à un visiteur anonyme, donc la question de son indexation ne se pose pas (§1.8, point 2).

---

# 10. Ce que ce document ne fait pas

- Il ne décrit pas les transitions ni les animations : `06_DESIGN_SYSTEM.md` §99.
- Il n'attribue aucun droit : `04_ENTITLEMENTS.md`.
- Il ne dit pas ce qu'une route affiche : `03_PRIVACY_RLS.md`.
- Il ne définit pas les Route Handlers d'API internes.

---

# 11. Critères d'acceptation

1. Aucun onglet de navigation n'est un état.
2. Aucun tiroir, aucune modale, aucune étape de formulaire n'est une route.
3. `…/plan/conditions` existe comme adresse et rend un panneau sur le Plan.
4. Les onze identifiants `ORG_LEGACY` redirigent, aucun ne rend d'écran.
5. Aucune route organisateur ne vit hors de `apps/app/org`.
6. `/a/[token]` et `/invitation/[token]` fonctionnent sans session.
7. Tout passage entre `app` et `admin` est un lien absolu construit sur une variable d'origine.
8. Aucun segment de regroupement ne rend de page vide.
9. Aucune route n'est ajoutée pour l'aperçu participant avant l'arbitrage de §6.3.
10. Aucune route privée ne porte de slug, aucune route publique ne porte d'UUID.
11. `/epreuves/[eventSlug]/[editionSlug]/[raceSlug]` répond sans session, et une course `private` y renvoie une 404.
12. `X-Robots-Tag: noindex` est posée par défaut dans `apps/app` et levée sur la seule fiche épreuve publique.
13. Il n'existe qu'une seule fiche épreuve dans tout le produit.
14. `/objectif` n'est atteignable que sous `/courses/[participantRaceId]/`.

---

# 12. Cas non tranchés

Ces dix points ne se déduisent pas des neuf règles de §1. Ils sont listés, pas décidés.

Trois cas de la première version ont été tranchés depuis, et sont devenus les règles §1.7, §1.8 et §1.9 : la portée des étapes d'entonnoir, la page publique de course, et la forme des identifiants publics.

## 12.1 Entité de portée du back-office organisateur

`/org/[editionId]` suppose que le back-office opère sur une **édition**. Le prototype l'écrit ainsi (« Wildstrubel by UTMB · Édition 2026 »), et ses onglets Épreuves listent les courses d'une édition.

Mais `orgNav` porte « Ma course » au singulier, les partenaires sont attachés à l'événement (`event_partners`), et la relation d'appartenance passe par `organizations`. Trois portées sont défendables : `[organizationId]`, `[eventId]`, `[editionId]`.

La règle §1.2 impose que la portée soit dans l'URL. Elle ne dit pas laquelle.

## 12.2 Drill-downs de l'Analyse

Peloton, flux, barrières et conditions sont quatre vues expertes atteintes par un clic depuis la page de conclusions.

Elles ne sont ni des onglets, ni des tiroirs, ni des modales, ni des étapes de formulaire : la règle §1.2 ne les classe pas. Son critère — « qu'on voudrait partager par lien » — est ce qui reste à décider.

Le prototype tranche explicitement dans l'autre sens : `orgGo()` remet `riExpert: null` à chaque navigation, avec le commentaire « Analyse rouvre toujours sur les conclusions ». Un back-office où l'on ne peut pas envoyer un lien vers une conclusion précise est un choix, pas un oubli.

## 12.3 Partage du Brief organisateur hors compte

La landing promet un brief partageable sans compte PLUKA. La règle §1.5 ne couvre qu'un seul jeton public, celui de l'assistance.

Un second jeton public suppose une politique propre : durée de vie, révocation, périmètre agrégé, traçabilité. `03_PRIVACY_RLS.md` §45 à §47 ne traite aujourd'hui que le jeton assistance.

## 12.4 Portée de Communauté

`navGlobal` place Communauté parmi les cinq entrées globales, au-dessus de toute course. Mais `tabTitle` du même prototype l'intitule « Communauté · Wild 70 2026 », donc scopée à une course.

Deux arborescences s'ensuivent : `/communaute` ou `/courses/[participantRaceId]/communaute`. Aucune règle ne départage.

## 12.5 Index de `apps/admin`

Le prototype ouvre l'administration sur une vue d'ensemble (`adminTab: 'overview'`). Le code existant place la liste des événements à `/`.

§7.1 écrit les deux, l'une à `/` et l'autre à `/evenements`. Laquelle est l'index reste à décider.

## 12.6 Rattachement de `/courses/[raceId]` dans `apps/admin`

C'est la partie la plus aboutie du code actuel — statut, visibilité, import GPX, waypoints, contrôles qualité — et elle n'a aucun équivalent dans l'`adminNav` du prototype, qui traite la course sous Événements et sous Validation.

La route existe et fonctionne. Son point d'entrée dans la navigation n'est pas décidé.

## 12.7 Demander à PLUKA

`01_ARCHITECTURE.md` §4.2 liste « Demander à PLUKA » parmi les zones de l'application, au même rang que le Plan ou la Nutrition. Le prototype le rend en panneau superposé (`askOpen`), ce que §1.2 classe comme un état.

Les deux lectures ne donnent pas la même arborescence. Et si une conversation doit pouvoir être reprise ou citée, `pluka_conversations` existant déjà, il lui faut une adresse.

## 12.8 Route de paiement

§5.3 écrit `/offre`. L'écran `checkout` du prototype est un paiement simulé.

La forme de la route de paiement dépend du contrat du prestataire retenu : page hébergée avec retour sur une URL de succès, ou formulaire embarqué. Aucun prestataire n'est configuré, et `04_ENTITLEMENTS.md` §25 et §26 décrivent le webhook sans fixer le parcours.

## 12.9 Pages marketing secondaires

Les pieds de page des deux landings annoncent Blog, FAQ, Courses, Préparation trail, À propos, Contact, Confidentialité et CGU. Le prototype les pointe vers des ancres de la même page, faute de destination.

Lesquelles deviennent des pages de `apps/www` relève du produit, pas de ces règles.

## 12.10 Accès par lien direct à une course `unlisted`

`03_PRIVACY_RLS.md` §17 range `unlisted` comme accessible par « lien direct ; invitation ; participant concerné ; organisation », et précise que ce qu'il faut empêcher est le **listing** anonyme.

L'implémentation est plus stricte : `private.race_is_publicly_readable` (migration 0005) et `isRacePubliclyReadable` exigent `public_visibility = 'public'`. Un visiteur anonyme muni du lien exact d'une course `unlisted` reçoit donc une 404, alors que §17 le laisserait entrer.

Les deux lectures sont défendables — « pas de listing » et « pas de lecture anonyme » ne sont pas la même règle — et l'écart touche la sécurité, pas le routage. Le trancher appartient à `03_PRIVACY_RLS.md` : soit §17 est reformulé pour dire que `unlisted` demande une session, soit la policy et l'invariant sont élargis ensemble. Les élargir séparément produirait un domaine qui autorise et une base qui refuse.
