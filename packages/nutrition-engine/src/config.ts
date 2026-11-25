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
  /** Les propositions PLUKA des profils Chaud et Froid (§14 bis, décision du 2026-11-24). */
  readonly conditions: ConditionProposalConfig;
}

/**
 * Propositions Chaud / Froid — calculées sur les cibles du coureur, jamais
 * imposées : il les voit et les modifie (décision du 2026-11-24). Sources,
 * détaillées dans NUTRITION_ENGINE §14 bis :
 * - ISSN, ultra-marathon (Tiller et al., 2019) : 450–750 mL·h⁻¹ en course ;
 *   besoins plus élevés au chaud (> 25 °C, ou humidité > 60 %) avec
 *   « ~300–600 mg·h⁻¹ » de sodium ; au-delà de ~1000 mg·L⁻¹, à éviter ; mise en
 *   garde contre l'excès de boisson ; le froid émousse la soif ; les
 *   températures extrêmes augmentent l'oxydation des glucides.
 * - GSSI SSE #152 (Sawka, Cheuvront, Kenefick, 2016) : > 1 L/h de sueur
 *   courant sous la chaleur.
 * Le −15 % d'hydratation et le +10 % de glucides au froid ne sont chiffrés
 * par aucune de ces sources : ce sont des estimations PLUKA, prudentes.
 */
export interface ConditionProposalConfig {
  readonly hot: {
    readonly hydrationFactor: number;
    /** Le haut de la fourchette ISSN : la proposition ne pousse pas au-delà. */
    readonly hydrationCeilingMlPerHour: number;
    readonly sodiumFloorMgPerHour: number;
    readonly sodiumCeilingMgPerLiter: number;
    readonly carbsFactor: number;
  };
  readonly cold: {
    readonly hydrationFactor: number;
    /** Le bas de la fourchette ISSN : la proposition ne descend pas en dessous. */
    readonly hydrationFloorMlPerHour: number;
    readonly carbsFactor: number;
    readonly carbsStepG: number;
  };
  /** Arrondi des propositions, en ml et en mg. */
  readonly roundingStep: number;
}

export const NUTRITION_ENGINE_V1: NutritionEngineConfig = {
  engineVersion: 'nutrition-1.2.0',
  configVersion: 'nutrition-config-1.1.0',
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
  conditions: {
    hot: {
      hydrationFactor: 1.25,
      hydrationCeilingMlPerHour: 750,
      sodiumFloorMgPerHour: 300,
      sodiumCeilingMgPerLiter: 1000,
      carbsFactor: 1,
    },
    cold: {
      hydrationFactor: 0.85,
      hydrationFloorMlPerHour: 450,
      carbsFactor: 1.1,
      carbsStepG: 5,
    },
    roundingStep: 5,
  },
};
