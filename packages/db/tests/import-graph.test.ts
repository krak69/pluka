import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Frontière serveur / navigateur, prouvée par le graphe des imports.
 *
 * `@pluka/db` expose deux points d'entrée. Celui du serveur construit le
 * client `service_role`, qui contourne la RLS ; celui du navigateur ne doit
 * jamais pouvoir y mener, même indirectement, à travers un module partagé qui
 * aurait pris une dépendance de trop (01_ARCHITECTURE §9, 03_PRIVACY_RLS §8).
 *
 * Un nommage de dossier ne prouve rien : seule la fermeture transitive des
 * imports le fait. Ce test la calcule.
 *
 * Il ne remplace pas la frontière `exports` du `package.json` — il vérifie
 * l'autre moitié : que le code derrière `./browser` est réellement clos.
 */

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(PACKAGE_ROOT, 'src');

const BROWSER_ENTRY = 'browser/index.ts';
const SERVER_ENTRY = 'server/index.ts';
const NEUTRAL_ENTRY = 'index.ts';

/**
 * Retire les commentaires, en préservant les littéraux de chaîne.
 *
 * Sans cela, un `from './x.js'` cité dans une documentation entrerait dans le
 * graphe, et le test échouerait sur une phrase.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      out += char;
      index += 1;

      while (index < source.length) {
        if (source[index] === '\\') {
          out += source[index] ?? '';
          out += source[index + 1] ?? '';
          index += 2;
          continue;
        }

        out += source[index] ?? '';
        const closed = source[index] === char;
        index += 1;
        if (closed) break;
      }

      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

const SPECIFIER_PATTERNS: readonly RegExp[] = [
  // `import … from '…'` et `export … from '…'`
  /\bfrom\s*['"]([^'"]+)['"]/g,
  // `import '…'` — import à effet de bord
  /\bimport\s*['"]([^'"]+)['"]/g,
  // `import('…')` et `require('…')`
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function specifiersOf(moduleId: string): string[] {
  const source = stripComments(readFileSync(join(SRC, moduleId), 'utf8'));
  const found = new Set<string>();

  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.add(specifier);
    }
  }

  return [...found];
}

/**
 * Résout un specifier relatif en identifiant de module.
 *
 * Les imports internes portent l'extension `.js` (résolution NodeNext) alors
 * que la source est en `.ts` : la traduction est explicite ici. Un specifier
 * non relatif — `@supabase/supabase-js`, `node:fs` — sort du paquet et n'a pas
 * à entrer dans le graphe.
 */
function resolveSpecifier(fromModuleId: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;

  const joined = posix.normalize(posix.join(posix.dirname(fromModuleId), specifier));

  return joined.endsWith('.js') ? `${joined.slice(0, -'.js'.length)}.ts` : joined;
}

function existsInSrc(moduleId: string): boolean {
  try {
    return statSync(join(SRC, moduleId)).isFile();
  } catch {
    return false;
  }
}

/** Modules atteignables, avec la chaîne d'imports qui y mène depuis l'entrée. */
function reachableFrom(entry: string): ReadonlyMap<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>([[entry, [entry]]]);
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const chain = chains.get(current) as readonly string[];

    for (const specifier of specifiersOf(current)) {
      const target = resolveSpecifier(current, specifier);
      if (target === null || chains.has(target)) continue;

      // Un import interne qui ne pointe sur aucun fichier est une erreur en
      // soi : le signaler ici évite un graphe silencieusement tronqué.
      expect(
        existsInSrc(target),
        `${current} importe ${specifier}, qui ne résout sur aucun module de src/`,
      ).toBe(true);

      chains.set(target, [...chain, target]);
      queue.push(target);
    }
  }

  return chains;
}

function allSourceModules(directory = ''): string[] {
  return readdirSync(join(SRC, directory), { withFileTypes: true }).flatMap((entry) => {
    const child = directory === '' ? entry.name : posix.join(directory, entry.name);

    if (entry.isDirectory()) return allSourceModules(child);
    return entry.name.endsWith('.ts') ? [child] : [];
  });
}

function isUnder(moduleId: string, directory: string): boolean {
  return moduleId.startsWith(`${directory}/`);
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('graphe des imports', () => {
  const browser = reachableFrom(BROWSER_ENTRY);
  const server = reachableFrom(SERVER_ENTRY);
  const neutral = reachableFrom(NEUTRAL_ENTRY);

  it('n’atteint jamais server/ depuis le point d’entrée navigateur', () => {
    const leaks = [...browser.entries()]
      .filter(([moduleId]) => isUnder(moduleId, 'server'))
      .map(([, chain]) => chain.join(' → '));

    expect(leaks, `chaîne(s) d’import fuitant vers server/ :\n${leaks.join('\n')}`).toEqual([]);
  });

  /**
   * Garde d'anti-vacuité.
   *
   * Un parcours qui ne trouverait rien passerait l'assertion précédente sans
   * rien prouver. Cette attente échoue si l'analyse casse — extension mal
   * traduite, commentaire mal retiré, motif qui ne matche plus.
   */
  it('parcourt réellement le graphe navigateur', () => {
    expect([...browser.keys()].sort()).toEqual([
      'browser/client.ts',
      'browser/index.ts',
      'browser/options.ts',
      'errors.ts',
      'generated/database.types.ts',
      'keys.ts',
      'types.ts',
      'url.ts',
    ]);
  });

  it('détecte bien un module server/ quand il y en a un', () => {
    // Preuve que le prédicat `isUnder(…, 'server')` ne rend pas faux par
    // construction : depuis l'entrée serveur, il trouve ce qu'il doit trouver.
    const serverModules = [...server.keys()].filter((moduleId) => isUnder(moduleId, 'server'));

    expect(serverModules.sort()).toEqual([
      'server/client.ts',
      'server/index.ts',
      'server/options.ts',
    ]);
  });

  it('garde le point d’entrée neutre à l’écart des deux', () => {
    const sided = [...neutral.keys()].filter(
      (moduleId) => isUnder(moduleId, 'server') || isUnder(moduleId, 'browser'),
    );

    expect(sided).toEqual([]);
  });

  it('ne laisse aucun module orphelin', () => {
    const reachable = new Set([...browser.keys(), ...server.keys(), ...neutral.keys()]);
    const orphans = allSourceModules().filter((moduleId) => !reachable.has(moduleId));

    expect(orphans, 'modules inatteignables depuis les trois points d’entrée').toEqual([]);
  });
});

describe('client de service', () => {
  it('n’est nommé dans aucun module atteignable depuis le navigateur', () => {
    const mentions = [...reachableFrom(BROWSER_ENTRY).keys()].filter((moduleId) =>
      readFileSync(join(SRC, moduleId), 'utf8').includes('createServiceRoleClient'),
    );

    expect(mentions).toEqual([]);
  });
});

describe('frontière déclarée', () => {
  it('expose les trois points d’entrée et rien d’autre', () => {
    const exportsMap = readManifest().exports as Record<string, { default: string }>;

    expect(Object.keys(exportsMap).sort()).toEqual(['.', './browser', './server']);
    expect(exportsMap['./server']?.default).toBe('./dist/server/index.js');
    expect(exportsMap['./browser']?.default).toBe('./dist/browser/index.js');
  });

  it('ne publie que dist/ : le navigateur ne peut pas contourner ./browser', () => {
    expect(readManifest().files).toEqual(['dist']);
  });
});
