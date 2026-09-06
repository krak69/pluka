import { beforeEach, describe, expect, it } from 'vitest';

import {
  DomainError,
  generateRacePlan,
  getPlanOverview,
  updatePlanStop,
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
  createFakePlanRepositories,
  planBaseState,
  WP0,
  WP1,
  WP2,
  type PlanState,
} from './fixtures/plan-repositories.js';

/**
 * Modèle de lecture du Plan — docs/engines/PLAN_ENGINE.md §64.
 *
 * §64 énumère ce que le résultat doit permettre d'afficher. Ces tests le
 * relisent point par point, sur le parcours P01 : dix kilomètres plats en deux
 * segments de 5 km, 1756 s puis 1844 s pour un objectif d'une heure.
 *
 * L'enjeu de ce modèle est qu'aucun de ces nombres n'ait à être recalculé plus
 * loin. Les allures en particulier : une division faite dans le navigateur
 * serait un second calcul, hors du serveur que §45 rend seul responsable.
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');
const TARGET = 3600;
const D0 = 1756;
const D1 = 1844;

let participation: ParticipationState;
let entitlements: EntitlementState;
let plan: PlanState;
let ownParticipation: string;
let foreignParticipation: string;

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

beforeEach(() => {
  participation = participationBaseState();

  ownParticipation = seedParticipation(participation, {
    userId: RUNNER_A,
    raceId: PUBLIC_RACE,
  }).id;
  foreignParticipation = seedParticipation(participation, {
    userId: RUNNER_B,
    raceId: PUBLIC_RACE,
  }).id;

  entitlements = entitlementBaseState(participation);
  plan = planBaseState(participation, PUBLIC_RACE);
});

async function withInitialPlan(): Promise<void> {
  await generateRacePlan(contextFor(RUNNER_A), {
    participantRaceId: ownParticipation,
    targetDurationSeconds: TARGET,
  });
}

describe('getPlanOverview', () => {
  it('rend les points dans l’ordre, avec horaires et allures', async () => {
    await withInitialPlan();

    const overview = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(overview.points.map((point) => point.raceWaypointId)).toEqual([WP0, WP1, WP2]);
    expect(overview.points.map((point) => point.plannedElapsedSeconds)).toEqual([0, D0, D0 + D1]);

    // §5.3 : les heures calendaires dérivent du départ effectif, 04:00 UTC.
    expect(overview.points.map((point) => point.plannedArrivalAt)).toEqual([
      '2026-06-20T04:00:00.000Z',
      '2026-06-20T04:29:16.000Z',
      '2026-06-20T05:00:00.000Z',
    ]);
  });

  it('calcule l’allure côté serveur, jamais dans l’écran', async () => {
    await withInitialPlan();

    const overview = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    // 1756 s sur 5 km puis 1844 s sur 5 km : 351 et 369 s/km.
    expect(overview.points.map((point) => point.incomingSegment?.paceSecondsPerKm ?? null)).toEqual(
      [null, 351, 369],
    );
    expect(overview.points[0]?.incomingSegment).toBeNull();
  });

  it('expose l’objectif, l’arrivée et l’écart de §27', async () => {
    await withInitialPlan();

    const overview = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(overview.targetDurationSeconds).toBe(TARGET);
    expect(overview.finishElapsedSeconds).toBe(TARGET);
    // Une génération initiale termine sur l'objectif : aucune dérive.
    expect(overview.driftSeconds).toBe(0);
    expect(overview.version).toBe(1);
    expect(overview.timezone).toBe('Europe/Paris');
  });

  it('rend la dérive quand le Plan a été conservé plus long', async () => {
    await withInitialPlan();
    grantEntitlement(entitlements, {
      kind: 'race_pass',
      userId: RUNNER_A,
      participantRaceId: ownParticipation,
    });

    // Un arrêt de dix minutes en mode « conserver » repousse l'arrivée : §27
    // admet explicitement l'écart, il doit se lire.
    await updatePlanStop(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      durationSeconds: 600,
      mode: 'preserve_manual_changes',
    });

    const overview = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(overview.driftSeconds).toBe(600);
    expect(overview.finishElapsedSeconds).toBe(TARGET + 600);
    expect(overview.points[1]?.stopDurationSeconds).toBe(600);
    expect(overview.points[1]?.plannedDepartureElapsedSeconds).toBe(D0 + 600);
  });

  it('nomme le point ayant la marge la plus faible', async () => {
    plan.cutoffs = [
      {
        id: 'cutoff-col',
        raceId: PUBLIC_RACE,
        raceWaypointId: WP1,
        // Passage prévu à 04:29:16 : la barrière laisse 1844 s de marge.
        cutoffDatetime: '2026-06-20T05:00:00Z',
        cutoffType: 'hard',
        basis: 'arrival',
      },
      {
        id: 'cutoff-arrivee',
        raceId: PUBLIC_RACE,
        raceWaypointId: WP2,
        // Arrivée prévue à 05:00 : la barrière laisse 3600 s.
        cutoffDatetime: '2026-06-20T06:00:00Z',
        cutoffType: 'hard',
        basis: 'arrival',
      },
    ];

    await withInitialPlan();

    const overview = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(overview.cutoffs.map((cutoff) => cutoff.marginSeconds)).toEqual([1844, 3600]);
    expect(overview.tightestCutoff?.raceWaypointId).toBe(WP1);
    expect(overview.tightestCutoff?.waypointName).toBe('Col du Test');
  });

  it('rend un profil ancré sur l’altitude officielle du départ', async () => {
    await withInitialPlan();

    const overview = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(overview.profileIsAnchored).toBe(true);
    expect(overview.profile).toEqual([
      { distanceKm: 0, elevationMeters: 900 },
      { distanceKm: 5, elevationMeters: 900 },
      { distanceKm: 10, elevationMeters: 900 },
    ]);
  });

  it('dit que le profil n’est pas ancré quand aucune altitude n’est connue', async () => {
    plan.waypoints = plan.waypoints.map((waypoint) => ({ ...waypoint, altitudeM: null }));

    await withInitialPlan();

    const overview = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    // §54, point 8 : la courbe garde sa forme, mais elle ne prétend pas à des
    // mètres officiels.
    expect(overview.profileIsAnchored).toBe(false);
    expect(overview.profile[0]).toEqual({ distanceKm: 0, elevationMeters: 0 });
    expect(overview.points.map((point) => point.altitudeM)).toEqual([null, null, null]);
  });

  it('reste introuvable tant qu’aucun Plan n’existe', async () => {
    const error = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('not_found');
  });

  it('rend introuvable la participation d’un autre coureur', async () => {
    // 03_PRIVACY_RLS §120 : `not_found`, jamais `forbidden` — un refus explicite
    // confirmerait que cette participation existe.
    const error = await getPlanOverview(contextFor(RUNNER_A), {
      participantRaceId: foreignParticipation,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('not_found');
  });

  it('est lisible en Free : la lecture du Plan n’est pas premium (§41)', async () => {
    await withInitialPlan();

    // Aucun entitlement n'a été accordé à RUNNER_A : la lecture passe quand même.
    await expect(
      getPlanOverview(contextFor(RUNNER_A), { participantRaceId: ownParticipation }),
    ).resolves.toBeDefined();
  });
});
