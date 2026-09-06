/**
 * Configuration du moteur Plan — docs/engines/PLAN_ENGINE.md §14.
 *
 * « La configuration `plan-v1.0.0` doit être explicitement définie dans le
 * package moteur. Le client ne peut jamais fournir cette configuration
 * arbitrairement. La version est choisie côté serveur. »
 *
 * Toute modification d'une de ces constantes impose une nouvelle
 * `engineVersion` : §11, « toute modification de la courbe implique une
 * nouvelle engine_version », et §67, critère 29, « toutes les constantes moteur
 * sont versionnées ». Un Plan persisté garde sa version, et reste donc
 * relisible exactement tel qu'il a été calculé.
 */

export type TechnicalityLevel = 'smooth' | 'standard' | 'technical' | 'very_technical';

export interface GradeCurvePoint {
  readonly grade: number;
  readonly factor: number;
}

export interface PlanEngineConfig {
  readonly engineVersion: string;
  readonly gradeCurve: readonly GradeCurvePoint[];
  /** Pente au-delà de laquelle le modèle cesse d'extrapoler (§11.2). */
  readonly gradeClampRatio: number;
  readonly technicalityFactors: Readonly<Record<TechnicalityLevel, number>>;
  readonly fatigueAlpha: number;
  readonly cutoffThresholds: {
    readonly comfortableSeconds: number;
    readonly watchSeconds: number;
  };
  readonly preprocessingVersion: string;
  readonly preprocessing: {
    /** §8.1 étape 5 — ré-échantillonnage. */
    readonly resampleStepMeters: number;
    /** §8.1 étape 6 — longueur cible d'un micro-segment. */
    readonly microSegmentLengthMeters: number;
    /** §9 — au-delà, le waypoint n'est pas raccordable au parcours. */
    readonly maxWaypointOffRouteMeters: number;
    /** §9 — écarts au référentiel officiel produisant un warning qualité. */
    readonly distanceMismatchRatio: number;
    readonly elevationGainMismatchRatio: number;
  };
  /**
   * Seuil d'`EXTREME_REBALANCE` — §49.
   *
   * « Le seuil précis doit rester dans la configuration calibrée. Aucun chiffre
   * non validé ne doit être inventé dans l'UI ou le domaine. » Il n'est pas
   * calibré : il vaut `null`, et le moteur n'émet donc pas ce warning. Inventer
   * une valeur pour faire exister le code serait exactement ce que §49 refuse.
   */
  readonly extremeRebalanceRatio: number | null;
}

/**
 * Courbe de pente V1 — §11.
 *
 * Reprise littérale du tableau de calibration. Elle exprime une **difficulté
 * temporelle relative**, pas une vérité physiologique (§11.3) : une descente
 * modérée est plus rapide que le plat, une descente très raide redevient
 * coûteuse.
 *
 * Les points sont ordonnés par pente croissante — l'interpolation en dépend.
 */
const GRADE_CURVE_V1: readonly GradeCurvePoint[] = [
  { grade: -0.4, factor: 1.4 },
  { grade: -0.3, factor: 1.2 },
  { grade: -0.2, factor: 0.95 },
  { grade: -0.15, factor: 0.86 },
  { grade: -0.1, factor: 0.82 },
  { grade: -0.05, factor: 0.9 },
  { grade: 0, factor: 1.0 },
  { grade: 0.05, factor: 1.25 },
  { grade: 0.1, factor: 1.6 },
  { grade: 0.15, factor: 2.1 },
  { grade: 0.2, factor: 2.8 },
  { grade: 0.3, factor: 4.1 },
  { grade: 0.4, factor: 5.5 },
];

export const PLAN_ENGINE_V1: PlanEngineConfig = {
  engineVersion: 'plan-v1.0.0',
  gradeCurve: GRADE_CURVE_V1,
  gradeClampRatio: 0.4,
  // §12 : quatre classes. L'absence de donnée vaut 1.00, et le moteur
  // n'invente jamais une technicité (§12.1).
  technicalityFactors: {
    smooth: 1.0,
    standard: 1.05,
    technical: 1.12,
    very_technical: 1.22,
  },
  fatigueAlpha: 0.1,
  cutoffThresholds: {
    comfortableSeconds: 60 * 60,
    watchSeconds: 30 * 60,
  },
  // §8.1 : le prétraitement a sa propre version, parce qu'il est calculé une
  // fois à l'import et réutilisé à chaque recalcul (§15).
  preprocessingVersion: 'plan-preprocessing-1.0.0',
  preprocessing: {
    resampleStepMeters: 25,
    microSegmentLengthMeters: 100,
    maxWaypointOffRouteMeters: 200,
    distanceMismatchRatio: 0.1,
    elevationGainMismatchRatio: 0.15,
  },
  extremeRebalanceRatio: null,
};
