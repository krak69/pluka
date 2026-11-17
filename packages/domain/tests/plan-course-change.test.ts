import type { PlanCourseReference } from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DomainError,
  diffPlanCourse,
  generateRacePlan,
  getPlanCourseChange,
  lockPlanWaypoint,
  updatePlanSegmentDuration,
  updatePlanStop,
  updatePlanToCurrentCourse,
  type PlanContext,
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
  type ParticipationState,
} from './fixtures/participation-repositories.js';
import {
  activePlan,
  createFakePlanRepositories,
  planBaseState,
  SEG1,
  WP1,
  type PlanState,
} from './fixtures/plan-repositories.js';

/**
 * « Le parcours a changé » — PLAN_ENGINE §39, décisions du 2026-11-17.
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');

const COURSE: PlanCourseReference = {
  waypoints: [
    { id: 'a', name: 'Départ', distanceKm: 0 },
    { id: 'b', name: 'Col', distanceKm: 12 },
    { id: 'c', name: 'Arrivée', distanceKm: 27 },
  ],
  cutoffs: [{ waypointId: 'b', at: '2026-07-04T10:00:00.000Z' }],
};

describe('diffPlanCourse — pure', () => {
  it('ne voit rien quand le parcours est le même', () => {
    expect(diffPlanCourse(COURSE, [], COURSE)).toBeNull();
  });

  it('nomme un point ajouté, un point retiré, un point déplacé', () => {
    const current: PlanCourseReference = {
      waypoints: [
        { id: 'a', name: 'Départ', distanceKm: 0 },
        { id: 'd', name: 'Ravito #1', distanceKm: 8 },
        { id: 'c', name: 'Arrivée', distanceKm: 27.5 },
      ],
      cutoffs: COURSE.cutoffs,
    };

    expect(diffPlanCourse(COURSE, [], current)).toEqual({
      added: ['Ravito #1'],
      removed: ['Col'],
      moved: [{ name: 'Arrivée', fromKm: 27, toKm: 27.5 }],
      cutoffsChanged: false,
    });
  });

  it('voit une barrière déplacée, même au même point', () => {
    const current = { ...COURSE, cutoffs: [{ waypointId: 'b', at: '2026-07-04T10:30:00.000Z' }] };

    expect(diffPlanCourse(COURSE, [], current)?.cutoffsChanged).toBe(true);
  });

  it('ignore un kilomètre réenregistré à l’identique, et l’écriture d’un même instant', () => {
    const current = {
      waypoints: COURSE.waypoints.map((waypoint) => ({ ...waypoint })),
      cutoffs: [{ waypointId: 'b', at: '2026-07-04T12:00:00+02:00' }],
    };

    expect(diffPlanCourse(COURSE, [], current)).toBeNull();
  });

  it('sans empreinte, compare les seuls points du Plan', () => {
    expect(diffPlanCourse(null, ['a', 'c', 'x'], COURSE)).toEqual({
      added: ['Col'],
      removed: [null],
      moved: [],
      cutoffsChanged: false,
    });
    expect(diffPlanCourse(null, ['a', 'b', 'c'], COURSE)).toBeNull();
  });
});

let participation: ParticipationState;
let entitlements: EntitlementState;
let plan: PlanState;
let own: string;

function contextFor(userId: string): PlanContext {
  return {
    repositories: {
      ...createFakePlanRepositories(plan),
      ...createFakeEntitlementRepositories(entitlements),
    },
    actor: { userId },
    now: () => NOW,
  };
}

async function expectDomainError(promise: Promise<unknown>, code: DomainError['code']) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

/** L'organisation déplace le point intermédiaire d'un kilomètre. */
function moveMiddlePoint(): void {
  plan.waypoints = plan.waypoints.map((waypoint) =>
    waypoint.id === WP1 ? { ...waypoint, distanceKm: 6 } : waypoint,
  );
}

beforeEach(async () => {
  participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  entitlements = entitlementBaseState(participation);
  plan = planBaseState(participation, PUBLIC_RACE);

  await generateRacePlan(contextFor(RUNNER_A), {
    participantRaceId: own,
    targetDurationSeconds: 3600,
  });
});

describe('getPlanCourseChange', () => {
  it('enregistre le parcours avec chaque version du Plan', () => {
    expect(activePlan(plan).record.course?.waypoints.map((waypoint) => waypoint.name)).toEqual([
      'Départ',
      'Col du Test',
      'Arrivée',
    ]);
  });

  it('ne signale rien tant que le parcours n’a pas bougé', async () => {
    await expect(
      getPlanCourseChange(contextFor(RUNNER_A), { participantRaceId: own }),
    ).resolves.toBeNull();
  });

  it('signale le point que l’organisation a déplacé', async () => {
    moveMiddlePoint();

    await expect(
      getPlanCourseChange(contextFor(RUNNER_A), { participantRaceId: own }),
    ).resolves.toMatchObject({ moved: [{ name: 'Col du Test', fromKm: 5, toKm: 6 }] });
  });

  it('ne dit rien du Plan d’un autre coureur', async () => {
    moveMiddlePoint();

    await expectDomainError(
      getPlanCourseChange(contextFor(RUNNER_B), { participantRaceId: own }),
      'not_found',
    );
  });
});

describe('updatePlanToCurrentCourse', () => {
  it('met à jour le Plan d’un coureur Free, et l’alerte tombe', async () => {
    const before = activePlan(plan).record.version;
    moveMiddlePoint();

    await updatePlanToCurrentCourse(contextFor(RUNNER_A), { participantRaceId: own });

    expect(activePlan(plan).record.version).toBe(before + 1);
    expect(activePlan(plan).record.targetDurationSeconds).toBe(3600);
    await expect(
      getPlanCourseChange(contextFor(RUNNER_A), { participantRaceId: own }),
    ).resolves.toBeNull();
  });

  it('garde arrêts et verrous, et laisse tomber les durées imposées aux sections', async () => {
    grantEntitlement(entitlements, { kind: 'race_pass', userId: RUNNER_A, participantRaceId: own });
    await updatePlanStop(contextFor(RUNNER_A), {
      participantRaceId: own,
      raceWaypointId: WP1,
      durationSeconds: 300,
      mode: 'rebalance_to_target',
    });
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: own,
      raceSegmentId: SEG1,
      durationSeconds: 2000,
      mode: 'preserve_manual_changes',
    });
    await lockPlanWaypoint(contextFor(RUNNER_A), {
      participantRaceId: own,
      raceWaypointId: WP1,
      arrivalElapsedSeconds: 1900,
      mode: 'preserve_manual_changes',
    });
    // Les trois réglages sont bien posés avant que le parcours ne bouge.
    expect(activePlan(plan).segments.some((segment) => segment.manualOverride)).toBe(true);
    expect(activePlan(plan).waypoints.some((waypoint) => waypoint.isLocked)).toBe(true);
    moveMiddlePoint();

    await updatePlanToCurrentCourse(contextFor(RUNNER_A), { participantRaceId: own });

    const updated = activePlan(plan);
    const middle = updated.waypoints.find((waypoint) => waypoint.raceWaypointId === WP1);
    expect(middle?.stopDurationSeconds).toBe(300);
    expect(middle?.isLocked).toBe(true);
    expect(middle?.lockedElapsedSeconds).toBe(1900);
    expect(updated.segments.some((segment) => segment.manualOverride)).toBe(false);
  });

  it('refuse quand le Plan suit déjà le parcours', async () => {
    await expectDomainError(
      updatePlanToCurrentCourse(contextFor(RUNNER_A), { participantRaceId: own }),
      'invalid_state',
    );
  });

  it('ne touche pas au Plan d’un autre coureur', async () => {
    moveMiddlePoint();

    await expectDomainError(
      updatePlanToCurrentCourse(contextFor(RUNNER_B), { participantRaceId: own }),
      'not_found',
    );
  });
});
