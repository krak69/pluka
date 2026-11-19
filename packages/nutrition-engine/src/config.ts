import type { NutritionDensity } from './contracts.js';

/**
 * Réglages versionnés du placement — NUTRITION_ENGINE §35, §37, §100.
 *
 * Des heuristiques d'ergonomie, pas des recommandations nutritionnelles. Les
 * valeurs v1 reprennent le prototype (décision du 2026-11-17) ; toute
 * évolution change `configVersion` (§101).
 */
export interface NutritionEngineConfig {
  readonly engineVersion: string;
  readonly configVersion: string;
  /** Une prise dès que cet écart de temps ou ce besoin en glucides est atteint. */
  readonly densities: Readonly<
    Record<NutritionDensity, { readonly maxGapSeconds: number; readonly carbsLoadG: number }>
  >;
  /** Une prise à moins de cette durée d'un ravitaillement s'y fusionne (§37). */
  readonly aidMergeWindowSeconds: number;
  /** Jamais deux prises plus proches que cela. */
  readonly minGapSeconds: number;
  /** Buffer avant un ravitaillement : part de la section, plafonnée. */
  readonly aidBufferRatio: number;
  readonly aidBufferMaxSeconds: number;
  /**
   * Fenêtre où chercher un meilleur terrain autour du moment idéal : une part
   * de l'écart entre prises, plafonnée.
   */
  readonly terrainWindowRatio: number;
  readonly terrainWindowMaxSeconds: number;
  /** Pas d'échantillonnage du terrain dans cette fenêtre. */
  readonly terrainStepSeconds: number;
  /** Bornes de pente : au-delà d'une montée, en deçà d'une descente raide. */
  readonly climbGrade: number;
  readonly gentleDescentGrade: number;
  readonly steepDescentGrade: number;
}

export const NUTRITION_ENGINE_V1: NutritionEngineConfig = {
  engineVersion: 'nutrition-1.1.0',
  configVersion: 'nutrition-config-1.0.0',
  densities: {
    frequent: { maxGapSeconds: 30 * 60, carbsLoadG: 30 },
    auto: { maxGapSeconds: 45 * 60, carbsLoadG: 40 },
    sparse: { maxGapSeconds: 60 * 60, carbsLoadG: 50 },
  },
  aidMergeWindowSeconds: 10 * 60,
  minGapSeconds: 18 * 60,
  aidBufferRatio: 0.18,
  aidBufferMaxSeconds: 20 * 60,
  terrainWindowRatio: 0.3,
  terrainWindowMaxSeconds: 10 * 60,
  terrainStepSeconds: 30,
  climbGrade: 0.03,
  gentleDescentGrade: -0.03,
  steepDescentGrade: -0.08,
};
