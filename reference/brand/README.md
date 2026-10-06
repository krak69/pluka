# PLUKA — kit de marque (charte v2 « Ligne d'altitude »)

Tout est en SVG vectoriel, prêt à être copié dans un projet.

## Logo — `logo/`

Verrouillage complet (ratio 928 × 175) :

| Fichier | Usage |
|---|---|
| `pluka-logo-primary.svg` | **Par défaut** — fond clair (chemin + logotype Forêt, jalon Aube) |
| `pluka-logo-lichen.svg` | Fond clair, version plus expressive (chemin Lichen) — éviter sur blanc pur si le contraste compte |
| `pluka-logo-inverse.svg` | Fond sombre (chemin Lichen, logotype Calcaire) |
| `pluka-logo-mono-foret.svg` · `-mono-ardoise.svg` · `-mono-calcaire.svg` | Monochromes (impression, tampons, gravure) |
| `pluka-logo-on-ardoise.svg` · `-on-calcaire.svg` · `-on-lichen.svg` | Avec fond et zone de protection intégrés (réseaux, docs) |

Symbole seul (240 × 195) : `pluka-mark-foret|lichen|ardoise|calcaire.svg`
Logotype seul : `pluka-wordmark-foret|calcaire|mono-ardoise.svg`

**Règle de contraste** : le chemin prend la couleur qui garantit le contraste — Forêt sur clair, Lichen sur sombre. Le triangle du A reste Aube, sauf en monochrome.

### Sprite inline — `logo/pluka-sprite.svg`

Coller une fois dans le `<body>`, puis :

```html
<svg viewBox="0 0 928 175" width="150"><use href="#pk-lockup"/></svg>        <!-- fond clair -->
<svg viewBox="0 0 928 175" width="150"><use href="#pk-lockup-light"/></svg>  <!-- fond sombre -->
<svg viewBox="0 0 928 175" width="150" style="color:#14342C"><use href="#pk-lockup-current"/></svg>
<svg viewBox="0 0 240 195" width="28" style="color:#C6F24E"><use href="#pk-mark"/></svg>
```

Tailles minimales : logo complet 120 px de large, symbole 20 px. Zone de protection = hauteur du P sur chaque côté. Ne pas étirer, ne pas recolorer hors palette, ne pas corriger l'oblique du logotype.

## Icônes — `icons/`

`pluka-app-icon.svg` (Ardoise + Lichen, rx 116/512), `-lichen.svg`, `-square.svg` (sans arrondi, pour iOS/Android qui masquent eux-mêmes), `favicon.svg`.

## Fonds topographiques — `topo/`

- `transparent/` — lignes seules, à poser sur un aplat : `topo-lichen`, `-glacier`, `-calcaire` (pour fonds sombres) · `topo-foret`, `-ardoise` (pour fonds clairs) · `topo-aube` (accent, rare).
- `filled/` — fond + lignes, utilisables tels quels : `ardoise-lichen`, `ardoise-glacier`, `foret-lichen`, `foret-calcaire`, `calcaire-foret`, `sable-foret`, `blanc-ardoise`, `lichen-ardoise`.

```css
.hero { background: #0E1A17 url(brand/topo/transparent/topo-lichen.svg) center/cover no-repeat; }
```

Règles : toujours `cover`, jamais en tuile ; jamais au-dessus du texte courant ; opacité maximale 10 % (lignes fines) / 20 % (lignes maîtresses) — déjà appliquée dans les fichiers.

## Tokens

`pluka-tokens.css` (variables CSS + classes de fonds topo) et `pluka-tokens.json` (couleurs, polices, rayons, proportions du logo).

Polices (Google Fonts) :
```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=Hanken+Grotesk:wght@300..700&family=Martian+Mono:wght@300..700&display=swap" rel="stylesheet">
```
