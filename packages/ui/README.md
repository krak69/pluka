# `@pluka/ui`

Design System PLUKA : tokens source et primitives.

Référence : `docs/06_DESIGN_SYSTEM.md`.

## Utilisation

```ts
import '@pluka/ui/styles.css'; // une seule fois par application
import { Button, DataValue, TrustBadge } from '@pluka/ui';
```

`@pluka/ui/tokens.css` expose les tokens seuls, pour une surface qui ne veut
pas des styles de composants.

## Le prototype n'est pas la source

`reference/prototype/PLUKA.dc.html` sert d'**intention visuelle**. Ses valeurs
ne sont pas des constantes moteur, et sa structure DOM n'est pas une
architecture de code (§191).

Concrètement : le prototype nomme les mêmes couleurs autrement —
`--pk-aube`, `--pk-stone`, `--pk-hair`, `--pk-faint`, `--pk-oxide`. Ce paquet
retient les noms du Design System (`--pk-dawn`, `--pk-limestone`,
`--pk-hairline`, `--pk-text-muted`, `--pk-dawn-ink`), parce que le document
fait foi (§0.1). Les hex, eux, coïncident.

Le prototype ne porte ni échelle d'espacement, ni largeurs de contenu : `--space-*`
et `--content-*` sont des conventions d'implémentation V1 posées par le
document (§20, §21), pas des valeurs historiques de la Charte.

## Tokens

```text
src/tokens/
├── colors.css      §6  — palette canonique, signal + encre lisible
├── typography.css  §114 — familles uniquement, aucune police chargée
├── radius.css      §17 — 2–3 px, direction anguleuse
├── spacing.css     §20, §21 — base 4 px, largeurs de contenu
├── motion.css      §99, §100 — durées courtes, reduced motion
├── layers.css      §159 — plans d'empilement nommés
└── index.css
```

`tokens.ts` en est un miroir TypeScript, pour les usages qui ne peuvent pas
lire une variable CSS — `theme-color`, canvas, SVG serveur, dataviz. La
duplication est surveillée : `tests/tokens.test.ts` relit le CSS et échoue si
les deux divergent.

### Polices

Aucune police n'est chargée par ce paquet : ni `@import` runtime, ni fichier
committé (§114, licence). Les variables portent une pile avec repli système ;
l'application les réassigne aux familles produites par `next/font`.

## Primitives livrées

```text
Button · IconButton · Link · MicroLabel · DataValue
Badge · TrustBadge · StatusBadge · Divider · Input
```

§110 liste une quarantaine de composants et précise que « tous ne doivent pas
être codés avant besoin réel ». Ce lot livre ceux dont le document fixe
précisément la forme et que les surfaces actuelles consomment. `TerrainBand`,
`Dialog`, `Toast`, `Tabs`, `BottomSheet` viendront avec l'écran qui les
demande.

Les composants de domaine — `AltitudeProfile`, `PlanWaypointRow`,
`NutritionWaypoint`, `ConditionPoint`, `OrganizerBrief` — ne vivent pas ici
(§111). Aucune règle métier dans ce paquet.

## Ce que les tests garantissent

Au-delà du rendu, ils tiennent les règles que le document énonce en toutes
lettres :

- la couleur ne porte jamais seule le sens — `StatusBadge` ne peut pas rendre
  un rond vert seul, `TrustBadge` affiche toujours son libellé (§103, §185) ;
- un champ a un label lié, et son erreur est un texte relié par
  `aria-describedby`, pas une bordure rouge (§35, §106) ;
- aucun hex arbitraire hors de `tokens/` (§139) ;
- aucun rayon au-delà de 3 px (§17) ;
- aucune ombre portée sur une surface standard (§18) ;
- `outline` jamais supprimé sans remplacement (§30) ;
- 44 px minimum sur les cibles interactives (§29) ;
- capitales réservées aux micro-labels (§15).

Ces garde-fous sont la version minimale du « lint design » de §138 : ils
lisent les feuilles de styles, sans outillage supplémentaire.

## Ce qui reste à faire

- **Contraste réel** — §102 et §134 demandent de vérifier les paires
  effectives ; les valeurs de focus sont notées « à revalider ». Un test axe
  ou équivalent suppose un DOM, que ce paquet n'installe pas encore.
- **Storybook et tests de régression visuelle** — §135, §136, à ouvrir quand
  les composants se multiplieront.
