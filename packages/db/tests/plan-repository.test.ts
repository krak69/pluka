import { describe, expect, it } from 'vitest';

import { planCourseRepository, racePlanRepository, type PlukaClient } from '../src/index.js';

/**
 * Repositories du Plan.
 *
 * PLAN_ENGINE §38 : « le moteur pur ne connaît pas ces tables. » Ce fichier
 * vérifie la réciproque — la couche données ne rejoue aucune décision du
 * moteur. Elle lit un référentiel ordonné, et transmet à une fonction SQL un
 * résultat déjà calculé.
 */

interface Recorder {
  readonly client: PlukaClient;
  readonly calls: string[];
  readonly rpcArgs: Record<string, unknown>[];
}

function fakeClient(result: unknown): Recorder {
  const calls: string[] = [];
  const rpcArgs: Record<string, unknown>[] = [];
  const answer = Promise.resolve({ data: result, error: null });

  const builder: Record<string, unknown> = {
    select: (columns: string) => {
      calls.push(`select:${columns}`);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      calls.push(`eq:${column}=${String(value)}`);
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      calls.push(`order:${column}:${options?.ascending === false ? 'desc' : 'asc'}`);
      return builder;
    },
    maybeSingle: () => answer,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      answer.then(resolve, reject),
  };

  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}`);
      rpcArgs.push(args);
      return answer;
    },
  } as unknown as PlukaClient;

  return { client, calls, rpcArgs };
}

const PERSIST_INPUT = {
  participantRaceId: 'pr-1',
  actorUserId: 'user-1',
  summary: {
    engineVersion: 'plan-v1.0.0',
    initialTargetDurationSeconds: 43_200,
    targetDurationSeconds: 45_000,
    plannedFinishDatetime: '2026-06-20T16:30:00.000Z',
    inputHash: 'a'.repeat(64),
    inputSnapshot: { mode: 'rebalance_to_target' },
  },
  waypoints: [
    {
      raceWaypointId: 'wp-1',
      sortOrder: 0,
      plannedElapsedSeconds: 0,
      plannedArrivalAt: '2026-06-20T04:00:00.000Z',
      stopDurationSeconds: 0,
      stopOrigin: 'default' as const,
      isLocked: false,
      lockedElapsedSeconds: null,
    },
  ],
  segments: [
    {
      raceSegmentId: 'seg-1',
      sortOrder: 0,
      initialDurationSeconds: 43_200,
      plannedDurationSeconds: 45_000,
      manualOverride: true,
    },
  ],
  cutoffStatuses: [
    {
      raceCutoffId: 'cut-1',
      raceWaypointId: 'wp-1',
      marginSeconds: 1800,
      status: 'watch' as const,
    },
  ],
  dependencies: [
    { raceFactVersionId: 'fv-1', dependencyType: 'cutoff' as const, dependencyKey: 'barriere' },
  ],
};

describe('lecture du référentiel de parcours', () => {
  it('rend les waypoints dans l’ordre du parcours (§35)', async () => {
    const { client, calls } = fakeClient([]);

    await planCourseRepository({ client }).listWaypoints('race-1');

    expect(calls[0]).toBe('from:race_waypoints');
    expect(calls).toContain('eq:race_id=race-1');
    expect(calls).toContain('order:sort_order:asc');
  });

  it('rend les micro-segments d’une géométrie précise (§8.1, étape 11)', async () => {
    const { client, calls } = fakeClient([]);

    await planCourseRepository({ client }).listMicroSegments('geometry-1');

    expect(calls[0]).toBe('from:race_course_micro_segments');
    expect(calls).toContain('eq:course_geometry_id=geometry-1');
    expect(calls).toContain('order:sort_order:asc');
  });

  it('convertit les numériques SQL en nombres', async () => {
    // `numeric` arrive en chaîne côté PostgREST : sans conversion, le moteur
    // multiplierait des chaînes et rendrait NaN.
    const { client } = fakeClient([
      {
        id: 'm-1',
        race_segment_id: 'seg-1',
        sort_order: 0,
        distance_m: '100.000',
        elevation_delta_m: '10.000',
        elevation_gain_m: '10.000',
        elevation_loss_m: '0.000',
        raw_grade: '0.100000',
        model_grade: '0.100000',
        progress: '0.05000000',
        technicality: null,
        preprocessing_version: 'plan-preprocessing-1.0.0',
      },
    ]);

    const micro = (await planCourseRepository({ client }).listMicroSegments('geometry-1'))[0];

    expect(micro?.distanceMeters).toBe(100);
    expect(micro?.rawGrade).toBeCloseTo(0.1, 10);
    expect(micro?.progress).toBeCloseTo(0.05, 10);
  });

  it('lit la référence temporelle de chaque barrière (§25)', async () => {
    const { client, calls } = fakeClient([]);

    await planCourseRepository({ client }).listCutoffs('race-1');

    expect(calls.find((call) => call.startsWith('select:'))).toContain('basis');
  });

  it('demande les dépendances de faits à la fonction dédiée (§38.5)', async () => {
    const { client, calls } = fakeClient([
      { race_fact_version_id: 'fv-1', dependency_type: 'cutoff', dependency_key: 'barriere' },
    ]);

    const dependencies = await planCourseRepository({ client }).listFactDependencies('race-1');

    expect(calls).toContain('rpc:list_plan_fact_dependencies');
    expect(dependencies).toEqual([
      { raceFactVersionId: 'fv-1', dependencyType: 'cutoff', dependencyKey: 'barriere' },
    ]);
  });
});

describe('lecture des Plans', () => {
  it('ne rend qu’une version active (§36)', async () => {
    const { client, calls } = fakeClient(null);

    await racePlanRepository({ client }).findActive('pr-1');

    expect(calls).toContain('eq:participant_race_id=pr-1');
    expect(calls).toContain('eq:status=active');
  });

  it('rend l’historique dans l’ordre des versions', async () => {
    const { client, calls } = fakeClient([]);

    await racePlanRepository({ client }).listVersions('pr-1');

    expect(calls).toContain('order:version:asc');
  });

  it('relit les contraintes explicites d’un Plan (§24)', async () => {
    const { client, calls } = fakeClient([]);

    await racePlanRepository({ client }).listWaypoints('plan-1');

    const projection = calls.find((call) => call.startsWith('select:')) as string;
    expect(projection).toContain('stop_origin');
    expect(projection).toContain('is_locked');
    expect(projection).toContain('locked_elapsed_seconds');
  });
});

describe('confirmation d’un Plan (§37)', () => {
  it('passe par une seule fonction SQL, pas par cinq écritures', async () => {
    // 01_ARCHITECTURE §31 : PostgREST n'exécute qu'une instruction par appel.
    // Découper laisserait un Plan sans waypoints si la seconde échouait.
    const { client, calls } = fakeClient([{ race_plan_id: 'plan-9', version: 3 }]);

    await racePlanRepository({ client }).persist(PERSIST_INPUT);

    expect(calls).toEqual(['rpc:persist_race_plan']);
  });

  it('transmet la charge en noms de colonnes, sans rien recalculer', async () => {
    const { client, rpcArgs } = fakeClient([{ race_plan_id: 'plan-9', version: 3 }]);

    await racePlanRepository({ client }).persist(PERSIST_INPUT);

    const args = rpcArgs[0] as Record<string, unknown>;

    expect(args['p_participant_race_id']).toBe('pr-1');
    expect(args['p_actor_user_id']).toBe('user-1');
    expect(args['p_summary']).toMatchObject({
      engine_version: 'plan-v1.0.0',
      initial_target_duration_seconds: 43_200,
      target_duration_seconds: 45_000,
      input_hash: 'a'.repeat(64),
    });
    expect(args['p_segments']).toEqual([
      {
        race_segment_id: 'seg-1',
        sort_order: 0,
        initial_duration_seconds: 43_200,
        planned_duration_seconds: 45_000,
        manual_override: true,
      },
    ]);
  });

  it('conserve l’origine de l’arrêt et le verrou (§21.4, §21.6)', async () => {
    const { client, rpcArgs } = fakeClient([{ race_plan_id: 'plan-9', version: 3 }]);

    await racePlanRepository({ client }).persist(PERSIST_INPUT);

    expect((rpcArgs[0] as Record<string, unknown>)['p_waypoints']).toEqual([
      {
        race_waypoint_id: 'wp-1',
        sort_order: 0,
        planned_elapsed_seconds: 0,
        planned_arrival_at: '2026-06-20T04:00:00.000Z',
        stop_duration_seconds: 0,
        stop_origin: 'default',
        is_locked: false,
        locked_elapsed_seconds: null,
      },
    ]);
  });

  it('transmet les dépendances de faits telles que le domaine les a résolues (§38.5)', async () => {
    const { client, rpcArgs } = fakeClient([{ race_plan_id: 'plan-9', version: 3 }]);

    await racePlanRepository({ client }).persist(PERSIST_INPUT);

    expect((rpcArgs[0] as Record<string, unknown>)['p_dependencies']).toEqual([
      { race_fact_version_id: 'fv-1', dependency_type: 'cutoff', dependency_key: 'barriere' },
    ]);
  });

  it('rend la version créée par la base, jamais une version devinée', async () => {
    const { client } = fakeClient([{ race_plan_id: 'plan-9', version: 3 }]);

    await expect(racePlanRepository({ client }).persist(PERSIST_INPUT)).resolves.toEqual({
      racePlanId: 'plan-9',
      version: 3,
    });
  });

  it('échoue bruyamment si la fonction ne rend aucune version', async () => {
    const { client } = fakeClient([]);

    await expect(racePlanRepository({ client }).persist(PERSIST_INPUT)).rejects.toThrow();
  });
});
