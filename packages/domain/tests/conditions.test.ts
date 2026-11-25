import type {
  ConditionsNightRecord,
  ConditionsPointRecord,
  ConditionsRepository,
  ConditionsRunRecord,
  RacePlanRecord,
  RaceRecord,
  CourseWaypointRecord,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getRaceConditions,
  requestRaceConditionsRefresh,
  type ConditionsContext,
} from '../src/index.js';
import {
  createFakeEntitlementRepositories,
  entitlementBaseState,
  grantEntitlement,
  type EntitlementState,
} from './fixtures/entitlement-repositories.js';
import {
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
} from './fixtures/participation-repositories.js';

/**
 * Conditions d'une course — WEATHER_CONDITIONS §6 à §12, §28 à §35, §52 à
 * §55 ; W01, W03. Départ samedi 12 septembre 2026, 08:00 à Paris.
 */

const NOW = new Date('2026-09-10T08:00:00.000Z');
const START = '2026-09-12T06:00:00.000Z';
const PLAN_ID = 'plan-1';

let own: string;
let entitlements: EntitlementState;
let planStart: string | null;
let hasPlan: boolean;
let runs: ConditionsRunRecord[];
let requested: string[];

const POINT: ConditionsPointRecord = {
  pointKey: 'wp-col',
  raceWaypointId: 'col',
  distanceKm: 40,
  elapsedSeconds: 18000,
  routeAltitudeM: 2429,
  plannedDatetime: '2026-09-12T11:00:00.000Z',
  temperatureC: 4,
  apparentTemperatureC: 1,
  precipitationProbabilityPct: 60,
  precipitationAmountMm: 1.2,
  windSpeedKmh: 22,
  windGustKmh: 52,
  windDirectionDeg: 280,
  weatherCode: 'rain',
  fetchedAt: '2026-09-10T07:00:00.000Z',
};

const NIGHT: ConditionsNightRecord = {
  startDatetime: '2026-09-12T06:00:00.000Z',
  endDatetime: '2026-09-12T05:05:00.000Z',
  startElapsedSeconds: 0,
  endElapsedSeconds: 3900,
  fromStart: true,
  untilFinish: false,
};

function run(patch: Partial<ConditionsRunRecord>): ConditionsRunRecord {
  return {
    id: 'run-1',
    status: 'active',
    completeness: 'complete',
    fetchedAt: '2026-09-10T07:00:00.000Z',
    failureCode: null,
    provider: 'open-meteo',
    ...patch,
  };
}

function conditions(): ConditionsRepository {
  return {
    activeRun: async () => runs.find((entry) => entry.status === 'active') ?? null,
    latestRun: async () =>
      [...runs].sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0] ?? null,
    listPoints: async () => [POINT],
    listNights: async () => [NIGHT],
    requestRefresh: async (participantRaceId) => {
      requested.push(participantRaceId);
      return 'queued';
    },
  };
}

function context(userId: string = RUNNER_A): ConditionsContext {
  return {
    repositories: {
      ...createFakeEntitlementRepositories(entitlements),
      conditions: conditions(),
      racePlans: {
        findActive: async () =>
          hasPlan ? ({ id: PLAN_ID, startAt: planStart } as RacePlanRecord) : null,
      },
      races: {
        findById: async () => ({ timezone: 'Europe/Paris', startDatetime: START }) as RaceRecord,
      },
      waypoints: {
        listByRace: async () => [{ id: 'col', name: 'Col du Rawil' } as CourseWaypointRecord],
      },
    },
    actor: { userId },
    now: () => NOW,
  };
}

function racePass(): void {
  grantEntitlement(entitlements, { kind: 'race_pass', userId: RUNNER_A, participantRaceId: own });
}

beforeEach(() => {
  const participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  seedParticipation(participation, { userId: RUNNER_B, raceId: PUBLIC_RACE });
  entitlements = entitlementBaseState(participation);
  planStart = START;
  hasPlan = true;
  runs = [];
  requested = [];
});

describe('lire ses Conditions', () => {
  it('W03 — sans Race Pass, aucune prévision personnalisée', async () => {
    runs = [run({})];
    const view = await getRaceConditions(context(), { participantRaceId: own });

    expect(view).toMatchObject({ status: 'not_entitled', forecast: null, refreshDue: false });
  });

  it('W01 — avant J-14, le jour d’ouverture et rien d’autre', async () => {
    racePass();
    planStart = '2026-09-30T06:00:00.000Z';
    const view = await getRaceConditions(context(), { participantRaceId: own });

    expect(view).toMatchObject({
      status: 'too_early',
      opensOn: '2026-09-16',
      forecast: null,
      horizon: null,
    });
  });

  it('sans Plan, attend le Plan', async () => {
    racePass();
    hasPlan = false;

    expect((await getRaceConditions(context(), { participantRaceId: own })).status).toBe('no_plan');
  });

  it('rend la prévision active, ses points nommés et ses nuits', async () => {
    racePass();
    runs = [run({})];
    const view = await getRaceConditions(context(), { participantRaceId: own });

    expect(view).toMatchObject({
      status: 'eligible',
      horizon: 'near',
      startAt: START,
      refreshDue: false,
      lastFailureAt: null,
      attribution: { text: 'Weather data by Open-Meteo.com' },
      forecast: { fetchedAt: '2026-09-10T07:00:00.000Z', completeness: 'complete' },
    });
    expect(view.forecast?.points[0]).toMatchObject({ label: 'Col du Rawil', temperatureC: 4 });
    expect(view.forecast?.nights).toEqual([NIGHT]);
  });

  it('§32 — une prévision trop ancienne pour l’horizon est à rafraîchir', async () => {
    racePass();
    // Quatre heures à J-2 : au-delà des 3 h permises.
    runs = [run({ fetchedAt: '2026-09-10T04:00:00.000Z' })];

    expect((await getRaceConditions(context(), { participantRaceId: own })).refreshDue).toBe(true);
  });

  it('§90 — dit qu’une mise à jour a échoué depuis la prévision affichée', async () => {
    racePass();
    runs = [run({}), run({ id: 'run-2', status: 'failed', fetchedAt: '2026-09-10T07:30:00.000Z' })];

    expect((await getRaceConditions(context(), { participantRaceId: own })).lastFailureAt).toBe(
      '2026-09-10T07:30:00.000Z',
    );
  });

  it('ne lit pas les Conditions d’un autre coureur', async () => {
    racePass();

    await expect(
      getRaceConditions(context(RUNNER_B), { participantRaceId: own }),
    ).rejects.toThrow();
  });
});

describe('demander un rafraîchissement', () => {
  it('demande une prévision qui manque', async () => {
    racePass();

    await expect(
      requestRaceConditionsRefresh(context(), { participantRaceId: own }),
    ).resolves.toEqual({ result: 'queued' });
    expect(requested).toEqual([own]);
  });

  it('§31 — ne redemande pas une prévision encore fraîche', async () => {
    racePass();
    runs = [run({})];

    await expect(
      requestRaceConditionsRefresh(context(), { participantRaceId: own }),
    ).resolves.toEqual({ result: 'fresh' });
    expect(requested).toEqual([]);
  });

  it('W03 — sans Race Pass, ne demande rien', async () => {
    await expect(
      requestRaceConditionsRefresh(context(), { participantRaceId: own }),
    ).resolves.toEqual({ result: 'unavailable', status: 'not_entitled' });
    expect(requested).toEqual([]);
  });

  it('W01 — avant J-14, ne demande rien', async () => {
    racePass();
    planStart = '2026-09-30T06:00:00.000Z';

    await expect(
      requestRaceConditionsRefresh(context(), { participantRaceId: own }),
    ).resolves.toEqual({ result: 'unavailable', status: 'too_early' });
    expect(requested).toEqual([]);
  });
});
