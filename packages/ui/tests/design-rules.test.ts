import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fous de design.
 *
 * §138 recommande d'ajouter progressivement un lint design : tokens plutôt
 * qu'hex arbitraires, pas de gros rayons, pas d'ombres non tokenisées. Ces
 * tests en sont la version minimale — ils lisent les sources et échouent sur
 * une dérive, sans outillage supplémentaire.
 *
 * La portée couvre `packages/ui` **et** `apps/*`. Les feuilles du paquet ne
 * sont plus l'essentiel du CSS du produit : les écrans en portent la majeure
 * partie, et une règle qui ne s'y applique pas ne protège rien. Les styles
 * inline des `.tsx` sont contrôlés comme le CSS, parce que c'est là que le
 * prototype invite à écrire des valeurs en dur.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const STYLES = join(SRC, 'styles');
const TOKENS = join(SRC, 'tokens');

/** Les seuls fichiers autorisés à contenir une valeur de couleur littérale. */
const TOKEN_FILES = ['colors.css'];

function walk(directory: string, extensions: readonly string[]): readonly string[] {
  let entries: readonly string[];

  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  return entries.flatMap((name) => {
    if (name === 'node_modules' || name === '.next' || name === 'dist') return [];

    const full = join(directory, name);
    if (statSync(full).isDirectory()) return walk(full, extensions);

    return extensions.some((extension) => name.endsWith(extension)) ? [full] : [];
  });
}

function cssFiles(directory: string): readonly string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(directory, name));
}

/**
 * Feuilles et composants de toutes les applications, plus ceux du paquet.
 *
 * `apps/worker` n'a pas d'interface ; il n'est pas exclu explicitement, il ne
 * contient simplement aucun des deux types de fichiers.
 */
function productSources(): readonly string[] {
  const apps = walk(join(ROOT, 'apps'), ['.css', '.tsx']);
  const ui = walk(SRC, ['.css', '.tsx']);

  return [...apps, ...ui];
}

function label(file: string): string {
  return relative(ROOT, file).split('\\').join('/');
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function isTokenFile(file: string): boolean {
  return TOKEN_FILES.some((name) => file.endsWith(name));
}

describe('couleurs', () => {
  it('n’écrit aucune couleur littérale hors des fichiers de tokens', () => {
    // §139 : le code de production ne doit pas contenir des dizaines de
    // `#13AB42`. Les couleurs vivent dans `tokens/`, les styles les consomment
    // par `var(--pk-*)`, au besoin dérivées par `color-mix()`. La règle couvre
    // aussi `rgb()` et `rgba()` littéraux : une opacité sur une couleur de
    // marque est une dérivation, pas une nouvelle couleur.
    const offenders = productSources()
      .filter((file) => !isTokenFile(file))
      .flatMap((file) => {
        const source = withoutComments(readFileSync(file, 'utf8'));
        const found = [
          ...(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
          ...(source.match(/\brgba?\(\s*\d/g) ?? []),
        ];

        return found.length === 0 ? [] : [`${label(file)} → ${found.join(', ')}`];
      });

    expect(offenders, 'couleur littérale hors de tokens/').toEqual([]);
  });

  it('n’emploie que des tokens PLUKA déclarés', () => {
    const declared = new Set(
      [...readFileSync(join(TOKENS, 'colors.css'), 'utf8').matchAll(/(--pk-[a-z0-9-]+)\s*:/g)].map(
        (match) => match[1] as string,
      ),
    );

    const used = new Set(
      productSources().flatMap((file) =>
        [...withoutComments(readFileSync(file, 'utf8')).matchAll(/var\((--pk-[a-z0-9-]+)\)/g)].map(
          (match) => match[1] as string,
        ),
      ),
    );

    const unknown = [...used].filter((token) => !declared.has(token));

    expect(unknown, 'token couleur utilisé mais jamais déclaré').toEqual([]);
  });
});

/**
 * Échelle d'espacement — §20, §138.
 *
 * La règle n'interdit pas tout pixel : le prototype marketing compose sur une
 * trame de 2 px, et `spacing.css` prévient que son échelle de 4 px est « une
 * convention d'implémentation V1, pas des valeurs de la Charte ». Interdire
 * `padding: 18px` reviendrait à interdire la reprise fidèle des maquettes.
 *
 * Ce qu'elle interdit est la dérive réelle : écrire en dur une valeur pour
 * laquelle un token existe déjà. `padding: 16px` contourne `--space-4` sans
 * raison, et c'est ainsi qu'une échelle meurt.
 */
const SPACING_TOKENS: Readonly<Record<string, string>> = {
  '4': '--space-1',
  '8': '--space-2',
  '12': '--space-3',
  '16': '--space-4',
  '20': '--space-5',
  '24': '--space-6',
  '32': '--space-8',
  '40': '--space-10',
  '48': '--space-12',
  '64': '--space-16',
  '80': '--space-20',
};

const CSS_SPACING =
  /\b(padding|margin|gap|row-gap|column-gap|padding-top|padding-right|padding-bottom|padding-left|margin-top|margin-right|margin-bottom|margin-left)\s*:\s*([^;}]+)/g;

const INLINE_SPACING =
  /\b(padding|margin|gap|rowGap|columnGap|paddingTop|paddingRight|paddingBottom|paddingLeft|marginTop|marginRight|marginBottom|marginLeft)\s*:\s*'([^']+)'/g;

function spacingOffenders(file: string): readonly string[] {
  const source = withoutComments(readFileSync(file, 'utf8'));
  const found: string[] = [];

  for (const pattern of [CSS_SPACING, INLINE_SPACING]) {
    for (const match of source.matchAll(pattern)) {
      const property = match[1] as string;
      const value = match[2] as string;

      for (const pixels of value.matchAll(/(?<![\d.])(\d+)px\b/g)) {
        const raw = pixels[1] as string;
        const token = SPACING_TOKENS[raw];

        if (token !== undefined) {
          found.push(`${property}: ${raw}px → var(${token})`);
        }
      }
    }
  }

  return found.length === 0 ? [] : [`${label(file)} → ${found.join(' ; ')}`];
}

describe('espacement', () => {
  it('ne réécrit pas en dur une valeur qui a déjà un token', () => {
    const offenders = productSources().flatMap(spacingOffenders);

    expect(offenders, 'px en dur alors qu’un token --space-* porte la même valeur').toEqual([]);
  });

  it('couvre les styles inline autant que les feuilles', () => {
    // Garde-fou du garde-fou : si la détection inline cessait de fonctionner,
    // le test précédent passerait sur un `.tsx` truffé de `padding: '16px'`.
    const sample = `<div style={{ padding: '16px', gap: '30px' }} />`;
    const matches = [...sample.matchAll(INLINE_SPACING)].map((match) => match[2]);

    expect(matches).toEqual(['16px', '30px']);
    expect(SPACING_TOKENS['16']).toBe('--space-4');
    expect(SPACING_TOKENS['30']).toBeUndefined();
  });
});

describe('rayons', () => {
  it('ne dépasse jamais 3 px', () => {
    // §17 : direction volontairement anguleuse. `border-radius: 50%` reste
    // admis pour une pastille ronde, qui n'est pas une carte.
    const offenders = productSources().flatMap((file) => {
      const source = withoutComments(readFileSync(file, 'utf8'));

      return [
        ...[...source.matchAll(/border-radius:\s*([^;}]+)/g)].map((match) => match[1] as string),
        ...[...source.matchAll(/borderRadius:\s*'([^']+)'/g)].map((match) => match[1] as string),
      ]
        .map((value) => value.trim())
        .filter((value) => {
          if (value === '50%' || value === '0' || value.startsWith('var(')) return false;

          // Un rayon composé — `2px 12px 12px 4px` — est mesuré coin par coin.
          const corners = value.split(/\s+/);

          return corners.some((corner) => {
            if (corner.startsWith('var(') || corner === '0' || corner.endsWith('%')) return false;
            const pixels = Number.parseInt(corner, 10);
            return Number.isNaN(pixels) || pixels > 3;
          });
        })
        .map((value) => `${label(file)} → ${value}`);
    });

    expect(offenders, 'rayon supérieur à la direction anguleuse').toEqual([]);
  });
});

describe('ombres', () => {
  it('ne pose aucune ombre portée sur une surface standard', () => {
    // §18 : « blocs bord à bord, sans carte flottante ni ombre portée ». Une
    // surface se délimite par un filet. L'ombre réelle est réservée à ce qui
    // passe au-dessus du document — aucun de ces composants n'est dans ce cas.
    const source = withoutComments(readFileSync(join(STYLES, 'surfaces.css'), 'utf8'));
    const shadows = [...source.matchAll(/box-shadow:\s*([^;]+);/g)].map((match) =>
      (match[1] as string).trim(),
    );

    expect(shadows.every((value) => value === 'none')).toBe(true);
  });

  it('n’emploie l’ombre interne du champ que comme accent', () => {
    // §34 : l'accent Lichen du champ est un `inset`, pas une élévation.
    const source = withoutComments(readFileSync(join(STYLES, 'field.css'), 'utf8'));

    for (const match of source.matchAll(/box-shadow:\s*([^;]+);/g)) {
      expect((match[1] as string).trim().startsWith('inset')).toBe(true);
    }
  });
});

describe('focus', () => {
  it('remplace toujours l’outline qu’il retire', () => {
    // §30 : « ne jamais supprimer `outline` sans remplacement ». Un
    // `outline: none` n'est acceptable que si la même feuille rétablit un
    // anneau visible ailleurs.
    for (const file of productSources()) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      if (!/outline:\s*none/.test(source)) continue;

      expect(source, `${label(file)} supprime l'outline sans le remplacer`).toMatch(
        /:focus-visible[\s\S]*?outline:\s*2px/,
      );
    }
  });

  it('pose un anneau au niveau du document', () => {
    const base = readFileSync(join(STYLES, 'base.css'), 'utf8');

    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  it('contraste sur les bandes sombres', () => {
    // Le vert Forêt disparaîtrait sur l'Ardoise.
    const base = readFileSync(join(STYLES, 'base.css'), 'utf8');

    expect(base).toContain('--pk-focus-dark');
  });
});

describe('cibles interactives', () => {
  it('atteint 44 px sur tous les contrôles', () => {
    // §29 : 44 × 44 px minimum. Le bouton principal conserve ses 52 px.
    const button = withoutComments(readFileSync(join(STYLES, 'button.css'), 'utf8'));

    const heights = [...button.matchAll(/min-height:\s*(\d+)px/g)].map((match) =>
      Number.parseInt(match[1] as string, 10),
    );

    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  });

  it('donne au bouton principal les 52 px du prototype', () => {
    const button = readFileSync(join(STYLES, 'button.css'), 'utf8');

    expect(button).toMatch(/\.pk-btn\s*\{[^}]*min-height:\s*52px/);
  });

  it('donne 44 px à chaque destination de navigation', () => {
    // §70 : la cible mobile ne descend pas sous 44 px, et la navigation est
    // précisément ce qu'on touche en courant.
    const nav = withoutComments(readFileSync(join(STYLES, 'nav.css'), 'utf8'));

    for (const selector of ['.pk-nav-item', '.pk-tab']) {
      const block = new RegExp(`\\${selector}\\s*\\{[^}]*min-height:\\s*(\\d+)px`);
      const match = block.exec(nav);

      expect(match, `${selector} sans hauteur minimale`).not.toBeNull();
      expect(Number.parseInt((match as RegExpExecArray)[1] as string, 10)).toBeGreaterThanOrEqual(
        44,
      );
    }
  });
});

describe('capitales', () => {
  it('les réserve aux micro-labels et aux badges', () => {
    // §15 : « La hiérarchie se fait par la taille et l'espace, jamais par les
    // capitales forcées. » Un `text-transform: uppercase` sur un titre ou un
    // bouton serait une dérive.
    const allowed = new Set(['typography.css', 'field.css', 'badge.css']);

    const offenders = cssFiles(STYLES)
      .filter((file) =>
        /text-transform:\s*uppercase/.test(withoutComments(readFileSync(file, 'utf8'))),
      )
      .map((file) => file.split(/[\\/]/).pop() ?? file)
      .filter((name) => !allowed.has(name));

    expect(offenders, 'capitales hors micro-label').toEqual([]);
  });
});

describe('feuille de styles', () => {
  it('importe les tokens avant les composants', () => {
    // Une règle de composant qui s'appliquerait avant la déclaration des
    // variables rendrait avec des valeurs vides.
    const index = readFileSync(join(STYLES, 'index.css'), 'utf8');
    const imports = [...index.matchAll(/@import\s+'([^']+)'/g)].map((match) => match[1] as string);

    expect(imports[0]).toBe('../tokens/index.css');
  });

  it('importe chaque feuille du dossier', () => {
    const index = readFileSync(join(STYLES, 'index.css'), 'utf8');
    const missing = cssFiles(STYLES)
      .map((file) => file.split(/[\\/]/).pop() as string)
      .filter((name) => name !== 'index.css')
      .filter((name) => !index.includes(`./${name}`));

    expect(missing, 'feuille jamais importée').toEqual([]);
  });
});

describe('portée du lint', () => {
  it('lit réellement les sources des applications', () => {
    // Sans cette vérification, une erreur de chemin ferait passer tous les
    // tests ci-dessus sur une liste vide.
    const files = productSources().map(label);

    expect(files.some((file) => file.startsWith('apps/www/src'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/app/src'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/admin/src'))).toBe(true);
    expect(files.some((file) => file.startsWith('packages/ui/src'))).toBe(true);
  });
});
