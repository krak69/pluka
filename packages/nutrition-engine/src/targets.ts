import type { ConditionProposalConfig, NutritionEngineConfig } from './config.js';
import type {
  CaffeineSpread,
  ConditionKind,
  ConditionOverrides,
  ConditionTargets,
  NutritionConditionRange,
  NutritionInput,
  NutritionNeeds,
} from './contracts.js';

/**
 * Les cibles dans le temps — NUTRITION_ENGINE §11 à §19, §24, §25 ; décisions
 * du 2026-11-24.
 *
 * Sans condition, la cible est constante. Sur une plage chaude ou froide, les
 * cibles du profil remplacent celles de base, et seulement sur la durée de la
 * plage : le besoin s'intègre morceau par morceau, au prorata exact (§18).
 * Une plage Nuit ne touche à aucune cible : elle sert à répartir la caféine,
 * dont le total ne change jamais (§16, §25).
 */

export type ConditionWarning =
  'hot_cold_overlap' | 'range_truncated' | 'range_outside' | 'caffeine_night_without_range';

export interface ConditionProfile {
  /** Ce qui s'applique sur les plages de ce type. */
  readonly targets: ConditionTargets;
  /** La proposition PLUKA, calculée sur les cibles de base (§14 bis). */
  readonly proposal: ConditionTargets;
  /** Les dimensions que le coureur a fixées lui-même. */
  readonly custom: {
    readonly carbs: boolean;
    readonly hydration: boolean;
    readonly sodium: boolean;
  };
}

export interface ConditionsResult {
  readonly hot: ConditionProfile;
  readonly cold: ConditionProfile;
  /** Les plages retenues, ramenées à la course (§19), dans l'ordre du temps. */
  readonly ranges: readonly NutritionConditionRange[];
  readonly caffeineSpread: CaffeineSpread;
  readonly warnings: readonly ConditionWarning[];
}

type BaseTargets = Pick<
  ConditionTargets,
  'carbsGPerHour' | 'hydrationMlPerHour' | 'sodiumMgPerHour'
>;

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * La proposition PLUKA d'un profil, sur les cibles de base du coureur
 * (§14 bis). Chaud : plus d'eau jusqu'au haut de la fourchette ISSN, le sodium
 * à la même concentration, au moins ~300 mg/h et jamais au-delà de 1000 mg/L,
 * jamais moins que la base. Froid : un peu moins d'eau sans passer sous le bas
 * de la fourchette, le sodium à la même concentration, un peu plus de glucides.
 */
export function proposeConditionTargets(
  kind: 'hot' | 'cold',
  base: BaseTargets,
  config: ConditionProposalConfig,
): ConditionTargets {
  const step = config.roundingStep;
  const concentration =
    base.hydrationMlPerHour > 0 ? base.sodiumMgPerHour / base.hydrationMlPerHour : null;

  if (kind === 'hot') {
    const hot = config.hot;
    const raised = roundTo(base.hydrationMlPerHour * hot.hydrationFactor, step);
    const hydration =
      raised > hot.hydrationCeilingMlPerHour
        ? Math.max(hot.hydrationCeilingMlPerHour, base.hydrationMlPerHour)
        : raised;
    const sameConcentration =
      concentration === null ? base.sodiumMgPerHour : concentration * hydration;
    const ceiling = (hot.sodiumCeilingMgPerLiter * hydration) / 1000;
    const sodium = Math.max(
      base.sodiumMgPerHour,
      roundTo(Math.min(Math.max(sameConcentration, hot.sodiumFloorMgPerHour), ceiling), step),
    );
    return {
      carbsGPerHour: base.carbsGPerHour * hot.carbsFactor,
      hydrationMlPerHour: hydration,
      sodiumMgPerHour: sodium,
    };
  }

  const cold = config.cold;
  const lowered = roundTo(base.hydrationMlPerHour * cold.hydrationFactor, step);
  const hydration =
    lowered < cold.hydrationFloorMlPerHour
      ? Math.min(cold.hydrationFloorMlPerHour, base.hydrationMlPerHour)
      : lowered;
  return {
    carbsGPerHour: Math.max(
      base.carbsGPerHour,
      roundTo(base.carbsGPerHour * cold.carbsFactor, cold.carbsStepG),
    ),
    hydrationMlPerHour: hydration,
    sodiumMgPerHour:
      concentration === null ? base.sodiumMgPerHour : roundTo(concentration * hydration, step),
  };
}

function profileOf(
  kind: 'hot' | 'cold',
  base: BaseTargets,
  overrides: ConditionOverrides | undefined,
  config: ConditionProposalConfig,
): ConditionProfile {
  const proposal = proposeConditionTargets(kind, base, config);
  return {
    targets: {
      carbsGPerHour: overrides?.carbsGPerHour ?? proposal.carbsGPerHour,
      hydrationMlPerHour: overrides?.hydrationMlPerHour ?? proposal.hydrationMlPerHour,
      sodiumMgPerHour: overrides?.sodiumMgPerHour ?? proposal.sodiumMgPerHour,
    },
    proposal,
    custom: {
      carbs: (overrides?.carbsGPerHour ?? null) !== null,
      hydration: (overrides?.hydrationMlPerHour ?? null) !== null,
      sodium: (overrides?.sodiumMgPerHour ?? null) !== null,
    },
  };
}

const KIND_ORDER: Readonly<Record<ConditionKind, number>> = { hot: 0, cold: 1, night: 2 };

/** §19 : une plage se ramène à la course ; hors de la course, elle est ignorée et signalée. */
function clip(
  ranges: readonly NutritionConditionRange[],
  finish: number,
  warnings: Set<ConditionWarning>,
): NutritionConditionRange[] {
  const kept: NutritionConditionRange[] = [];
  for (const range of ranges) {
    if (range.endElapsedSeconds <= range.startElapsedSeconds) continue;
    if (range.endElapsedSeconds <= 0 || range.startElapsedSeconds >= finish) {
      warnings.add('range_outside');
      continue;
    }
    const start = Math.max(0, range.startElapsedSeconds);
    const end = Math.min(finish, range.endElapsedSeconds);
    if (start !== range.startElapsedSeconds || end !== range.endElapsedSeconds) {
      warnings.add('range_truncated');
    }
    kept.push({ kind: range.kind, startElapsedSeconds: start, endElapsedSeconds: end });
  }
  return kept.sort(
    (left, right) =>
      left.startElapsedSeconds - right.startElapsedSeconds ||
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.endElapsedSeconds - right.endElapsedSeconds,
  );
}

interface Segment {
  readonly start: number;
  readonly end: number;
  readonly targets: BaseTargets;
}

function covers(range: NutritionConditionRange, t: number): boolean {
  return range.startElapsedSeconds <= t && t < range.endElapsedSeconds;
}

/** Ce que les cibles fournissent entre `from` et `to`, morceau par morceau (§11, §18). */
export interface ConditionTimeline {
  readonly result: ConditionsResult;
  needsBetween(from: number, to: number): NutritionNeeds;
  /**
   * La part du total de caféine due au temps `t`, de 0 à 1 (§24) ; nulle en
   * placement manuel, où PLUKA ne place aucune caféine.
   */
  readonly caffeineShareUntil: ((t: number) => number) | null;
}

export function conditionTimeline(
  input: NutritionInput,
  config: NutritionEngineConfig,
): ConditionTimeline {
  const finish = input.timeline.finishElapsedSeconds;
  const base: BaseTargets = {
    carbsGPerHour: input.targets.carbsGPerHour,
    hydrationMlPerHour: input.targets.hydrationMlPerHour,
    sodiumMgPerHour: input.targets.sodiumMgPerHour,
  };
  const warnings = new Set<ConditionWarning>();
  const hot = profileOf('hot', base, input.conditions?.hot, config.conditions);
  const cold = profileOf('cold', base, input.conditions?.cold, config.conditions);
  const ranges = clip(input.conditions?.ranges ?? [], finish, warnings);
  const weather = ranges.filter((range) => range.kind !== 'night');
  const nights = ranges.filter((range) => range.kind === 'night');

  // Les morceaux à cible constante : la base, ou un profil. Chaud et froid à
  // la fois n'ont pas de sens (§17) : le conflit est signalé, la base s'y applique.
  const bounds = [
    ...new Set([
      0,
      finish,
      ...weather.flatMap((range) => [range.startElapsedSeconds, range.endElapsedSeconds]),
    ]),
  ].sort((left, right) => left - right);
  const segments: Segment[] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const start = bounds[index] as number;
    const end = bounds[index + 1] as number;
    if (end <= start) continue;
    const middle = (start + end) / 2;
    const inHot = weather.some((range) => range.kind === 'hot' && covers(range, middle));
    const inCold = weather.some((range) => range.kind === 'cold' && covers(range, middle));
    if (inHot && inCold) warnings.add('hot_cold_overlap');
    const targets = inHot && !inCold ? hot.targets : inCold && !inHot ? cold.targets : base;
    const previous = segments[segments.length - 1];
    if (previous !== undefined && previous.targets === targets && previous.end === start) {
      segments[segments.length - 1] = { ...previous, end };
    } else {
      segments.push({ start, end, targets });
    }
  }

  const needsBetween = (from: number, to: number): NutritionNeeds => {
    if (to <= from) return { carbsG: 0, sodiumMg: 0, hydrationMl: 0 };
    let carbs = 0;
    let sodium = 0;
    let hydration = 0;
    let covered = 0;
    for (const segment of segments) {
      const overlap = Math.min(to, segment.end) - Math.max(from, segment.start);
      if (overlap <= 0) continue;
      covered += overlap;
      carbs += (segment.targets.carbsGPerHour * overlap) / 3600;
      sodium += (segment.targets.sodiumMgPerHour * overlap) / 3600;
      hydration += (segment.targets.hydrationMlPerHour * overlap) / 3600;
    }
    // Hors de la course (avant le départ, après l'arrivée) : la base.
    const rest = Math.max(0, to - from - covered);
    return {
      carbsG: carbs + (base.carbsGPerHour * rest) / 3600,
      sodiumMg: sodium + (base.sodiumMgPerHour * rest) / 3600,
      hydrationMl: hydration + (base.hydrationMlPerHour * rest) / 3600,
    };
  };

  const spread = input.caffeineSpread ?? 'auto';
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const late = (t: number) =>
    finish <= 0 ? 1 : clamp((t - finish / 2) / Math.max(finish / 2, Number.EPSILON));
  let caffeineShareUntil: ((t: number) => number) | null;
  if (spread === 'manual') {
    caffeineShareUntil = null;
  } else if (spread === 'late') {
    caffeineShareUntil = late;
  } else if (spread === 'night') {
    const total = nights.reduce(
      (sum, range) => sum + range.endElapsedSeconds - range.startElapsedSeconds,
      0,
    );
    if (total <= 0) {
      // Prototype : sans plage Nuit, la caféine part sur la deuxième partie, et l'écran le dit.
      warnings.add('caffeine_night_without_range');
      caffeineShareUntil = late;
    } else {
      caffeineShareUntil = (t: number) =>
        nights.reduce(
          (sum, range) =>
            sum + Math.max(0, Math.min(t, range.endElapsedSeconds) - range.startElapsedSeconds),
          0,
        ) / total;
    }
  } else {
    caffeineShareUntil = (t: number) => (finish <= 0 ? 1 : clamp(t / finish));
  }

  return {
    result: { hot, cold, ranges, caffeineSpread: spread, warnings: [...warnings].sort() },
    needsBetween,
    caffeineShareUntil,
  };
}
