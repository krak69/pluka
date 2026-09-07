import type {
  CourseMicroSegmentRecord,
  PersistPlanInput,
  PlanFactDependency,
  PlanRepositories,
  PlanSegmentRecord,
  PlanWaypointRecord,
  RaceCutoffRecord,
  RacePlanRecord,
  RaceSegmentRecord,
  RaceWaypointRecord,
} from '@pluka/db';

import {
  createFakeParticipationRepositories,
  type ParticipationState,
} from './participation-repositories.js';

/**
 * Repositories Plan en mémoire.
 *
 * Ils reproduisent ce que la migration 0020 garantit en base, et rien de plus :
 *
 * - `ux_active_race_plan` — une seule version active par participation, donc
 *   l'ancienne est archivée avant l'insertion de la suivante ;
 * - `version = max + 1` sur la participation (PLAN_ENGINE §36) ;
 * - le refus d'écrire sur la participation d'un autre.
 *
 * Sans le premier point, les tests de versionnement passeraient sur un état que
 * la base refuserait ; sans le troisième, la garde de propriété serait vérifiée
 * dans le use case seulement, alors que la fonction SQL la porte aussi.
 */

export interface StoredPlan {
  readonly record: RacePlanRecord;
  readonly waypoints: readonly PlanWaypointRecord[];
  readonly segments: readonly PlanSegmentRecord[];
  readonly dependencies: readonly PlanFactDependency[];
  readonly cutoffStatuses: PersistPlanInput['cutoffStatuses'];
  readonly inputSnapshot: Readonly<Record<string, unknown>>;
}

export interface PlanState {
  readonly participation: ParticipationState;
  waypoints: RaceWaypointRecord[];
  segments: RaceSegmentRecord[];
  cutoffs: RaceCutoffRecord[];
  microSegments: CourseMicroSegmentRecord[];
  factDependencies: PlanFactDependency[];
  courseGeometryId: string | null;
  startWaves: Map<string, string>;
  plans: StoredPlan[];
}

export const PREPROCESSING_VERSION = 'plan-preprocessing-1.0.0';

/** Identifiants de la fixture. Des UUID : les commandes les valident comme tels. */
export const WP0 = 'ffff0000-0000-4000-8000-000000000010';
export const WP1 = 'ffff0000-0000-4000-8000-000000000011';
export const WP2 = 'ffff0000-0000-4000-8000-000000000012';
export const SEG0 = 'ffff0000-0000-4000-8000-000000000020';
export const SEG1 = 'ffff0000-0000-4000-8000-000000000021';

/**
 * Parcours de test : dix kilomètres plats en deux segments de 5 km.
 *
 * Le même que P01 du moteur, pour que les durées attendues restent calculables
 * à la main — 1756 s puis 1844 s pour un objectif d'une heure.
 */
export function planBaseState(participation: ParticipationState, raceId: string): PlanState {
  const waypoints: RaceWaypointRecord[] = [
    {
      id: WP0,
      raceId,
      name: 'Départ',
      sortOrder: 0,
      distanceKm: 0,
      waypointType: 'start',
      altitudeM: 900,
    },
    {
      id: WP1,
      raceId,
      name: 'Col du Test',
      sortOrder: 1,
      distanceKm: 5,
      waypointType: 'aid_station',
      altitudeM: 1400,
    },
    {
      id: WP2,
      raceId,
      name: 'Arrivée',
      sortOrder: 2,
      distanceKm: 10,
      waypointType: 'finish',
      altitudeM: 900,
    },
  ];

  const segments: RaceSegmentRecord[] = [
    { id: SEG0, raceId, sortOrder: 0, fromWaypointId: WP0, toWaypointId: WP1 },
    { id: SEG1, raceId, sortOrder: 1, fromWaypointId: WP1, toWaypointId: WP2 },
  ];

  const microSegments: CourseMicroSegmentRecord[] = segments.map((segment, index) => ({
    id: `micro${index}`,
    raceSegmentId: segment.id,
    sortOrder: index,
    distanceMeters: 5000,
    elevationDeltaMeters: 0,
    elevationGainMeters: 0,
    elevationLossMeters: 0,
    rawGrade: 0,
    modelGrade: 0,
    // Milieu du segment rapporté aux 10 km : 0.25 puis 0.75.
    progress: index === 0 ? 0.25 : 0.75,
    technicality: null,
    preprocessingVersion: PREPROCESSING_VERSION,
  }));

  return {
    participation,
    waypoints,
    segments,
    cutoffs: [],
    microSegments,
    factDependencies: [
      { raceFactVersionId: 'fv-cutoff-1', dependencyType: 'cutoff', dependencyKey: 'barriere-col' },
      { raceFactVersionId: 'fv-wp-1', dependencyType: 'waypoint', dependencyKey: 'col-du-test' },
    ],
    courseGeometryId: 'geometry-1',
    startWaves: new Map(),
    plans: [],
  };
}

let sequence = 0;

export function createFakePlanRepositories(state: PlanState): PlanRepositories {
  const participation = createFakeParticipationRepositories(state.participation);

  return {
    participantRaces: participation.participantRaces,
    races: participation.races,
    editions: participation.editions,
    events: participation.events,

    planCourse: {
      listWaypoints: async (raceId) =>
        state.waypoints
          .filter((waypoint) => waypoint.raceId === raceId)
          .sort((left, right) => left.sortOrder - right.sortOrder),
      listSegments: async (raceId) =>
        state.segments
          .filter((segment) => segment.raceId === raceId)
          .sort((left, right) => left.sortOrder - right.sortOrder),
      listCutoffs: async (raceId) => state.cutoffs.filter((cutoff) => cutoff.raceId === raceId),
      listMicroSegments: async (courseGeometryId) =>
        courseGeometryId === state.courseGeometryId
          ? [...state.microSegments].sort((left, right) => left.sortOrder - right.sortOrder)
          : [],
      listFactDependencies: async () => state.factDependencies,
      findCurrentCourseGeometryId: async () => state.courseGeometryId,
      findStartWaveDatetime: async (waveId) => state.startWaves.get(waveId) ?? null,
    },

    racePlans: {
      findActive: async (participantRaceId) =>
        state.plans.find(
          (plan) =>
            plan.record.participantRaceId === participantRaceId && plan.record.status === 'active',
        )?.record ?? null,

      listVersions: async (participantRaceId) =>
        state.plans
          .filter((plan) => plan.record.participantRaceId === participantRaceId)
          .map((plan) => plan.record)
          .sort((left, right) => left.version - right.version),

      listWaypoints: async (racePlanId) =>
        state.plans.find((plan) => plan.record.id === racePlanId)?.waypoints ?? [],

      listSegments: async (racePlanId) =>
        state.plans.find((plan) => plan.record.id === racePlanId)?.segments ?? [],

      listDependencies: async (racePlanId) =>
        state.plans.find((plan) => plan.record.id === racePlanId)?.dependencies ?? [],

      // Trié par marge croissante, comme le repository réel : le premier est
      // le point le plus serré (PLAN_ENGINE §64).
      listCutoffStatuses: async (racePlanId) =>
        [...(state.plans.find((plan) => plan.record.id === racePlanId)?.cutoffStatuses ?? [])]
          .sort((left, right) => left.marginSeconds - right.marginSeconds)
          .map((status) => ({
            raceCutoffId: status.raceCutoffId,
            raceWaypointId: status.raceWaypointId,
            marginSeconds: status.marginSeconds,
            status: status.status,
          })),

      persist: async (input) => {
        // La fonction SQL revérifie la propriété quel que soit l'appelant
        // (AGENTS §26). Le fake fait de même, sinon un use case qui oublierait
        // sa garde passerait les tests.
        const owner = state.participation.participants.find(
          (row) => row.id === input.participantRaceId,
        );
        if (owner === undefined || owner.userId !== input.actorUserId) {
          throw new Error('plan participation not owned by actor');
        }

        // §36 : une seule version active.
        for (let index = 0; index < state.plans.length; index += 1) {
          const stored = state.plans[index] as StoredPlan;
          if (
            stored.record.participantRaceId === input.participantRaceId &&
            stored.record.status === 'active'
          ) {
            state.plans[index] = {
              ...stored,
              record: { ...stored.record, status: 'superseded' },
            };
          }
        }

        const version =
          state.plans
            .filter((plan) => plan.record.participantRaceId === input.participantRaceId)
            .reduce((max, plan) => Math.max(max, plan.record.version), 0) + 1;

        sequence += 1;
        const record: RacePlanRecord = {
          id: `plan-${sequence}`,
          participantRaceId: input.participantRaceId,
          version,
          status: 'active',
          engineVersion: input.summary.engineVersion,
          initialTargetDurationSeconds: input.summary.initialTargetDurationSeconds,
          targetDurationSeconds: input.summary.targetDurationSeconds,
          plannedFinishDatetime: input.summary.plannedFinishDatetime,
          inputHash: input.summary.inputHash,
        };

        state.plans.push({
          record,
          waypoints: input.waypoints.map((waypoint) => ({
            raceWaypointId: waypoint.raceWaypointId,
            sortOrder: waypoint.sortOrder,
            plannedElapsedSeconds: waypoint.plannedElapsedSeconds,
            stopDurationSeconds: waypoint.stopDurationSeconds,
            stopOrigin: waypoint.stopOrigin,
            isLocked: waypoint.isLocked,
            lockedElapsedSeconds: waypoint.lockedElapsedSeconds,
          })),
          segments: input.segments.map((segment) => ({
            raceSegmentId: segment.raceSegmentId,
            sortOrder: segment.sortOrder,
            initialDurationSeconds: segment.initialDurationSeconds,
            plannedDurationSeconds: segment.plannedDurationSeconds,
            manualOverride: segment.manualOverride,
          })),
          dependencies: input.dependencies,
          cutoffStatuses: input.cutoffStatuses,
          inputSnapshot: input.summary.inputSnapshot,
        });

        return { racePlanId: record.id, version };
      },
    },
  };
}

export function activePlan(state: PlanState): StoredPlan {
  const plan = state.plans.find((entry) => entry.record.status === 'active');
  if (plan === undefined) throw new Error('aucun Plan actif dans la fixture');

  return plan;
}
