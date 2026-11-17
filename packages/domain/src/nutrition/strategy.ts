import { z } from 'zod';

import type {
  CourseMicroSegmentRecord,
  EntitlementRepositories,
  NutritionRepositories,
  NutritionSettingsRecord,
  RacePlanRecord,
} from '@pluka/db';
import {
  generateNutrition,
  NUTRITION_ENGINE_V1,
  type NutritionInput,
  type NutritionResult,
  type NutritionTerrainSpan,
  type NutritionTimeline,
  type NutritionTimelinePoint,
} from '@pluka/nutrition-engine';
import { microSegmentWeight, PLAN_ENGINE_V1 } from '@pluka/plan-engine';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { invalidStateError, notFoundError, parseCommand } from '../errors.js';

/**
 * Nutrition, tranche 1 — NUTRITION_ENGINE §6, §7, §10, §35, §83 ; décisions
 * du 2026-11-17.
 *
 * Le coureur fixe ses cibles horaires et le placement de ses prises ; le
 * moteur pur les répartit sur son Plan actif. Les prises et les sections se
 * recalculent à chaque lecture : rien n'est encore personnalisé, donc rien ne
 * peut être écrasé (§57). Quand le Plan change, la stratégie suit le nouveau
 * Plan avec les mêmes cibles, et l'écran le dit.
 *
 * Droits : lire est gratuit (`nutrition.read`) ; régler ses cibles est la
 * stratégie Nutrition complète, au Race Pass (`nutrition.edit`, 04 §44).
 */

export interface NutritionContext {
  readonly repositories: NutritionRepositories & EntitlementRepositories;
  readonly actor: Actor;
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

export interface NutritionStrategyView {
  /**
   * `no_plan` : pas encore de Plan, donc pas de timeline. `off` : la
   * Nutrition n'est pas activée — jamais par défaut (décision du 2026-11-17) ;
   * `settings` garde alors les derniers réglages, pour une réactivation.
   * `ready` : activée, la stratégie est calculée.
   */
  readonly state: 'no_plan' | 'off' | 'ready';
  readonly settings: NutritionSettingsRecord | null;
  readonly result: NutritionResult | null;
  /** Heure de départ du Plan, pour dire l'heure de chaque prise. */
  readonly startAt: string | null;
  readonly timezone: string;
  /** Les cibles ont été réglées sur une version antérieure du Plan. */
  readonly planChangedSinceSettings: boolean;
  readonly canEdit: boolean;
}

const participation = z.object({ participantRaceId: z.uuid() }).strict();

/**
 * Bornes techniques du contrat (§10) — pas des bornes médicales : elles
 * écartent une saisie absurde (une virgule oubliée), jamais un choix.
 */
const settingsCommand = z
  .object({
    participantRaceId: z.uuid(),
    carbsGPerHour: z.number().min(0).max(400),
    hydrationMlPerHour: z.number().int().min(0).max(5000),
    sodiumMgPerHour: z.number().int().min(0).max(10000),
    caffeineTotalMg: z.number().int().min(0).max(5000).nullable(),
    waterSharePercent: z.number().min(0).max(100),
    density: z.enum(['frequent', 'auto', 'sparse']),
    aidBuffer: z.boolean(),
    placementMode: z.enum(['smart', 'interval']).default('smart'),
    // §36 : une cadence de 10 min à 2 h ; seulement en rythme imposé.
    intervalMinutes: z.number().int().min(10).max(120).nullable().default(null),
  })
  .strict();

function serviceContext(context: NutritionContext) {
  return {
    repositories: context.repositories,
    actor: context.actor,
    now: context.now,
    ...(context.disabledCapabilities === undefined
      ? {}
      : { disabledCapabilities: context.disabledCapabilities }),
  };
}

/** Un point où manger ou boire : ravitaillement, eau, assistance autorisée. */
const AID_TYPES = new Set(['aid_station', 'water', 'assistance']);

/**
 * Le terrain d'une section du Plan, tronçon par tronçon. Sa durée prévue se
 * répartit au poids d'effort du moteur Plan (pente, technicité, fatigue) :
 * une montée prend plus de temps qu'une descente, comme dans le Plan.
 */
function sectionTerrain(
  micros: readonly CourseMicroSegmentRecord[],
  departSeconds: number,
  durationSeconds: number,
  startKm: number,
  endKm: number,
): NutritionTerrainSpan[] {
  if (micros.length === 0 || durationSeconds <= 0) return [];
  const weights = micros.map((micro) => microSegmentWeight({ ...micro }, PLAN_ENGINE_V1).weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const totalMeters = micros.reduce((sum, micro) => sum + micro.distanceMeters, 0);
  if (totalWeight <= 0 || totalMeters <= 0) return [];

  const spans: NutritionTerrainSpan[] = [];
  let elapsed = departSeconds;
  let meters = 0;
  micros.forEach((micro, index) => {
    const duration = (durationSeconds * (weights[index] ?? 0)) / totalWeight;
    const fromKm = startKm + ((endKm - startKm) * meters) / totalMeters;
    meters += micro.distanceMeters;
    spans.push({
      startElapsedSeconds: elapsed,
      endElapsedSeconds: elapsed + duration,
      startKm: fromKm,
      endKm: startKm + ((endKm - startKm) * meters) / totalMeters,
      grade: micro.modelGrade,
    });
    elapsed += duration;
  });
  return spans;
}

/** La timeline générique du moteur, depuis le Plan actif (§6, §7). */
async function timelineOf(
  context: NutritionContext,
  raceId: string,
  plan: RacePlanRecord,
): Promise<NutritionTimeline> {
  const repositories = context.repositories;
  const [planWaypoints, planSegments, waypoints, segments, geometry] = await Promise.all([
    repositories.racePlans.listWaypoints(plan.id),
    repositories.racePlans.listSegments(plan.id),
    repositories.waypoints.listByRace(raceId),
    repositories.planCourse.listSegments(raceId),
    repositories.planCourse.findCurrentCourseGeometry(raceId),
  ]);
  const micros =
    geometry === null ? [] : await repositories.planCourse.listMicroSegments(geometry.id);

  const byId = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));
  const points: NutritionTimelinePoint[] = [...planWaypoints]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((step) => {
      const waypoint = byId.get(step.raceWaypointId);
      if (waypoint === undefined) return [];
      const kind: NutritionTimelinePoint['kind'] =
        waypoint.waypointType === 'start'
          ? 'start'
          : waypoint.waypointType === 'finish'
            ? 'finish'
            : AID_TYPES.has(waypoint.waypointType) || waypoint.assistanceAllowed
              ? 'aid'
              : 'passage';
      return [
        {
          id: waypoint.id,
          name: waypoint.name,
          kind,
          elapsedSeconds: step.plannedElapsedSeconds,
          stopSeconds: step.stopDurationSeconds,
          distanceKm: waypoint.distanceKm,
        },
      ];
    });
  const pointById = new Map(points.map((point) => [point.id, point]));
  const durationOf = new Map(
    planSegments.map((segment) => [segment.raceSegmentId, segment.plannedDurationSeconds]),
  );

  const terrain = [...segments]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((segment) => {
      const from = pointById.get(segment.fromWaypointId);
      const to = pointById.get(segment.toWaypointId);
      const duration = durationOf.get(segment.id);
      if (from === undefined || to === undefined || duration === undefined) return [];
      return sectionTerrain(
        micros
          .filter((micro) => micro.raceSegmentId === segment.id)
          .sort((left, right) => left.sortOrder - right.sortOrder),
        from.elapsedSeconds + from.stopSeconds,
        duration,
        from.distanceKm,
        to.distanceKm,
      );
    });

  return {
    finishElapsedSeconds: points[points.length - 1]?.elapsedSeconds ?? 0,
    points,
    terrain,
  };
}

function engineInput(
  timeline: NutritionTimeline,
  settings: Pick<
    NutritionSettingsRecord,
    | 'carbsGPerHour'
    | 'hydrationMlPerHour'
    | 'sodiumMgPerHour'
    | 'caffeineTotalMg'
    | 'waterSharePercent'
    | 'density'
    | 'aidBuffer'
    | 'placementMode'
    | 'intervalMinutes'
  >,
): NutritionInput {
  return {
    timeline,
    targets: {
      carbsGPerHour: settings.carbsGPerHour,
      hydrationMlPerHour: settings.hydrationMlPerHour,
      sodiumMgPerHour: settings.sodiumMgPerHour,
      caffeineTotalMg: settings.caffeineTotalMg,
      waterShare: settings.waterSharePercent / 100,
    },
    placement: {
      mode: settings.placementMode,
      density: settings.density,
      aidBuffer: settings.aidBuffer,
      intervalSeconds: settings.intervalMinutes === null ? null : settings.intervalMinutes * 60,
    },
  };
}

async function scopeOf(context: NutritionContext, participantRaceId: string, useCase: string) {
  const record = await context.repositories.participantRaces.findById(participantRaceId);
  if (record === null) throw notFoundError(useCase, 'participation');
  const [race, plan] = await Promise.all([
    context.repositories.races.findById(record.raceId),
    context.repositories.racePlans.findActive(participantRaceId),
  ]);
  return { raceId: record.raceId, timezone: race?.timezone ?? 'Europe/Paris', plan };
}

/** La stratégie Nutrition d'une course, calculée sur le Plan actif. Gratuit à lire. */
export async function getNutritionStrategy(
  context: NutritionContext,
  input: unknown,
): Promise<NutritionStrategyView> {
  const useCase = 'getNutritionStrategy';
  const { participantRaceId } = parseCommand(participation, input, useCase);

  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.read',
    participantRaceId,
  });

  const [{ raceId, timezone, plan }, settings, entitlements] = await Promise.all([
    scopeOf(context, participantRaceId, useCase),
    context.repositories.nutrition.findLatest(participantRaceId),
    resolveEntitlements(serviceContext(context), { participantRaceId }),
  ]);
  const canEdit = can(entitlements, 'nutrition.edit').allowed;
  const base = { startAt: plan?.startAt ?? null, timezone, canEdit };

  if (plan === null) {
    return {
      ...base,
      state: 'no_plan',
      settings,
      result: null,
      planChangedSinceSettings: false,
    };
  }
  if (settings === null || !settings.enabled) {
    return {
      ...base,
      state: 'off',
      settings,
      result: null,
      planChangedSinceSettings: false,
    };
  }

  const timeline = await timelineOf(context, raceId, plan);
  return {
    ...base,
    state: 'ready',
    settings,
    result: generateNutrition(engineInput(timeline, settings)),
    planChangedSinceSettings: !settings.onActivePlan,
  };
}

/** Régler ses cibles et le placement de ses prises — Race Pass (`nutrition.edit`). */
export async function saveNutritionSettings(
  context: NutritionContext,
  input: unknown,
): Promise<NutritionResult> {
  const useCase = 'saveNutritionSettings';
  const command = parseCommand(settingsCommand, input, useCase);

  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });

  const { raceId, plan } = await scopeOf(context, command.participantRaceId, useCase);
  if (plan === null) {
    throw invalidStateError(useCase, 'aucun Plan actif : construire le Plan d’abord');
  }

  const engine = engineInput(await timelineOf(context, raceId, plan), command);
  const result = generateNutrition(engine);

  await context.repositories.nutrition.save(command.participantRaceId, {
    carbsGPerHour: command.carbsGPerHour,
    hydrationMlPerHour: command.hydrationMlPerHour,
    sodiumMgPerHour: command.sodiumMgPerHour,
    caffeineTotalMg: command.caffeineTotalMg,
    waterSharePercent: command.waterSharePercent,
    density: command.density,
    aidBuffer: command.aidBuffer,
    placementMode: command.placementMode,
    intervalMinutes: command.placementMode === 'interval' ? command.intervalMinutes : null,
    engineVersion: result.engineVersion,
    engineConfigVersion: result.configVersion,
    inputHash: result.inputHash,
    // §79 : ce qui décrit le calcul, sans le terrain détaillé — il se retrouve
    // depuis la géométrie courante, comme pour le Plan (AGENTS §78).
    inputSnapshot: {
      race_plan_id: plan.id,
      targets: engine.targets,
      placement: engine.placement,
      point_count: engine.timeline.points.length,
      terrain_span_count: engine.timeline.terrain.length,
    },
  });
  return result;
}

export { NUTRITION_ENGINE_V1 };

/**
 * Désactiver la Nutrition. Toujours permis, même sans Race Pass : on ne
 * retient pas un coureur dans une fonctionnalité. Les réglages restent.
 */
export async function disableNutrition(context: NutritionContext, input: unknown): Promise<void> {
  const { participantRaceId } = parseCommand(participation, input, 'disableNutrition');

  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.read',
    participantRaceId,
  });
  await context.repositories.nutrition.disable(participantRaceId);
}
