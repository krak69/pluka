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
      'race_facts',
      'race_fact_versions',
      'fact_candidates',
      'fact_candidate_evidence',
      'fact_sources',
      'sources',
      'source_snapshots',
      'race_course_geometries',
      'race_course_micro_segments',
      'race_waypoints',
      'race_segments',
      'race_cutoffs',
      'ingestion_jobs',
      'outbox_events',
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
      'app/courses/[raceId]/revue/page.tsx',
      'app/courses/[raceId]/gpx-import-status.tsx',
      'app/courses/[raceId]/waypoints-form.tsx',
    ];

    for (const screen of screens) {
      expect(read(screen), `${screen} n'importe pas @pluka/domain`).toContain(
        "from '@pluka/domain'",
      );
    }
  });
});

describe('fonctions SQL', () => {
  it('n’appelle aucune fonction de publication par son nom', () => {
    // Les fonctions de la migration 0012 sont la surface du repository, pas
    // celle de l'application. Les voir ici signifierait que l'écran a
    // court-circuité `@pluka/domain` — et donc ses invariants de §31 et §38.
    const functions = [
      'publish_fact_candidate',
      'decide_fact_candidate',
      'list_fact_candidates_for_review',
      'get_fact_candidate_scope',
      'list_fact_publication_acts',
      // 0008 et 0023 : le dépôt d'un GPX et la lecture de son état passent par
      // `@pluka/domain`, jamais par un appel nommé depuis un écran.
      'enqueue_race_gpx',
      'get_race_gpx_import',
      'get_course_preprocessing_input',
      // 0025 : la réécriture du référentiel de parcours est atomique côté
      // base. Un écran qui l'appellerait par son nom aurait court-circuité les
      // invariants de chaîne de PLAN_ENGINE §7.
      'set_race_waypoints',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = functions.filter((name) => source.includes(name));
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'fonction SQL appelée depuis l’application').toEqual([]);
  });
});

describe('référentiel de parcours', () => {
  it('ne dérive aucun segment dans l’application', () => {
    // Les segments sont les intervalles entre waypoints consécutifs, et
    // `set_race_waypoints` les produit. Les recalculer ici créerait une
    // seconde vérité, qui divergerait de celle que le moteur relit (§7.5).
    const offenders = sourceFiles().filter((moduleId) =>
      /fromWaypointId|toWaypointId|segment_type/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'segment construit dans l’application').toEqual([]);
  });

  it('ne fabrique aucun rang de waypoint', () => {
    // L'ordre du document fait le rang. Un `sortOrder` calculé côté écran
    // serait une seconde façon d'exprimer l'ordre — et la première à diverger.
    const offenders = sourceFiles().filter((moduleId) =>
      /sortOrder\s*[:=]|sort_order/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'rang calculé dans l’application').toEqual([]);
  });
});

describe('stockage', () => {
  it('n’atteint jamais le Storage directement', () => {
    // Déposer un fichier est une écriture. Elle passe par le repository de
    // `@pluka/db`, sous la policy du bucket — l'application ne construit ni
    // requête, ni transfert.
    const offenders = sourceFiles().filter((moduleId) =>
      /\.storage|\.from\(['"`]race-sources/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'accès Storage depuis l’application').toEqual([]);
  });

  it('ne nomme ni le bucket ni un chemin d’objet', () => {
    // Le chemin `races/<race_id>/gpx/<hash>.gpx` est une donnée
    // d'autorisation : la policy de 0023 en extrait l'épreuve. Le composer
    // dans un écran mettrait cette règle à deux endroits, et le second
    // finirait par produire un chemin que la base refuse sans dire pourquoi.
    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = ['race-sources', 'raceGpxStoragePath', 'RACE_SOURCES_BUCKET'].filter((name) =>
        source.includes(name),
      );
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'chemin de stockage construit dans l’application').toEqual([]);
  });

  it('ne calcule aucune empreinte hors des Server Actions', () => {
    // L'empreinte rend le dépôt idempotent (§22.1) : elle porte sur le contenu
    // réellement transmis, et se calcule donc côté serveur. Un composant
    // client qui la produirait ferait croire au serveur ce que le navigateur
    // annonce du fichier qu'il envoie.
    const offenders = sourceFiles()
      .filter((moduleId) => /crypto\.subtle|createHash/.test(withoutComments(read(moduleId))))
      .filter((moduleId) => moduleId !== 'app/actions.ts');

    expect(offenders, 'empreinte calculée hors des Server Actions').toEqual([]);
  });
});

describe('design system', () => {
  it('n’écrit à la main aucune classe interne d’un composant', () => {
    // « Composants de `packages/ui` uniquement. » Les classes de mise en page
    // et de typographie sont publiques — `pk-body`, `pk-h1`, `pk-input` — mais
    // `pk-badge` ou `pk-source-body` appartiennent à un composant : les
    // recopier reviendrait à réimplémenter ce composant dans l'application, et
    // il divergerait au premier changement du Design System.
    const internal = [
      'pk-badge',
      'pk-data-value',
      'pk-source-body',
      'pk-source-drawer',
      'pk-source-excerpt',
      'pk-divider',
      'pk-micro-label',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = internal.filter((name) => source.includes(name));
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'classe interne d’un composant recopiée').toEqual([]);
  });

  it('ne définit aucun composant qui doublerait une primitive', () => {
    // Un `function Badge(` ou `function SourceDrawer(` local serait une
    // seconde version du composant, hors de portée des tests du paquet.
    const primitives = [
      'Badge',
      'Button',
      'DataValue',
      'Divider',
      'IconButton',
      'Input',
      'MicroLabel',
      'SourceDrawer',
      'SourceLink',
      'StatusBadge',
      'TrustBadge',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = primitives.filter((name) =>
        new RegExp(String.raw`function\s+${name}\s*\(`).test(source),
      );
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'primitive du Design System redéfinie dans l’application').toEqual([]);
  });

  it('importe ses composants de @pluka/ui', () => {
    // Contrepartie des tests d'absence : l'écran de revue consomme bien le
    // Design System plutôt que d'être un empilement de div nues.
    expect(read('app/courses/[raceId]/revue/review-list.tsx')).toContain("from '@pluka/ui'");
  });
});
