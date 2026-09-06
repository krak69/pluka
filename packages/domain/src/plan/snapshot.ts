import type {
  EditionRecord,
  EventRecord,
  ParticipantRaceRecord,
  PlanRepositories,
  RaceRecord,
} from '@pluka/db';
import {
  PLAN_ENGINE_V1,
  type PlanAnchorInput,
  type PlanCalculationInput,
  type PlanEngineConfig,
  type PlanMode,
  type PlanSegmentOverrideInput,
  type PlanStopInput,
} from '@pluka/plan-engine';

import { invalidStateError, notFoundError } from '../errors.js';

/**
 * Assemblage du snapshot moteur — docs/engines/PLAN_ENGINE.md §6.
 *
 * « Le moteur reçoit un snapshot cohérent. Il ne lit ni PostgreSQL, ni un PDF,
 * ni un écran React, ni une URL, ni une source brute, ni un provider météo. Le
 * service de domaine assemble et valide les données avant l'appel. »
 *
 * C'est exactement ce fichier : il lit la base, résout le départ effectif,
 * convertit les barrières en temps écoulé, et rend une entrée que le moteur
 * peut consommer sans rien savoir de sa provenance.
 */

/** Portée d'un Plan : la participation et la hiérarchie de course au-dessus. */
export interface PlanScope {
  readonly participation: ParticipantRaceRecord;
  readonly race: RaceRecord;
  readonly edition: EditionRecord;
  readonly event: EventRecord;
  /** Départ effectif résolu selon §5.2. */
  readonly startAt: string;
}

/**
 * Contraintes explicites d'un Plan — §24.
 *
 * « Toute personnalisation explicite reste une contrainte jusqu'à ce que
 * l'utilisateur la retire. » Elles sont relues du Plan actif à chaque
 * recalcul : sans cela, un changement d'objectif écraserait un override, ce
 * que §21.2 interdit.
 */
export interface PlanConstraints {
  readonly targetDurationSeconds: number;
  readonly stops: readonly PlanStopInput[];
  readonly segmentOverrides: readonly PlanSegmentOverrideInput[];
  readonly anchors: readonly PlanAnchorInput[];
}

export const EMPTY_CONSTRAINTS = {
  stops: [] as readonly PlanStopInput[],
  segmentOverrides: [] as readonly PlanSegmentOverrideInput[],
  anchors: [] as readonly PlanAnchorInput[],
} as const;

/**
 * Départ effectif — §5.2.
 *
 * ```text
 * participant_race.personal_start_datetime
 * → heure de vague applicable
 * → race.start_datetime
 * ```
 *
 * « Le moteur reçoit ensuite un `startAt` non ambigu. » La résolution appartient
 * donc au service, jamais au moteur : lui ne connaît qu'un instant.
 */
export async function resolveStartAt(
  repositories: PlanRepositories,
  participation: ParticipantRaceRecord,
  race: RaceRecord,
): Promise<string> {
  if (participation.personalStartDatetime !== null) return participation.personalStartDatetime;

  if (participation.startWaveId !== null) {
    const wave = await repositories.planCourse.findStartWaveDatetime(participation.startWaveId);
    if (wave !== null) return wave;
  }

  return race.startDatetime;
}

/**
 * Charge la portée d'un Plan, propriété vérifiée.
 *
 * 03_PRIVACY_RLS §120 : une participation qui n'est pas la sienne est
 * « introuvable », jamais « interdite ». Le contrôle vient avant toute question
 * commerciale (§24 d'AGENTS).
 */
export async function loadPlanScope(
  repositories: PlanRepositories,
  actorUserId: string,
  participantRaceId: string,
  useCase: string,
): Promise<PlanScope> {
  const participation = await repositories.participantRaces.findById(participantRaceId);
  if (participation === null || participation.userId !== actorUserId) {
    throw notFoundError(useCase, 'participation');
  }

  const race = await repositories.races.findById(participation.raceId);
  if (race === null) throw notFoundError(useCase, 'épreuve');

  const edition = await repositories.editions.findById(race.editionId);
  if (edition === null) throw notFoundError(useCase, 'édition');

  const event = await repositories.events.findById(edition.eventId);
  if (event === null) throw notFoundError(useCase, 'événement');

  return {
    participation,
    race,
    edition,
    event,
    startAt: await resolveStartAt(repositories, participation, race),
  };
}

/**
 * Reconstruit les contraintes portées par le Plan actif.
 *
 * Un arrêt `default` est la proposition de PLUKA, un `manual` un choix du
 * coureur : la distinction gouverne le mode dérive (§21.6), et c'est pour la
 * conserver que la migration 0020 ajoute `plan_waypoints.stop_origin`.
 */
export async function loadConstraints(
  repositories: PlanRepositories,
  racePlanId: string,
  targetDurationSeconds: number,
): Promise<PlanConstraints> {
  const [waypoints, segments] = await Promise.all([
    repositories.racePlans.listWaypoints(racePlanId),
    repositories.racePlans.listSegments(racePlanId),
  ]);

  return {
    targetDurationSeconds,
    stops: waypoints
      .filter((waypoint) => waypoint.stopDurationSeconds > 0)
      .map((waypoint) => ({
        waypointId: waypoint.raceWaypointId,
        durationSeconds: waypoint.stopDurationSeconds,
        origin: waypoint.stopOrigin,
      })),
    segmentOverrides: segments
      .filter((segment) => segment.manualOverride)
      .map((segment) => ({
        segmentId: segment.raceSegmentId,
        durationSeconds: segment.plannedDurationSeconds,
      })),
    anchors: waypoints
      .filter(
        (waypoint): waypoint is typeof waypoint & { lockedElapsedSeconds: number } =>
          waypoint.isLocked && waypoint.lockedElapsedSeconds !== null,
      )
      .map((waypoint) => ({
        waypointId: waypoint.raceWaypointId,
        arrivalElapsedSeconds: waypoint.lockedElapsedSeconds,
      })),
  };
}

export interface BuildSnapshotOptions {
  readonly repositories: PlanRepositories;
  readonly scope: PlanScope;
  readonly constraints: PlanConstraints;
  readonly mode: PlanMode;
  readonly engineConfig?: PlanEngineConfig;
}

/**
 * Construit l'entrée du moteur.
 *
 * Les micro-segments viennent de la géométrie courante, prétraitée une fois à
 * l'import (§8, §8.1 étape 11). Le GPX n'est jamais reparsé ici : §15 est
 * explicite, et §62 le répète — « l'important est qu'il ne soit pas recomputé à
 * chaque édition du Plan ».
 */
export async function buildSnapshot(options: BuildSnapshotOptions): Promise<PlanCalculationInput> {
  const useCase = 'buildPlanSnapshot';
  const { repositories, scope, constraints } = options;
  const config = options.engineConfig ?? PLAN_ENGINE_V1;

  const geometryId = await repositories.planCourse.findCurrentCourseGeometryId(scope.race.id);
  if (geometryId === null) {
    throw invalidStateError(useCase, 'cette épreuve n’a pas encore de parcours prétraité');
  }

  const [waypoints, segments, cutoffs, microSegments] = await Promise.all([
    repositories.planCourse.listWaypoints(scope.race.id),
    repositories.planCourse.listSegments(scope.race.id),
    repositories.planCourse.listCutoffs(scope.race.id),
    repositories.planCourse.listMicroSegments(geometryId),
  ]);

  if (microSegments.length === 0) {
    throw invalidStateError(useCase, 'le parcours prétraité ne porte aucun micro-segment');
  }

  const startMs = Date.parse(scope.startAt);

  return {
    race: { id: scope.race.id, timezone: scope.race.timezone, startAt: scope.startAt },
    course: {
      preprocessingVersion: microSegments[0]?.preprocessingVersion ?? config.preprocessingVersion,
      microSegments: microSegments.map((micro) => ({
        id: micro.id,
        raceSegmentId: micro.raceSegmentId,
        sortOrder: micro.sortOrder,
        distanceMeters: micro.distanceMeters,
        elevationDeltaMeters: micro.elevationDeltaMeters,
        elevationGainMeters: micro.elevationGainMeters,
        elevationLossMeters: micro.elevationLossMeters,
        rawGrade: micro.rawGrade,
        modelGrade: micro.modelGrade,
        progress: micro.progress,
        technicality: micro.technicality,
      })),
      raceSegments: segments.map((segment) => ({
        id: segment.id,
        sortOrder: segment.sortOrder,
        fromWaypointId: segment.fromWaypointId,
        toWaypointId: segment.toWaypointId,
      })),
      waypoints: waypoints.map((waypoint) => ({
        id: waypoint.id,
        sortOrder: waypoint.sortOrder,
      })),
      // §5.1 : le moteur ne raisonne qu'en secondes écoulées. La conversion
      // depuis la date calendaire de la barrière se fait ici, une fois, contre
      // le départ effectif.
      cutoffs: cutoffs.map((cutoff) => ({
        id: cutoff.id,
        waypointId: cutoff.raceWaypointId,
        cutoffElapsedSeconds: Math.round((Date.parse(cutoff.cutoffDatetime) - startMs) / 1000),
        basis: cutoff.basis,
      })),
    },
    targetDurationSeconds: constraints.targetDurationSeconds,
    stops: constraints.stops,
    segmentOverrides: constraints.segmentOverrides,
    anchors: constraints.anchors,
    mode: options.mode,
    engineConfig: config,
  };
}
