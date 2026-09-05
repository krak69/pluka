import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  brandColors,
  contentWidth,
  focusColors,
  fontFamily,
  functionalColors,
  motion,
  radius,
  signalColors,
  spacing,
  textColors,
  zIndex,
} from '../src/index.js';

/**
 * Le miroir TypeScript des tokens ne doit pas devenir une seconde vérité.
 *
 * `tokens/*.css` est ce que le navigateur applique ; `tokens.ts` sert aux
 * usages qui ne peuvent pas lire une variable CSS. Ces tests relisent le CSS
 * et comparent, pour qu'une valeur corrigée d'un seul côté échoue ici plutôt
 * que de diverger en silence (06_DESIGN_SYSTEM.md §113).
 */

const TOKENS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tokens');

/**
 * Retire les blocs `@media`, accolades appariées comprises.
 *
 * Sans cela, l'override `prefers-reduced-motion` — déclaré après la valeur de
 * base — écraserait celle-ci dans la lecture, et le test comparerait le
 * miroir TypeScript à une durée réduite. Ce qui se compare ici, c'est la
 * valeur de base.
 */
function withoutMediaBlocks(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const media = source.indexOf('@media', index);
    if (media < 0) {
      out += source.slice(index);
      break;
    }

    out += source.slice(index, media);

    const open = source.indexOf('{', media);
    if (open < 0) break;

    let depth = 0;
    let cursor = open;

    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    index = cursor + 1;
  }

  return out;
}

function cssVariables(file: string): ReadonlyMap<string, string> {
  const source = withoutMediaBlocks(readFileSync(join(TOKENS, file), 'utf8'));
  const found = new Map<string, string>();

  // Les déclarations sont simples par construction : `--nom: valeur;`.
  for (const match of source.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) found.set(name, value.trim());
  }

  return found;
}

describe('couleurs', () => {
  const css = cssVariables('colors.css');

  const brand: readonly (readonly [string, string])[] = [
    ['--pk-ink', brandColors.ink],
    ['--pk-forest', brandColors.forest],
    ['--pk-lichen', brandColors.lichen],
    ['--pk-lichen-deep', brandColors.lichenDeep],
    ['--pk-lichen-active', brandColors.lichenActive],
    ['--pk-dawn', brandColors.dawn],
    ['--pk-dawn-ink', brandColors.dawnInk],
    ['--pk-glacier', brandColors.glacier],
    ['--pk-glacier-bg', brandColors.glacierBg],
    ['--pk-limestone', brandColors.limestone],
    ['--pk-surface', brandColors.surface],
    ['--pk-sand', brandColors.sand],
    ['--pk-hairline', brandColors.hairline],
    ['--pk-granite', brandColors.granite],
    ['--pk-text', textColors.text],
    ['--pk-text-secondary', textColors.secondary],
    ['--pk-text-muted', textColors.muted],
    ['--pk-text-on-dark', textColors.onDark],
    ['--pk-success-signal', signalColors.success],
    ['--pk-warning-signal', signalColors.warning],
    ['--pk-error-signal', signalColors.error],
    ['--pk-success', functionalColors.success],
    ['--pk-warning', functionalColors.warning],
    ['--pk-error', functionalColors.error],
    ['--pk-success-bg', functionalColors.successBg],
    ['--pk-warning-bg', functionalColors.warningBg],
    ['--pk-error-bg', functionalColors.errorBg],
    ['--pk-focus-light', focusColors.light],
    ['--pk-focus-dark', focusColors.dark],
  ];

  for (const [variable, mirrored] of brand) {
    it(`${variable} est identique en CSS et en TypeScript`, () => {
      expect(css.get(variable)).toBe(mirrored);
    });
  }

  it('n’expose aucune couleur que le miroir ignore', () => {
    const mirrored = new Set(brand.map(([variable]) => variable));
    const orphans = [...css.keys()].filter((variable) => !mirrored.has(variable));

    expect(orphans, 'token CSS absent de tokens.ts').toEqual([]);
  });

  /**
   * §4.1 : la palette canonique tient en huit couleurs de marque. Ce test
   * échoue si une neuvième apparaît sans passer par le Design System (§139).
   */
  it('conserve les huit couleurs de la Charte', () => {
    expect([
      brandColors.ink,
      brandColors.forest,
      brandColors.lichen,
      brandColors.dawn,
      brandColors.glacier,
      brandColors.limestone,
      brandColors.sand,
      brandColors.granite,
    ]).toEqual([
      '#0e1a17',
      '#14342c',
      '#c6f24e',
      '#ff6a3d',
      '#9ae0d6',
      '#f2f0e9',
      '#e4e1d6',
      '#6f7a74',
    ]);
  });
});

describe('typographie', () => {
  const css = cssVariables('typography.css');

  it('déclare les trois familles de la Charte', () => {
    expect(css.get('--font-heading')).toBe(fontFamily.heading);
    expect(css.get('--font-body')).toBe(fontFamily.body);
    expect(css.get('--font-mono')).toBe(fontFamily.mono);
  });

  it('donne à chaque pile un fallback système', () => {
    // §115 : la police est chargée par l'application. Sans repli, un échec de
    // chargement rendrait la page dans la police par défaut du navigateur.
    for (const stack of Object.values(fontFamily)) {
      expect(stack.split(',').length).toBeGreaterThan(1);
    }
  });

  it('ne charge aucune police depuis le paquet', () => {
    // §114 : ni `@import` Google Fonts runtime, ni fichier committé.
    const source = readFileSync(join(TOKENS, 'typography.css'), 'utf8');

    expect(source).not.toContain('@font-face');
    expect(source).not.toMatch(/@import\s+url/);
  });
});

describe('rayons', () => {
  const css = cssVariables('radius.css');

  it('reflète le miroir TypeScript', () => {
    expect(css.get('--radius-sm')).toBe(radius.sm);
    expect(css.get('--radius-md')).toBe(radius.md);
    expect(css.get('--radius-lg')).toBe(radius.lg);
  });

  it('ne dépasse jamais 3 px', () => {
    // §17 : « pas de grosses cartes arrondies ». 12, 16 et 24 px sont
    // interdits par défaut — aucun token ne doit les rendre accessibles.
    for (const value of Object.values(radius)) {
      expect(Number.parseInt(value, 10)).toBeLessThanOrEqual(3);
    }
  });
});

describe('espacement et largeurs', () => {
  const css = cssVariables('spacing.css');

  it('reflète le miroir TypeScript', () => {
    for (const [step, value] of Object.entries(spacing)) {
      expect(css.get(`--space-${step}`)).toBe(value);
    }

    expect(css.get('--content-wide')).toBe(contentWidth.wide);
    expect(css.get('--content-main')).toBe(contentWidth.main);
    expect(css.get('--content-reading')).toBe(contentWidth.reading);
  });

  it('reste sur une grille de 4 px', () => {
    // §20 : convention d'implémentation V1.
    for (const value of Object.values(spacing)) {
      expect(Number.parseInt(value, 10) % 4).toBe(0);
    }
  });
});

describe('motion', () => {
  const css = cssVariables('motion.css');

  it('reflète le miroir TypeScript', () => {
    expect(css.get('--motion-interaction')).toBe(motion.interaction);
    expect(css.get('--motion-panel')).toBe(motion.panel);
    expect(css.get('--motion-ease')).toBe(motion.ease);
  });

  it('reste dans les durées recommandées', () => {
    // §99 : 120–180 ms pour une interaction locale, 200–280 ms pour un panel.
    expect(Number.parseInt(motion.interaction, 10)).toBeGreaterThanOrEqual(120);
    expect(Number.parseInt(motion.interaction, 10)).toBeLessThanOrEqual(180);
    expect(Number.parseInt(motion.panel, 10)).toBeGreaterThanOrEqual(200);
    expect(Number.parseInt(motion.panel, 10)).toBeLessThanOrEqual(280);
  });

  it('prévoit le mode réduit', () => {
    // §100 : les animations non essentielles disparaissent.
    const source = readFileSync(join(TOKENS, 'motion.css'), 'utf8');

    expect(source).toContain('prefers-reduced-motion: reduce');
  });

  it('y raccourcit les durées sans les annuler', () => {
    // Une durée nulle empêche certains navigateurs d'émettre `transitionend` :
    // un composant qui attend cet événement resterait bloqué. Le mode réduit
    // supprime la perception du mouvement, pas le cycle de vie de la
    // transition.
    const source = readFileSync(join(TOKENS, 'motion.css'), 'utf8');
    const reduced = source.slice(source.indexOf('prefers-reduced-motion'));

    const durations = [...reduced.matchAll(/--motion-[a-z]+:\s*([^;]+);/g)].map((match) =>
      (match[1] as string).trim(),
    );

    expect(durations.length).toBeGreaterThan(0);
    for (const duration of durations) {
      expect(Number.parseFloat(duration)).toBeGreaterThan(0);
      expect(Number.parseFloat(duration)).toBeLessThanOrEqual(1);
    }
  });
});

describe('plans d’empilement', () => {
  const css = cssVariables('layers.css');

  it('reflète le miroir TypeScript', () => {
    for (const [name, value] of Object.entries(zIndex)) {
      expect(css.get(`--layer-${name}`)).toBe(String(value));
    }
  });

  it('reste ordonné du fond vers le toast', () => {
    // §159 : l'ordre est le contrat. Un toast sous une modale serait invisible.
    const order = [
      zIndex.base,
      zIndex.sticky,
      zIndex.dropdown,
      zIndex.overlay,
      zIndex.modal,
      zIndex.toast,
    ];

    expect(order).toEqual([...order].sort((left, right) => left - right));
  });
});

describe('point d’entrée des tokens', () => {
  it('importe chaque fichier source', () => {
    // §113 : la liste des fichiers est le contrat d'organisation. Un fichier
    // créé mais jamais importé serait du style mort.
    const index = readFileSync(join(TOKENS, 'index.css'), 'utf8');

    for (const file of ['colors', 'typography', 'radius', 'spacing', 'motion', 'layers']) {
      expect(index).toContain(`./${file}.css`);
    }
  });
});
