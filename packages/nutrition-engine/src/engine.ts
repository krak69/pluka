import { NUTRITION_ENGINE_V1, type NutritionEngineConfig } from './config.js';
import type {
  MilestoneReason,
  NutritionInput,
  NutritionMilestone,
  NutritionNeeds,
  NutritionResult,
  NutritionSection,
  NutritionTerrainSpan,
  NutritionTimeline,
  NutritionTimelinePoint,
} from './contracts.js';
import { allocateProducts, SOLID_CATEGORIES } from './allocator.js';
import { planFlasks } from './flasks.js';
import { computeNutritionHash } from './hash.js';
import { conditionTimeline, type ConditionTimeline } from './targets.js';

/**
 * Moteur Nutrition V1, tranche 1 — NUTRITION_ENGINE §11, §12, §35, §37, §38.
 *
 * Pur et déterministe : aucune horloge, aucun réseau, aucun LLM (§87). Il
 * intègre les cibles du coureur sur le temps du Plan, découpe le parcours en
 * sections d'un ravitaillement au suivant, et place des prises « Smart » :
 * - leur nombre suit le temps et le besoin accumulé, pas une minuterie ;
 * - chaque prise glisse, dans une petite fenêtre, vers le terrain où manger
 *   est le plus facile — en montée ou sur le plat, pas en pleine descente ;
 * - une prise trop proche d'un ravitaillement s'y fond, et aucune ne tombe
 *   juste avant lui quand le coureur l'a choisi.
 */

const EPSILON = 1e-9;

function departure(point: NutritionTimelinePoint): number {
  return point.elapsedSeconds + point.stopSeconds;
}

/** Recherche du tronçon de terrain contenant `t` (bornes triées, recherche dichotomique). */
function spanAt(
  terrain: readonly NutritionTerrainSpan[],
  t: number,
): NutritionTerrainSpan | undefined {
  let low = 0;
  let high = terrain.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = terrain[middle] as NutritionTerrainSpan;
    if (t < span.startElapsedSeconds) high = middle - 1;
    else if (t > span.endElapsedSeconds) low = middle + 1;
    else return span;
  }
  return undefined;
}

/** Kilomètre au temps `t` : le terrain d'abord, sinon les points du Plan. */
function kmAt(timeline: NutritionTimeline, t: number): number {
  const span = spanAt(timeline.terrain, t);
  if (span !== undefined) {
    const duration = span.endElapsedSeconds - span.startElapsedSeconds;
    const ratio = duration <= 0 ? 0 : (t - span.startElapsedSeconds) / duration;
    return span.startKm + (span.endKm - span.startKm) * ratio;
  }
  const points = timeline.points;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as NutritionTimelinePoint;
    const next = points[index] as NutritionTimelinePoint;
    if (t <= next.elapsedSeconds) {
      const leave = departure(previous);
      if (t <= leave) return previous.distanceKm;
      const ratio = (t - leave) / Math.max(EPSILON, next.elapsedSeconds - leave);
      return previous.distanceKm + (next.distanceKm - previous.distanceKm) * ratio;
    }
  }
  return points[points.length - 1]?.distanceKm ?? 0;
}

/** Facilité à manger selon la pente : 3 en montée, 2 sur le plat, 1 en descente douce, 0 sinon. */
function terrainScore(
  grade: number,
  config: NutritionEngineConfig,
): { score: number; reason: MilestoneReason } {
  if (grade >= config.climbGrade) return { score: 3, reason: 'climb' };
  if (grade > config.gentleDescentGrade) return { score: 2, reason: 'flat' };
  if (grade >= config.steepDescentGrade) return { score: 1, reason: 'gentle_descent' };
  return { score: 0, reason: 'descent' };
}

interface Leg {
  readonly open: NutritionTimelinePoint;
  readonly close: NutritionTimelinePoint;
}

/** Les sections : du départ ou d'un ravitaillement au ravitaillement suivant, ou à l'arrivée. */
function legsOf(points: readonly NutritionTimelinePoint[]): Leg[] {
  const legs: Leg[] = [];
  let open: NutritionTimelinePoint | null = null;
  for (const point of points) {
    if (point.kind === 'passage') continue;
    if (open !== null) legs.push({ open, close: point });
    open = point;
  }
  return legs;
}

/**
 * Le meilleur moment pour une prise autour de `ideal`, entre `lower` et
 * `upper` : le terrain le plus facile, puis le plus proche du moment idéal.
 */
function bestMoment(
  input: NutritionInput,
  config: NutritionEngineConfig,
  ideal: number,
  lower: number,
  upper: number,
): { at: number; reason: MilestoneReason } {
  if (input.timeline.terrain.length === 0) return { at: ideal, reason: 'time' };

  let best: { at: number; score: number; reason: MilestoneReason } | null = null;
  const consider = (t: number) => {
    const span = spanAt(input.timeline.terrain, t);
    if (span === undefined) return;
    const { score, reason } = terrainScore(span.grade, config);
    if (
      best === null ||
      score > best.score ||
      (score === best.score && Math.abs(t - ideal) < Math.abs(best.at - ideal) - EPSILON)
    ) {
      best = { at: t, score, reason };
    }
  };

  consider(ideal);
  for (let offset = config.terrainStepSeconds; ; offset += config.terrainStepSeconds) {
    const before = ideal - offset;
    const after = ideal + offset;
    if (before < lower && after > upper) break;
    if (before >= lower) consider(before);
    if (after <= upper) consider(after);
  }

  const chosen = best as { at: number; reason: MilestoneReason } | null;
  return chosen === null ? { at: ideal, reason: 'time' } : chosen;
}

/** La boisson d'effort choisie : la première boisson qui a un volume (§29). */
function drinkOf(input: NutritionInput) {
  return (
    input.products?.find((product) => product.category === 'drink' && product.hydrationMl > 0) ??
    null
  );
}

/** Le volume de boisson d'effort entre deux instants : sa part de l'hydratation, plage par plage. */
function drinkMlBetween(
  input: NutritionInput,
  conditions: ConditionTimeline,
  from: number,
  to: number,
): number {
  return conditions.needsBetween(from, to).hydrationMl * (1 - input.targets.waterShare);
}

/**
 * Ce que les prises doivent apporter, et combien chacune peut porter (§35).
 *
 * Sans produits connus : le besoin entier, et la charge de la densité. Avec
 * les produits choisis : la boisson d'effort se déduit du besoin, et une prise
 * ne porte pas plus que la plus grosse portion solide choisie. Une prise vient
 * donc quand le besoin d'une portion s'est accumulé — des gels de 30 g à
 * 60 g/h donnent une prise toutes les 30 min environ, pas deux gels d'un coup.
 * Les cibles et le pacing ne bougent pas (§39) : seul l'espacement suit. Sur
 * une plage chaude ou froide, le besoin suit le profil (§18).
 */
function solidsLoad(
  input: NutritionInput,
  conditions: ConditionTimeline,
  densityLoadG: number,
): { netCarbsBetween: (from: number, to: number) => number; loadG: number } {
  const products = input.products;
  if (products === undefined || products.length === 0) {
    return {
      netCarbsBetween: (from, to) => conditions.needsBetween(from, to).carbsG,
      loadG: densityLoadG,
    };
  }
  const drink = drinkOf(input);
  const largestServing = Math.max(
    0,
    ...products
      .filter((product) => SOLID_CATEGORIES.has(product.category))
      .map((product) => product.carbsG),
  );
  return {
    netCarbsBetween: (from, to) =>
      Math.max(
        0,
        conditions.needsBetween(from, to).carbsG -
          (drink === null
            ? 0
            : (drinkMlBetween(input, conditions, from, to) * drink.carbsG) / drink.hydrationMl),
      ),
    loadG: largestServing > 0 ? Math.min(densityLoadG, largestServing) : densityLoadG,
  };
}

function intakesForLeg(
  input: NutritionInput,
  config: NutritionEngineConfig,
  conditions: ConditionTimeline,
  leg: Leg,
): { stableKey: string; at: number; reason: MilestoneReason }[] {
  const start = departure(leg.open);
  const end = leg.close.elapsedSeconds;
  const duration = end - start;
  if (duration <= 0) return [];

  const density = config.densities[input.placement.density];
  const { netCarbsBetween, loadG } = solidsLoad(input, conditions, density.carbsLoadG);
  const carbs = netCarbsBetween(start, end);
  const interval = input.placement.intervalSeconds ?? 0;
  // §36 : le rythme imposé ne regarde que la cadence choisie, pas le besoin.
  let count =
    input.placement.mode === 'interval' && interval > 0
      ? Math.max(0, Math.round(duration / interval) - 1)
      : Math.max(
          0,
          Math.ceil(duration / density.maxGapSeconds - EPSILON) - 1,
          carbs > 0 ? Math.ceil(carbs / loadG - EPSILON) - 1 : 0,
        );
  while (count > 0 && duration / (count + 1) < config.minGapSeconds) count -= 1;
  if (count === 0) return [];

  const buffer =
    input.placement.aidBuffer && leg.close.kind === 'aid'
      ? Math.min(duration * config.aidBufferRatio, config.aidBufferMaxSeconds)
      : 0;
  const spacing = (duration - buffer) / (count + 1);
  const window = Math.min(spacing * config.terrainWindowRatio, config.terrainWindowMaxSeconds);
  const earliest = start + (leg.open.kind === 'aid' ? config.aidMergeWindowSeconds : 0);
  const latest = end - (leg.close.kind === 'aid' ? config.aidMergeWindowSeconds : 0) - buffer;

  const intakes: { stableKey: string; at: number; reason: MilestoneReason }[] = [];
  let previous = start;
  for (let k = 1; k <= count; k += 1) {
    const ideal = start + spacing * k;
    const lower = Math.max(ideal - window, previous + config.minGapSeconds, earliest);
    const upper = Math.min(ideal + window, latest);
    // §37 : une prise qui ne trouve pas sa place loin du ravitaillement s'y fond.
    if (lower > upper) continue;
    const { at, reason } = bestMoment(
      input,
      config,
      Math.min(Math.max(ideal, lower), upper),
      lower,
      upper,
    );
    intakes.push({ stableKey: `intake:${leg.open.id}:${String(k)}`, at, reason });
    previous = at;
  }
  return intakes;
}

/** Génère la stratégie : besoins, sections, prises, produits, flasques. */
export function generateNutrition(
  input: NutritionInput,
  config: NutritionEngineConfig = NUTRITION_ENGINE_V1,
): NutritionResult {
  const conditions = conditionTimeline(input, config);
  const needsBetween = (from: number, to: number): NutritionNeeds =>
    conditions.needsBetween(from, to);
  const legs = legsOf(input.timeline.points);
  const placed: Omit<NutritionMilestone, 'needSincePrevious'>[] = [];
  const sections: NutritionSection[] = [];

  for (const leg of legs) {
    const intakes = intakesForLeg(input, config, conditions, leg);
    for (const intake of intakes) {
      placed.push({
        stableKey: intake.stableKey,
        kind: 'intake',
        pointId: null,
        name: 'Prise',
        elapsedSeconds: intake.at,
        distanceKm: kmAt(input.timeline, intake.at),
        reason: intake.reason,
      });
    }
    const finish = leg.close.kind === 'finish';
    placed.push({
      stableKey: `${finish ? 'finish' : 'aid'}:${leg.close.id}`,
      kind: finish ? 'finish' : 'aid',
      pointId: leg.close.id,
      name: leg.close.name,
      elapsedSeconds: leg.close.elapsedSeconds,
      distanceKm: leg.close.distanceKm,
      reason: finish ? 'finish' : 'aid',
    });

    // Une section court de l'arrivée au point d'ouverture jusqu'à l'arrivée au
    // suivant : l'arrêt y est compté, et les sections totalisent la course.
    const needs = needsBetween(leg.open.elapsedSeconds, leg.close.elapsedSeconds);
    sections.push({
      fromPointId: leg.open.id,
      toPointId: leg.close.id,
      fromName: leg.open.name,
      toName: leg.close.name,
      startElapsedSeconds: leg.open.elapsedSeconds,
      endElapsedSeconds: leg.close.elapsedSeconds,
      startKm: leg.open.distanceKm,
      endKm: leg.close.distanceKm,
      needs,
      waterMl: needs.hydrationMl * input.targets.waterShare,
      drinkMl: needs.hydrationMl * (1 - input.targets.waterShare),
      intakeCount: intakes.length,
    });
  }

  let previous = 0;
  const milestones = placed.map((milestone) => {
    const needSincePrevious = needsBetween(previous, milestone.elapsedSeconds);
    previous = milestone.elapsedSeconds;
    return { ...milestone, needSincePrevious };
  });

  const totals = needsBetween(0, input.timeline.finishElapsedSeconds);

  return {
    engineVersion: config.engineVersion,
    configVersion: config.configVersion,
    inputHash: computeNutritionHash(input, config),
    totals: {
      ...totals,
      caffeineMg: input.targets.caffeineTotalMg,
    },
    sections,
    milestones,
    // §39 : besoins et jalons d'abord, produits ensuite — un défaut de
    // produit ne change ni les prises ni les cibles.
    allocation:
      input.products === undefined
        ? null
        : allocateProducts({
            products: input.products,
            milestones,
            sections,
            drinkMlPerHour: input.targets.hydrationMlPerHour * (1 - input.targets.waterShare),
            drinkMlBetween: (from, to) => drinkMlBetween(input, conditions, from, to),
            caffeineTotalMg: input.targets.caffeineTotalMg,
            caffeineShareUntil: conditions.caffeineShareUntil,
            finishElapsedSeconds: input.timeline.finishElapsedSeconds,
            ...(input.customItems === undefined ? {} : { customItems: input.customItems }),
          }),
    // §33-34 : la logistique de l'hydratation, à part des besoins et des produits.
    flasks:
      input.containers === undefined || totals.hydrationMl <= 0
        ? null
        : planFlasks(
            input,
            input.containers,
            input.noRefillPointIds ?? [],
            input.aidDrinkPointIds ?? [],
            (from, to) => conditions.needsBetween(from, to).hydrationMl,
          ),
    conditions: conditions.result,
  };
}
