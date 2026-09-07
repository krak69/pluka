import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Le worker et son environnement — 01_ARCHITECTURE §4.4, §38.
 *
 * « Processus Node.js durable » : il ne rend aucune page, ne sert aucune
 * requête HTTP, et n'a donc aucune raison de connaître une variable
 * `NEXT_PUBLIC_*` — préfixe qui ne veut dire qu'une chose : « Next inline
 * cette valeur dans le bundle navigateur ».
 *
 * Il en validait pourtant cinq, par `loadPublicEnv`, et refusait de démarrer
 * sur l'absence de `NEXT_PUBLIC_ADMIN_URL`. Ces tests relisent la contrainte
 * dans les sources plutôt que de compter sur la discipline de revue : c'est
 * une règle facile à réintroduire d'un `process.env.NEXT_PUBLIC_…` glissé dans
 * un port.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(directory = ''): readonly string[] {
  return readdirSync(join(SRC, directory), { withFileTypes: true }).flatMap((entry) => {
    const child = directory === '' ? entry.name : posix.join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

function read(moduleId: string): string {
  return readFileSync(join(SRC, moduleId), 'utf8');
}

/** Retire les commentaires : expliquer la règle n'est pas l'enfreindre. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('contrat d’environnement', () => {
  it('ne lit aucune variable `NEXT_PUBLIC_*`', () => {
    const offenders = sourceFiles().flatMap((moduleId) => {
      const found = withoutComments(read(moduleId)).match(/NEXT_PUBLIC_[A-Z_]+/g);
      return found === null ? [] : [`${moduleId} → ${[...new Set(found)].join(', ')}`];
    });

    expect(offenders, 'variable de navigateur lue par le worker').toEqual([]);
  });

  it('ne valide pas le contrat public', () => {
    // `loadPublicEnv` impose les cinq variables du navigateur. C'est l'appel
    // qui faisait échouer le démarrage.
    const offenders = sourceFiles().filter((moduleId) =>
      /loadPublicEnv|publicEnvSchema/.test(withoutComments(read(moduleId))),
    );

    expect(offenders).toEqual([]);
  });

  it('lit sa configuration en un seul endroit', () => {
    // Une valeur de configuration lue au fond d'un port est une valeur qu'on
    // ne peut ni tester ni auditer — et c'est ainsi que
    // `NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'` avait pris place dans
    // la fabrique de ports.
    const offenders = sourceFiles()
      .filter((moduleId) => /\bprocess\.env\b/.test(withoutComments(read(moduleId))))
      .filter((moduleId) => moduleId !== 'main.ts')
      // `createAI` et `createEmail` reçoivent une source d'environnement en
      // paramètre : leur passer `process.env` est du câblage, pas une lecture
      // implicite, et les providers restent facultatifs par construction.
      .filter((moduleId) => moduleId !== 'ports-supabase.ts');

    expect(offenders, 'configuration lue hors du point d’entrée').toEqual([]);
  });

  it('ne fabrique aucune valeur de configuration par défaut', () => {
    // AGENTS §38 : une brique dont la configuration manque doit le dire, pas
    // deviner. Un lien vers `localhost` parti en production ne se voit pas.
    const offenders = sourceFiles().flatMap((moduleId) => {
      const found = withoutComments(read(moduleId)).match(/\?\?\s*'https?:\/\/[^']*'/g);
      return found === null ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'URL par défaut fabriquée').toEqual([]);
  });

  it('déclare son environnement de développement à côté de lui', () => {
    // Le script `dev` pointait vers `../../.env.local`, le fichier de la
    // racine — qui ne porte pas les mêmes variables que celui du worker, et
    // dont le chemin relatif dépend du répertoire courant.
    const manifest = readFileSync(join(SRC, '..', 'package.json'), 'utf8');
    const dev = (JSON.parse(manifest) as { scripts: Record<string, string> }).scripts['dev'];

    expect(dev).toContain('--env-file=.env.local');
    expect(dev).not.toContain('..');
  });
});
