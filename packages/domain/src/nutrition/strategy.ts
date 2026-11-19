import { z } from 'zod';

import type {
  AidNoteRecord,
  AidNoteRepository,
  AidStationRepository,
  AssistanceRepository,
  BagRepository,
  CourseMicroSegmentRecord,
  CustomMilestoneRecord,
  EntitlementRepositories,
  NutritionRepositories,
  MyProductRecord,
  NutritionSettingsRecord,
  RacePlanRecord,
} from '@pluka/db';
import {
  type CustomItem,
  generateNutrition,
  NUTRITION_ENGINE_V1,
  type NutritionContainers,
  type NutritionInput,
  type NutritionResult,
  type NutritionTerrainSpan,
  type NutritionTimeline,
  type NutritionTimelinePoint,
  planPreparation,
} from '@pluka/nutrition-engine';
import { microSegmentWeight, PLAN_ENGINE_V1 } from '@pluka/plan-engine';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { invalidStateError, notFoundError, parseCommand } from '../errors.js';
import { type AidPointView, aidDrinkPointIds, aidPoints } from './aid.js';
import {
  type NutritionPreparationView,
  type NutritionSendView,
  type NutritionSupply,
  sendStatus,
  sentOf,
  sourcesOf,
  supplyLabels,
  supplyOf,
  supplyPoints,
} from './supply.js';

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
  /**
   * Les sacs et les rendez-vous d'Assistance disent d'où viennent les produits
   * après chaque ravitaillement (« À préparer », §53) : la Nutrition les lit,
   * sans jamais les écrire.
   */
  readonly repositories: NutritionRepositories &
    EntitlementRepositories & {
      readonly bags: Pick<BagRepository, 'listBags'>;
      /** Ce que proposent les ravitaillements, et la note du coureur (0110). */
      readonly aidStations: Pick<AidStationRepository, 'listByRace'>;
      readonly aidNotes: AidNoteRepository;
      readonly assistance: Pick<
        AssistanceRepository,
        'listAssistants' | 'listAssignments' | 'listItems'
      >;
    };
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
  /** « Mes produits », pour l'étape de choix de la modale. */
  readonly products: readonly MyProductRecord[];
  /** « À préparer pour cette course » (§49-56) ; nul tant que la stratégie n'est pas calculée. */
  readonly preparation: NutritionPreparationView | null;
  /** Ce que propose chaque ravitaillement, annoncé ou noté (§32, 0110). */
  readonly aid: readonly AidPointView[];
}

const participation = z.object({ participantRaceId: z.uuid() }).strict();

/**
 * Bornes techniques du contrat (§10) — pas des bornes médicales : elles
 * écartent une saisie absurde (une virgule oubliée), jamais un choix.
 */
/** Bornes techniques des contenants (0107) : de quoi écarter une saisie absurde. */
const containersSchema = z
  .object({
    flaskCount: z.number().int().min(0).max(4),
    flaskCapacityMl: z.number().int().min(150).max(1000),
    bladderMl: z.number().int().min(500).max(3000).nullable(),
  })
  .strict();

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
    // §27 : les produits choisis pour la stratégie ; absents, la sélection ne change pas.
    productIds: z.array(z.uuid()).max(60).optional(),
    // §33-34 : ce que le coureur porte ; absent, les contenants ne changent pas.
    containers: containersSchema.optional(),
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
  products?: readonly MyProductRecord[],
  customs: readonly CustomMilestoneRecord[] = [],
  logistics?: {
    readonly containers: NutritionContainers;
    readonly noRefillPointIds: readonly string[];
    readonly aidDrinkPointIds: readonly string[];
  },
): NutritionInput {
  return {
    timeline,
    ...(logistics === undefined
      ? {}
      : {
          containers: logistics.containers,
          noRefillPointIds: logistics.noRefillPointIds,
          aidDrinkPointIds: logistics.aidDrinkPointIds,
        }),
    ...(customs.length === 0 ? {} : { customItems: customItemsOf(customs) }),
    ...(products === undefined
      ? {}
      : {
          products: products.map((product) => ({
            id: product.id,
            name: product.brand === null ? product.name : `${product.brand} ${product.name}`,
            category: product.category,
            carbsG: product.carbsG,
            sodiumMg: product.sodiumMg,
            caffeineMg: product.caffeineMg,
            hydrationMl: product.hydrationMl,
          })),
        }),
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

/**
 * Les prises fixées par le coureur, pour le moteur. Les valeurs sont celles
 * recopiées à l'enregistrement (0106) : un produit retiré depuis de « Mes
 * produits » reste à sa prise, sous son nom.
 */
function customItemsOf(
  customs: readonly CustomMilestoneRecord[],
): Record<string, readonly CustomItem[]> {
  return Object.fromEntries(
    customs.map((custom) => [
      custom.stableKey,
      custom.items.map((item, index) => ({
        id: item.userProductId ?? `retire:${custom.stableKey}:${String(index)}`,
        name: item.label,
        category: 'other',
        carbsG: item.carbsG,
        sodiumMg: item.sodiumMg,
        caffeineMg: item.caffeineMg,
        hydrationMl: 0,
        quantity: item.quantity,
      })),
    ]),
  );
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

  const [{ raceId, timezone, plan }, settings, entitlements, products] = await Promise.all([
    scopeOf(context, participantRaceId, useCase),
    context.repositories.nutrition.findLatest(participantRaceId),
    resolveEntitlements(serviceContext(context), { participantRaceId }),
    context.repositories.myProducts.list(context.actor.userId),
  ]);
  const canEdit = can(entitlements, 'nutrition.edit').allowed;
  const base = {
    startAt: plan?.startAt ?? null,
    timezone,
    canEdit,
    products,
    preparation: null,
    aid: [],
  };

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

  const [timeline, customs, bags, assistants, aidItems, aidNotes] = await Promise.all([
    timelineOf(context, raceId, plan),
    context.repositories.nutrition.listCustomMilestones(settings.id),
    context.repositories.bags.listBags(participantRaceId),
    context.repositories.assistance.listAssistants(participantRaceId),
    context.repositories.aidStations.listByRace(raceId),
    context.repositories.aidNotes.listByParticipation(participantRaceId),
  ]);
  const assignments =
    assistants.length === 0
      ? []
      : await context.repositories.assistance.listAssignments(
          assistants.map((person) => person.id),
        );
  const sentItems =
    assignments.length === 0
      ? []
      : await context.repositories.assistance.listItems(
          assignments.map((assignment) => assignment.id),
        );
  // §27 : seuls les produits choisis pour cette stratégie, et qui existent encore.
  // §58 : les prises que le coureur a modifiées gardent ses produits.
  const result = generateNutrition(
    engineInput(
      timeline,
      settings,
      products.filter((product) => settings.selectedProductIds.includes(product.id)),
      customs,
      {
        containers: {
          flaskCount: settings.flaskCount,
          flaskCapacityMl: settings.flaskCapacityMl,
          bladderMl: settings.bladderMl,
        },
        noRefillPointIds: settings.noRefillWaypointIds,
        aidDrinkPointIds: aidDrinkPointIds(aidItems, aidNotes, settings.aidDrinkWaypointIds),
      },
    ),
  );
  const points = supplyPoints(result, {
    choices: settings.supplyChoices,
    bags,
    assistants,
    assignments,
  });
  const preparationPlan = planPreparation(result, {
    reservePercent: settings.reservePercent,
    sources: sourcesOf(points),
  });
  const supply = supplyOf({ plan: preparationPlan, points, sends: [] });
  const names = new Map(assistants.map((person) => [person.id, person.firstName]));
  const pointNames = new Map(points.map((point) => [point.pointId, point.name]));
  const sends = assignments.flatMap((assignment): NutritionSendView[] => {
    const current = supplyLabels(supply.assistance[assignment.raceWaypointId] ?? []);
    const sent = sentOf(sentItems, assignment.id);
    const status = sendStatus(current, sent.labels);
    if (status === 'none') return [];
    return [
      {
        rendezvousId: assignment.id,
        assistant: names.get(assignment.assistantId) ?? 'ton accompagnant',
        pointId: assignment.raceWaypointId,
        pointName: pointNames.get(assignment.raceWaypointId) ?? 'son point',
        status,
        sentAt: sent.sentAt,
        nothingToGive: current.length === 0,
        labels: current,
      },
    ];
  });
  return {
    ...base,
    state: 'ready',
    settings,
    result,
    preparation: { plan: preparationPlan, points, sends },
    aid: aidPoints(result, aidItems, aidNotes, settings.aidDrinkWaypointIds),
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

  const [timeline, products, previous] = await Promise.all([
    timelineOf(context, raceId, plan),
    context.repositories.myProducts.list(context.actor.userId),
    context.repositories.nutrition.findLatest(command.participantRaceId),
  ]);
  const selected = command.productIds ?? previous?.selectedProductIds ?? [];
  const engine = engineInput(
    timeline,
    command,
    products.filter((product) => selected.includes(product.id)),
  );
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
      product_ids: selected,
    },
  });
  if (command.productIds !== undefined) {
    await context.repositories.nutrition.setProducts(command.participantRaceId, command.productIds);
  }
  if (command.containers !== undefined) {
    await context.repositories.nutrition.setContainers(
      command.participantRaceId,
      command.containers,
    );
  }
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

// ------------------------------------------------------------
// « Mes produits » — choisir, ajouter, créer (0104). Pas de stock.
// ------------------------------------------------------------

const searchQuery = z.object({ participantRaceId: z.uuid(), query: z.string().max(80) }).strict();

const addFromCatalogueCommand = z
  .object({ participantRaceId: z.uuid(), catalogueProductId: z.uuid() })
  .strict();

const createProductCommand = z
  .object({
    participantRaceId: z.uuid(),
    brand: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
    name: z.string().trim().min(1).max(80),
    category: z.enum([
      'gel',
      'drink',
      'bar',
      'chew',
      'puree',
      'solid',
      'salty',
      'capsule',
      'electrolyte',
      'other',
    ]),
    servingLabel: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
    carbsG: z.number().min(0).max(500),
    sodiumMg: z.number().int().min(0).max(10000),
    caffeineMg: z.number().int().min(0).max(1000),
    hydrationMl: z.number().int().min(0).max(5000),
  })
  .strict();

/** Le catalogue validé de PLUKA, pour ajouter un produit à « Mes produits ». */
export async function searchNutritionCatalogue(context: NutritionContext, input: unknown) {
  const command = parseCommand(searchQuery, input, 'searchNutritionCatalogue');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  return context.repositories.myProducts.searchCatalogue(command.query);
}

/** Ajoute un produit du catalogue à « Mes produits » ; rend son identifiant. */
export async function addCatalogueProduct(context: NutritionContext, input: unknown) {
  const command = parseCommand(addFromCatalogueCommand, input, 'addCatalogueProduct');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  return context.repositories.myProducts.addFromCatalogue(
    context.actor.userId,
    command.catalogueProductId,
  );
}

/** Crée un produit personnel dans « Mes produits » ; rend son identifiant. */
export async function createMyNutritionProduct(context: NutritionContext, input: unknown) {
  const command = parseCommand(createProductCommand, input, 'createMyNutritionProduct');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  return context.repositories.myProducts.createCustom(context.actor.userId, {
    brand: command.brand,
    name: command.name,
    category: command.category,
    servingLabel: command.servingLabel,
    carbsG: command.carbsG,
    sodiumMg: command.sodiumMg,
    caffeineMg: command.caffeineMg,
    hydrationMl: command.hydrationMl,
  });
}

const volumeCommand = z
  .object({
    participantRaceId: z.uuid(),
    userProductId: z.uuid(),
    hydrationMl: z.number().int().min(50).max(3000),
  })
  .strict();

/**
 * Le volume de dilution d'une boisson en poudre : sans lui, sa concentration
 * est inconnue et la boisson ne compte pas (§29). Un réglage personnel, gardé
 * dans « Mes produits ».
 */
export async function setNutritionProductVolume(context: NutritionContext, input: unknown) {
  const command = parseCommand(volumeCommand, input, 'setNutritionProductVolume');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  await context.repositories.myProducts.setHydration(
    context.actor.userId,
    command.userProductId,
    command.hydrationMl,
  );
}

// ------------------------------------------------------------
// Modifier les produits d'une prise — §57, §58 (0106).
// ------------------------------------------------------------

const milestoneCommand = z
  .object({
    participantRaceId: z.uuid(),
    stableKey: z.string().min(1).max(160),
    items: z
      .array(z.object({ userProductId: z.uuid(), quantity: z.number().int().min(1).max(5) }))
      .max(6),
  })
  .strict();

const resetCommand = z
  .object({ participantRaceId: z.uuid(), stableKey: z.string().min(1).max(160) })
  .strict();

/**
 * Le coureur fixe lui-même les produits d'une prise ou d'un ravitaillement.
 * Ils sont protégés : le moteur ne les change plus, et répartit le reste
 * autour (§40, étape 2). Une liste vide veut dire « rien à cette prise ».
 */
export async function setNutritionMilestoneItems(
  context: NutritionContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setNutritionMilestoneItems';
  const command = parseCommand(milestoneCommand, input, useCase);
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });

  const view = await getNutritionStrategy(context, {
    participantRaceId: command.participantRaceId,
  });
  const milestone = view.result?.milestones.find(
    (candidate) => candidate.stableKey === command.stableKey && candidate.kind !== 'finish',
  );
  if (view.state !== 'ready' || milestone === undefined) {
    throw invalidStateError(useCase, 'prise introuvable dans la stratégie actuelle');
  }
  const owned = new Set(view.products.map((product) => product.id));
  if (command.items.some((item) => !owned.has(item.userProductId))) {
    throw notFoundError(useCase, 'produit');
  }
  const ids = command.items.map((item) => item.userProductId);
  if (new Set(ids).size !== ids.length) {
    throw invalidStateError(useCase, 'un produit en double');
  }

  await context.repositories.nutrition.setMilestoneItems(command.participantRaceId, {
    stableKey: milestone.stableKey,
    label: milestone.kind === 'aid' ? milestone.name : 'Prise',
    elapsedSeconds: milestone.elapsedSeconds,
    distanceKm: milestone.distanceKm,
    items: command.items,
  });
}

/** Rend une prise au moteur : la proposition PLUKA revient. */
export async function resetNutritionMilestone(
  context: NutritionContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(resetCommand, input, 'resetNutritionMilestone');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  await context.repositories.nutrition.resetMilestone(command.participantRaceId, command.stableKey);
}

// ------------------------------------------------------------
// Points de remplissage — §33, §34 (0107).
// ------------------------------------------------------------

const refillCommand = z
  .object({ participantRaceId: z.uuid(), raceWaypointId: z.uuid(), refill: z.boolean() })
  .strict();

/**
 * « Je remplis ici » ou non, à un ravitaillement. Le plan de flasques suit :
 * le tronçon s'allonge jusqu'au point de remplissage suivant.
 */
export async function setNutritionRefillPoint(
  context: NutritionContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(refillCommand, input, 'setNutritionRefillPoint');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  await context.repositories.nutrition.setRefillPoint(
    command.participantRaceId,
    command.raceWaypointId,
    command.refill,
  );
}

// ------------------------------------------------------------
// « À préparer pour cette course » — §49 à §56 (0108).
// ------------------------------------------------------------

const reserveCommand = z
  .object({ participantRaceId: z.uuid(), reservePercent: z.number().min(0).max(100) })
  .strict();

/**
 * La réserve de sécurité : ce qu'on prépare en plus, jamais compté comme
 * consommé (§49, §51). Elle part avec le coureur.
 */
export async function setNutritionReserve(
  context: NutritionContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(reserveCommand, input, 'setNutritionReserve');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  await context.repositories.nutrition.setReserve(
    command.participantRaceId,
    command.reservePercent,
  );
}

const supplyCommand = z
  .object({
    participantRaceId: z.uuid(),
    raceWaypointId: z.uuid(),
    source: z.enum(['start', 'bag', 'assistance']).nullable(),
  })
  .strict();

/**
 * D'où viennent les produits après un ravitaillement : porté depuis le
 * départ, drop bag ou Assistance ; nul, retour au choix automatique.
 */
export async function setNutritionSupplyPoint(
  context: NutritionContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(supplyCommand, input, 'setNutritionSupplyPoint');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  await context.repositories.nutrition.setSupplyPoint(
    command.participantRaceId,
    command.raceWaypointId,
    command.source,
  );
}

/**
 * Ce que la Nutrition range dans les sacs et chez l'Assistance (§53 à §55),
 * pour Sacs et Assistance. Nul tant que la stratégie n'est pas calculée.
 */
export async function getNutritionSupply(
  context: NutritionContext,
  input: unknown,
): Promise<NutritionSupply | null> {
  const view = await getNutritionStrategy(context, input);
  return view.preparation === null ? null : supplyOf(view.preparation);
}

// ------------------------------------------------------------
// Ravitaillements — §31, §32 (0110)
// ------------------------------------------------------------

const aidDrinkCommand = z
  .object({ participantRaceId: z.uuid(), raceWaypointId: z.uuid(), use: z.boolean() })
  .strict();

/**
 * « Je prends la boisson du ravito ici » : ce remplissage ne demande ni dose à
 * préparer ni dose à emporter. Les apports restent comptés avec les valeurs de
 * la boisson du coureur.
 */
export async function setNutritionAidDrink(
  context: NutritionContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(aidDrinkCommand, input, 'setNutritionAidDrink');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  await context.repositories.nutrition.setAidDrink(
    command.participantRaceId,
    command.raceWaypointId,
    command.use,
  );
}

const AID_NOTE_KINDS = [
  'water',
  'sports_drink',
  'cola',
  'soup',
  'fruit',
  'sweet',
  'salty',
  'hot_meal',
] as const;

const aidNoteCommand = z
  .object({
    participantRaceId: z.uuid(),
    raceWaypointId: z.uuid(),
    kinds: z.array(z.enum(AID_NOTE_KINDS)).max(8),
    note: z.string().trim().max(200).nullable(),
  })
  .strict();

/**
 * La note du coureur sur un ravitaillement qui n'annonce rien : ce qu'il y
 * trouvera, d'après lui. Elle n'est jamais présentée comme officielle.
 */
export async function setAidNote(context: NutritionContext, input: unknown): Promise<void> {
  const command = parseCommand(aidNoteCommand, input, 'setAidNote');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.edit',
    participantRaceId: command.participantRaceId,
  });
  await context.repositories.aidNotes.set(
    command.participantRaceId,
    command.raceWaypointId,
    [...new Set(command.kinds)],
    command.note === null || command.note === '' ? null : command.note,
  );
}

/** Les notes du coureur sur ses ravitaillements, pour la Course. Gratuit à lire. */
export async function getMyAidNotes(
  context: NutritionContext,
  input: unknown,
): Promise<readonly AidNoteRecord[]> {
  const { participantRaceId } = parseCommand(participation, input, 'getMyAidNotes');
  await authorizeCapability(serviceContext(context), {
    capability: 'nutrition.read',
    participantRaceId,
  });
  return context.repositories.aidNotes.listByParticipation(participantRaceId);
}
