import type { PlanEngineConfig } from './config.js';
import type { PlanMicroSegment, PlanRaceSegmentInput } from './contracts.js';
import { fatigueFactor } from './fatigue.js';
import { gradeFactorFor } from './grade-factor.js';
import { technicalityFactor } from './technicality.js';

/**
 * Modèle de coût relatif — docs/engines/PLAN_ENGINE.md §10.
 *
 * ```text
 * weight_i = distance_i × grade_factor(grade_i) × technicality_factor_i × fatigue_factor(progress_i)
 * ```
 *
 * « Le poids n'est pas une durée. La durée n'apparaît qu'au moment de la
 * normalisation sur le budget utilisateur. » C'est ce qui permet au relief de
 * changer la *répartition* sans jamais changer l'objectif — §67, critères 6 et
 * 7 : « le relief influence réellement la répartition », « le temps n'est pas
 * réparti uniquement selon la distance ».
 */

export interface MicroSegmentWeight {
  readonly microSegmentId: string;
  readonly raceSegmentId: string;
  readonly weight: number;
  readonly gradeFactor: number;
  readonly technicalityFactor: number;
  readonly fatigueFactor: number;
}

export function microSegmentWeight(
  micro: PlanMicroSegment,
  config: PlanEngineConfig,
): MicroSegmentWeight {
  const grade = gradeFactorFor(micro.modelGrade, config);
  const technicality = technicalityFactor(micro.technicality, config);
  const fatigue = fatigueFactor(micro.progress, config);

  return {
    microSegmentId: micro.id,
    raceSegmentId: micro.raceSegmentId,
    weight: micro.distanceMeters * grade * technicality * fatigue,
    gradeFactor: grade,
    technicalityFactor: technicality,
    fatigueFactor: fatigue,
  };
}

export interface SegmentWeight {
  readonly raceSegmentId: string;
  readonly sortOrder: number;
  readonly weight: number;
  readonly microSegmentCount: number;
}

/**
 * Agrège les poids des micro-segments au niveau des RaceSegments.
 *
 * Le micro-segment est « non exposé comme objet produit » (§4) : il sert à
 * calculer, le segment sert à afficher et à persister.
 *
 * L'ordre d'itération est celui des RaceSegments triés par `sortOrder`, jamais
 * celui d'une clé d'objet — §35 interdit « l'itération non déterministe sur des
 * objets non ordonnés ».
 */
export function aggregateSegmentWeights(
  microSegments: readonly PlanMicroSegment[],
  raceSegments: readonly PlanRaceSegmentInput[],
  config: PlanEngineConfig,
): readonly SegmentWeight[] {
  const totals = new Map<string, { weight: number; count: number }>();

  for (const micro of microSegments) {
    const { weight } = microSegmentWeight(micro, config);
    const current = totals.get(micro.raceSegmentId) ?? { weight: 0, count: 0 };

    totals.set(micro.raceSegmentId, { weight: current.weight + weight, count: current.count + 1 });
  }

  return [...raceSegments]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((segment) => {
      const total = totals.get(segment.id) ?? { weight: 0, count: 0 };

      return {
        raceSegmentId: segment.id,
        sortOrder: segment.sortOrder,
        weight: total.weight,
        microSegmentCount: total.count,
      };
    });
}

export function totalWeight(weights: readonly SegmentWeight[]): number {
  return weights.reduce((sum, segment) => sum + segment.weight, 0);
}
