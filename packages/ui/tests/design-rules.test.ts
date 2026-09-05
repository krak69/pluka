import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fous de design, appliqués au CSS du paquet.
 *
 * §138 recommande d'ajouter progressivement un lint design : tokens plutôt
 * qu'hex arbitraires, pas de gros rayons, pas d'ombres non tokenisées. Ces
 * tests en sont la version minimale — ils lisent les feuilles de styles et
 * échouent sur une dérive, sans outillage supplémentaire.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const STYLES = join(SRC, 'styles');
const TOKENS = join(SRC, 'tokens');

function cssFiles(directory: string): readonly string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(directory, name));
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('couleurs', () => {
  it('n’écrit aucun hex hors des fichiers de tokens', () => {
    // §139 : le code de production ne doit pas contenir des dizaines de
    // `#13AB42`. Les couleurs vivent dans `tokens/`, les styles les
    // consomment par `var(--pk-*)`.
    const offenders = cssFiles(STYLES).flatMap((file) => {
      const found = withoutComments(readFileSync(file, 'utf8')).match(/#[0-9a-fA-F]{3,8}\b/g);
      return found === null ? [] : [`${file.split(/[\\/]/).pop() ?? file} → ${found.join(', ')}`];
    });

    expect(offenders, 'hex arbitraire hors de tokens/').toEqual([]);
  });

  it('n’emploie que des tokens PLUKA déclarés', () => {
    const declared = new Set(
      [...readFileSync(join(TOKENS, 'colors.css'), 'utf8').matchAll(/(--pk-[a-z0-9-]+)\s*:/g)].map(
        (match) => match[1] as string,
      ),
    );

    const used = new Set(
      cssFiles(STYLES).flatMap((file) =>
        [...withoutComments(readFileSync(file, 'utf8')).matchAll(/var\((--pk-[a-z0-9-]+)\)/g)].map(
          (match) => match[1] as string,
        ),
      ),
    );

    const unknown = [...used].filter((token) => !declared.has(token));

    expect(unknown, 'token couleur utilisé mais jamais déclaré').toEqual([]);
  });
});

describe('rayons', () => {
  it('ne dépasse jamais 3 px', () => {
    // §17 : direction volontairement anguleuse. `border-radius: 50%` reste
    // admis pour une pastille ronde, qui n'est pas une carte.
    const offenders = cssFiles(STYLES).flatMap((file) => {
      const source = withoutComments(readFileSync(file, 'utf8'));

      return [...source.matchAll(/border-radius:\s*([^;]+);/g)]
        .map((match) => (match[1] as string).trim())
        .filter((value) => {
          if (value === '50%' || value === '0' || value.startsWith('var(')) return false;
          const pixels = Number.parseInt(value, 10);
          return Number.isNaN(pixels) || pixels > 3;
        })
        .map((value) => `${file.split(/[\\/]/).pop() ?? file} → ${value}`);
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
    for (const file of cssFiles(STYLES)) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      if (!/outline:\s*none/.test(source)) continue;

      expect(source, `${file} supprime l'outline sans le remplacer`).toMatch(
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
