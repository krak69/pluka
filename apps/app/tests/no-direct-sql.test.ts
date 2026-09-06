import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * « Les commandes de packages/domain uniquement, aucune écriture directe,
 * aucun calcul dans le navigateur. »
 *
 * Ces trois contraintes sont faciles à énoncer et faciles à perdre. Il suffit
 * d'un `db.from('race_plans')` dans un écran pour contourner les autorisations
 * de PLAN_ENGINE §45, ou d'une division dans un composant client pour qu'une
 * allure existe en deux exemplaires — celle du moteur et celle du navigateur,
 * forcément divergentes un jour. Ces tests les relisent dans les sources
 * plutôt que de compter sur la discipline de revue.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const PLAN_SCREEN = 'app/courses/[participantRaceId]/plan';

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

/**
 * Exception documentée — 01_ARCHITECTURE §6.3.
 *
 * L'accueil lit la ligne de l'utilisateur courant directement sous RLS. §6.3
 * autorise ce cas nommément — « prévue, triviale » — et la suite pgTAP le
 * couvre. Elle est listée ici plutôt que tolérée par un motif large : toute
 * autre lecture directe fera échouer ces tests.
 */
const DIRECT_READ_EXCEPTIONS: readonly string[] = ['app/page.tsx'];

/** Les fichiers soumis à l'interdiction de requête directe. */
function guardedFiles(): readonly string[] {
  return sourceFiles().filter((moduleId) => !DIRECT_READ_EXCEPTIONS.includes(moduleId));
}

function planScreenFiles(): readonly string[] {
  return sourceFiles().filter((moduleId) => moduleId.startsWith(PLAN_SCREEN));
}

describe('aucune requête directe', () => {
  it('n’appelle jamais .from() sur un client', () => {
    // Le point d'entrée de PostgREST. Son absence prouve qu'aucun écran ne
    // construit sa propre lecture.
    const offenders = guardedFiles().filter((moduleId) =>
      /\.from\s*\(/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'requête PostgREST dans l’application').toEqual([]);
  });

  it('n’appelle ni rpc(), ni select(), ni insert(), ni update()', () => {
    const offenders = guardedFiles().filter((moduleId) =>
      /\.(rpc|select|insert|upsert|delete)\s*\(/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'verbe de requête dans l’application').toEqual([]);
  });

  it('n’importe aucun helper de requête de @pluka/db', () => {
    // `selectColumns` et `unwrap` sont les outils d'un repository. Les voir ici
    // signifierait que l'application en écrit un.
    const offenders = guardedFiles().filter((moduleId) =>
      /\b(selectColumns|unwrapMaybe|unwrap)\b/.test(withoutComments(read(moduleId))),
    );

    expect(offenders).toEqual([]);
  });

  it('ne connaît aucun nom de table du Plan', () => {
    const tables = [
      'race_plans',
      'plan_waypoints',
      'plan_segments',
      'plan_version_dependencies',
      'plan_cutoff_statuses',
      'race_waypoints',
      'race_segments',
      'race_cutoffs',
      'race_course_micro_segments',
      'race_course_geometries',
      'participant_races',
      'user_entitlements',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = tables.filter((table) => new RegExp(`['"\`]${table}['"\`]`).test(source));
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'nom de table cité dans l’application').toEqual([]);
  });

  it('n’appelle aucune fonction SQL du Plan par son nom', () => {
    // Les fonctions de la migration 0020 sont la surface du repository, pas
    // celle de l'application. Les voir ici signifierait que l'écran a
    // court-circuité `@pluka/domain`, et donc ses gardes de §36 et §45.
    const functions = [
      'persist_race_plan',
      'list_plan_fact_dependencies',
      'persist_course_micro_segments',
      'get_course_preprocessing_input',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = functions.filter((name) => source.includes(name));
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'fonction SQL appelée depuis l’application').toEqual([]);
  });
});

describe('accès aux données', () => {
  it('ne construit un client que dans la couche lib', () => {
    // Câbler un repository demande un client : c'est du montage, pas une
    // requête. Il reste confiné à `lib/`, hors des écrans.
    const offenders = guardedFiles()
      .filter((moduleId) =>
        /createDataClient|createPlanRepositories|createEntitlementRepositories/.test(
          withoutComments(read(moduleId)),
        ),
      )
      .filter((moduleId) => !moduleId.startsWith('lib/'));

    expect(offenders, 'client de données construit hors de lib/').toEqual([]);
  });

  it('n’emploie jamais de clé de service', () => {
    // 03_PRIVACY_RLS §8 : `service_role` ne vit pas dans une application web.
    const offenders = sourceFiles().filter((moduleId) =>
      /SERVICE_ROLE|createServiceRoleClient|secretKey/.test(withoutComments(read(moduleId))),
    );

    expect(offenders).toEqual([]);
  });

  it('ne déclare jamais l’acteur autrement que par son identifiant', () => {
    // PLAN_ENGINE §45, 04_ENTITLEMENTS §5 : l'application ne peut se déclarer
    // ni propriétaire, ni premium. Un `tier:` ou un `capabilities:` construit
    // ici serait exactement la décision que le resolver serveur doit garder.
    const offenders = sourceFiles().filter((moduleId) =>
      /\b(tier|capabilities|entitlements)\s*:/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'droit déclaré par l’application').toEqual([]);
  });

  it('ne choisit pas la version du moteur', () => {
    // §14 : « le client ne peut jamais fournir cette configuration
    // arbitrairement ». `engineConfig` n'est donc jamais passé.
    const offenders = sourceFiles().filter((moduleId) =>
      /engineConfig|PLAN_ENGINE_V1|plan-v1\.0\.0/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'configuration du moteur fournie par l’application').toEqual([]);
  });
});

describe('écriture du Plan', () => {
  it('ne mute qu’à travers les commandes de §63', () => {
    // Les Server Actions sont la seule surface d'écriture, et chacune appelle
    // une commande du domaine.
    const actions = withoutComments(read('app/actions.ts'));

    for (const command of [
      'generateRacePlan',
      'changePlanTarget',
      'updatePlanSegmentDuration',
      'removePlanSegmentOverride',
      'updatePlanStop',
      'rebalancePlanToTarget',
      'preserveCurrentPlan',
    ]) {
      expect(actions, `${command} absent des Server Actions`).toContain(command);
    }

    expect(actions).toContain("from '@pluka/domain'");
  });

  it('expose les deux modes de §22 comme deux commandes distinctes', () => {
    // §22.1 et §22.2 sont deux décisions du coureur. Un paramètre `mode` sur un
    // même bouton en ferait un réglage, et le choix disparaîtrait.
    const actions = withoutComments(read('app/actions.ts'));

    expect(actions).toContain('rebalancePlanToTarget(context, { participantRaceId })');
    expect(actions).toContain('preserveCurrentPlan(context, { participantRaceId })');
  });

  it('n’écrit jamais depuis un composant', () => {
    // Une commande du domaine appelée hors d'une action serait une écriture
    // déclenchée au rendu.
    const offenders = planScreenFiles().filter((moduleId) =>
      /\b(generateRacePlan|changePlanTarget|updatePlanS(egmentDuration|top)|rebalancePlanToTarget|preserveCurrentPlan)\s*\(/.test(
        withoutComments(read(moduleId)),
      ),
    );

    expect(offenders, 'commande appelée depuis un composant').toEqual([]);
  });

  it('lit le Plan par le use case, dans un Server Component', () => {
    const page = read(`${PLAN_SCREEN}/page.tsx`);

    expect(page).toContain("from '@pluka/domain'");
    expect(page).toContain('getPlanOverview');
    // Un `'use client'` sur la page ferait de la lecture un appel navigateur.
    expect(page).not.toContain("'use client'");
  });
});

describe('aucun calcul dans le navigateur', () => {
  it('ne construit ni ne lit aucune date dans l’écran', () => {
    // §5.3 dérive les horaires du départ effectif, côté serveur. Une `new Date`
    // ici recalculerait un instant que le Plan a déjà fixé — et le ferait dans
    // le fuseau du navigateur.
    const offenders = planScreenFiles().filter((moduleId) =>
      /new Date\s*\(|Date\.(parse|now)\s*\(/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'date calculée dans l’écran').toEqual([]);
  });

  it('ne fait aucune arithmétique sur les secondes du Plan', () => {
    // Horaires, durées, allures, marges et dérive arrivent résolus de
    // `getPlanOverview`. Un opérateur appliqué à un champ en secondes serait un
    // second calcul, hors du serveur que §45 rend seul responsable.
    const offenders = planScreenFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      return /Seconds\s*[-+*/]|[-+*/]\s*\w*Seconds\b/.test(source) ? [moduleId] : [];
    });

    expect(offenders, 'calcul sur des secondes dans l’écran').toEqual([]);
  });

  it('ne dérive aucune allure', () => {
    // L'allure est une division. Elle est faite une fois, dans le modèle de
    // lecture, jamais ici.
    const offenders = planScreenFiles().filter((moduleId) =>
      /paceSecondsPerKm\s*=|\/\s*distanceKm/.test(withoutComments(read(moduleId))),
    );

    expect(offenders, 'allure calculée dans l’écran').toEqual([]);
  });

  it('projette le profil côté serveur', () => {
    // La géométrie SVG est de la mise en forme, pas du domaine — mais elle
    // reste hors du navigateur : le client reçoit un chemin, pas une série.
    const profile = read(`${PLAN_SCREEN}/altitude-profile.tsx`);

    expect(profile).not.toContain("'use client'");
    expect(profile).toContain('<svg');
  });

  it('concentre toute mise en forme dans lib/plan', () => {
    // Une seule définition de `HH:MM`, d'allure et d'heure de course : deux
    // écrans ne peuvent donc pas afficher deux formats du même nombre. Le
    // module est distinct de `lib/plan` : celui-là câble Supabase, et n'a rien
    // à faire dans un bundle navigateur.
    const points = read(`${PLAN_SCREEN}/plan-points.tsx`);

    expect(points).toContain("from '@/lib/plan-format'");
    expect(points).not.toContain("from '@/lib/plan'");
    expect(points).toContain('formatElapsed');
    expect(points).toContain('formatClock');
    expect(points).toContain('formatPace');
  });
});

describe('design system', () => {
  it('n’écrit à la main aucune classe interne d’un composant', () => {
    // « Composants de `packages/ui`. » Les classes de typographie sont
    // publiques — `pk-body`, `pk-h1`, `pk-label` — mais `pk-badge`,
    // `pk-data-value` ou `pk-table` appartiennent à un composant : les recopier
    // reviendrait à réimplémenter ce composant dans l'application, et il
    // divergerait au premier changement du Design System.
    const internal = [
      'pk-badge',
      'pk-data-value',
      'pk-divider',
      'pk-micro-label',
      'pk-table',
      'pk-source-drawer',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = internal.filter((name) => source.includes(name));
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'classe interne d’un composant recopiée').toEqual([]);
  });

  it('n’invente aucune classe de typographie', () => {
    // §14 fixe l'échelle : display, h1, h2, body, data, label. Un `pk-h3` ou un
    // `pk-caption` écrit ici ne serait défini nulle part — donc sans style, et
    // sans que rien ne le signale.
    const declared = ['pk-display', 'pk-h1', 'pk-h2', 'pk-body', 'pk-data', 'pk-label'];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const used = [...source.matchAll(/className="(pk-[a-z0-9- ]+)"/g)].flatMap((match) =>
        (match[1] ?? '').split(' '),
      );
      const unknown = used.filter(
        (name) =>
          /^pk-(display|h\d|body|data|caption|label|title|text)/.test(name) &&
          !declared.includes(name),
      );

      return unknown.length === 0 ? [] : [`${moduleId} → ${unknown.join(', ')}`];
    });

    expect(offenders, 'classe de typographie inconnue').toEqual([]);
  });

  it('ne redéfinit aucune primitive du Design System', () => {
    const primitives = [
      'Badge',
      'Button',
      'DataValue',
      'Divider',
      'IconButton',
      'Input',
      'MicroLabel',
      'StatusBadge',
      'Table',
      'TrustBadge',
    ];

    const offenders = sourceFiles().flatMap((moduleId) => {
      const source = withoutComments(read(moduleId));
      const found = primitives.filter((name) =>
        new RegExp(String.raw`function\s+${name}\s*\(`).test(source),
      );
      return found.length === 0 ? [] : [`${moduleId} → ${found.join(', ')}`];
    });

    expect(offenders, 'primitive du Design System redéfinie').toEqual([]);
  });

  it('construit l’écran du Plan avec les composants de packages/ui', () => {
    for (const moduleId of [
      `${PLAN_SCREEN}/plan-points.tsx`,
      `${PLAN_SCREEN}/altitude-profile.tsx`,
      `${PLAN_SCREEN}/generate-form.tsx`,
      `${PLAN_SCREEN}/page.tsx`,
    ]) {
      expect(read(moduleId), `${moduleId} n'importe pas @pluka/ui`).toContain("from '@pluka/ui'");
    }
  });
});
