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

/** Les conditions d'une stratégie — §13 à §17. */
export type ConditionKind = 'hot' | 'cold' | 'night';

/** Les cibles horaires appliquées sur une plage chaude ou froide (§14, §15). */
export interface ConditionTargets {
  readonly carbsGPerHour: number;
  readonly hydrationMlPerHour: number;
  readonly sodiumMgPerHour: number;
}

/** Ce que le coureur a fixé lui-même ; une valeur nulle suit la proposition PLUKA. */
export interface ConditionOverrides {
  readonly carbsGPerHour: number | null;
  readonly hydrationMlPerHour: number | null;
  readonly sodiumMgPerHour: number | null;
}

/** Une plage en temps écoulé depuis le départ, toujours bornée (§13, §68). */
export interface NutritionConditionRange {
  readonly kind: ConditionKind;
  readonly startElapsedSeconds: number;
  readonly endElapsedSeconds: number;
}

export interface NutritionConditionsInput {
  readonly hot?: ConditionOverrides;
  readonly cold?: ConditionOverrides;
  /** Les plages actives seulement : une condition désactivée n'en envoie aucune. */
  readonly ranges: readonly NutritionConditionRange[];
}

/**
 * Répartition de la caféine (§24, décision du 2026-11-24, prototype) : sur
 * toute la course, à partir de la mi-course, sur les plages Nuit, ou placée
 * par le coureur. Le total ne change jamais (§25).
 */
export type CaffeineSpread = 'auto' | 'late' | 'night' | 'manual';

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
  /** Les produits choisis par le coureur (§27). Absents : pas de répartition. */
  readonly products?: readonly import('./allocator.js').NutritionProduct[];
  /**
   * Les produits que le coureur a choisis lui-même pour une prise, par
   * `stableKey` (§57, §58). Ils sont gardés tels quels, et les autres prises
   * s'ajustent autour (§40, étape 2). Une liste vide : rien à cette prise.
   */
  readonly customItems?: Readonly<Record<string, readonly import('./allocator.js').CustomItem[]>>;
  /** Ce que le coureur porte (flasques, poche) ; absent : pas de plan de flasques. */
  readonly containers?: import('./flasks.js').NutritionContainers;
  /** Les ravitaillements où le coureur ne remplit pas (« je ne remplis pas ici »). */
  readonly noRefillPointIds?: readonly string[];
  /** Les ravitaillements où le coureur prend la boisson d'effort fournie (0110). */
  readonly aidDrinkPointIds?: readonly string[];
  /** Temps chaud, froid, nuit (§13 à §19) ; absentes : les cibles de base partout. */
  readonly conditions?: NutritionConditionsInput;
  /** Absente : `auto`, la caféine au prorata du temps (§24). */
  readonly caffeineSpread?: CaffeineSpread;
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
  /** Répartition des produits et couverture ; nulle sans produits fournis. */
  readonly allocation: import('./allocator.js').Allocation | null;
  /** Quoi mettre dans chaque flasque à chaque point ; nul sans contenants ni hydratation. */
  readonly flasks: import('./flasks.js').FlaskPlan | null;
  /** Les cibles Chaud / Froid appliquées, les propositions PLUKA et les plages retenues. */
  readonly conditions: import('./targets.js').ConditionsResult;
}
