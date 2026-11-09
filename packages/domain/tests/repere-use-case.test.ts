import type { RepereEstimateInput } from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { DomainError, estimateRepere, type RepereContext } from '../src/index.js';
import {
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
  type ParticipationState,
} from './fixtures/participation-repositories.js';
import {
  createFakePlanRepositories,
  planBaseState,
  type PlanState,
} from './fixtures/plan-repositories.js';

/**
 * Le cas d'usage du Repère PLUKA — REPERE_PLUKA §5, §6, REP-06.
 *
 * Il lit la course du coureur, garde la plage pour le calibrage, et ne touche
 * ni à l'objectif ni au Plan.
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');

let participation: ParticipationState;
let plan: PlanState;
let recorded: RepereEstimateInput[];
let own: string;

function contextFor(userId: string): RepereContext {
  return {
    repositories: {
      ...createFakePlanRepositories(plan),
      repereEstimates: {
        record: (estimate) => {
          recorded.push(estimate);
          return Promise.resolve();
        },
      },
    },
    actor: { userId },
    now: () => NOW,
  };
}

const EFFORT = {
  kind: 'effort',
  distanceKm: 20,
  elevationGainM: 800,
  durationSeconds: 9000,
  date: '2026-01-15',
} as const;

beforeEach(() => {
  participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  plan = planBaseState(participation, PUBLIC_RACE);
  recorded = [];
});

describe('estimateRepere', () => {
  it('rend une plage pour la course du coureur et la garde avec sa version', async () => {
    const estimate = await estimateRepere(contextFor(RUNNER_A), {
      participantRaceId: own,
      reference: EFFORT,
    });

    expect(estimate.result.ok).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      participantRaceId: own,
      configVersion: 'repere-v0.1.0',
      referenceKind: 'effort',
      outcome: 'range',
    });
    // Une course de 42 km et 2 000 m D+ : le moteur l'a lue depuis l'épreuve.
    expect(recorded[0]?.input).toMatchObject({ course: { distanceKm: 42, elevationGainM: 2000 } });
  });

  it('REP-06 — ne crée ni objectif ni Plan', async () => {
    await estimateRepere(contextFor(RUNNER_A), { participantRaceId: own, reference: EFFORT });

    expect(plan.plans).toHaveLength(0);
  });

  it('la participation d’un autre est introuvable, et rien n’est gardé', async () => {
    const error = await estimateRepere(contextFor(RUNNER_B), {
      participantRaceId: own,
      reference: EFFORT,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('not_found');
    expect(recorded).toHaveLength(0);
  });

  it('refuse un effort daté dans le futur', async () => {
    await expect(
      estimateRepere(contextFor(RUNNER_A), {
        participantRaceId: own,
        reference: { ...EFFORT, date: '2026-04-01' },
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(recorded).toHaveLength(0);
  });

  it('un refus du moteur est gardé aussi, sans plage', async () => {
    const estimate = await estimateRepere(contextFor(RUNNER_A), {
      participantRaceId: own,
      reference: {
        kind: 'effort',
        distanceKm: 3,
        elevationGainM: 0,
        durationSeconds: 1200,
        date: null,
      },
    });

    expect(estimate.result).toMatchObject({ ok: false, reason: 'reference_too_short' });
    expect(recorded[0]).toMatchObject({ outcome: 'reference_too_short', lowSeconds: null });
  });
});
