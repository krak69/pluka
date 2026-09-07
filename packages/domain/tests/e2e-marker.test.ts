import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { E2E_MARKER, e2eName, e2eSlug, isE2eSlug } from './fixtures/e2e-marker.js';

/**
 * Les mondes de test s'annoncent — et le restent.
 *
 * Les suites e2e construisent un référentiel de course réel qu'elles ne
 * peuvent pas démonter : un dépôt crée un `source_snapshot`, immuable par
 * trigger. Onze événements s'étaient ainsi accumulés dans une base de
 * développement, sous des noms — « Trail GPX », « Trail Maintenu PLUKA » — que
 * rien ne distinguait d'une vraie course.
 *
 * Le marqueur les rend reconnaissables. Ce test le rend durable : un slug
 * écrit à la main dans une suite e2e produirait un monde anonyme de plus, et
 * personne ne s'en apercevrait avant de relire la liste des événements.
 *
 * Il tourne toujours, lui — il lit des sources, pas une base.
 */

const TESTS = resolve(dirname(fileURLToPath(import.meta.url)));

function e2eSources(): readonly string[] {
  return readdirSync(TESTS).filter((name) => name.endsWith('.e2e.test.ts'));
}

function read(name: string): string {
  return readFileSync(join(TESTS, name), 'utf8');
}

/**
 * Valeurs d'un champ qui ne passent pas par leur helper.
 *
 * Le filtre est en JavaScript, pas dans l'expression : un `(?!e2eSlug\()`
 * placé après `\s*` recule d'un caractère et laisse passer exactement ce
 * qu'il devait refuser. La première version de ce test se croyait vert.
 *
 * Seuls les littéraux entre guillemets comptent : une signature de type
 * — `rpc(name: string, …)` — n'écrit rien en base.
 */
function unmarked(field: RegExp, helper: string): readonly string[] {
  return e2eSources().flatMap((name) => {
    const values = [...read(name).matchAll(field)]
      .map((match) => (match[1] as string).trim())
      .filter((value) => !value.startsWith(helper))
      .filter((value) => /^['"`]/.test(value));

    return values.length === 0 ? [] : [`${name} → ${values.join(', ')}`];
  });
}

describe('marqueur', () => {
  it('ouvre le slug, pour qu’un `like` suffise à isoler l’ensemble', () => {
    expect(e2eSlug('trail-gpx', 'abc')).toBe('e2e-test-trail-gpx-abc');
    expect(isE2eSlug(e2eSlug('quoi-que-ce-soit', 'abc'))).toBe(true);
  });

  it('préfixe le nom, pour qu’un humain le voie dans l’écran', () => {
    expect(e2eName('Trail GPX')).toBe('[e2e] Trail GPX');
  });

  it('ne reconnaît pas une vraie course', () => {
    expect(isE2eSlug('wildstrubel-by-utmb')).toBe(false);
  });
});

describe('aucune suite e2e ne crée de monde anonyme', () => {
  it('trouve les suites à surveiller', () => {
    // Sans cette borne, le test passerait en ne lisant rien.
    expect(e2eSources().length).toBeGreaterThan(0);
  });

  it('n’écrit aucun slug à la main', () => {
    // Chaque `slug:` doit passer par le helper. Un littéral produirait un
    // identifiant que rien ne signale comme jeu de test.
    expect(unmarked(/slug:\s*([^,\n]+)/g, 'e2eSlug('), 'slug non marqué').toEqual([]);
  });

  it('nomme par le helper ce qu’un écran affiche', () => {
    // Le nom est ce qu'on lit dans l'administration : c'est lui qui trompait.
    // `rpc(name: string, …)` d'une signature de type n'est pas une valeur —
    // seuls les littéraux entre guillemets sont retenus.
    expect(unmarked(/name:\s*([^,\n]+)/g, 'e2eName('), 'nom non marqué').toEqual([]);
  });

  it('emploie le marqueur là où il compte', () => {
    for (const name of e2eSources()) {
      expect(read(name), `${name} n'importe pas le marqueur`).toContain(
        "from './fixtures/e2e-marker.js'",
      );
    }
  });

  it('garde un marqueur utilisable en SQL', () => {
    // Il sert de préfixe dans un `like` : ni majuscule, ni espace, ni
    // caractère que le slug refuserait.
    expect(E2E_MARKER).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
