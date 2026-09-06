import { describe, expect, it } from 'vitest';
import type { DeclaredWaypoint, PlanMicroSegment, PlanRaceSegmentInput } from '@pluka/plan-engine';

import { handleGpxMessage } from '../src/jobs/gpx-process.js';
import type {
  CoursePreprocessingInput,
  JobClaim,
  QueueMessage,
  WorkerPorts,
} from '../src/ports.js';

/**
 * Prétraitement du parcours à l'import — PLAN_ENGINE §8, §8.1, §9, §9.1.
 *
 * Le job fait deux choses de nature différente, et le fil de ces tests est
 * leur asymétrie : la géométrie est le fait brut, le prétraitement en dérive.
 * Un référentiel absent ou faux ne doit jamais faire perdre la trace.
 *
 * La trace de test monte régulièrement le long d'un méridien : deux kilomètres
 * pour cent mètres de dénivelé, soit une pente de +5 % partout. Les
 * micro-segments attendus s'en déduisent au crayon.
 */

const WP0 = '11110000-0000-4000-8000-000000000001';
const WP1 = '11110000-0000-4000-8000-000000000002';
const SEG0 = '11110000-0000-4000-8000-000000000010';

/**
 * GPX synthétique : 21 points le long du méridien 6°E, de 45.0000 à 45.0180.
 *
 * Un centième de degré de latitude vaut environ 1 111 m ; 0.018° font donc
 * environ 2 000 m. L'altitude monte de 1000 m à 1100 m.
 */
function buildGpx(): string {
  const points: string[] = [];

  for (let index = 0; index <= 20; index += 1) {
    const latitude = 45 + index * 0.0009;
    const elevation = 1000 + index * 5;
    points.push(
      `<trkpt lat="${latitude.toFixed(6)}" lon="6.000000"><ele>${elevation}</ele></trkpt>`,
    );
  }

  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>Test</name><trkseg>${points.join('')}</trkseg></trk></gpx>`;
}

const MESSAGE: QueueMessage = {
  msgId: 1,
  readCount: 1,
  payload: {
    raceId: 'race-1',
    sourceSnapshotId: 'snapshot-1',
    storagePath: 'races/race-1/course.gpx',
    idempotencyKey: 'gpx.process:race-1:hash-1',
  },
};

interface Harness {
  ports: WorkerPorts;
  referential: CoursePreprocessingInput;
  readonly written: { geometryId: string; version: string; micro: readonly PlanMicroSegment[] }[];
  readonly blocked: { geometryId: string; issue: string }[];
  readonly warnings: { message: string; context?: Record<string, unknown> }[];
}

const SEGMENTS: readonly PlanRaceSegmentInput[] = [
  { id: SEG0, sortOrder: 0, fromWaypointId: WP0, toWaypointId: WP1 },
];

/** Départ et arrivée posés exactement sur la trace. */
const ON_ROUTE: readonly DeclaredWaypoint[] = [
  { id: WP0, sortOrder: 0, latitude: 45, longitude: 6, declaredDistanceMeters: 0 },
  { id: WP1, sortOrder: 1, latitude: 45.018, longitude: 6, declaredDistanceMeters: 2000 },
];

function createHarness(): Harness {
  const written: Harness['written'] = [];
  const blocked: Harness['blocked'] = [];
  const warnings: Harness['warnings'] = [];

  const harness: Harness = {
    ports: undefined as unknown as WorkerPorts,
    referential: {
      waypoints: ON_ROUTE,
      segments: SEGMENTS,
      official: { distanceMeters: null, elevationGainMeters: null },
    },
    written,
    blocked,
    warnings,
  };

  const claim: JobClaim = { jobId: 'job-1', status: 'running', attempts: 1, maxAttempts: 5 };

  harness.ports = {
    queue: { read: async () => [], archive: async () => undefined },
    jobs: { claim: async () => claim, fail: async () => 'queued' },
    objects: {
      downloadText: async () => buildGpx(),
      downloadBytes: async () => new Uint8Array(),
      upload: async () => undefined,
    },
    geometries: { persist: async () => 'geometry-1' },
    coursePreprocessing: {
      readInput: async () => harness.referential,
      persist: async (geometryId: string, version: string, micro: readonly PlanMicroSegment[]) => {
        written.push({ geometryId, version, micro });
        return micro.length;
      },
      block: async (geometryId: string, issue: string) => {
        blocked.push({ geometryId, issue });
      },
    },
    sources: {
      fetch: async () => {
        throw new Error('non employé');
      },
      knownHashes: async () => [],
      recordSnapshot: async () => ({ snapshotId: 's', created: true }),
      markFailed: async () => undefined,
    },
    parsing: {
      startRun: async () => ({ runId: 'r', alreadyCompleted: false }),
      completeRun: async () => 0,
      failRun: async () => undefined,
    },
    extraction: {
      readParseOutput: async () => ({ blocks: [], chunks: [] }),
      startRun: async () => ({ runId: 'r', alreadyCompleted: false }),
      recordCandidates: async () => 0,
      completeRun: async () => undefined,
      failRun: async () => undefined,
    },
    impacts: { analyze: async () => 0 },
    notifications: {
      claim: async () => null,
      markSent: async () => undefined,
      markFailed: async () => undefined,
    },
    email: null,
    appUrl: 'http://localhost:3001',
    ai: null,
    outbox: { dispatch: async () => 0 },
    logger: {
      info: () => undefined,
      warn: (message: string, context?: Record<string, unknown>) => {
        warnings.push({ message, ...(context === undefined ? {} : { context }) });
      },
      error: () => undefined,
    },
  } as unknown as WorkerPorts;

  return harness;
}

describe('prétraitement à l’import (§8)', () => {
  it('découpe le parcours en micro-segments et les persiste', async () => {
    const harness = createHarness();

    const outcome = await handleGpxMessage(harness.ports, MESSAGE);

    expect(outcome).toMatchObject({ kind: 'processed', geometryId: 'geometry-1' });
    expect(outcome.kind === 'processed' && outcome.preprocessing).toMatchObject({
      kind: 'completed',
    });

    // Environ 2 000 m à découper en parts d'environ 100 m.
    const written = harness.written[0];
    expect(written?.geometryId).toBe('geometry-1');
    expect(written?.micro.length).toBeGreaterThanOrEqual(19);
    expect(written?.micro.length).toBeLessThanOrEqual(21);
  });

  it('porte sa version de prétraitement (§8.1, étape 11)', async () => {
    const harness = createHarness();

    await handleGpxMessage(harness.ports, MESSAGE);

    expect(harness.written[0]?.version).toBe('plan-preprocessing-1.0.0');
  });

  it('mesure une pente régulière de +5 % sur toute la trace', async () => {
    const harness = createHarness();

    await handleGpxMessage(harness.ports, MESSAGE);

    for (const micro of harness.written[0]?.micro ?? []) {
      expect(micro.rawGrade, `micro ${micro.sortOrder}`).toBeCloseTo(0.05, 2);
      expect(micro.modelGrade).toBeCloseTo(micro.rawGrade, 10);
    }
  });

  it('n’invente aucune technicité (§12.1)', async () => {
    const harness = createHarness();

    await handleGpxMessage(harness.ports, MESSAGE);

    expect((harness.written[0]?.micro ?? []).every((micro) => micro.technicality === null)).toBe(
      true,
    );
  });

  it('donne une progression croissante de 0 à 1 (§13)', async () => {
    const harness = createHarness();

    await handleGpxMessage(harness.ports, MESSAGE);

    const progress = (harness.written[0]?.micro ?? []).map((micro) => micro.progress);

    expect(progress).toEqual([...progress].sort((left, right) => left - right));
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBeLessThan(1);
  });

  it('rattache chaque micro-segment à son segment de course (§8.1, étape 7)', async () => {
    const harness = createHarness();

    await handleGpxMessage(harness.ports, MESSAGE);

    expect((harness.written[0]?.micro ?? []).every((micro) => micro.raceSegmentId === SEG0)).toBe(
      true,
    );
  });
});

describe('raccordement des waypoints (§8.1, étape 9 ; §9)', () => {
  it('bloque le prétraitement quand un waypoint est trop loin de la trace', async () => {
    const harness = createHarness();
    harness.referential = {
      ...harness.referential,
      waypoints: [
        ON_ROUTE[0] as DeclaredWaypoint,
        // Environ 800 m à l'est de la trace : bien au-delà des 200 m de §9.
        {
          id: WP1,
          sortOrder: 1,
          latitude: 45.018,
          longitude: 6.0102,
          declaredDistanceMeters: 2000,
        },
      ],
    };

    const outcome = await handleGpxMessage(harness.ports, MESSAGE);

    expect(outcome.kind === 'processed' && outcome.preprocessing).toMatchObject({
      kind: 'blocked',
      code: 'WAYPOINT_OFF_ROUTE',
    });
    expect(harness.blocked[0]?.geometryId).toBe('geometry-1');
    expect(harness.written).toEqual([]);
  });

  it('mais conserve la géométrie : §9 bloque le Plan, pas l’import', async () => {
    const harness = createHarness();
    harness.referential = {
      ...harness.referential,
      waypoints: [
        ON_ROUTE[0] as DeclaredWaypoint,
        {
          id: WP1,
          sortOrder: 1,
          latitude: 45.018,
          longitude: 6.0102,
          declaredDistanceMeters: 2000,
        },
      ],
    };

    const outcome = await handleGpxMessage(harness.ports, MESSAGE);

    // Le job réussit, la trace est enregistrée. Cinq tentatives ne
    // corrigeraient pas un ravito mal pointé : le problème est dans le
    // référentiel, pas dans le fichier.
    expect(outcome.kind).toBe('processed');
    expect(outcome.kind === 'processed' && outcome.geometryId).toBe('geometry-1');
  });

  it('fait foi de l’abscisse mesurée, pas de la distance annoncée (§9.1)', async () => {
    const harness = createHarness();
    harness.referential = {
      ...harness.referential,
      waypoints: [
        ON_ROUTE[0] as DeclaredWaypoint,
        // L'organisation annonce 5 km ; la trace en fait 2. Le prétraitement
        // suit la trace, et ne falsifie rien pour les réconcilier.
        { id: WP1, sortOrder: 1, latitude: 45.018, longitude: 6, declaredDistanceMeters: 5000 },
      ],
    };

    await handleGpxMessage(harness.ports, MESSAGE);

    const total = (harness.written[0]?.micro ?? []).reduce(
      (sum, micro) => sum + micro.distanceMeters,
      0,
    );

    expect(total).toBeGreaterThan(1900);
    expect(total).toBeLessThan(2100);
  });
});

describe('référentiel absent (§8)', () => {
  it('met le prétraitement de côté sans écrire ni bloquer', async () => {
    const harness = createHarness();
    harness.referential = {
      waypoints: [],
      segments: [],
      official: { distanceMeters: null, elevationGainMeters: null },
    };

    const outcome = await handleGpxMessage(harness.ports, MESSAGE);

    // Un GPX déposé avant ses waypoints est un ordre d'import légitime.
    expect(outcome.kind === 'processed' && outcome.preprocessing).toEqual({
      kind: 'skipped',
      reason: 'REFERENTIAL_INCOMPLETE',
    });
    expect(harness.written).toEqual([]);
    expect(harness.blocked).toEqual([]);
  });

  it('en fait autant quand les segments manquent', async () => {
    const harness = createHarness();
    harness.referential = { ...harness.referential, segments: [] };

    const outcome = await handleGpxMessage(harness.ports, MESSAGE);

    expect(outcome.kind === 'processed' && outcome.preprocessing).toMatchObject({
      kind: 'skipped',
    });
  });
});

describe('contrôles qualité (§9, §9.1)', () => {
  it('signale un écart de distance sans corriger la trace', async () => {
    const harness = createHarness();
    harness.referential = {
      ...harness.referential,
      official: { distanceMeters: 5000, elevationGainMeters: null },
    };

    await handleGpxMessage(harness.ports, MESSAGE);

    expect(
      harness.warnings.some((entry) => entry.context?.['code'] === 'GPX_DISTANCE_MISMATCH'),
    ).toBe(true);
    // Les micro-segments décrivent toujours les 2 km réels.
    expect(harness.written[0]?.micro.length).toBeGreaterThan(0);
  });

  it('signale un écart de D+ sans le retoucher', async () => {
    const harness = createHarness();
    harness.referential = {
      ...harness.referential,
      official: { distanceMeters: null, elevationGainMeters: 300 },
    };

    await handleGpxMessage(harness.ports, MESSAGE);

    expect(harness.warnings.some((entry) => entry.context?.['code'] === 'GPX_GAIN_MISMATCH')).toBe(
      true,
    );

    const gain = (harness.written[0]?.micro ?? []).reduce(
      (sum, micro) => sum + micro.elevationGainMeters,
      0,
    );
    expect(gain).toBeCloseTo(100, 0);
  });

  it('se tait quand le référentiel officiel concorde', async () => {
    const harness = createHarness();
    harness.referential = {
      ...harness.referential,
      official: { distanceMeters: 2000, elevationGainMeters: 100 },
    };

    await handleGpxMessage(harness.ports, MESSAGE);

    expect(
      harness.warnings.filter((entry) => String(entry.context?.['code'] ?? '').startsWith('GPX_')),
    ).toEqual([]);
  });
});

describe('rejeu (§22.1)', () => {
  it('réécrit le même ensemble plutôt qu’un second exemplaire', async () => {
    const harness = createHarness();

    await handleGpxMessage(harness.ports, MESSAGE);
    await handleGpxMessage(harness.ports, MESSAGE);

    // Deux appels, deux remplacements complets de la même géométrie — c'est la
    // fonction SQL qui garantit qu'il n'en reste qu'un jeu en base.
    expect(harness.written).toHaveLength(2);
    expect(harness.written[1]?.micro).toEqual(harness.written[0]?.micro);
    expect(harness.written.every((entry) => entry.geometryId === 'geometry-1')).toBe(true);
  });
});
