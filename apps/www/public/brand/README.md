# Assets de marque — apps/www

Ce dossier attend quatre fichiers qui ne sont pas dans le dépôt. Les pages sont
écrites pour les consommer sans modification : il suffit de les déposer ici.

## Ce qui manque

| Fichier attendu    | Rôle                                           | Référence                |
| ------------------ | ---------------------------------------------- | ------------------------ |
| `lockup.svg`       | Lockup PLUKA horizontal, viewBox `0 0 928 175` | 06_DESIGN_SYSTEM.md §143 |
| `topo-dark.svg`    | Relief de signature sur bande sombre           | §144                     |
| `topo-light.svg`   | Relief de signature sur fond Calcaire          | §144                     |
| `topo-glacier.svg` | Relief de signature en teinte Glacier          | §144                     |

Le prototype les charge depuis `assets/` et un sprite `pluka-logo-sprite.js`
(symboles `#pk-lockup` et `#pk-mark`). Ni le sprite ni les SVG n'ont été
versionnés avec `reference/prototype/`.

## Pourquoi ils ne sont pas reconstitués

§143 : « Le SVG doit être importé / rendu comme asset de marque. Ne pas
redessiner le logo manuellement en CSS. »

§144 : « Les SVG `topo-dark`, `topo-light`, `topo-glacier` sont canoniques. Ne
pas générer une nouvelle topographie aléatoire par écran V1. »

Redessiner l'un ou l'autre produirait une marque approchante et une
topographie inventée — exactement ce que ces deux règles interdisent.

## Comment les activer

### Le lockup

`src/components/brand-lockup.tsx` compose aujourd'hui le nom dans Archivo, la
police de titre de la Charte. Remplacer le contenu du composant par le SVG
importé suffit : c'est le seul endroit à toucher, sur les deux pages et les
deux pieds de page.

### Le relief

`src/app/landing.css` déclare trois variables à `none` sur `.lp-shell` :

```css
--lp-topo-dark: none;
--lp-topo-light: none;
--lp-topo-glacier: none;
```

Les pointer vers les fichiers déposés ici active le relief partout à la fois :

```css
--lp-topo-dark: url('/brand/topo-dark.svg');
--lp-topo-light: url('/brand/topo-light.svg');
--lp-topo-glacier: url('/brand/topo-glacier.svg');
```

Tant qu'elles valent `none`, les bandes sombres et les panneaux rendent leur
fond plat. Aucune mise en page n'en dépend, et aucune requête 404 n'est émise.

## Emplacement canonique

§142 demande un emplacement unique, `packages/ui/assets/brand/`, plutôt qu'une
copie par application. `public/brand/` n'est que le point de service HTTP de
`apps/www` : quand les fichiers arriveront, ils appartiennent à `packages/ui`,
et ce dossier ne devrait en contenir qu'une copie générée ou un lien.
