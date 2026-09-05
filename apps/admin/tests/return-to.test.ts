import { describe, expect, it } from 'vitest';

import { DEFAULT_RETURN_TO, safeReturnTo } from '../src/lib/return-to.js';

/**
 * `returnTo` est la seule valeur non fiable du tunnel de connexion.
 *
 * Sans assainissement, la page de connexion devient une redirection ouverte :
 * un lien `…/connexion?returnTo=https://faux-pluka.test` renverrait
 * l'utilisateur fraîchement authentifié vers un site tiers, avec le crédit
 * d'être passé par PLUKA. D'où une batterie de cas hostiles.
 */

describe('chemins internes acceptés', () => {
  it('accepte la racine', () => {
    expect(safeReturnTo('/')).toBe('/');
  });

  it('accepte un chemin simple', () => {
    expect(safeReturnTo('/ma-saison')).toBe('/ma-saison');
  });

  it('accepte un chemin avec query et fragment', () => {
    expect(safeReturnTo('/courses/80k?onglet=plan#ravitos')).toBe(
      '/courses/80k?onglet=plan#ravitos',
    );
  });

  it('tolère les espaces autour', () => {
    expect(safeReturnTo('  /ma-saison  ')).toBe('/ma-saison');
  });
});

describe('valeurs absentes', () => {
  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['chaîne vide', ''],
    ['espaces seuls', '   '],
  ] as const) {
    it(`retombe sur la destination par défaut : ${label}`, () => {
      expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
    });
  }

  it('refuse une valeur qui n’est pas une chaîne', () => {
    expect(safeReturnTo(42 as unknown as string)).toBe(DEFAULT_RETURN_TO);
  });
});

describe('redirections ouvertes', () => {
  const hostile: readonly (readonly [string, string])[] = [
    ['URL absolue https', 'https://faux-pluka.test/piege'],
    ['URL absolue http', 'http://faux-pluka.test'],
    ['protocol-relative', '//faux-pluka.test/piege'],
    ['antislash normalisé en slash', '/\\faux-pluka.test'],
    ['schéma javascript', 'javascript:alert(1)'],
    ['schéma data', 'data:text/html,<script>alert(1)</script>'],
    ['chemin relatif', 'ma-saison'],
    ['remontée relative', '../admin'],
    ['schéma masqué en milieu de chaîne', '/redirect?next=https://faux-pluka.test'],
  ];

  for (const [label, value] of hostile) {
    it(`refuse : ${label}`, () => {
      expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
    });
  }
});

describe('caractères de contrôle', () => {
  it('refuse un saut de ligne, qui permettrait d’injecter un en-tête', () => {
    expect(safeReturnTo('/ma-saison\nLocation: https://faux-pluka.test')).toBe(DEFAULT_RETURN_TO);
  });

  it('refuse un retour chariot', () => {
    expect(safeReturnTo('/ma-saison\r\nSet-Cookie: x=1')).toBe(DEFAULT_RETURN_TO);
  });

  it('refuse une tabulation', () => {
    expect(safeReturnTo('/ma\tsaison')).toBe(DEFAULT_RETURN_TO);
  });

  it('refuse un octet nul', () => {
    expect(safeReturnTo(`/ma-saison${String.fromCharCode(0)}`)).toBe(DEFAULT_RETURN_TO);
  });

  it('refuse le caractère de suppression', () => {
    expect(safeReturnTo(`/ma-saison${String.fromCharCode(0x7f)}`)).toBe(DEFAULT_RETURN_TO);
  });

  it('accepte les accents, qui ne sont pas des caractères de contrôle', () => {
    expect(safeReturnTo('/préparation')).toBe('/préparation');
  });
});

describe('composition avec une origine', () => {
  it('reste interne une fois résolu contre l’origine', () => {
    // Le Route Handler construit `new URL(returnTo, origin)`. Ce test vérifie
    // qu'aucune valeur acceptée ne peut en sortir.
    const origin = 'https://app.pluka.run';

    for (const candidate of ['/', '/ma-saison', '/courses/80k?onglet=plan']) {
      expect(new URL(safeReturnTo(candidate), origin).origin).toBe(origin);
    }

    for (const candidate of ['https://faux-pluka.test', '//faux-pluka.test', '/\\faux.test']) {
      expect(new URL(safeReturnTo(candidate), origin).origin).toBe(origin);
    }
  });
});
