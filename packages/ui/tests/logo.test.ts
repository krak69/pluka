import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ACCENT_PATH,
  LOCKUP_CLEARSPACE_VIEWBOX,
  LOCKUP_MARK_TRANSFORM,
  LOCKUP_VIEWBOX,
  LOCKUP_WORDMARK_TRANSFORM,
  MARK_PATH,
  MARK_VIEWBOX,
  WORDMARK_PATH,
  WORDMARK_VIEWBOX,
} from '../src/brand/logo-paths.js';
import { Logo } from '../src/index.js';

/**
 * Le logo rendu doit être le logo officiel — 06_DESIGN_SYSTEM.md §143.
 *
 * « Ne pas redessiner le logo manuellement. » Ce test est la version
 * exécutable de cette règle : il relit les SVG de `reference/brand/logos/` et
 * compare, caractère par caractère, les tracés que le composant émet.
 *
 * Une retouche du logo doit donc arriver par les fichiers officiels. Modifier
 * `logo-paths.ts` sans eux fait échouer ces tests ; remplacer les fichiers sans
 * régénérer le module les fait échouer aussi. C'est exactement ce qu'on veut :
 * la dérive ne peut pas passer en silence.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOGOS = join(ROOT, 'reference', 'brand', 'logos');

/** Le contenu après le bloc `<metadata>` C2PA, qui n'entre pas dans le composant. */
function officialBody(name: string): string {
  const source = readFileSync(join(LOGOS, `${name}.svg`), 'utf8');
  const marker = '</metadata>';
  const index = source.indexOf(marker);

  return index < 0 ? source : source.slice(index + marker.length);
}

function officialPaths(name: string): readonly { readonly fill: string; readonly d: string }[] {
  return [...officialBody(name).matchAll(/<path\s+fill="([^"]+)"\s+d="([^"]+)"/g)].map((match) => ({
    fill: match[1] as string,
    d: match[2] as string,
  }));
}

function officialViewBox(name: string): string {
  const source = readFileSync(join(LOGOS, `${name}.svg`), 'utf8');
  const match = /viewBox="([^"]+)"/.exec(source);

  expect(match, `${name}.svg sans viewBox`).not.toBeNull();

  return (match as RegExpExecArray)[1] as string;
}

/** Les `d` émis par le composant, dans l'ordre du document. */
function renderedPaths(markup: string): readonly string[] {
  return [...markup.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] as string);
}

function renderedFills(markup: string): readonly string[] {
  return [...markup.matchAll(/fill="([^"]+)"/g)].map((match) => match[1] as string);
}

function renderedViewBox(markup: string): string {
  const match = /viewBox="([^"]+)"/.exec(markup);

  expect(match, 'rendu sans viewBox').not.toBeNull();

  return (match as RegExpExecArray)[1] as string;
}

describe('tracés extraits', () => {
  it('reprend le symbole du fichier officiel, caractère par caractère', () => {
    expect(MARK_PATH).toBe(officialPaths('pluka-mark-foret')[0]?.d);
  });

  it('reprend les lettres et l’accent du fichier officiel', () => {
    const official = officialPaths('pluka-wordmark-foret');

    expect(WORDMARK_PATH).toBe(official[0]?.d);
    expect(ACCENT_PATH).toBe(official[1]?.d);
  });

  it('reprend les viewBox officiels sans les arrondir', () => {
    // `272 75 672.6 110.80000000000001` : la valeur est étrange, elle est
    // officielle. L'arrondir décalerait le mot.
    expect(MARK_VIEWBOX).toBe(officialViewBox('pluka-mark-foret'));
    expect(WORDMARK_VIEWBOX).toBe(officialViewBox('pluka-wordmark-foret'));
    expect(LOCKUP_VIEWBOX).toBe(officialViewBox('pluka-logo-primary'));
    expect(LOCKUP_CLEARSPACE_VIEWBOX).toBe(officialViewBox('pluka-logo-on-calcaire'));
  });

  it('reprend le calage du lockup', () => {
    const transforms = [
      ...officialBody('pluka-logo-primary').matchAll(/<g\s+transform="([^"]+)"/g),
    ].map((match) => match[1] as string);

    expect(LOCKUP_MARK_TRANSFORM).toBe(transforms[0]);
    expect(LOCKUP_WORDMARK_TRANSFORM).toBe(transforms[1]);
  });

  it('emploie le même dessin dans le lockup et dans les fichiers isolés', () => {
    // Le lockup n'est pas un second dessin : c'est le symbole et le mot,
    // calés. Si les fichiers divergeaient un jour, le composant ne pourrait
    // plus les partager.
    const lockup = officialPaths('pluka-logo-primary');

    expect(lockup[0]?.d).toBe(MARK_PATH);
    expect(lockup[1]?.d).toBe(WORDMARK_PATH);
    expect(lockup[2]?.d).toBe(ACCENT_PATH);
  });

  it('n’emporte aucune métadonnée C2PA', () => {
    /*
     * Le manifeste atteste la provenance d'un fichier, pas d'un composant.
     *
     * La vérification porte sur le code, commentaires retirés : l'en-tête du
     * module parle justement de C2PA pour dire qu'il ne le reprend pas, et une
     * recherche naïve y verrait une infraction.
     */
    const module = readFileSync(
      join(ROOT, 'packages', 'ui', 'src', 'brand', 'logo-paths.ts'),
      'utf8',
    );
    const code = module.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code.toLowerCase()).not.toContain('c2pa');
    expect(code).not.toContain('metadata');
    expect(code).not.toContain('<');

    // Le contrôle n'a de valeur que si les fichiers officiels en portent, eux.
    expect(readFileSync(join(LOGOS, 'pluka-logo-primary.svg'), 'utf8')).toContain('c2pa');
  });
});

describe('Logo — rendu', () => {
  it('rend le lockup par défaut, avec ses trois tracés dans l’ordre', () => {
    const markup = renderToStaticMarkup(Logo({}));

    expect(renderedPaths(markup)).toEqual([MARK_PATH, WORDMARK_PATH, ACCENT_PATH]);
    expect(renderedViewBox(markup)).toBe(LOCKUP_VIEWBOX);
  });

  it('rend le symbole seul', () => {
    const markup = renderToStaticMarkup(Logo({ variant: 'mark' }));

    expect(renderedPaths(markup)).toEqual([MARK_PATH]);
    expect(renderedViewBox(markup)).toBe(MARK_VIEWBOX);
  });

  it('rend le mot et son accent', () => {
    const markup = renderToStaticMarkup(Logo({ variant: 'wordmark' }));

    expect(renderedPaths(markup)).toEqual([WORDMARK_PATH, ACCENT_PATH]);
    expect(renderedViewBox(markup)).toBe(WORDMARK_VIEWBOX);
  });

  it('élargit le viewBox pour les déclinaisons « on- »', () => {
    // La zone de respect est dans le fichier, pas dans une marge CSS.
    expect(renderedViewBox(renderToStaticMarkup(Logo({ tone: 'on-calcaire' })))).toBe(
      LOCKUP_CLEARSPACE_VIEWBOX,
    );
    expect(renderedViewBox(renderToStaticMarkup(Logo({ tone: 'primary' })))).toBe(LOCKUP_VIEWBOX);
  });
});

describe('Logo — couleurs', () => {
  it('n’émet jamais une couleur littérale', () => {
    // §139 : les couleurs vivent dans `tokens/`. Un `#14342C` rendu ici
    // signifierait que le composant a recopié la valeur du fichier.
    const tones = [
      'primary',
      'inverse',
      'lichen',
      'mono-ardoise',
      'mono-calcaire',
      'mono-foret',
      'on-ardoise',
      'on-calcaire',
      'on-lichen',
      'current',
    ] as const;

    for (const tone of tones) {
      const markup = renderToStaticMarkup(Logo({ tone }));

      expect(markup, `lockup ${tone}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);

      for (const fill of renderedFills(markup)) {
        expect(fill, `lockup ${tone}`).toMatch(/^(var\(--pk-[a-z-]+\)|currentColor)$/);
      }
    }
  });

  /**
   * Chaque déclinaison doit porter les encres de son fichier.
   *
   * La comparaison passe par la table hex → token : le composant n'écrit pas
   * de hex, mais il doit décrire la même couleur que le fichier officiel.
   * Sans ce test, une déclinaison pourrait être colorée de travers sans que
   * rien ne le dise.
   */
  const TOKEN_OF_HEX: Readonly<Record<string, string>> = {
    '#14342C': 'var(--pk-forest)',
    '#FF6A3D': 'var(--pk-dawn)',
    '#C6F24E': 'var(--pk-lichen)',
    '#F2F0E9': 'var(--pk-limestone)',
    '#0E1A17': 'var(--pk-ink)',
  };

  const LOCKUPS: readonly (readonly [string, string])[] = [
    ['primary', 'pluka-logo-primary'],
    ['inverse', 'pluka-logo-inverse'],
    ['lichen', 'pluka-logo-lichen'],
    ['mono-ardoise', 'pluka-logo-mono-ardoise'],
    ['mono-calcaire', 'pluka-logo-mono-calcaire'],
    ['mono-foret', 'pluka-logo-mono-foret'],
    ['on-ardoise', 'pluka-logo-on-ardoise'],
    ['on-calcaire', 'pluka-logo-on-calcaire'],
    ['on-lichen', 'pluka-logo-on-lichen'],
  ];

  for (const [tone, file] of LOCKUPS) {
    it(`colore le lockup « ${tone} » comme ${file}.svg`, () => {
      const expected = officialPaths(file).map((path) => TOKEN_OF_HEX[path.fill]);
      const markup = renderToStaticMarkup(
        Logo({ tone: tone as Parameters<typeof Logo>[0] extends never ? never : never }),
      );

      expect(expected).not.toContain(undefined);
      expect(renderedFills(markup)).toEqual(expected);
    });
  }

  const MARKS: readonly (readonly [string, string])[] = [
    ['foret', 'pluka-mark-foret'],
    ['ardoise', 'pluka-mark-ardoise'],
    ['calcaire', 'pluka-mark-calcaire'],
    ['lichen', 'pluka-mark-lichen'],
  ];

  for (const [tone, file] of MARKS) {
    it(`colore le symbole « ${tone} » comme ${file}.svg`, () => {
      const expected = officialPaths(file).map((path) => TOKEN_OF_HEX[path.fill]);
      const markup = renderToStaticMarkup(
        Logo({ variant: 'mark', tone } as Parameters<typeof Logo>[0]),
      );

      expect(expected).not.toContain(undefined);
      expect(renderedFills(markup)).toEqual(expected);
    });
  }

  const WORDMARKS: readonly (readonly [string, string])[] = [
    ['foret', 'pluka-wordmark-foret'],
    ['calcaire', 'pluka-wordmark-calcaire'],
    ['mono-ardoise', 'pluka-wordmark-mono-ardoise'],
  ];

  for (const [tone, file] of WORDMARKS) {
    it(`colore le mot « ${tone} » comme ${file}.svg`, () => {
      const expected = officialPaths(file).map((path) => TOKEN_OF_HEX[path.fill]);
      const markup = renderToStaticMarkup(
        Logo({ variant: 'wordmark', tone } as Parameters<typeof Logo>[0]),
      );

      expect(expected).not.toContain(undefined);
      expect(renderedFills(markup)).toEqual(expected);
    });
  }

  it('couvre toutes les déclinaisons livrées', () => {
    // Sans ce compte, un nouveau fichier déposé dans `reference/` resterait
    // invisible : le composant ne l'offrirait pas, et rien ne le signalerait.
    const files = readdirSync(LOGOS)
      .filter((name) => name.endsWith('.svg'))
      .filter((name) => name !== 'pluka-sprite.svg')
      .map((name) => name.replace(/\.svg$/, ''));

    const covered = [...LOCKUPS, ...MARKS, ...WORDMARKS].map(([, file]) => file);

    expect([...files].sort()).toEqual([...covered].sort());
  });
});

describe('favicons générés', () => {
  /**
   * Les trois applications servent le symbole officiel.
   *
   * `apps/*\/src/app/icon.svg` est un fichier généré depuis
   * `pluka-mark-foret.svg`. Sans ce test, une retouche du logo laisserait
   * trois favicons périmés que personne ne penserait à regarder.
   */
  const APPS = ['www', 'app', 'admin'] as const;

  for (const app of APPS) {
    it(`apps/${app} sert le tracé officiel du symbole`, () => {
      const icon = readFileSync(join(ROOT, 'apps', app, 'src', 'app', 'icon.svg'), 'utf8');
      const path = /<path[^>]*\sd="([^"]+)"/.exec(icon);

      expect(path, `apps/${app}/src/app/icon.svg sans tracé`).not.toBeNull();
      expect((path as RegExpExecArray)[1]).toBe(MARK_PATH);
      expect(icon).toContain(`viewBox="${MARK_VIEWBOX}"`);
    });

    it(`apps/${app} n’emploie que les deux déclinaisons officielles du symbole`, () => {
      /*
       * Un favicon est rendu hors du document : aucune variable CSS n'y est
       * résolue, donc les couleurs y sont littérales. C'est la seule exception
       * assumée à §139, et elle est bornée — les deux valeurs doivent être
       * exactement celles de `pluka-mark-foret.svg` et `pluka-mark-lichen.svg`.
       */
      const icon = readFileSync(join(ROOT, 'apps', app, 'src', 'app', 'icon.svg'), 'utf8');
      const declared = [...icon.matchAll(/fill:\s*(#[0-9A-Fa-f]{6})/g)].map(
        (match) => match[1] as string,
      );

      const forest = officialPaths('pluka-mark-foret')[0]?.fill;
      const lichen = officialPaths('pluka-mark-lichen')[0]?.fill;

      expect(declared).toEqual([forest, lichen]);
    });

    it(`apps/${app} ne recopie pas le manifeste C2PA`, () => {
      /*
       * Le manifeste atteste un fichier précis ; celui-ci n'est pas celui-là.
       *
       * Les commentaires XML sont retirés avant le contrôle : l'en-tête du
       * fichier généré parle justement de C2PA pour dire qu'il ne le reprend
       * pas, et une recherche naïve y verrait une infraction.
       */
      const icon = readFileSync(join(ROOT, 'apps', app, 'src', 'app', 'icon.svg'), 'utf8');
      const markup = icon.replace(/<!--[\s\S]*?-->/g, '');

      expect(markup).not.toContain('metadata');
      expect(markup.toLowerCase()).not.toContain('c2pa');
    });
  }
});

describe('Logo — accessibilité', () => {
  it('s’annonce « PLUKA » par défaut, comme les fichiers officiels', () => {
    const markup = renderToStaticMarkup(Logo({}));

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="PLUKA"');
    expect(readFileSync(join(LOGOS, 'pluka-logo-primary.svg'), 'utf8')).toContain(
      'aria-label="PLUKA"',
    );
  });

  it('se retire de l’arbre quand il est décoratif', () => {
    // §101 : un logo répété dans la même page — en-tête et pied — n'a pas à
    // être annoncé deux fois.
    const markup = renderToStaticMarkup(Logo({ decorative: true }));

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="img"');
  });

  it('n’est jamais focusable', () => {
    // Un `<svg>` reçoit le focus sous IE/Edge héritées ; l'attribut le retire
    // sans ajouter de piège au parcours clavier (§104).
    expect(renderToStaticMarkup(Logo({}))).toContain('focusable="false"');
  });
});
