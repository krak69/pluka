/**
 * Contrats du moteur Nutrition — NUTRITION_ENGINE.md §6, §9, §10, §35, §72.
 *
 * Le moteur ne connaît ni la base, ni le Plan, ni les droits : le domaine lui
 * construit une timeline générique (§6) et des cibles choisies par le coureur
 * (§1, §10). Tout est en secondes écoulées depuis le départ.
 */

/** Un point de la timeline : départ, arrivée, ou une opportunité officielle (§35.3). */
export interface NutritionTimelinePoint {
  readonly id: string;
  readonly name: string;
  readonly kind: 'start' | 'aid' | 'finish' | 'passage';
  /** Arrivée au point, en secondes depuis le départ. */
  readonly elapsedSeconds: number;
  /** Arrêt prévu au point ; on repart à `elapsedSeconds + stopSeconds`. */
  readonly stopSeconds: number;
  readonly distanceKm: number;
}

/**
 * Un tronçon de terrain avec ses temps de passage — de quoi choisir où une
 * prise est facile (§35.9). Construit par le domaine depuis le Plan.
 */
export interface NutritionTerrainSpan {
  readonly startElapsedSeconds: number;
  readonly endElapsedSeconds: number;
  readonly startKm: number;
  readonly endKm: number;
  /** Pente du tronçon (0.08 = 8 %). */
  readonly grade: number;
}

export interface NutritionTimeline {
  readonly finishElapsedSeconds: number;
  /** Dans l'ordre du parcours ; le premier est le départ, le dernier l'arrivée. */
  readonly points: readonly NutritionTimelinePoint[];
  /** Peut être vide : le placement retombe alors sur le temps seul. */
  readonly terrain: readonly NutritionTerrainSpan[];
}

/** Les cibles du coureur — §10. Jamais déduites par le moteur (§1). */
export interface NutritionTargets {
  readonly carbsGPerHour: number;
  readonly hydrationMlPerHour: number;
  readonly sodiumMgPerHour: number;
  readonly caffeineTotalMg: number | null;
  /** Part de l'hydratation en eau pure, de 0 à 1 ; le reste en boisson d'effort. */
  readonly waterShare: number;
}

export type NutritionDensity = 'frequent' | 'auto' | 'sparse';

export interface NutritionPlacement {
  /**
   * `smart` par défaut (§35) ; `interval` est le « rythme imposé » avancé
   * (§36) : une prise toutes les `intervalSeconds`, rapprochée du terrain et
   * des ravitaillements comme en mode Smart.
   */
  readonly mode: 'smart' | 'interval';
  readonly density: NutritionDensity;
  readonly intervalSeconds?: number | null;
  /** Ne pas placer de prise juste avant un ravitaillement (§35.7). */
  readonly aidBuffer: boolean;
}

export interface NutritionInput {
  readonly timeline: NutritionTimeline;
  readonly targets: NutritionTargets;
  readonly placement: NutritionPlacement;
}

export interface NutritionNeeds {
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly hydrationMl: number;
}

/** Pourquoi une prise est là : dit au coureur, jamais une injonction (§105). */
export type MilestoneReason =
  'aid' | 'finish' | 'climb' | 'flat' | 'gentle_descent' | 'descent' | 'time';

export interface NutritionMilestone {
  /** Déterministe à entrée égale (§38, §60). */
  readonly stableKey: string;
  readonly kind: 'aid' | 'intake' | 'finish';
  /** Le point officiel, pour un ravitaillement ou l'arrivée. */
  readonly pointId: string | null;
  readonly name: string;
  readonly elapsedSeconds: number;
  readonly distanceKm: number;
  readonly reason: MilestoneReason;
  /** Besoin accumulé depuis la prise précédente (§12). */
  readonly needSincePrevious: NutritionNeeds;
}

/** D'un départ ou ravitaillement au suivant : ce qui se consomme, ce qui se prépare. */
export interface NutritionSection {
  readonly fromPointId: string;
  readonly toPointId: string;
  readonly fromName: string;
  readonly toName: string;
  readonly startElapsedSeconds: number;
  readonly endElapsedSeconds: number;
  readonly startKm: number;
  readonly endKm: number;
  readonly needs: NutritionNeeds;
  readonly waterMl: number;
  readonly drinkMl: number;
  /** Prises placées dans la section, hors ravitaillements. */
  readonly intakeCount: number;
}

export interface NutritionResult {
  readonly engineVersion: string;
  readonly configVersion: string;
  readonly inputHash: string;
  readonly totals: NutritionNeeds & { readonly caffeineMg: number | null };
  readonly sections: readonly NutritionSection[];
  readonly milestones: readonly NutritionMilestone[];
}
