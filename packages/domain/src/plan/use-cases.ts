import type {
  EntitlementRepositories,
  PersistedPlan,
  PlanFactDependency,
  PlanRepositories,
  RacePlanRecord,
} from '@pluka/db';
import {
  calculatePlan,
  PLAN_ENGINE_V1,
  type PlanCalculationInput,
  type PlanCalculationResult,
  type PlanEngineConfig,
  type PlanMode,
  type PlanStopInput,
} from '@pluka/plan-engine';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { authorizeCapability } from '../entitlements/use-cases.js';
import { invalidStateError, notFoundError } from '../errors.js';
import {
  changePlanTargetCommandSchema,
  generateRacePlanCommandSchema,
  getActivePlanQuerySchema,
  listPlanVersionsQuerySchema,
  lockPlanWaypointCommandSchema,
  preserveCurrentPlanCommandSchema,
  previewPlanQuerySchema,
  rebalancePlanToTargetCommandSchema,
  removePlanSegmentOverrideCommandSchema,
  resetPlanScopeCommandSchema,
  unlockPlanWaypointCommandSchema,
  updatePlanSegmentDurationCommandSchema,
  updatePlanStopCommandSchema,
} from './commands.js';
import {
  buildSnapshot,
  loadConstraints,
  loadPlanScope,
  type PlanConstraints,
  type PlanScope,
} from './snapshot.js';

/**
 * Use cases du Plan — docs/engines/PLAN_ENGINE.md §63.
 *
 * TROIS FRONTIÈRES
 *
 * 1. **Le moteur ne sait rien.** §38 : « le moteur pur ne connaît pas ces
 *    tables », §45 : « le moteur ne connaît pas Free, Race Pass, PLUKA+,
 *    Organizer Included ». Ce fichier lit la base, résout les droits, appelle
 *    `calculatePlan`, range le résultat. Le moteur reçoit un snapshot et rend
 *    une réponse.
 *
 * 2. **Rien n'est persisté avant validation.** §37 sépare la preview de la
 *    confirmation, et §63 le redit : les commandes « persistent uniquement
 *    après validation ». Un conflit rend donc son résultat sans écrire.
 *
 * 3. **Aucune contrainte n'est écrasée.** §24 : « toute personnalisation
 *    explicite reste une contrainte jusqu'à ce que l'utilisateur la retire ».
 *    Chaque commande relit les contraintes du Plan actif, applique sa seule
 *    modification, et laisse le reste intact.
 */
export interface PlanContext {
  readonly repositories: PlanRepositories & EntitlementRepositories;
  readonly actor: Actor;
  /** Horloge serveur, transmise à l'EntitlementService (04_ENTITLEMENTS §22). */
  readonly now: () => Date;
  /**
   * Configuration du moteur — §14, « la version est choisie côté serveur ».
   *
   * Sur le contexte et non dans la commande : un client qui pourrait la fournir
   * choisirait sa propre courbe de pente.
   */
  readonly engineConfig?: PlanEngineConfig;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

/**
 * Résultat d'une commande Plan.
 *
 * `persisted` est nul pour une preview (§37) et pour un calcul en conflit : le
 * résultat existe et s'explique, mais il n'a pas été confirmé.
 */
export interface PlanCommandResult {
  readonly result: PlanCalculationResult;
  readonly persisted: PersistedPlan | null;
}

/** Le Plan actif avec ce qui le compose — §36. */
export interface ActivePlanView {
  readonly plan: RacePlanRecord;
  readonly waypoints: Awaited<ReturnType<PlanRepositories['racePlans']['listWaypoints']>>;
  readonly segments: Awaited<ReturnType<PlanRepositories['racePlans']['listSegments']>>;
  readonly dependencies: readonly PlanFactDependency[];
}

function engineConfigOf(context: PlanContext): PlanEngineConfig {
  return context.engineConfig ?? PLAN_ENGINE_V1;
}

/**
 * Garde commerciale — §45.
 *
 * « Le service applicatif contrôle les droits. […] Chaque mutation premium est
 * revérifiée serveur. » La vérification passe par l'EntitlementService, qui
 * vérifie d'abord la propriété de la participation : un refus commercial ne
 * doit jamais confirmer l'existence de l'objet d'un autre (03_PRIVACY_RLS §24).
 */
async function authorize(
  context: PlanContext,
  capability: Capability,
  participantRaceId: string,
): Promise<void> {
  await authorizeCapability(
    {
      repositories: context.repositories,
      actor: context.actor,
      now: context.now,
      ...(context.disabledCapabilities === undefined
        ? {}
        : { disabledCapabilities: context.disabledCapabilities }),
    },
    { capability, participantRaceId },
  );
}

/**
 * Garde de lecture du Plan.
 *
 * `plan.read` appartient au socle Free (04_ENTITLEMENTS §57) : §41 du moteur
 * veut que « Free puisse lire le premier Plan généré ». La garde reste
 * nécessaire parce qu'elle vérifie d'abord la propriété de la participation.
 */
export async function authorizePlanRead(
  context: PlanContext,
  participantRaceId: string,
): Promise<void> {
  await authorize(context, 'plan.read', participantRaceId);
}

/** Contraintes du Plan actif, ou l'absence de Plan. */
async function currentState(
  context: PlanContext,
  participantRaceId: string,
  useCase: string,
): Promise<{ plan: RacePlanRecord; constraints: PlanConstraints }> {
  const plan = await context.repositories.racePlans.findActive(participantRaceId);
  if (plan === null) {
    throw invalidStateError(useCase, 'aucun Plan actif : générer le Plan initial d’abord');
  }

  return {
    plan,
    constraints: await loadConstraints(context.repositories, plan.id, plan.targetDurationSeconds),
  };
}

interface RunOptions {
  readonly useCase: string;
  readonly scope: PlanScope;
  readonly constraints: PlanConstraints;
  readonly mode: PlanMode;
  /** Objectif initial conservé d'une version à l'autre — §27. */
  readonly initialTargetDurationSeconds: number;
  readonly persist: boolean;
}

/**
 * Cœur commun : assembler, calculer, éventuellement confirmer.
 *
 * Les sept étapes de §37 dans l'ordre : autorisation (faite par l'appelant),
 * input canonique reconstruit serveur, calcul définitif, nouvelle version
 * persistée, ancienne archivée, dépendances de faits enregistrées.
 */
async function run(context: PlanContext, options: RunOptions): Promise<PlanCommandResult> {
  const input: PlanCalculationInput = await buildSnapshot({
    repositories: context.repositories,
    scope: options.scope,
    constraints: options.constraints,
    mode: options.mode,
    engineConfig: engineConfigOf(context),
  });

  const result = calculatePlan(input);

  // §63 : « persistent uniquement après validation ». Un conflit d'ancres ou de
  // durées imposées rend son explication, pas une version de Plan.
  if (!options.persist || result.status !== 'ok' || result.finishElapsedSeconds === null) {
    return { result, persisted: null };
  }

  const dependencies = await context.repositories.planCourse.listFactDependencies(
    options.scope.race.id,
  );

  const persisted = await context.repositories.racePlans.persist({
    participantRaceId: options.scope.participation.id,
    actorUserId: context.actor.userId,
    summary: {
      engineVersion: result.calculationMetadata.engineVersion,
      initialTargetDurationSeconds: options.initialTargetDurationSeconds,
      targetDurationSeconds: result.targetDurationSeconds,
      plannedFinishDatetime: new Date(
        Date.parse(options.scope.startAt) + result.finishElapsedSeconds * 1000,
      ).toISOString(),
      inputHash: result.calculationMetadata.inputHash,
      inputSnapshot: safeInputSnapshot(input, result),
    },
    waypoints: result.planWaypoints.map((waypoint) => ({
      raceWaypointId: waypoint.raceWaypointId,
      sortOrder: waypoint.sortOrder,
      plannedElapsedSeconds: waypoint.plannedElapsedSeconds,
      plannedArrivalAt: waypoint.plannedArrivalAt,
      stopDurationSeconds: waypoint.stopDurationSeconds,
      stopOrigin: stopOriginOf(options.constraints.stops, waypoint.raceWaypointId),
      isLocked: waypoint.isLocked,
      lockedElapsedSeconds: waypoint.lockedElapsedSeconds,
    })),
    segments: result.planSegments.map((segment) => ({
      raceSegmentId: segment.raceSegmentId,
      sortOrder: segment.sortOrder,
      initialDurationSeconds: segment.initialDurationSeconds,
      plannedDurationSeconds: segment.plannedDurationSeconds,
      manualOverride: segment.manualOverride,
    })),
    cutoffStatuses: result.cutoffStatuses.map((status) => ({
      raceCutoffId: status.cutoffId,
      raceWaypointId: status.raceWaypointId,
      marginSeconds: status.marginSeconds,
      status: status.status,
    })),
    dependencies,
  });

  return { result, persisted };
}

function stopOriginOf(stops: readonly PlanStopInput[], waypointId: string): 'default' | 'manual' {
  return stops.find((stop) => stop.waypointId === waypointId)?.origin ?? 'default';
}

/**
 * `input_snapshot` — §36.
 *
 * Il porte ce qui décrit le calcul, pas ce qui le compose. Les micro-segments
 * en sont exclus : ils se retrouvent à l'identique depuis
 * `course_geometry_id` + `preprocessing_version`, et un ultra en compte des
 * milliers. AGENTS §78 refuse le vidage de mémoire de worker dans un JSONB ;
 * `input_hash` couvre déjà la reproductibilité exacte (§34).
 */
function safeInputSnapshot(
  input: PlanCalculationInput,
  result: PlanCalculationResult,
): Record<string, unknown> {
  return {
    mode: input.mode,
    start_at: input.race.startAt,
    timezone: input.race.timezone,
    target_duration_seconds: input.targetDurationSeconds,
    engine_version: input.engineConfig.engineVersion,
    preprocessing_version: input.course.preprocessingVersion,
    micro_segment_count: input.course.microSegments.length,
    stops: input.stops,
    segment_overrides: input.segmentOverrides,
    anchors: input.anchors,
    total_weight: result.calculationMetadata.totalWeight,
    solved_intervals: result.calculationMetadata.solvedIntervals,
  };
}

/**
 * Génération initiale — §63, `generateRacePlan`.
 *
 * `plan.generate_initial` est une capability Free (04_ENTITLEMENTS §57, §41) :
 * « le Free doit pouvoir lire le premier Plan généré ». Le mode est
 * nécessairement `rebalance_to_target` — §22.3, « la génération initiale
 * utilise de fait rebalance_to_target, puisque le moteur doit produire un Plan
 * terminant sur l'objectif utilisateur ».
 */
export async function generateRacePlan(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'generateRacePlan';
  const command = generateRacePlanCommandSchema.parse(input);

  await authorize(context, 'plan.generate_initial', command.participantRaceId);

  const scope = await loadPlanScope(
    context.repositories,
    context.actor.userId,
    command.participantRaceId,
    useCase,
  );

  const existing = await context.repositories.racePlans.findActive(command.participantRaceId);

  return run(context, {
    useCase,
    scope,
    // Une génération initiale repart de la proposition PLUKA : aucune
    // contrainte explicite n'est reprise, même s'il existait un Plan.
    constraints: {
      targetDurationSeconds: command.targetDurationSeconds,
      stops: [],
      segmentOverrides: [],
      anchors: [],
    },
    mode: 'rebalance_to_target',
    // §27 : l'objectif initial est conservé « pour la comparaison historique ».
    // Il ne bouge plus une fois le premier Plan créé.
    initialTargetDurationSeconds:
      existing?.initialTargetDurationSeconds ?? command.targetDurationSeconds,
    persist: true,
  });
}

/** §21.1 — changer l'objectif, en respectant ancres et overrides (§21.1, P17). */
export async function changePlanTarget(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'changePlanTarget';
  const command = changePlanTargetCommandSchema.parse(input);

  await authorize(context, 'plan.edit', command.participantRaceId);

  const scope = await loadPlanScope(
    context.repositories,
    context.actor.userId,
    command.participantRaceId,
    useCase,
  );
  const { plan, constraints } = await currentState(context, command.participantRaceId, useCase);

  return run(context, {
    useCase,
    scope,
    constraints: { ...constraints, targetDurationSeconds: command.targetDurationSeconds },
    mode: 'rebalance_to_target',
    initialTargetDurationSeconds: plan.initialTargetDurationSeconds,
    persist: true,
  });
}

/** §21.2 — durée imposée d'un segment. */
export async function updatePlanSegmentDuration(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'updatePlanSegmentDuration';
  const command = updatePlanSegmentDurationCommandSchema.parse(input);

  return editPlan(context, useCase, command.participantRaceId, command.mode, (constraints) => ({
    ...constraints,
    segmentOverrides: [
      ...constraints.segmentOverrides.filter(
        (override) => override.segmentId !== command.raceSegmentId,
      ),
      { segmentId: command.raceSegmentId, durationSeconds: command.durationSeconds },
    ],
  }));
}

/** §21.6 — retirer un override : le segment redevient flexible. */
export async function removePlanSegmentOverride(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'removePlanSegmentOverride';
  const command = removePlanSegmentOverrideCommandSchema.parse(input);

  return editPlan(context, useCase, command.participantRaceId, command.mode, (constraints) => ({
    ...constraints,
    segmentOverrides: constraints.segmentOverrides.filter(
      (override) => override.segmentId !== command.raceSegmentId,
    ),
  }));
}

/** §21.3 — un arrêt modifié devient fixe, et manuel. */
export async function updatePlanStop(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'updatePlanStop';
  const command = updatePlanStopCommandSchema.parse(input);

  return editPlan(context, useCase, command.participantRaceId, command.mode, (constraints) => ({
    ...constraints,
    stops: [
      ...constraints.stops.filter((stop) => stop.waypointId !== command.raceWaypointId),
      ...(command.durationSeconds === 0
        ? []
        : [
            {
              waypointId: command.raceWaypointId,
              durationSeconds: command.durationSeconds,
              origin: 'manual' as const,
            },
          ]),
    ],
  }));
}

/** §21.4 — verrouiller une heure de passage : le waypoint devient une ancre. */
export async function lockPlanWaypoint(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'lockPlanWaypoint';
  const command = lockPlanWaypointCommandSchema.parse(input);

  return editPlan(context, useCase, command.participantRaceId, command.mode, (constraints) => ({
    ...constraints,
    anchors: [
      ...constraints.anchors.filter((anchor) => anchor.waypointId !== command.raceWaypointId),
      {
        waypointId: command.raceWaypointId,
        arrivalElapsedSeconds: command.arrivalElapsedSeconds,
      },
    ],
  }));
}

/** §21.5 — « la contrainte horaire disparaît, le waypoint redevient dérivé ». */
export async function unlockPlanWaypoint(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'unlockPlanWaypoint';
  const command = unlockPlanWaypointCommandSchema.parse(input);

  return editPlan(context, useCase, command.participantRaceId, command.mode, (constraints) => ({
    ...constraints,
    anchors: constraints.anchors.filter((anchor) => anchor.waypointId !== command.raceWaypointId),
  }));
}

/**
 * §22.2 — « Rééquilibrer pour finir en HH:MM ».
 *
 * L'arrivée redevient une ancre. Rien d'autre ne change : override, arrêt
 * explicite et waypoint verrouillé « ne sont jamais modifiés ».
 */
export async function rebalancePlanToTarget(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const command = rebalancePlanToTargetCommandSchema.parse(input);

  return recalculate(
    context,
    'rebalancePlanToTarget',
    command.participantRaceId,
    'rebalance_to_target',
  );
}

/**
 * §22.1 — « Conserver ce Plan ».
 *
 * Aucune ancre finale : les segments flexibles gardent leur durée de référence
 * et l'arrivée dérive. L'objectif, lui, ne bouge pas — §27 admet
 * explicitement un Plan dont l'arrivée diverge de la cible tant que
 * l'utilisateur n'a pas demandé de rééquilibrage.
 */
export async function preserveCurrentPlan(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const command = preserveCurrentPlanCommandSchema.parse(input);

  return recalculate(
    context,
    'preserveCurrentPlan',
    command.participantRaceId,
    'preserve_manual_changes',
  );
}

/**
 * §21.6 — réinitialisation d'un périmètre choisi.
 *
 * « Pas de reset silencieux de toute la course » : `all` doit être demandé
 * nommément, et ne retire que les personnalisations — l'objectif reste celui du
 * coureur.
 */
export async function resetPlanScope(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'resetPlanScope';
  const command = resetPlanScopeCommandSchema.parse(input);
  const { scope } = command;

  return editPlan(context, useCase, command.participantRaceId, command.mode, (constraints) => {
    if (scope.kind === 'all') {
      return { ...constraints, stops: [], segmentOverrides: [], anchors: [] };
    }

    if (scope.kind === 'segment') {
      return {
        ...constraints,
        segmentOverrides: constraints.segmentOverrides.filter(
          (override) => override.segmentId !== scope.raceSegmentId,
        ),
      };
    }

    if (scope.kind === 'stop') {
      return {
        ...constraints,
        stops: constraints.stops.filter((stop) => stop.waypointId !== scope.raceWaypointId),
      };
    }

    return {
      ...constraints,
      anchors: constraints.anchors.filter((anchor) => anchor.waypointId !== scope.raceWaypointId),
    };
  });
}

/**
 * §37 — preview.
 *
 * « Peut être calculée en mémoire, ne crée pas automatiquement une version
 * persistée, ne déclenche pas les consommateurs downstream définitifs. » Le
 * droit est quand même vérifié : une preview d'édition reste une édition, et
 * §45 refuse le « bouton masqué côté UI seulement ».
 */
export async function previewPlan(
  context: PlanContext,
  input: unknown,
): Promise<PlanCommandResult> {
  const useCase = 'previewPlan';
  const query = previewPlanQuerySchema.parse(input);

  await authorize(context, 'plan.read', query.participantRaceId);

  const scope = await loadPlanScope(
    context.repositories,
    context.actor.userId,
    query.participantRaceId,
    useCase,
  );
  const { plan, constraints } = await currentState(context, query.participantRaceId, useCase);

  return run(context, {
    useCase,
    scope,
    constraints: {
      ...constraints,
      targetDurationSeconds: query.targetDurationSeconds ?? constraints.targetDurationSeconds,
    },
    mode: query.mode,
    initialTargetDurationSeconds: plan.initialTargetDurationSeconds,
    persist: false,
  });
}

/** Lecture du Plan actif et de ses dépendances de faits (§36, §38.5). */
export async function getActivePlan(context: PlanContext, input: unknown): Promise<ActivePlanView> {
  const useCase = 'getActivePlan';
  const query = getActivePlanQuerySchema.parse(input);

  await authorize(context, 'plan.read', query.participantRaceId);

  const plan = await context.repositories.racePlans.findActive(query.participantRaceId);
  if (plan === null) throw notFoundError(useCase, 'Plan');

  const [waypoints, segments, dependencies] = await Promise.all([
    context.repositories.racePlans.listWaypoints(plan.id),
    context.repositories.racePlans.listSegments(plan.id),
    context.repositories.racePlans.listDependencies(plan.id),
  ]);

  return { plan, waypoints, segments, dependencies };
}

/** Historique des versions — §36, « participant_race_id + version ». */
export async function listPlanVersions(
  context: PlanContext,
  input: unknown,
): Promise<readonly RacePlanRecord[]> {
  const query = listPlanVersionsQuerySchema.parse(input);

  await authorize(context, 'plan.read', query.participantRaceId);

  return context.repositories.racePlans.listVersions(query.participantRaceId);
}

/**
 * Édition d'une contrainte, puis recalcul.
 *
 * Toutes les commandes de §21 partagent la même forme : relire les contraintes,
 * en modifier **une seule**, recalculer. Ce qui n'est pas nommé par la commande
 * traverse inchangé — c'est ainsi que §24 est tenu.
 */
async function editPlan(
  context: PlanContext,
  useCase: string,
  participantRaceId: string,
  mode: PlanMode,
  change: (constraints: PlanConstraints) => PlanConstraints,
): Promise<PlanCommandResult> {
  await authorize(context, 'plan.edit', participantRaceId);

  const scope = await loadPlanScope(
    context.repositories,
    context.actor.userId,
    participantRaceId,
    useCase,
  );
  const { plan, constraints } = await currentState(context, participantRaceId, useCase);

  return run(context, {
    useCase,
    scope,
    constraints: change(constraints),
    mode,
    initialTargetDurationSeconds: plan.initialTargetDurationSeconds,
    persist: true,
  });
}

/** Recalcul sans changement de contrainte : seul le mode décide (§22). */
async function recalculate(
  context: PlanContext,
  useCase: string,
  participantRaceId: string,
  mode: PlanMode,
): Promise<PlanCommandResult> {
  await authorize(context, 'plan.recalculate', participantRaceId);

  const scope = await loadPlanScope(
    context.repositories,
    context.actor.userId,
    participantRaceId,
    useCase,
  );
  const { plan, constraints } = await currentState(context, participantRaceId, useCase);

  return run(context, {
    useCase,
    scope,
    constraints,
    mode,
    initialTargetDurationSeconds: plan.initialTargetDurationSeconds,
    persist: true,
  });
}
