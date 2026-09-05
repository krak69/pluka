import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * « Les use cases de packages/domain uniquement, aucune requête SQL directe
 * depuis l'application. »
 *
 * Cette contrainte est facile à énoncer et facile à perdre : il suffit d'un
 * `db.from('races')` glissé dans un écran pour contourner les autorisations
 * de §4.1 tout en restant parfaitement fonctionnel. Ces tests la relisent
 * dans les sources plutôt que de compter sur la discipline de revue.
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

/** Retire les commentaires : une explication n'est pas une requête. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('aucune requête directe', () => {
  it('n’appelle jamais .from() sur un client', () => {
    // Le point d'entrée de PostgREST. Son absence prouve qu'aucun écran ne
    // construit sa propre lecture.
    const offenders = sourceFiles().filter((moduleId) =>
      /\.from\s*\(/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'requête PostgREST dans l’application').toEqual([]);
  });

  it('n’appelle ni rpc(), ni select(), ni insert(), ni update()', () => {
    const offenders = sourceFiles().filter((moduleId) =>
      /\.(rpc|select|insert|upsert|delete)\s*\(/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'verbe de requête dans l’application').toEqual([]);
  });

  it('n’importe aucun helper de requête de @pluka/db', () => {
    // `selectColumns` et `unwrap` sont les outils d'un repository. Les voir
    // ici signifierait que l'application en écrit un.
    const offenders = sourceFiles().filter((moduleId) =>
      /\b(selectColumns|unwrapMaybe|unwrap)\b/.test(withoutComments(read(moduleId))),
    );

    expect(offenders).toEqual([]);
  });

  it('ne connaît aucun nom de table', () => {
    const tables = [
      'races',
      'editions',
      'events',
      'organization_members',
      'race_status_transitions',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = tables.filter((table) => new RegExp(`['"\`]${table}['"\`]`).test(source));
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'nom de table cité dans l’application').toEqual([]);
  });
});

describe('accès aux données', () => {
  it('ne construit un client que dans la couche lib', () => {
    // `createCourseRepositories` a besoin d'un client : c'est du câblage, pas
    // une requête. Il reste confiné à `lib/`, hors des écrans.
    const offenders = sourceFiles()
      .filter((moduleId) =>
        /createDataClient|createCourseRepositories/.test(withoutComments(read(moduleId))),
      )
      .filter((moduleId) => !moduleId.startsWith('lib/'));

    expect(offenders, 'client de données construit hors de lib/').toEqual([]);
  });

  it('n’emploie jamais de clé de service', () => {
    // 03_PRIVACY_RLS §8 : `service_role` ne vit pas dans une application web.
    //
    // Le test porte sur le code, commentaires retirés : expliquer en prose
    // pourquoi cette clé n'est pas lue est précisément ce qu'on veut voir
    // dans `lib/env.ts`, pas une infraction.
    const offenders = sourceFiles().filter((moduleId) =>
      /SERVICE_ROLE|createServiceRoleClient|secretKey/.test(withoutComments(read(moduleId))),
    );

    expect(offenders).toEqual([]);
  });
});

describe('autorisations', () => {
  it('ne réimplémente aucune règle de §4.1', () => {
    // Les transitions et leurs autorités vivent dans `@pluka/domain`. Un
    // `if (status === 'published')` ici serait une seconde vérité, qui
    // finirait par diverger de la table.
    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const suspicious = /platformRole\s*===|platform_role\s*===|=== 'pluka_admin'/.test(source);
      return suspicious ? [moduleId] : [];
    });

    expect(offenders, 'rôle testé dans l’application plutôt que dans le domaine').toEqual([]);
  });

  it('passe par les use cases du domaine dans chaque écran de données', () => {
    // Contrepartie des tests d'absence : vérifie que les écrans consomment
    // bien le domaine, plutôt que d'être vides.
    const screens = [
      'app/page.tsx',
      'app/evenements/[eventId]/page.tsx',
      'app/courses/[raceId]/page.tsx',
    ];

    for (const screen of screens) {
      expect(read(screen), `${screen} n'importe pas @pluka/domain`).toContain(
        "from '@pluka/domain'",
      );
    }
  });
});
