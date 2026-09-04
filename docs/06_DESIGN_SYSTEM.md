# PLUKA — Design System V1

**Fichier de référence :** `docs/06_DESIGN_SYSTEM.md`  
**Statut :** Référence UI / marque pour le développement — Product Design Freeze V1  
**Date de consolidation :** 2026-09-03  
**Nom du système visuel :** **Ligne d’altitude**  
**Principe :** terrain comme structure, progression visible, information dense mais calme, aucune esthétique SaaS générique

---

# 0. Rôle de ce document

Ce document traduit la **Charte graphique PLUKA V2 — Ligne d’altitude** et le prototype figé en règles directement exploitables pour le développement.

Il définit :

- les fondations visuelles ;
- les tokens ;
- la typographie ;
- les couleurs ;
- les surfaces ;
- les bordures et rayons ;
- les règles de composition ;
- les composants principaux ;
- les états interactifs ;
- les données sportives ;
- les graphiques et profils d’altitude ;
- la navigation ;
- le responsive ;
- l’accessibilité ;
- les règles de co-branding ;
- les règles photographiques ;
- le ton UI ;
- les critères de non-régression.

Ce document ne décrit pas le métier.

Il complète :

- `docs/00_PRODUCT_SPEC.md`
- `docs/01_ARCHITECTURE.md`
- `docs/03_PRIVACY_RLS.md`
- `docs/04_ENTITLEMENTS.md`
- `docs/05_ROUTES_FLOWS.md`
- `/reference/prototype/PLUKA.dc.html`
- `/reference/prototype/PLUKA Homepage.dc.html`
- `/reference/prototype/PLUKA Organisateurs.dc.html`
- `/reference/prototype/PLUKA Charte Graphique v2.dc.html`

---

## 0.1 Ordre de priorité

En cas de contradiction :

1. ce document fait foi sur les règles UI réutilisables ;
2. la Charte graphique V2 fait foi sur l’identité de marque ;
3. le prototype figé fait foi sur l’intention d’écran et les compositions déjà validées ;
4. la Product Spec fait foi sur le comportement fonctionnel ;
5. le code ne doit pas inventer une nouvelle grammaire visuelle pour résoudre une difficulté locale.

Si le prototype contient une anomalie héritée contraire à la Charte, **la Charte / ce Design System priment**.

---

# 1. Fondation de marque

La Charte définit PLUKA ainsi :

> **PLUKA transforme l’après-inscription en parcours maîtrisé.**

La marque repose sur quatre principes :

## 1.1 Clarté

> Une information utile, contextualisée, au bon moment.

Conséquence UI :

- une priorité claire par écran ;
- pas de mur de données ;
- pas d’indicateurs décoratifs ;
- pas d’information sans action ou compréhension associée.

## 1.2 Progression

> Chaque action rapproche visiblement du jour J.

Conséquence UI :

- jalons ;
- progression ;
- états franchis ;
- prochain point visible ;
- séquences qui se lisent dans le temps.

## 1.3 Confiance

> On ne devine jamais à la place de l’organisateur.

Conséquence UI :

- sources visibles ;
- états de confiance explicites ;
- absence de faux niveau de précision ;
- distinction officielle / PLUKA / estimation ;
- aucune donnée inventée pour remplir un vide.

## 1.4 Terrain

> Sportif dans l’énergie, minéral dans le ton, jamais démonstratif.

Conséquence UI :

- relief ;
- topographie ;
- profils ;
- palette minérale ;
- composition éditoriale ;
- pas de codes gaming ;
- pas d’esthétique fitness flashy.

---

# 2. Principes UI non négociables

Le prototype et la Charte convergent sur les règles suivantes :

> **Calcaire dominant.**

> **Blocs bord à bord.**

> **Pas de carte flottante par défaut.**

> **Pas d’ombre portée décorative.**

> **Un seul CTA Lichen dominant par écran.**

> **L’Aube représente la prochaine échéance, pas l’action primaire générique.**

> **La donnée est en Martian Mono ; la prose est en Hanken Grotesk.**

> **Les grands titres sont en Archivo Expanded.**

> **Le profil d’altitude est un composant signature.**

> **Le topo est un fond de scène, jamais un motif décoratif agressif.**

---

# 3. Anti-pattern principal : le dashboard SaaS générique

PLUKA ne doit pas devenir :

```text
fond gris
+
12 cartes blanches arrondies
+
grosses ombres
+
badges multicolores
+
boutons bleus
+
graphiques décoratifs
```

La composition privilégiée est :

```text
BANDE DE TERRAIN
──────────────────────────
CONTENU BORD À BORD
──────────────────────────
SECTION
──────────────────────────
LIGNE / PROFIL / TABLEAU
──────────────────────────
ACTION
```

Les surfaces servent la hiérarchie.

Elles ne doivent pas produire un empilement de cartes.

---

# 4. Palette de marque

## 4.1 Couleurs principales

| Token | Nom | Hex | Rôle |
|---|---|---:|---|
| `ink` | Ardoise | `#0E1A17` | texte fort, grand fond sombre |
| `forest` | Forêt | `#14342C` | structure, secondaire, liens, pictos |
| `lichen` | Lichen | `#C6F24E` | action principale, progression |
| `dawn` | Aube | `#FF6A3D` | prochaine échéance / jalon |
| `glacier` | Glacier | `#9AE0D6` | respiration, données secondaires, cartes / terrain |
| `limestone` | Calcaire | `#F2F0E9` | fond principal |
| `sand` | Sable | `#E4E1D6` | séparation, surface secondaire |
| `granite` | Granit | `#6F7A74` | texte / metadata secondaire |

Répartition recommandée par la Charte :

```text
60 % Calcaire
25 % Ardoise
11 % Lichen
4 % Aube
```

Ce ratio est un principe de composition, pas une mesure CSS stricte.

---

# 5. Couleurs fonctionnelles

La Charte de marque donne :

```text
Succès     #3FBF7F
Attention  #F2B33D
Erreur     #E14434
```

Le prototype applicatif utilise actuellement des variantes plus sombres pour le texte fonctionnel :

```text
Success ink  #2F7A55
Warning ink  #B8791C
Error ink    #B23A2B
```

et des fonds doux :

```text
Success bg   #E6EFE4
Warning bg   #F5ECD8
Error bg     #F6E7E1
```

### Décision d’implémentation V1

Conserver **les deux niveaux** :

- couleur signal de la Charte ;
- couleur d’encre lisible du prototype pour texte / iconographie fonctionnelle.

Ne pas remplacer les couleurs de marque par des couleurs d’état.

---

# 6. Tokens couleur canoniques

```css
:root {
  /* Brand */
  --pk-ink: #0E1A17;
  --pk-forest: #14342C;
  --pk-lichen: #C6F24E;
  --pk-lichen-deep: #A8D42F;
  --pk-lichen-active: #96C022;
  --pk-dawn: #FF6A3D;
  --pk-dawn-ink: #C4471F;
  --pk-glacier: #9AE0D6;
  --pk-glacier-bg: #E8F4F1;

  --pk-limestone: #F2F0E9;
  --pk-surface: #FFFFFF;
  --pk-sand: #E4E1D6;
  --pk-hairline: #DCD8CB;
  --pk-granite: #6F7A74;

  /* Text */
  --pk-text: #0E1A17;
  --pk-text-secondary: #4A5A54;
  --pk-text-muted: #5A6660;
  --pk-text-on-dark: #F2F0E9;

  /* Functional signal */
  --pk-success-signal: #3FBF7F;
  --pk-warning-signal: #F2B33D;
  --pk-error-signal: #E14434;

  /* Functional readable ink */
  --pk-success: #2F7A55;
  --pk-warning: #B8791C;
  --pk-error: #B23A2B;

  --pk-success-bg: #E6EFE4;
  --pk-warning-bg: #F5ECD8;
  --pk-error-bg: #F6E7E1;
}
```

---

# 7. Usage des couleurs

## 7.1 Lichen

Utiliser pour :

- CTA principal ;
- état actif sur fond sombre ;
- progression positive ;
- point franchi lorsque la Charte le prévoit ;
- accent marque dominant.

Ne pas utiliser pour :

- tous les boutons ;
- toutes les icônes ;
- tous les badges ;
- un fond complet de page.

## 7.2 Aube

Utiliser pour :

- prochaine échéance ;
- prochain jalon ;
- deadline ;
- direction / triangle signature.

Ne pas utiliser comme :

- couleur primaire générique ;
- erreur ;
- promo ;
- second CTA systématique.

## 7.3 Glacier

Utiliser pour :

- information secondaire liée au parcours ;
- fonds respirants ;
- certains états contextuels ;
- vues de terrain / profil ;
- détails techniques sans urgence.

## 7.4 Ardoise

Utiliser pour :

- grandes bandes de terrain ;
- héros ;
- navigation sombre ;
- texte principal ;
- contextes de concentration.

---

# 8. Topographie

Assets canoniques :

```text
assets/topo-dark.svg
assets/topo-light.svg
assets/topo-glacier.svg
```

## 8.1 `topo-dark`

Fond :

```text
Ardoise
```

Courbes :

```text
Lichen
```

Opacité définie par la Charte :

```text
≈ 10 % lignes normales
≈ 20 % lignes maîtresses
```

Usage :

- couverture ;
- hero ;
- ouverture de section ;
- carte de course / Plan.

## 8.2 `topo-light`

Fond :

```text
Calcaire
```

Courbes :

```text
Forêt
```

Opacité :

```text
≈ 8,5 % / 17 %
```

Usage :

- pages de contenu ;
- fonds clairs ;
- documents ;
- certaines scènes marketing.

## 8.3 `topo-glacier`

Usage réservé :

- langage graphique ;
- vues parcours ;
- situations où Glacier possède un sens réel.

---

# 9. Règles du fond topographique

Toujours :

```css
background-repeat: no-repeat;
background-size: cover;
```

ou cadrage équivalent permettant un relief unique.

La Charte demande :

- pas de répétition en tuiles ;
- pas plus de deux sommets lisibles par surface ;
- pas de texte de labeur posé directement sur des lignes trop visibles ;
- jamais au-dessus d’une photographie ;
- jamais coloré hors palette ;
- jamais une opacité agressive.

Le topo est :

> **une scène**

pas :

> **un pattern décoratif.**

---

# 10. Typographie

Trois familles forment le système.

## 10.1 Archivo

Usage :

- Display ;
- H1 ;
- H2 ;
- H3 ;
- titres de blocs ;
- boutons principaux lorsque pertinent.

Réglages :

```text
Archivo Variable
width : 115 → 125
font-weight : 600 / 700
```

Caractère :

> technique et sportif sans être criard.

Fallback :

```css
'Archivo', system-ui, sans-serif
```

---

# 11. Hanken Grotesk

Usage :

- corps ;
- formulaires ;
- interface ;
- explications ;
- paragraphes ;
- navigation textuelle ;
- libellés courants.

Weights :

```text
400
500
600
```

Fallback :

```css
'Hanken Grotesk', system-ui, sans-serif
```

---

# 12. Martian Mono

Usage :

- heures ;
- distances ;
- D+ / D- ;
- dossards ;
- températures ;
- petits chiffres sportifs ;
- statuts techniques ;
- micro-libellés ;
- labels de sections.

Weights :

```text
400
500
600
```

Fallback :

```css
'Martian Mono', ui-monospace, monospace
```

Règle absolue :

> **Jamais un paragraphe en Martian Mono.**

---

# 13. Échelle typographique de référence

La Charte fournit les références suivantes :

```text
Display       64 / 700
H1            36 / 700
H2            24 / 600
Corps         16 / 400
Donnée        18 / 500
```

Le produit responsive peut interpoler la taille des grands titres avec `clamp()`.

Exemple d’implémentation :

```css
.pk-display {
  font-family: var(--font-heading);
  font-variation-settings: 'wdth' 122;
  font-weight: 700;
  font-size: clamp(44px, 6vw, 64px);
  line-height: .96;
  letter-spacing: -.03em;
}

.pk-h1 {
  font-family: var(--font-heading);
  font-variation-settings: 'wdth' 121;
  font-weight: 700;
  font-size: clamp(32px, 4vw, 36px);
  line-height: 1.02;
  letter-spacing: -.025em;
}

.pk-h2 {
  font-family: var(--font-heading);
  font-variation-settings: 'wdth' 119;
  font-weight: 600;
  font-size: 24px;
  line-height: 1.12;
  letter-spacing: -.025em;
}

.pk-body {
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.55;
}

.pk-data {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
```

Les valeurs `clamp()` ci-dessus sont une convention d’implémentation V1 ; la Charte fixe surtout les tailles de référence et la hiérarchie.

---

# 14. Micro-label

Pattern actuel du prototype :

```css
.pk-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--pk-text-muted);
}
```

Usage :

```text
PROCHAINE ÉTAPE
PASSAGE PRÉVU
SOURCE
J-7
RAVITO
```

Les capitales sont acceptées ici parce qu’il s’agit de micro-libellés.

---

# 15. Hiérarchie typographique

La Charte précise :

> **La hiérarchie se fait par la taille et l’espace, jamais par les capitales forcées.**

Donc :

- titres en casse naturelle ;
- paragraphes en casse naturelle ;
- CTA lisibles sans forcer tous les composants en uppercase ;
- uppercase réservée aux micro-labels et metadata.

---

# 16. Chiffres

Les données sportives utilisent :

```css
font-variant-numeric: tabular-nums;
```

pour :

- ETA ;
- horaires ;
- temps cible ;
- marges ;
- températures ;
- valeurs Nutrition ;
- km ;
- D+.

But :

- stabilité visuelle ;
- lecture des colonnes ;
- comparaison rapide.

---

# 17. Rayons

La direction finale V2 est volontairement anguleuse.

Tokens du prototype canonique :

```css
--radius-sm: 2px;
--radius-md: 2px;
--radius-lg: 3px;
```

Principe :

> **pas de grosses cartes arrondies.**

Interdit par défaut :

```text
12 px
16 px
24 px
rounded-2xl
rounded-3xl
```

sauf composant tiers impossible à modifier ou usage exceptionnel explicitement validé.

---

# 18. Ombres

La Charte dit :

> blocs bord à bord, sans carte flottante ni ombre portée.

Donc :

### Surface standard

```css
box-shadow: none;
border: 1px solid var(--pk-hairline);
```

### Ancien token du prototype

```css
0 0 0 1px #DCD8CB
```

peut être remplacé proprement par une vraie bordure.

### Ombre élevée

Réserver une ombre réelle à :

- modal ;
- popover ;
- bottom sheet ;
- élément temporairement au-dessus du document.

Jamais pour chaque section.

---

# 19. Séparateurs

Token :

```css
--pk-hairline: #DCD8CB;
```

Usage :

- border-top ;
- border-bottom ;
- colonne ;
- table ;
- listes ;
- séparation entre zones.

Les filets font partie de l’identité fonctionnelle de PLUKA.

---

# 20. Spacing

La Charte ne fournit pas une échelle numérique complète.

### Convention d’implémentation V1

Adopter une grille de base de `4 px`.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
```

Règle :

- préférer de l’espace entre les groupes ;
- éviter de résoudre la hiérarchie par des box / fonds différents.

---

# 21. Largeurs de contenu

### Convention d’implémentation V1

```css
--content-wide: 1280px;
--content-main: 1120px;
--content-reading: 720px;
```

Usage :

- marketing / dashboard : `wide` ;
- app standard : `main` ;
- contenu éditorial / texte long : `reading`.

Ces valeurs sont des conventions de code, pas des valeurs historiques de la Charte.

---

# 22. Bandes de terrain

Une **bande de terrain** est un bloc pleine largeur ou quasi pleine largeur qui établit une scène.

Exemples :

- Hero sombre ;
- Résumé Plan ;
- Accueil J-x ;
- Assistance ;
- Ma saison ;
- Intro Analyse B2B.

Pattern :

```text
Fond fort
+
topo éventuel
+
micro-label
+
titre
+
donnée / progression
+
une action dominante
```

Une bande ne doit pas être enfermée dans une card flottante.

---

# 23. Surfaces

## `surface-page`

```text
Calcaire
```

## `surface-paper`

```text
Blanc
```

Usage :

- listes ;
- formulaires ;
- tableaux structurés ;
- contenu dense lorsque Calcaire seul ne suffit pas.

## `surface-dark`

```text
Ardoise
```

Usage :

- hero ;
- zone signature ;
- focus.

## `surface-soft`

```text
Sable
```

Usage :

- distinction secondaire ;
- zone readonly ;
- regroupement discret.

## `surface-glacier`

```text
#E8F4F1
```

Usage :

- contexte / information neutre particulière.

---

# 24. Boutons

Pattern canonique du prototype :

```css
.pk-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  padding: 14px 22px;
  border: 1.5px solid transparent;
  border-radius: 2px;
  font-family: var(--font-heading);
  font-variation-settings: 'wdth' 113;
  font-weight: 600;
  font-size: 16px;
}
```

---

# 25. Bouton principal

```css
.pk-button-primary {
  background: var(--pk-lichen);
  border-color: var(--pk-lichen);
  color: var(--pk-ink);
}

.pk-button-primary:hover {
  background: var(--pk-lichen-deep);
  border-color: var(--pk-lichen-deep);
}

.pk-button-primary:active {
  background: var(--pk-lichen-active);
}
```

Règle :

> **un seul CTA Lichen dominant par écran / zone décisionnelle principale.**

---

# 26. Bouton secondaire clair

```css
.pk-button-secondary {
  background: transparent;
  border-color: var(--pk-forest);
  color: var(--pk-forest);
}

.pk-button-secondary:hover {
  background: var(--pk-sand);
}
```

---

# 27. Bouton secondaire sur fond sombre

```css
.pk-button-ghost-dark {
  background: transparent;
  border-color: rgba(242, 240, 233, .42);
  color: var(--pk-limestone);
}
```

Hover :

```text
fond blanc transparent léger
bord plus visible
```

---

# 28. Boutons destructifs

Ne pas utiliser Lichen.

Pattern :

- texte / bord Error ;
- fond transparent ou Error bg ;
- confirmation si action destructive réelle.

Un bouton rouge n’est pas un CTA primaire de page.

---

# 29. Taille des cibles interactives

Tous les contrôles interactifs doivent viser au minimum :

```text
44 × 44 px
```

Le bouton principal du prototype utilise :

```text
min-height: 52 px
```

à conserver lorsque possible.

---

# 30. Focus

Le focus clavier doit être visible.

Règle :

- ne jamais supprimer `outline` sans remplacement ;
- anneau lisible ;
- contraste sur fond clair et sombre ;
- ne pas utiliser la couleur seule si le contrôle reste ambigu.

Convention :

```css
:focus-visible {
  outline: 2px solid var(--pk-forest);
  outline-offset: 3px;
}
```

Sur fond sombre, utiliser un token contrastant tel que Lichen / Calcaire si nécessaire.

---

# 31. Disabled

Un contrôle disabled :

- reste lisible ;
- ne ressemble pas à un état disponible ;
- garde sa forme ;
- n’utilise pas uniquement une baisse d’opacité extrême.

Ne pas descendre à une opacité rendant le texte illisible.

---

# 32. Liens

Sur fond clair :

```text
Forêt
```

Hover :

```text
Ardoise
```

Les liens inline doivent être distinguables du texte par :

- underline ;
- ou autre indicateur non chromatique clair.

Le prototype marketing utilise parfois la couleur seule ; l’implémentation production devra ajouter le comportement accessible adapté.

---

# 33. Champs de formulaire

Le prototype Organisateurs valide le pattern suivant :

> **champ à filet, pas champ capsule / card.**

```css
.pk-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.pk-field label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.pk-input {
  min-height: 46px;
  padding: 10px 2px;
  border: 0;
  border-bottom: 2px solid var(--pk-hairline);
  border-radius: 0;
  background: transparent;
}
```

---

# 34. Focus champ

Pattern actuel :

```text
filet Forêt
+
fond Lichen très léger
+
accent Lichen inférieur
```

Exemple :

```css
.pk-input:focus {
  border-bottom-color: var(--pk-forest);
  background: rgba(198,242,78,.14);
  box-shadow: inset 0 -3px 0 var(--pk-lichen);
}
```

---

# 35. Erreur de champ

Utiliser :

- Error ink ;
- message explicite ;
- icône éventuelle ;
- `aria-describedby`.

Ne pas utiliser une bordure rouge seule.

---

# 36. Labels / badges

PLUKA distingue plusieurs familles.

## 36.1 Micro-label

Martian Mono uppercase.

## 36.2 État de confiance

Exemples :

```text
OFFICIELLE
VALIDÉE PLUKA
COMMUNAUTAIRE
PRÉVISION MÉTÉO
ESTIMATION
```

Le texte est indispensable.

La couleur seule ne porte jamais le sens.

## 36.3 Deadline / prochaine étape

Aube.

Exemple :

```text
À FAIRE AVANT VENDREDI
```

## 36.4 Active state sombre

Lichen.

---

# 37. Badges : forme

Faible radius :

```text
2 px
```

Pas de “pill” excessive sauf petit tag sémantique réellement adapté.

Éviter l’effet :

```text
20 badges capsules sur une page
```

---

# 38. Listes d’action

Les zones :

```text
À faire maintenant
Matériel
Ravitos
Participants
Points à vérifier
```

doivent privilégier une **liste bord à bord**.

Pattern :

```text
ligne
────────────────────
ligne
────────────────────
ligne
```

Chaque ligne contient :

- icône / état ;
- titre ;
- metadata ;
- prochaine action.

Pas une card par ligne.

---

# 39. Icônes

La Charte définit :

```text
grille 24 × 24
trait 1,75 px
extrémités carrées
angles à peine adoucis
```

Style :

> utilitaire, tracé d’un seul geste.

Pas :

- emoji ;
- icône pleine ;
- illustration réaliste ;
- fond rond coloré sous chaque icône.

---

# 40. Tailles icônes

Référence Charte :

```text
20 px en ligne de texte
24 px en navigation
32 px en tête de section
```

---

# 41. Couleur des icônes

Par défaut :

```text
Forêt
```

Sur fond sombre actif :

```text
Lichen
```

Pour prochaine échéance :

```text
Aube
```

Les couleurs fonctionnelles ne sont utilisées que pour leur sémantique.

---

# 42. Logo

Principe :

> **priorité au logo complet pour toute première exposition.**

Symbole seul :

- favicon ;
- app icon ;
- contexte où PLUKA est déjà clairement identifié.

---

# 43. Logo — couleurs

### Fond clair

Chemin + logotype :

```text
Forêt
```

Triangle :

```text
Aube
```

### Fond Ardoise

Version inversée :

```text
Lichen
```

Triangle :

```text
Aube
```

### Monochrome

Autorisé lorsque la production l’exige.

---

# 44. Logo — protection

Charte :

```text
X = hauteur du P
zone de protection = X de chaque côté
```

Ne pas coller le logo :

- au bord viewport ;
- à une autre marque ;
- à un bouton ;
- à une image.

---

# 45. Taille minimale logo

Digital :

```text
logo complet : 120 px de large
symbole seul : 20 px
```

Print :

```text
logo complet : 32 mm
symbole : 7 mm
```

---

# 46. Logo — interdits

- étirer ;
- déformer ;
- corriger son oblique ;
- recolorer hors palette ;
- ajouter une ombre ;
- utiliser comme motif décoratif ;
- poser sur un fond qui tue le contraste.

---

# 47. Profil d’altitude — composant signature

La Charte précise :

> **Le profil devient un composant.**

Il ne doit pas être traité comme un simple graphique analytique.

Il permet d’exprimer :

- progression ;
- difficulté ;
- jalons ;
- passages ;
- ravitos ;
- barrières ;
- Assistance ;
- Conditions ;
- arrivée.

---

# 48. Anatomy — Altitude Profile

Composant recommandé :

```text
AltitudeProfile
├── Area / line
├── Start marker
├── Waypoint markers
├── Next marker
├── Completed marker
├── Active marker
├── Cutoff marker
├── Weather overlays éventuels
└── Axis / metadata minimale
```

Ne pas charger le profil de labels permanents illisibles.

---

# 49. Jalon

Charte :

```text
Triangle Aube = prochaine action
Cercle Lichen = étape franchie
```

Les états complémentaires peuvent utiliser :

- Forêt ;
- contour ;
- point neutre.

Mais ils doivent préserver ce langage.

---

# 50. Profil — interaction

Desktop :

- hover / focus ;
- synchronisation ligne ↔ détail.

Mobile :

- tap ;
- sélection ;
- bottom sheet / détail sous le profil.

L’interaction doit fonctionner au clavier lorsque le graphique contient des points interactifs.

---

# 51. Profil — accessibilité

Toujours fournir une représentation textuelle équivalente :

```text
Départ — 07:10
Adelboden — 10:48
Rawil — 17:20
Arrivée — 20:42
```

Un SVG / canvas n’est jamais la seule source de l’information.

---

# 52. Progression

Toute barre / chronologie peut emprunter le langage du **Flow Path**.

Elle doit rester :

- lisible ;
- directionnelle ;
- fonctionnelle.

Ne pas transformer le logo en décoration répétée.

---

# 53. Tables et données denses

Utiliser pour :

- Plan détaillé ;
- imports ;
- participants ;
- Race Intelligence ;
- cutoffs.

Règles :

- bordures fines ;
- peu de fonds alternés ;
- données chiffrées alignées ;
- Martian Mono pour valeurs ;
- Hanken pour noms / prose ;
- header sticky si utile ;
- pas d’ombre autour de la table.

---

# 54. Data visualisation

Principes :

1. montrer une question claire ;
2. limiter le nombre de séries ;
3. ne pas utiliser une palette arc-en-ciel ;
4. préserver les couleurs de marque ;
5. réserver Warning/Error aux états réels ;
6. afficher les unités ;
7. fournir du texte équivalent ;
8. ne pas fabriquer de précision.

---

# 55. Race Intelligence

La dataviz B2B doit rester secondaire aux conclusions.

Ordre recommandé :

```text
CONCLUSION
↓
CHIFFRE / PLAGE
↓
VISUALISATION
↓
DÉTAIL
```

Pas :

```text
graphique complexe
↓
“à vous d’interpréter”
```

---

# 56. Incertitude

Pour les prévisions :

- afficher des plages ;
- distinguer estimation et valeur observée ;
- utiliser un libellé explicite.

Ne jamais inventer :

```text
98 % fiable
```

ou une précision graphique qui n’existe pas dans le moteur.

---

# 57. Conditions météo

Conditions reste une sous-expérience du Plan.

Elle doit visuellement privilégier :

- le parcours ;
- l’ETA ;
- l’altitude ;
- les conditions au point.

Pas une interface météo générique avec 12 cartes “Température / Vent / Humidité / Pluie”.

---

# 58. Weather Point

Anatomie :

```text
Lieu
km / altitude
PASSAGE PRÉVU
heure
condition
température
ressenti
pluie si utile
vent / rafales
updatedAt
```

La donnée de course reste au premier plan.

---

# 59. Nuit

Nuit est une Condition.

Le langage visuel doit l’intégrer au parcours, sans créer une palette “night mode” distincte dans toute l’application.

Le mode global sombre de l’interface n’est pas automatiquement activé parce qu’une course passe de nuit.

---

# 60. Official notice

Une notice officielle doit avoir une présence visuelle supérieure à une suggestion PLUKA.

Pattern :

```text
ORGANISATION
KIT FROID OBLIGATOIRE
Source / timestamp
```

puis :

```text
TES CONDITIONS PRÉVUES
...
```

Ne jamais fusionner visuellement ces deux niveaux.

---

# 61. Suggestions PLUKA

Pattern :

```text
SUGGESTION PLUKA
Vérifier tes gants
[Ajouter à ma checklist]
```

Une suggestion ne doit pas utiliser le même style qu’un matériel obligatoire.

---

# 62. Toasts

Usage :

- confirmation ;
- recalage ;
- action courte ;
- état non bloquant.

Exemples :

```text
Plan mis à jour.
Conditions recalées sur ton Plan.
Équipement ajouté.
```

Pas de toast pour une information critique qui doit rester visible.

---

# 63. Alertes

### Info

Glacier / neutral.

### Success

Success bg + Success ink.

### Warning

Warning bg + Warning ink.

### Error

Error bg + Error ink.

### Official

Doit être traité selon le contexte de source / importance, souvent avec une structure dédiée plutôt qu’un simple warning jaune.

---

# 64. Modales

Réserver aux :

- décisions bloquantes ;
- confirmations destructives ;
- édition courte impossible inline.

Ne pas ouvrir une modal pour chaque détail.

---

# 65. Bottom sheets mobile

Utiles pour :

- édition waypoint ;
- détail météo ;
- détail jalon Nutrition ;
- filtres ;
- actions contextuelles.

Radius :

- le système global reste faible ;
- une sheet peut avoir une géométrie fonctionnelle adaptée à l’OS, mais éviter les coins surdimensionnés typiques “consumer app” si non nécessaires.

---

# 66. Navigation globale coureur

Navigation annuelle :

```text
Accueil
Ma saison
Sorties
Bibliothèque
Communauté
```

`Demander à PLUKA` est transversal et peut être présenté comme action dédiée plutôt que comme destination classique selon le viewport.

La structure exacte de routes appartient à `05_ROUTES_FLOWS.md`.

---

# 67. Navigation course

Navigation validée :

```text
Plan
Préparation
Assistance
Course
```

Nutrition est une couche / workflow du Plan.

Conditions est une sous-expérience du Plan.

Ne pas ajouter :

```text
Météo
Nutrition
```

comme cinquième / sixième onglet principal uniquement parce que les fonctionnalités existent.

---

# 68. Navigation B2B

Navigation organisateur simplifiée :

```text
Accueil
Ma course
Analyse
Participants
```

Secondaire :

```text
Paramètres
```

La navigation ne doit pas exposer tous les sous-moteurs :

```text
Peloton
Flux
Barrières
Conditions
Insights
```

comme cinq produits.

Ils vivent derrière `Analyse`.

---

# 69. Desktop app shell

Principes :

- navigation stable ;
- zone contenu lisible ;
- page header contextualisé ;
- pas de sidebar immense remplie d’icônes ;
- priorité au contenu terrain.

---

# 70. Mobile app shell

La navigation mobile course doit rester simple.

Le prototype valide :

```text
Plan
Prépa
Assistance
Course
```

avec accès secondaire au reste.

Cible interactive minimum :

```text
44 px
```

Labels lisibles.

Pas d’icônes seules pour les destinations principales.

---

# 71. Responsive — philosophie

PLUKA est :

- mobile-first pour le coureur ;
- desktop-first mais responsive pour l’organisation.

La version mobile n’est pas un desktop comprimé.

---

# 72. Breakpoints

La Charte ne fournit pas de breakpoints numériques.

### Convention d’implémentation V1

Adopter :

```text
sm  640 px
md  768 px
lg 1024 px
xl 1280 px
```

Ils servent de primitives de code.

Chaque composant reste responsable de sa propre adaptation ; ne pas créer des variantes desktop/mobile totalement séparées sans nécessité.

---

# 73. Responsive coureur

Sur mobile :

- sections pleine largeur ;
- padding latéral réduit ;
- profil prioritaire ;
- données verticales ;
- tables transformées en listes si nécessaire ;
- bottom sheets pour détails ;
- CTA pleine largeur lorsque pertinent ;
- pas de mini-columns illisibles.

---

# 74. Responsive B2B

Sur mobile :

prioriser :

```text
À retenir
Brief
alertes
conclusions
```

Les analyses denses peuvent :

- scroll horizontal contrôlé ;
- afficher un résumé ;
- proposer détail sur desktop.

Ne pas casser une dataviz complexe en 8 mini cartes.

---

# 75. Grid

### Convention V1

Desktop :

```text
12 colonnes
```

Tablet :

```text
8 colonnes
```

Mobile :

```text
4 colonnes
```

La grille sert à construire les bandes et les layouts éditoriaux.

Ne pas l’utiliser pour systématiquement créer des cards égales.

---

# 76. Container padding

### Convention V1

Mobile :

```text
16–20 px
```

Tablet :

```text
24–32 px
```

Desktop :

```text
32–48 px
```

La composition marketing peut utiliser davantage sur grand écran.

---

# 77. Header marketing

Doit rester :

- léger ;
- lisible ;
- peu d’entrées ;
- CTA unique.

Homepage coureur :

- produit ;
- fonctionnement ;
- tarifs ;
- organisateurs si pertinent.

Homepage organisateur :

- pourquoi PLUKA ;
- fonctionnement ;
- participants ;
- FAQ ;
- parler de mon événement.

---

# 78. Hero marketing

Structure :

```text
micro-label optionnel
H1 fort
sous-titre concret
CTA principal
CTA secondaire
preuve produit réelle
```

La preuve visuelle doit être :

- Plan ;
- profil ;
- Brief ;
- Conditions ;

pas une illustration SaaS générique.

---

# 79. Hero coureur

Direction validée :

> **Prépare ta course. PLUKA organise le reste.**

Le produit doit être visible immédiatement.

Le visuel doit permettre de comprendre :

- profil ;
- passages ;
- ravitos ;
- barrières ;
- arrivée.

---

# 80. Hero organisateur

Direction validée :

> **Votre course, plus claire avant même le départ.**

Le visuel principal doit ressembler à un :

> **Brief organisateur**

et non à un cockpit analytique complexe.

---

# 81. Pricing

Cards tarifaires autorisées, mais :

- faible radius ;
- pas d’ombre ;
- distinction par bord / fond ;
- Lichen uniquement sur offre / CTA dominant ;
- pricing lisible ;
- pas de fausse urgence.

Les offres :

```text
Free
Race Pass
PLUKA+
```

---

# 82. Paywall contextuel

Doit ressembler à une continuation naturelle du produit.

Exemple :

```text
Tu as construit ton Plan.
Pour le modifier et organiser Nutrition, Assistance et Conditions :
Race Pass.
```

Pas :

```text
écran opaque
+
gros cadenas
+
contenu flouté artificiellement
```

---

# 83. Empty states

Un empty state explique :

1. ce qui manque ;
2. pourquoi cela compte ;
3. quelle est la prochaine action.

Exemple :

```text
Ajoute une heure de départ pour voir
les conditions prévues le long de ta sortie.

[Ajouter l’heure]
```

Pas d’illustration décorative obligatoire.

---

# 84. Loading

Privilégier :

- skeletons simples ;
- lignes / surfaces ;
- progression lorsque le job est réellement long.

Éviter les spinners permanents dans une card vide.

Pour ingestion :

```text
PLUKA analyse le document…
```

avec état compréhensible.

---

# 85. Error states

Le ton reste calme.

Exemple :

> **Conditions indisponibles pour le moment.**

Pas :

> **ERREUR CRITIQUE MÉTÉO**

si l’échec est simplement provider.

---

# 86. Source drawer

Composant important.

Doit afficher selon disponibilité :

- type ;
- titre ;
- organisme ;
- page / section ;
- extrait court ;
- date ;
- niveau de confiance.

La source doit être accessible depuis l’information critique sans polluer l’écran principal.

---

# 87. Trust Badge

Valeurs :

```text
Officielle
Validée PLUKA
Communautaire
Prévision externe
Estimation
```

Ne pas rendre la hiérarchie uniquement par couleur.

Texte toujours présent.

---

# 88. Ton UI

Charte :

> **Direct, utile, rassurant.**

Qualités :

```text
Clair
Concret
Calme
Sportif
Humain
```

PLUKA :

- simplifie sans infantiliser ;
- alerte sans dramatiser ;
- encourage sans discours héroïque.

---

# 89. Exemples de wording

Bon :

> **Ta navette part demain à 04 h 50.**

Bon :

> **Il te reste 3 éléments à vérifier.**

Bon :

> **Cette information n’est pas précisée par l’organisateur.**

À éviter :

> **Attention !!! Tu n’es pas prêt !**

À éviter :

> **Dépasse tes limites. Sois un champion.**

---

# 90. Verbes

Privilégier :

```text
Vérifier
Ajouter
Préparer
Modifier
Confirmer
Voir
Comparer
Recalculer
Partager
Consulter
```

Éviter le jargon :

```text
Optimiser
Booster
Disrupter
Monitorer
AI-powered
Predictive engine
```

sauf contexte technique interne.

---

# 91. Photographie

Direction :

> **Montrer l’expérience, pas seulement la performance.**

PLUKA vit autour de :

- préparation ;
- attente ;
- crew ;
- transitions ;
- ravitos ;
- arrivée ;
- effort.

---

# 92. Photographie — à privilégier

- lumière naturelle ;
- cadrages humains ;
- détails utiles ;
- diversité de disciplines ;
- énergie réelle ;
- contexte événementiel identifiable ;
- geste de préparation ;
- lien coureur / accompagnant / bénévole.

---

# 93. Photographie — à éviter

- trailer seul systématiquement sur une crête ;
- image spectaculaire sans rapport avec le service ;
- retouche irréaliste ;
- saturation excessive ;
- pose commerciale ;
- visuel anxiogène ;
- génération IA avec erreurs corporelles / matériel incohérent.

---

# 94. Photo + topo

La Charte l’interdit visuellement :

> ne pas empiler le relief topographique sur une photographie.

Choisir :

```text
photo
```

ou :

```text
fond topo
```

dans une même scène principale.

---

# 95. Co-branding organisateur

Principe :

> **L’événement reste au premier plan. PLUKA signe l’infrastructure.**

La couverture d’une course partenaire peut porter :

- identité de l’événement ;
- logo événement ;
- image / univers ;
- “powered by PLUKA”.

Les composants fonctionnels gardent la grammaire PLUKA :

- horaires ;
- profil ;
- checklist ;
- Assistance ;
- Conditions.

---

# 96. Ce que l’organisateur peut personnaliser

À définir par produit, mais l’identité événement peut intervenir sur :

- logo ;
- image de couverture ;
- nom ;
- certains contenus éditoriaux.

Elle ne doit pas :

- recolorer chaque composant PLUKA ;
- changer le sens des états ;
- supprimer la provenance ;
- casser l’accessibilité ;
- transformer les CTA en couleurs arbitraires.

---

# 97. Partenaires

Une activation partenaire doit fournir :

> **un service ou une information utile.**

Exemple de la Charte :

```text
Conseil équipement partenaire
Ta veste n’est pas encore validée.
Découvre la sélection conforme au règlement.
```

---

# 98. Publicité / sponsor — interdits

Proscrire :

- bannière générique ;
- popup intrusive ;
- habillage complet ;
- faux conseil sponsorisé ;
- recommandation masquant son origine.

Principes :

```text
contextuel
utile
mesurable
transparent
```

---

# 99. Animation

La Charte n’impose pas de motion system avancé.

### Convention V1

Animation :

- courte ;
- fonctionnelle ;
- discrète.

Durées recommandées :

```text
120–180 ms interaction locale
200–280 ms sheet / panel
```

Ne pas animer :

- chaque carte ;
- chaque chiffre ;
- chaque ligne topo.

---

# 100. Reduced motion

Respecter :

```css
@media (prefers-reduced-motion: reduce)
```

Le prototype possède déjà cette attention.

En mode réduit :

- supprimer animations non essentielles ;
- conserver les changements d’état instantanés ;
- ne pas perdre d’information.

---

# 101. Accessibilité — cible

Le produit production vise :

> **WCAG 2.2 AA**

comme standard d’implémentation.

Cette cible technique n’est pas explicitée dans la Charte graphique, mais elle doit guider le code de production.

---

# 102. Contraste

Vérifier les paires réelles.

En particulier :

- Lichen + Ardoise ;
- Aube + Ardoise ;
- Granit + Calcaire ;
- textes muted ;
- functional colors.

Ne jamais supposer qu’une couleur de marque est automatiquement conforme pour du petit texte.

---

# 103. Couleur non exclusive

Aucun état ne repose uniquement sur la couleur.

Exemple :

```text
Warning icon
+ texte “À surveiller”
+ couleur Warning
```

---

# 104. Navigation clavier

Tous les éléments interactifs doivent être :

- focusables ;
- activables ;
- ordonnés logiquement.

Les zones graphiques doivent avoir une alternative textuelle.

---

# 105. Screen readers

Utiliser :

- landmarks ;
- headings réels ;
- labels ;
- descriptions ;
- `aria-live` pour certains recalculs ;
- boutons avec nom accessible.

Pas de `<div onclick>` sans sémantique.

---

# 106. Formulaires

Chaque input :

- label visible ;
- état error relié ;
- required explicite ;
- autocomplete approprié ;
- clavier mobile adapté ;
- format de date/heure compréhensible.

---

# 107. Dates et heures

UI en contexte français :

```text
04 h 50
17:20
```

Le produit peut utiliser l’un ou l’autre format selon composant, mais doit rester cohérent dans un même contexte.

Martian Mono est privilégié.

Toujours distinguer :

- heure locale ;
- date si passage multi-jour.

---

# 108. Températures / unités

Toujours afficher unité :

```text
4 °C
38 km/h
2 429 m
71 km
D+ 4 200 m
```

Ne pas afficher un chiffre sportif isolé si son sens n’est pas évident.

---

# 109. Responsive typography

Éviter des H1 de 64 px fixes sur mobile.

Utiliser :

```css
clamp()
```

ou breakpoints sobres.

La sensation Archivo Expanded doit rester visible sans créer des retours de ligne absurdes.

---

# 110. Composants minimaux du package UI

```text
Logo
BrandMark
Button
IconButton
Link
Label
DataValue
Badge
TrustBadge
StatusBadge
Divider
SectionHeader
TerrainBand
TopoBackground
ProgressPath
AltitudeProfile
WaypointMarker
Notice
Alert
Toast
Input
Textarea
Select
Checkbox
Radio
Switch
Tabs
BottomSheet
Dialog
Drawer
Tooltip
Table
DataList
EmptyState
LoadingState
SourceDrawer
Paywall
OfficialNotice
ConditionPoint
ConditionPeriod
RaceSummary
PlanSummary
```

Tous ne doivent pas être codés avant besoin réel.

---

# 111. Composants domaine vs primitives

`packages/ui` :

```text
Button
Input
Badge
Divider
Dialog
...
```

Composants domaine peuvent vivre dans :

```text
apps/app/features/*
```

ou package domaine UI dédié :

```text
AltitudeProfile
PlanWaypointRow
NutritionWaypoint
ConditionPoint
OrganizerBrief
```

Ne pas mettre toute la logique métier dans `packages/ui`.

---

# 112. Nommage des tokens

Préférer des noms sémantiques :

```text
--color-action-primary
--color-text-muted
```

ou marque :

```text
--pk-lichen
```

Éviter des noms basés sur l’usage momentané :

```text
--green-button
--orange-alert
```

---

# 113. Tokens source

Recommandation d’implémentation :

```text
packages/ui/src/tokens/
├── colors.css
├── typography.css
├── spacing.css
├── radius.css
├── motion.css
└── index.css
```

ou équivalent TypeScript/CSS.

Le design system ne doit pas être recopié dans chaque app.

---

# 114. Fonts

En production Next.js :

préférer :

```text
next/font
```

ou stratégie locale compatible licence/performance.

Ne pas dépendre nécessairement d’un `@import Google Fonts` runtime comme le prototype.

Fonts :

```text
Archivo
Hanken Grotesk
Martian Mono
```

Les fichiers de police ne doivent pas être committés si la licence / source choisie ne le permet pas.

---

# 115. Font loading

Prévoir :

- `font-display: swap` ou comportement équivalent ;
- fallback cohérent ;
- limitation du nombre de weights réellement chargés ;
- variable fonts si pertinent.

---

# 116. Images

Utiliser l’optimisation Next lorsque pertinente.

Préserver :

- ratio ;
- focal point ;
- `alt` ;
- taille intrinsèque.

Les photos décoratives peuvent avoir `alt=""`.

Les captures produit utiles doivent avoir une description adaptée.

---

# 117. Images réelles d’organisations

Ne pas laisser croire à un partenariat.

Une démonstration utilisant une course réelle doit afficher lorsque nécessaire :

> **Exemple de démonstration · données simulées · aucune affiliation**

Le disclaimer fait partie de l’intégrité visuelle / éditoriale du prototype marketing.

---

# 118. États loading du Plan

Le Plan est déterministe, mais son calcul serveur peut prendre un court instant.

UI :

```text
Construction de ton Plan…
```

Puis afficher le résultat.

Ne pas utiliser un discours :

```text
Notre IA analyse tes capacités…
```

---

# 119. États recalcul

Lors d’une preview :

- montrer le delta ;
- éviter le clignotement de tout l’écran ;
- conserver les éléments verrouillés visuellement ;
- mettre en avant la zone impactée.

---

# 120. Locks

Un verrou doit avoir :

- icône ;
- état ;
- explication ;
- action de déverrouillage.

Ne pas le représenter uniquement par une couleur.

---

# 121. Barrières

Afficher :

```text
heure barrière
heure prévue
marge
statut
```

Le wording :

```text
Marge confortable
À surveiller
Marge critique
Barrière dépassée dans ce scénario
```

La couleur fonctionnelle accompagne le texte.

---

# 122. Nutrition

La Nutrition doit garder le Plan comme contexte.

Éviter une UI de type tracker calories.

L’identité visuelle privilégie :

- timeline ;
- sections ;
- ravitos ;
- “À consommer ici” ;
- “À remplir” ;
- “À emporter” ;
- couverture.

---

# 123. Couverture Nutrition

Ne pas utiliser une jauge rouge/verte médicalisante sans besoin.

Libellés :

```text
À compléter
Presque atteint
Dans ta cible
Au-dessus de ta cible définie
```

La couleur accompagne le message.

---

# 124. Assistance

L’Assistant privé reçoit une UI extrêmement simple.

Priorités :

```text
prochain rendez-vous
heure / fenêtre
lieu
accès
quoi apporter
Conditions
prochain point
```

Pas de navigation complexe PLUKA.

---

# 125. B2B — Accueil

Le BO doit être orienté conclusions.

Pattern :

```text
À RETENIR
01 ...
02 ...
03 ...
```

Puis détail.

Ne pas commencer par un tableau ou un graphique.

---

# 126. B2B — Brief

Le Brief est un composant / page signature côté organisation.

Composition :

```text
BRIEF ORGANISATION
Race · J-x
─────────────────
COURSE
PELOTON
PARCOURS
PARTICIPANTS
CONDITIONS
```

Chaque section :

- conclusion ;
- quelques chiffres ;
- prochaine vérification éventuelle.

---

# 127. B2B — couleur

Ne pas créer une palette “enterprise” séparée.

Le B2B utilise la même identité :

- Ardoise ;
- Calcaire ;
- Forêt ;
- Lichen ;
- Aube ;
- Glacier.

Différence :

- densité de données ;
- layout plus desktop ;
- conclusions analytiques.

---

# 128. B2B — complexité

Ne pas faire une card distincte pour :

```text
Directeur course
Ops
Communication
Marketing
```

La même information peut être utile à plusieurs rôles.

La UI garde une seule plateforme.

---

# 129. Data density

Desktop B2B peut être plus dense que B2C.

Mais conserver :

- 1 priorité ;
- filets ;
- mono ;
- bande terrain ;
- absence d’ombres ;
- faible radius.

---

# 130. Do / Don’t — résumé

## Do

- utiliser Calcaire comme base ;
- utiliser Ardoise pour structurer ;
- utiliser Lichen pour le CTA principal ;
- utiliser Aube pour l’échéance ;
- utiliser le profil comme signature ;
- utiliser des listes bord à bord ;
- rendre les sources accessibles ;
- garder la donnée en mono ;
- utiliser le topo avec retenue ;
- montrer des preuves produit réelles.

## Don’t

- cards arrondies partout ;
- ombres décoratives ;
- gradient SaaS violet / bleu ;
- emojis comme iconographie ;
- badges multicolores en masse ;
- Aube comme bouton primaire générique ;
- Lichen comme fond de toutes les sections ;
- mini-dashboard météo générique ;
- logos partenaires fictifs ;
- statistiques fictives ;
- animation spectaculaire ;
- copy héroïque.

---

# 131. CSS base recommandée

```css
:root {
  --pk-ink: #0E1A17;
  --pk-forest: #14342C;
  --pk-lichen: #C6F24E;
  --pk-lichen-deep: #A8D42F;
  --pk-dawn: #FF6A3D;
  --pk-glacier: #9AE0D6;
  --pk-glacier-bg: #E8F4F1;

  --pk-limestone: #F2F0E9;
  --pk-surface: #FFFFFF;
  --pk-sand: #E4E1D6;
  --pk-hairline: #DCD8CB;
  --pk-granite: #6F7A74;

  --pk-success: #2F7A55;
  --pk-warning: #B8791C;
  --pk-error: #B23A2B;
  --pk-success-bg: #E6EFE4;
  --pk-warning-bg: #F5ECD8;
  --pk-error-bg: #F6E7E1;

  --font-heading: 'Archivo', system-ui, sans-serif;
  --font-body: 'Hanken Grotesk', system-ui, sans-serif;
  --font-mono: 'Martian Mono', ui-monospace, monospace;

  --radius-sm: 2px;
  --radius-md: 2px;
  --radius-lg: 3px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
}
```

---

# 132. Body base recommandé

```css
html {
  color-scheme: light;
}

body {
  margin: 0;
  background: var(--pk-limestone);
  color: var(--pk-ink);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
```

---

# 133. Dark mode

La Charte actuelle ne définit pas un **mode dark global utilisateur**.

Elle définit des **surfaces sombres de marque**.

Donc :

- ne pas inventer un thème dark global V1 uniquement parce que le système d’exploitation le demande ;
- conserver les bandes Ardoise prévues ;
- traiter un futur dark mode comme une feature de design à part entière.

---

# 134. Token accessibilité

Prévoir des tokens de focus et états.

```css
--pk-focus-light: #14342C;
--pk-focus-dark: #C6F24E;
```

Les valeurs finales doivent être testées en contraste réel.

---

# 135. Storybook

Recommandation :

installer Storybook ou outil équivalent pour `packages/ui` lorsque les composants commencent à se multiplier.

Stories minimales :

```text
Button
Form controls
TrustBadge
OfficialNotice
TerrainBand
AltitudeProfile
SourceDrawer
ConditionPoint
Paywall
```

Ne pas commencer le projet par deux semaines de Storybook vide.

---

# 136. Visual regression

Les écrans critiques doivent avoir des screenshots de référence.

Minimum :

- Homepage coureur ;
- Homepage organisateur ;
- Accueil coureur ;
- Plan desktop ;
- Plan mobile ;
- Nutrition ;
- Conditions ;
- Assistance mobile ;
- Accueil organisateur ;
- Analyse ;
- Brief.

Utiliser les screenshots pour détecter :

- nouveau radius ;
- ombre ;
- mauvaise typo ;
- CTA en double ;
- régression responsive.

---

# 137. Tests UI automatisés

Vérifier au minimum :

- contraste avec axe / équivalent ;
- focus visible ;
- labels de formulaire ;
- navigation clavier ;
- absence d’horizontal overflow mobile ;
- cible tactile ;
- noindex pages privées ;
- reduced motion ;
- alternative texte graphique.

---

# 138. Lint design possible

Ajouter progressivement des garde-fous :

- token colors plutôt que hex arbitraires ;
- interdiction des gros `border-radius` ;
- interdiction d’ombres non tokenisées ;
- pas de couleur inline hors cas dataviz.

Ne pas créer une usine à gaz dès le bootstrap.

---

# 139. Hex arbitraires

À terme, le code production ne doit pas contenir des dizaines de :

```text
#13AB42
#F3F3F3
#8734FF
```

hors :

- données d’un partenaire autorisées ;
- visualisation nécessitant une exception ;
- contenu externe.

Toute nouvelle couleur de l’UI principale doit être validée dans ce Design System.

---

# 140. Tailwind éventuel

Si Tailwind est utilisé :

mapper les tokens :

```text
pk.ink
pk.forest
pk.lichen
pk.dawn
pk.glacier
pk.limestone
pk.sand
pk.granite
```

Ne pas utiliser librement :

```text
green-500
lime-400
orange-500
slate-900
```

dans les composants PLUKA.

---

# 141. CSS Modules / vanilla CSS

Si le projet n’utilise pas Tailwind, conserver les mêmes tokens CSS globaux et composants modulaires.

Le choix de technologie CSS n’altère pas le Design System.

---

# 142. Source de vérité des assets

Créer un emplacement canonique :

```text
packages/ui/assets/brand/
├── logo/
├── topo/
└── icons/
```

ou un package `brand-assets`.

Ne pas dupliquer les SVG dans trois applications.

---

# 143. SVG logo

Le SVG doit être importé / rendu comme asset de marque.

Ne pas redessiner le logo manuellement en CSS.

---

# 144. Assets topo

Les SVG `topo-dark`, `topo-light`, `topo-glacier` sont canoniques.

Ne pas générer une nouvelle topographie aléatoire par écran V1.

Cela préservera la cohérence de la Charte.

---

# 145. Icon library

Une bibliothèque d’icônes externe peut servir de base si son trait peut être normalisé.

Mais les icônes principales visibles doivent respecter :

```text
24×24
stroke ≈ 1.75
forme utilitaire
```

Ne pas mélanger trois familles d’icônes.

---

# 146. Marketing vs app

Même Design System.

Marketing :

- plus d’espace ;
- Display ;
- photographies ;
- sections explicatives.

Application :

- plus dense ;
- données ;
- listes ;
- profils ;
- états.

Ce ne sont pas deux identités.

---

# 147. B2C vs B2B

Même identité.

B2C :

```text
personnel
mobile
opérationnel
```

B2B :

```text
agrégé
desktop
conclusions
```

Ne pas créer une marque visuelle “PLUKA Pro”.

---

# 148. Ton marketing coureur

Mettre en avant :

- après inscription ;
- course concrète ;
- Plan ;
- préparation ;
- terrain.

Pas :

- performance ultime ;
- coaching ;
- data obsession.

---

# 149. Ton marketing organisation

Mettre en avant :

- “PLUKA fait le travail” ;
- conclusions ;
- simplicité ;
- pas d’outil jour J à remplacer ;
- participant mieux préparé.

Éviter :

- “Race Intelligence AI platform” ;
- digital twin ;
- predictive analytics jargon.

---

# 150. États de confiance et provenance

Le Design System doit rendre structurellement faciles les composants :

```text
TrustBadge
SourceLink
SourceDrawer
OfficialNotice
EstimatedValue
ExternalForecastLabel
```

La confiance n’est pas une note en étoiles.

---

# 151. EstimatedValue

Pattern :

```text
12 g
Estimation PLUKA
```

ou :

```text
≈ 12 g
```

avec détail source.

Ne pas afficher une estimation exactement comme une donnée fabricant.

---

# 152. Prévision

Pattern :

```text
Prévision météo
Mise à jour 18:20
```

Jamais :

```text
Officiel
```

sauf décision organisateur séparée.

---

# 153. Confiance Race Intelligence

Pattern :

```text
Prévision PLUKA
Couverture : 82 %
```

La couverture n’est pas un score de fiabilité.

Le UI doit éviter de la rendre comme un pourcentage de certitude.

---

# 154. Loading asynchrone B2B

Exemple :

```text
PLUKA analyse les nouveaux participants…
```

Le BO peut continuer à utiliser le dernier snapshot valide.

Ne pas remplacer toutes les données par un spinner pendant recalcul.

---

# 155. Historique / stale

Si une donnée n’est plus fraîche :

```text
Dernière analyse : hier à 18:40
Mise à jour en cours
```

Ne pas masquer l’ancien résultat sans raison si sa date est visible.

---

# 156. Offline

Le Race Pack doit conserver la même hiérarchie visuelle.

Un état offline doit afficher :

```text
Dernière synchronisation : 05:42
```

et ne pas laisser croire que Conditions viennent d’être mises à jour.

---

# 157. Accessibilité du Lichen

Lichen sert surtout :

- de fond avec texte Ardoise ;
- de trait / état sur fond Ardoise.

Éviter le petit texte Lichen sur fond Calcaire si le contraste n’est pas suffisant.

Toujours vérifier la paire réelle.

---

# 158. Accessibilité d’Aube

Même règle.

Aube peut être excellente comme :

- signal ;
- triangle ;
- filet ;
- label fort.

Ne pas l’utiliser automatiquement pour du petit texte sur Calcaire sans vérification.

---

# 159. Z-index

### Convention V1

```text
base        0
sticky      20
dropdown    40
overlay     60
modal       80
toast       100
```

Limiter les contextes arbitraires.

---

# 160. Motion zéro gratuit

Un changement de valeur Plan peut être animé subtilement.

Ne pas :

- faire compter les chiffres pendant 1 seconde ;
- faire flotter des cards ;
- déplacer le topo ;
- créer un parallax.

PLUKA est calme.

---

# 161. Erreurs générées par IA / données

Si une source est incertaine :

le design doit rendre possible :

```text
À vérifier
```

et :

```text
Voir la source
```

plutôt que de masquer l’incertitude pour avoir un écran propre.

---

# 162. Densité des états

Éviter :

```text
badge officiel
badge validé
badge modifié
badge premium
badge synchronisé
badge météo
```

sur la même ligne.

Prioriser l’état utile.

Les autres détails sont accessibles au niveau suivant.

---

# 163. Un seul CTA primaire

Sur un écran Plan :

```text
Modifier / Recalculer
```

peut être primaire selon contexte.

Ne pas avoir simultanément :

```text
Ajouter nutrition
Ajouter matériel
Ajouter assistant
Voir météo
Exporter
Sauvegarder
```

tous en Lichen.

---

# 164. Progressive disclosure

Mettre en avant :

- prochaine action ;
- prochain point ;
- plus gros risque / attention.

Les détails :

- drawer ;
- accordion ;
- niveau secondaire.

Cette règle est importante pour éviter l’effet usine à gaz.

---

# 165. “À faire maintenant”

Le pattern Accueil validé est une liste éditoriale forte.

Anatomie :

```text
index / icône
titre
raison
deadline éventuelle
CTA / chevron
```

Elle doit pouvoir fonctionner sans cards.

---

# 166. Cards autorisées

Les cards ne sont pas interdites.

Elles sont autorisées lorsque l’objet a réellement :

- une frontière indépendante ;
- une comparaison ;
- un prix ;
- une preview ;
- un module isolé.

Mais elles restent :

- bordées ;
- peu arrondies ;
- sans shadow décorative.

---

# 167. Cards à éviter

Éviter une card pour :

- chaque équipement ;
- chaque ligne de TODO ;
- chaque waypoint ;
- chaque métrique météo ;
- chaque insight B2B.

Utiliser listes / tableaux / bandes.

---

# 168. Accordéons

Utiles pour :

- FAQ ;
- détail source ;
- détails secondaires.

Style :

- filets ;
- aucun gros container arrondi ;
- header lisible ;
- cible tactile suffisante.

---

# 169. Tabs

Utiliser uniquement lorsqu’il s’agit de plusieurs vues du **même objet**.

Exemple Nutrition :

```text
Ma stratégie
Par section
Profil
```

Éviter de transformer toute la navigation produit en tabs.

---

# 170. Segmented controls

Usage limité :

- options de vue ;
- petit choix mutuellement exclusif.

Ne pas styliser comme des grosses pills mobiles si ce n’est pas nécessaire.

---

# 171. Checkboxes matériel

Les checklists sont importantes.

État :

- unchecked ;
- checked ;
- blocked / needs review si nécessaire.

Le checked peut utiliser Lichen / success avec une distinction sémantique claire.

Un élément obligatoire n’est pas “validé” uniquement parce qu’il est coché ; le wording doit rester précis.

---

# 172. Progress bars

Progression préparation :

- fine ;
- directe ;
- labels numériques ;
- pas de gros donut.

Lichen peut porter la progression.

---

# 173. Donuts / gauges

À éviter par défaut.

Ils consomment de l’espace et donnent une esthétique dashboard.

Une barre / chiffre est généralement plus PLUKA.

---

# 174. Maps

Les cartes peuvent être nécessaires pour :

- parcours ;
- Assistance ;
- points d’accès.

Elles ne doivent pas devenir le fond décoratif de toute l’app.

Le style map devrait rester neutre et laisser :

- trace ;
- points ;
- données PLUKA ;

au premier plan.

---

# 175. Graphiques altitude + Conditions

La météo peut être superposée au profil de manière légère :

- plage ;
- marker ;
- sélection.

Ne pas repeindre toute la courbe avec 8 couleurs météo.

---

# 176. Print / PDF

Exports :

- fond majoritairement clair ;
- topo-light discret si utilisé ;
- noir / Forêt lisible ;
- éviter gros aplats sombres consommant beaucoup d’encre sauf couverture ;
- informations essentielles imprimables sans couleur.

---

# 177. Emails

Même identité mais simplifiée :

- logo ;
- Calcaire / blanc ;
- Forêt ;
- Lichen CTA ;
- Aube deadline ;
- pas de topo lourd ;
- largeur lecture.

Le mail doit rester lisible sans images.

---

# 178. Notifications

Texte en priorité.

L’identité de couleur n’est pas fiable dans une notification OS.

Le contenu doit donc être autosuffisant.

---

# 179. Format des CTA

Préférer :

```text
Préparer ma course
Voir mon Plan
Vérifier mes conditions
Ajouter à ma checklist
Parler de mon événement
```

Éviter :

```text
Découvrir
En savoir plus
Cliquer ici
```

lorsque l’action peut être plus précise.

---

# 180. Writing microcopy

Un bouton :

- verbe ;
- résultat clair.

Une erreur :

- problème ;
- prochaine action.

Une alerte :

- fait ;
- impact ;
- source / action.

---

# 181. Composant OfficialNotice

Props conceptuelles :

```ts
type OfficialNoticeProps = {
  title: string
  body?: string
  sourceLabel: string
  publishedAt?: string
  severity?: 'info' | 'important' | 'critical'
  action?: Action
}
```

Le design doit rester distinct d’une `Alert` système.

---

# 182. Composant TrustBadge

```ts
type TrustLevel =
  | 'official'
  | 'validated_pluka'
  | 'community'
  | 'external_forecast'
  | 'estimated'
```

Le libellé humain reste visible.

---

# 183. Composant TerrainBand

```ts
type TerrainBandProps = {
  tone: 'dark' | 'light' | 'glacier'
  topo?: boolean
  eyebrow?: ReactNode
  title: ReactNode
  body?: ReactNode
  primaryAction?: ReactNode
  secondaryAction?: ReactNode
}
```

Le composant ne doit pas forcer l’usage d’une card interne.

---

# 184. Composant DataValue

```ts
type DataValueProps = {
  value: ReactNode
  label?: string
  unit?: string
  emphasis?: 'normal' | 'strong'
}
```

Toujours tabular nums pour les chiffres.

---

# 185. Composant StatusBadge

Doit combiner :

```text
text
+
optional icon
+
semantic color
```

Ne jamais retourner uniquement un rond vert.

---

# 186. Composant SourceLink

Doit pouvoir afficher :

```text
Voir la source
```

et ouvrir SourceDrawer.

C’est un composant de premier niveau du produit, pas une feature admin.

---

# 187. Composant ConditionPoint

Ne dépend pas directement du provider météo.

Il reçoit un modèle normalisé PLUKA.

Cela maintient l’identité et évite de copier l’UI d’un fournisseur.

---

# 188. Composant Paywall

Doit recevoir :

```ts
type PaywallProps = {
  capability: string
  title: string
  body: string
  offer: 'race_pass' | 'plus'
  primaryAction: Action
}
```

La décision d’accès vient d’EntitlementService.

Le composant ne calcule jamais les droits.

---

# 189. Thèmes événements

Le co-branding ne doit pas reconfigurer les tokens fondamentaux.

Si une couleur événement est utilisée :

- couverture / accent contextuel limité ;
- jamais sur les états fonctionnels ;
- jamais sur les CTA si contraste non garanti.

---

# 190. Design tokens et server rendering

Les tokens doivent être disponibles dès le HTML initial.

Éviter un flash :

```text
UI non stylée
→ tokens chargés après JS
```

---

# 191. Prototype ≠ code

Le prototype contient des styles inline et du code de démonstration.

Ne pas copier littéralement :

- structure DOM ;
- styles inline ;
- hacks ;
- composants simulés.

Il faut reproduire :

- intention visuelle ;
- hiérarchie ;
- interaction ;
- contenu.

---

# 192. Prototype canonique

Le prototype de référence est :

```text
PLUKA.dc.html
```

dans la version figée actuelle.

Ne pas utiliser une ancienne :

```text
PLUKA v2.dc.html
```

ou branche historique si elle subsiste dans des archives.

---

# 193. Écrans de référence obligatoires

Avant de créer un nouveau pattern, Claude Code doit vérifier si un écran existant répond déjà au besoin.

Références :

```text
Homepage coureur
Homepage organisateur
Accueil coureur
Plan
Préparation
Assistance
Course
Ma saison
Sorties
Conditions
Accueil organisateur
Ma course
Analyse
Participants
Brief
```

---

# 194. Ne pas inventer de nouveau pattern

Si un besoin ressemble à :

```text
liste d’action
```

réutiliser la liste d’action.

Si un besoin ressemble à :

```text
source
```

réutiliser SourceDrawer.

Si un besoin ressemble à :

```text
section héro
```

réutiliser TerrainBand.

Pas de composant visuellement unique à chaque feature.

---

# 195. Critères de revue visuelle

Une PR UI doit répondre :

1. utilise-t-elle les fonts canoniques ?
2. utilise-t-elle uniquement les tokens ?
3. respecte-t-elle faible radius ?
4. évite-t-elle les shadows ?
5. y a-t-il un seul CTA primaire ?
6. Aube signifie-t-elle réellement prochaine échéance ?
7. les données sont-elles en mono ?
8. la source est-elle accessible si critique ?
9. le mobile est-il utilisable ?
10. le clavier fonctionne-t-il ?
11. la couleur n’est-elle pas le seul signal ?
12. l’écran ressemble-t-il encore à PLUKA ?

---

# 196. Critères de non-régression Claude Code

Une évolution UI ne peut pas être mergée si elle :

- introduit une nouvelle couleur sans token / justification ;
- utilise de gros radius SaaS ;
- ajoute une shadow à toutes les cards ;
- remplace Archivo par Inter ;
- utilise Martian Mono pour un paragraphe ;
- utilise Aube comme CTA principal générique ;
- met plusieurs CTA Lichen concurrents ;
- ajoute une navigation Météo principale ;
- ajoute une navigation Nutrition principale ;
- transforme le BO en grille de 12 analytics cards ;
- cache les sources importantes ;
- utilise un emoji comme icône métier ;
- rend un état uniquement par couleur ;
- supprime un focus visible ;
- casse la cible tactile 44 px ;
- affiche une dataviz sans alternative textuelle ;
- utilise une photo + topo superposé agressif ;
- donne à une marque partenaire la priorité sur l’événement ;
- invente un logo client / témoignage / statistique ;
- rend une estimation visuellement identique à une donnée officielle.

---

# 197. Critères d’acceptation du Design System V1

Le Design System est correctement appliqué lorsque :

1. Calcaire est le fond dominant ;
2. Ardoise structure les bandes principales ;
3. Lichen est réservé à l’action / progression ;
4. Aube représente la prochaine échéance ;
5. Glacier reste secondaire ;
6. les couleurs fonctionnelles ne concurrencent pas Lichen ;
7. Archivo est utilisé pour les titres ;
8. Hanken Grotesk pour la prose ;
9. Martian Mono pour les données / micro-labels ;
10. la hiérarchie ne repose pas sur l’uppercase généralisé ;
11. les rayons principaux restent 2–3 px ;
12. les surfaces standards n’ont pas d’ombre décorative ;
13. les listes utilisent des filets / blocs bord à bord ;
14. le topo reste discret et non répété ;
15. les icônes restent utilitaires et cohérentes ;
16. le profil d’altitude est traité comme composant signature ;
17. le prochain jalon est identifiable ;
18. les states ont texte + signal ;
19. les boutons ont une cible suffisante ;
20. le focus clavier est visible ;
21. les formulaires possèdent des labels ;
22. les sources critiques sont accessibles ;
23. les données estimées sont identifiées ;
24. les décisions officielles sont visuellement distinctes des suggestions ;
25. la météo ne ressemble pas à une app météo générique ;
26. Race Intelligence commence par des conclusions ;
27. le B2B partage la même marque que le B2C ;
28. l’événement reste au premier plan en co-branding ;
29. le mobile coureur est réellement utilisable ;
30. le BO reste lisible sur desktop et résumé sur mobile ;
31. les animations respectent reduced motion ;
32. les écrans critiques passent les tests d’accessibilité ;
33. aucune ancienne branche visuelle n’est réintroduite ;
34. les composants de domaine réutilisent les primitives ;
35. le prototype sert de référence visuelle mais n’est pas copié comme architecture de code.

---

# 198. Consigne à Claude Code

Lorsqu’une feature nécessite de l’UI :

1. lire ce document ;
2. consulter l’écran équivalent du prototype ;
3. chercher un composant existant ;
4. utiliser les tokens ;
5. implémenter la version mobile et desktop nécessaire ;
6. vérifier clavier et accessibilité ;
7. ajouter une story si le composant devient réutilisable ;
8. ajouter un test visuel / E2E sur l’écran critique ;
9. ne pas “moderniser” spontanément la DA ;
10. signaler une contradiction au lieu de créer un quatrième style.

---

# 199. Référence rapide

```text
IDENTITÉ
Ligne d’altitude

COULEURS
Ardoise   #0E1A17
Forêt     #14342C
Lichen    #C6F24E
Aube      #FF6A3D
Glacier   #9AE0D6
Calcaire  #F2F0E9
Sable     #E4E1D6
Granit    #6F7A74

TYPO
Archivo Expanded — titres
Hanken Grotesk — texte / interface
Martian Mono — donnée / micro-label

RADIUS
2 / 2 / 3 px

SURFACES
bord à bord
filets
pas d’ombre décorative

ACTION
1 CTA Lichen principal

ÉCHÉANCE
Aube

SIGNATURE
profil d’altitude
jalons
topographie

TON
direct
utile
rassurant
concret

INTERDIT
SaaS cards
grosses ombres
gros arrondis
emoji métier
hero performance
faux chiffres
```

---

# 200. Consigne finale

PLUKA doit être reconnaissable **sans avoir besoin de regarder son logo**.

Cette reconnaissance vient de la combinaison :

```text
CALCAIRE
+
ARDOISE
+
LICHEN
+
AUBE
+
ARCHIVO
+
MARTIAN MONO
+
PROFIL D’ALTITUDE
+
TOPO DISCRET
+
BLOCS BORD À BORD
+
PROCHAINE ÉTAPE CLAIRE
```

Le Design System ne doit jamais dériver vers une esthétique générique parce qu’un composant de bibliothèque est plus rapide à utiliser.

La phrase directrice est :

> **Le terrain est la structure. L’information est utile. L’action est évidente.**

---

**Fin — PLUKA Design System V1**
