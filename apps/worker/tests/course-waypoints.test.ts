import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  handleCourseWaypointsMessage,
  isCourseWaypointsMessage,
} from '../src/jobs/course-waypoints.js';
import type { QueueMessage, RaceCourseSource, WorkerPorts } from '../src/ports.js';

/**
 * Relance du prétraitement — PLAN_ENGINE §8, §8.1.
 *
 * `gpx.process` couvre le cas où la trace arrive après le référentiel. Ce job
 * couvre l'autre, celui que le worker annonçait sans que personne ne puisse le
 * déclencher : « le prétraitement reste `pending` et attend que quelqu'un le
 * relance ».
 *
 * Les ports sont des doublures : ce qui se teste ici est le branchement — ce
 * que le job fait selon ce qu'il trouve — pas le prétraitement lui-même, qui
 * est celui de `gpx.process`, inchangé.
 */

const REFERENCE_GPX = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'packages',
    'gpx',
    'tests',
    'fixtures',
    'reference.gpx',
  ),
  'utf8',
);

const RACE_ID = 'aaaaaaaa-0000-4000-8000-000000000013';

/** Départ, milieu et arrivée de `reference.gpx` — une ligne droite plein nord. */
const TRACK_POINTS = [
  { latitude: 45.9, longitude: 6.8, declaredDistanceMeters: 0 },
  { latitude: 45.90898311, longitude: 6.8, declaredDistanceMeters: 1000 },
  { latitude: 45.91787639, longitude: 6.8, declaredDistanceMeters: 2000 },
] as const;

interface Recorded {
  readonly persisted: {
    count: number;
    version: string | null;
    warnings: readonly { code: string; message: string }[];
  };
  readonly blocked: string[];
  readonly downloaded: string[];
}

function message(payload: Record<string, unknown>): QueueMessage {
  return { msgId: 1, readCount: 1, payload } as QueueMessage;
}

/**
 * Ports minimaux.
 *
 * Seuls ceux que le job touche sont réels ; les autres lèvent, pour qu'un
 * chemin d'exécution inattendu se voie au lieu de passer inaperçu.
 */
function createPorts(
  source: RaceCourseSource | null,
  recorded: Recorded,
  options: {
    readonly waypoints?: number;
    readonly downloadFails?: boolean;
    readonly officialDistanceMeters?: number;
  } = {},
): WorkerPorts {
  const waypointCount = options.waypoints ?? 3;

  return {
    objects: {
      downloadText: async (_bucket: string, path: string): Promise<string> => {
        recorded.downloaded.push(path);
        if (options.downloadFails === true) throw new Error('stockage indisponible');
        return REFERENCE_GPX;
      },
      downloadBytes: async () => new Uint8Array(),
      upload: async (): Promise<void> => undefined,
    },
    coursePreprocessing: {
      findCourseSource: async () => source,
      readInput: async () => ({
        // Des points pris sur la trace de référence : §9 refuse un waypoint à
        // plus de 200 m, et des coordonnées inventées feraient bloquer le
        // prétraitement au lieu de l'exécuter.
        waypoints: Array.from({ length: waypointCount }, (_value, index) => ({
          id: `waypoint-${index}`,
          sortOrder: index,
          ...(TRACK_POINTS[index] ?? TRACK_POINTS[TRACK_POINTS.length - 1]),
        })),
        segments: Array.from({ length: Math.max(waypointCount - 1, 0) }, (_value, index) => ({
          id: `segment-${index}`,
          sortOrder: index,
          fromWaypointId: `waypoint-${index}`,
          toWaypointId: `waypoint-${index + 1}`,
        })),
        official: {
          distanceMeters: options.officialDistanceMeters ?? null,
          elevationGainMeters: null,
        },
      }),
      persist: async (
        _geometryId: string,
        version: string,
        _micro: unknown,
        warnings: readonly { code: string; message: string }[],
      ): Promise<number> => {
        recorded.persisted.count += 1;
        recorded.persisted.version = version;
        recorded.persisted.warnings = warnings;
        return 42;
      },
      block: async (_geometryId: string, issue: string): Promise<void> => {
        recorded.blocked.push(issue);
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as WorkerPorts;
}

function recorder(): Recorded {
  return { persisted: { count: 0, version: null, warnings: [] }, blocked: [], downloaded: [] };
}

const SOURCE: RaceCourseSource = {
  courseGeometryId: 'geometry-1',
  storagePath: `races/${RACE_ID}/gpx/abc.gpx`,
};

describe('reconnaissance du message', () => {
  it('reconnaît une relance de référentiel', () => {
    expect(
      isCourseWaypointsMessage(message({ eventType: 'course.waypoints.changed', raceId: RACE_ID })),
    ).toBe(true);
  });

  it('laisse passer un import GPX', () => {
    // La file `pluka_geo` porte les deux : un message d'import ne doit pas
    // être détourné vers la relance, il n'a pas la même charge utile.
    expect(
      isCourseWaypointsMessage(
        message({ raceId: RACE_ID, sourceSnapshotId: 's', storagePath: 'p', idempotencyKey: 'k' }),
      ),
    ).toBe(false);
  });
});

describe('relance', () => {
  it('prétraite la géométrie courante à partir de sa trace', async () => {
    const recorded = recorder();
    const ports = createPorts(SOURCE, recorded);

    const outcome = await handleCourseWaypointsMessage(
      ports,
      message({ eventType: 'course.waypoints.changed', raceId: RACE_ID }),
    );

    expect(outcome.kind).toBe('preprocessed');
    expect(recorded.downloaded).toEqual([SOURCE.storagePath]);
    expect(recorded.persisted.count).toBe(1);
    expect(recorded.persisted.version).not.toBeNull();
  });

  it('persiste les contrôles qualité avec le prétraitement — §9.1', async () => {
    // Ils étaient journalisés : un écran ne lit pas les logs, et « un état de
    // qualité à résoudre » doit survivre à leur rotation. Ici la trace mesure
    // environ 2 km face à 1 km annoncé — §9 veut un warning, et il doit partir
    // avec les micro-segments, dans la même écriture.
    const recorded = recorder();

    await handleCourseWaypointsMessage(
      createPorts(SOURCE, recorded, { officialDistanceMeters: 1000 }),
      message({ eventType: 'course.waypoints.changed', raceId: RACE_ID }),
    );

    expect(recorded.persisted.count).toBe(1);
    expect(recorded.persisted.warnings.map((warning) => warning.code)).toContain(
      'GPX_DISTANCE_MISMATCH',
    );
  });

  it('ne persiste aucun constat quand rien ne diverge', async () => {
    const recorded = recorder();

    await handleCourseWaypointsMessage(
      createPorts(SOURCE, recorded),
      message({ eventType: 'course.waypoints.changed', raceId: RACE_ID }),
    );

    expect(recorded.persisted.warnings).toEqual([]);
  });

  it('ne crée aucune version de géométrie', async () => {
    // La trace n'a pas changé : seul son découpage change. `geometries.persist`
    // n'est même pas dans les ports du job — s'il y touchait, ce test lèverait.
    const recorded = recorder();
    const outcome = await handleCourseWaypointsMessage(
      createPorts(SOURCE, recorded),
      message({ eventType: 'course.waypoints.changed', raceId: RACE_ID }),
    );

    expect(outcome).toMatchObject({ kind: 'preprocessed' });
  });

  it('se met de côté quand l’épreuve n’a pas encore de trace', async () => {
    // Le référentiel est prêt avant le GPX : c'est un ordre d'import légitime,
    // et l'import prétraitera de lui-même. Rien à réessayer.
    const recorded = recorder();

    const outcome = await handleCourseWaypointsMessage(
      createPorts(null, recorded),
      message({ eventType: 'course.waypoints.changed', raceId: RACE_ID }),
    );

    expect(outcome).toEqual({ kind: 'skipped', reason: 'NO_GEOMETRY' });
    expect(recorded.downloaded).toEqual([]);
    expect(recorded.persisted.count).toBe(0);
  });

  it('diffère quand le référentiel est encore incomplet', async () => {
    // Un seul waypoint : `preprocessCourse` n'a aucun intervalle à découper.
    const recorded = recorder();

    const outcome = await handleCourseWaypointsMessage(
      createPorts(SOURCE, recorded, { waypoints: 1 }),
      message({ eventType: 'course.waypoints.changed', raceId: RACE_ID }),
    );

    expect(outcome).toMatchObject({ kind: 'preprocessed' });
    expect(recorded.persisted.count).toBe(0);
    expect(recorded.blocked).toEqual([]);
  });
});

describe('cas non nominaux', () => {
  it('abandonne un message sans épreuve', async () => {
    const recorded = recorder();

    const outcome = await handleCourseWaypointsMessage(
      createPorts(SOURCE, recorded),
      message({ eventType: 'course.waypoints.changed' }),
    );

    expect(outcome).toMatchObject({ kind: 'abandoned', code: 'PAYLOAD_INVALID' });
    expect(recorded.downloaded).toEqual([]);
  });

  it('redemande le message quand le stockage flanche', async () => {
    // Transitoire : le fichier existe, c'est le stockage qui n'a pas répondu.
    const recorded = recorder();

    const outcome = await handleCourseWaypointsMessage(
      createPorts(SOURCE, recorded, { downloadFails: true }),
      message({ eventType: 'course.waypoints.changed', raceId: RACE_ID }),
    );

    expect(outcome.kind).toBe('retry');
    expect(recorded.persisted.count).toBe(0);
  });
});
