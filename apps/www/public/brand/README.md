# Assets de marque — apps/www

## Le logo est arrivé

Les logos officiels sont dans `reference/brand/logos/` : 17 SVG, soit trois
dessins déclinés en couleurs, plus un sprite.

Ils ne sont **pas** recopiés ici. Le composant `Logo` de `@pluka/ui` en extrait
les tracés — `packages/ui/src/brand/logo-paths.ts` — et les rend en SVG inline,
coloré par les tokens `--pk-*`. Une image externe ne pourrait pas prendre une
variable CSS, et §139 exige que les couleurs passent par les tokens.

```tsx
import { Logo } from '@pluka/ui';

<Logo />                                  {/* lockup, déclinaison primary */}
<Logo tone="inverse" height={26} />       {/* sur fond Ardoise */}
<Logo variant="mark" tone="lichen" />     {/* symbole seul */}
<Logo variant="wordmark" height={20} />   {/* mot seul */}
<Logo decorative />                       {/* répétition : hors arbre a11y */}
```

Les déclinaisons offertes sont exactement celles que les fichiers portent :

| Variante   | Déclinaisons                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `lockup`   | `primary` `inverse` `lichen` `mono-ardoise` `mono-calcaire` `mono-foret` `on-ardoise` `on-calcaire` `on-lichen` `current` |
| `mark`     | `foret` `ardoise` `calcaire` `lichen` `current`                                                                           |
| `wordmark` | `foret` `calcaire` `mono-ardoise` `current`                                                                               |

`variant="mark" tone="primary"` ne compile pas : aucun fichier ne le définit.

Les `on-*` ne sont pas des couleurs de plus. Ce sont les trois combinaisons
prévues pour être posées sur un fond donné, et leur `viewBox` embarque les
44 unités de zone de respect du fichier officiel.

`current` vient des symboles `pk-lockup-current` et `pk-mark` du sprite : le
logo hérite alors de la couleur du texte, ce qui sert dans une navigation.

## Ce qui garde tout cela honnête

`packages/ui/tests/logo.test.ts` relit `reference/brand/logos/` et compare,
caractère par caractère, les tracés que le composant émet, les `viewBox`, le
calage du lockup et les encres de chaque déclinaison. Il vérifie aussi les trois
favicons générés.

Conséquences pratiques :

- retoucher le logo passe par les fichiers officiels, puis par une
  régénération de `logo-paths.ts` et des `icon.svg` ;
- modifier `logo-paths.ts` sans toucher aux fichiers fait échouer les tests ;
- déposer un nouveau fichier dans `reference/brand/logos/` sans l'offrir dans
  le composant fait échouer les tests aussi.

Le bloc `<metadata>` C2PA des fichiers de référence n'est repris nulle part : il
atteste la provenance d'un fichier précis, pas d'un composant ni d'un dérivé.
Il reste dans `reference/brand/logos/`, qui demeure la source.

## Favicon et icône d'application

Les trois applications servent le symbole officiel.

| Fichier                         | Rôle                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `apps/*/src/app/icon.svg`       | Favicon, Forêt sur chrome clair, Lichen sur chrome sombre |
| `apps/*/src/app/apple-icon.tsx` | Icône iOS, PNG 180 × 180 rendu au build                   |

`icon.svg` est un fichier généré et porte ses couleurs en hexadécimal. C'est la
seule exception assumée à §139 : un favicon est rendu hors du document, où
aucune variable CSS n'est résolue. Les deux valeurs sont bornées par le test aux
deux déclinaisons officielles du symbole.

`apple-icon.tsx` passe par `next/og`, parce qu'Apple n'accepte qu'un PNG opaque
et que le dépôt n'embarque aucun rastériseur. Ses couleurs viennent de
`brandColors`, le miroir TypeScript des tokens, prévu pour « les usages qui ne
peuvent pas lire une variable CSS ».

## Ce qui manque encore : le relief

**Ce dossier attend toujours trois fichiers.** Ils ne font pas partie du lot
logo et le relief reste désactivé.

| Fichier attendu    | Rôle                                  | Référence |
| ------------------ | ------------------------------------- | --------- |
| `topo-dark.svg`    | Relief de signature sur bande sombre  | §144      |
| `topo-light.svg`   | Relief de signature sur fond Calcaire | §144      |
| `topo-glacier.svg` | Relief de signature en teinte Glacier | §144      |

§144 : « Les SVG `topo-dark`, `topo-light`, `topo-glacier` sont canoniques. Ne
pas générer une nouvelle topographie aléatoire par écran V1. » En générer une
produirait une topographie inventée, exactement ce que la règle interdit.

### Comment les activer

`apps/www/src/app/landing.css` déclare trois variables à `none` sur `.lp-shell` :

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
copie par application.

Le logo y échappe sans le contredire : `reference/brand/logos/` est la source,
et rien n'en est dupliqué — le paquet en extrait les tracés, les applications
consomment le composant. Quand les SVG de relief arriveront, ils devront en
revanche vivre à un seul endroit, `public/brand/` n'étant que le point de
service HTTP de `apps/www`.
