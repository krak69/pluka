import type { PlanEngineConfig, TechnicalityLevel } from './config.js';

/**
 * Contrats du moteur Plan — docs/engines/PLAN_ENGINE.md §29 à §33.
 *
 * §6 : « le moteur reçoit un snapshot cohérent. Il ne lit ni PostgreSQL, ni un
 * PDF, ni un écran React, ni une URL, ni une source brute, ni un provider
 * météo. » Tout ce qui suit est donc une donnée assemblée et validée par la
 * couche domaine avant l'appel.
 *
 * §6.2 énumère ce qui n'entre pas dans le calcul : Trail Profile, index ITRA /
 * UTMB, Repère PLUKA, Nutrition, météo, matériel, Assistance, Race
 * Intelligence, entitlement commercial. Aucun de ces noms n'apparaît dans ce
 * fichier, et c'est la garantie la plus simple qu'ils n'influencent pas la
 * formule.
 */

/** Micro-segment prétraité — §30. Unité interne de coût, jamais un objet produit (§4). */
export interface PlanMicroSegment {
  readonly id: string;
  readonly raceSegmentId: string;
  readonly sortOrder: number;
  readonly distanceMeters: number;
  readonly elevationDeltaMeters: number;
  readonly elevationGainMeters: number;
  readonly elevationLossMeters: number;
  /** Pente réelle, conservée pour le diagnostic (§11.2). */
  readonly rawGrade: number;
  /** Pente bornée à ±40 %, celle que le modèle consomme (§11.2). */
  readonly modelGrade: number;
  /** Progression le long du parcours, dans `[0, 1]` (§13). */
  readonly progress: number;
  /** `null` quand la donnée n'existe pas : le moteur n'invente pas (§12.1). */
  readonly technicality: TechnicalityLevel | null;
}

export interface PlanWaypointInput {
  readonly id: string;
  readonly sortOrder: number;
}

export interface PlanRaceSegmentInput {
  readonly id: string;
  readonly sortOrder: number;
  readonly fromWaypointId: string;
  readonly toWaypointId: string;
}

export type CutoffBasis = 'arrival' | 'departure';

/**
 * Barrière horaire — §25.
 *
 * L'instant est reçu en secondes écoulées depuis le départ effectif, comme
 * tout le reste du moteur (§5.1). La conversion depuis une date calendaire
 * appartient au service applicatif, qui connaît le départ effectif (§5.2).
 */
export interface PlanCutoffInput {
  readonly id: string;
  readonly waypointId: string;
  readonly cutoffElapsedSeconds: number;
  readonly basis: CutoffBasis;
}

/** Référentiel officiel, pour les contrôles qualité de §9. */
export interface OfficialCourseReference {
  readonly distanceMeters?: number;
  readonly elevationGainMeters?: number;
}

export interface PlanCourseInput {
  readonly preprocessingVersion: string;
  readonly microSegments: readonly PlanMicroSegment[];
  readonly raceSegments: readonly PlanRaceSegmentInput[];
  readonly waypoints: readonly PlanWaypointInput[];
  readonly cutoffs: readonly PlanCutoffInput[];
  readonly official?: OfficialCourseReference;
}

/** §21.3 — un arrêt manuel devient fixe jusqu'à modification ultérieure. */
export interface PlanStopInput {
  readonly waypointId: string;
  readonly durationSeconds: number;
  readonly origin: 'default' | 'manual';
}

/** §21.2 — durée imposée d'un segment. Contrainte de durée, pas d'horaire (§18.1). */
export interface PlanSegmentOverrideInput {
  readonly segmentId: string;
  readonly durationSeconds: number;
}

/** §21.4 — heure d'arrivée verrouillée : une ancre dure. */
export interface PlanAnchorInput {
  readonly waypointId: string;
  readonly arrivalElapsedSeconds: number;
}

/** §22 — les deux comportements après une modification. */
export type PlanMode = 'preserve_manual_changes' | 'rebalance_to_target';

export interface PlanRaceInput {
  readonly id: string;
  readonly timezone: string;
  /** Départ effectif, déjà résolu par le service applicatif (§5.2). */
  readonly startAt: string;
}

export interface PlanCalculationInput {
  readonly race: PlanRaceInput;
  readonly course: PlanCourseInput;
  readonly targetDurationSeconds: number;
  readonly stops: readonly PlanStopInput[];
  readonly segmentOverrides: readonly PlanSegmentOverrideInput[];
  readonly anchors: readonly PlanAnchorInput[];
  readonly mode: PlanMode;
  readonly engineConfig: PlanEngineConfig;
}

/** §48.1 — trois niveaux, trois conséquences produit. */
export type PlanIssueLevel = 'error' | 'warning' | 'conflict';

/** §49 — codes principaux. */
export type PlanIssueCode =
  | 'GPX_INVALID'
  | 'WAYPOINT_OFF_ROUTE'
  | 'TARGET_TOO_SHORT'
  | 'ANCHOR_ORDER_CONFLICT'
  | 'FIXED_DURATION_CONFLICT'
  | 'GPX_DISTANCE_MISMATCH'
  | 'GPX_GAIN_MISMATCH'
  /**
   * D+ mesuré absent sur la géométrie courante — §9.
   *
   * Le moteur ne l'émet pas : il ne voit pas la ligne stockée. Le code vit ici
   * parce que le vocabulaire des constats de parcours est unique — et parce
   * qu'un `GPX_GAIN_MISSING` classé ailleurs finirait par diverger de
   * `GPX_GAIN_MISMATCH`, qu'il complète.
   */
  | 'GPX_GAIN_MISSING'
  | 'CUTOFF_CRITICAL'
  | 'CUTOFF_MISSED'
  | 'EXTREME_REBALANCE';

export interface PlanIssue {
  readonly code: PlanIssueCode;
  readonly level: PlanIssueLevel;
  readonly message: string;
  /** Identifiants concernés, pour que l'UI désigne la contrainte en cause (§24). */
  readonly waypointId?: string;
  readonly segmentId?: string;
  readonly cutoffId?: string;
}

/** §32. */
export interface PlanSegmentResult {
  readonly raceSegmentId: string;
  readonly sortOrder: number;
  /** Durée de la proposition de référence, avant contraintes explicites. */
  readonly initialDurationSeconds: number;
  readonly plannedDurationSeconds: number;
  readonly manualOverride: boolean;
  readonly relativeWeight: number;
}

/** §33. */
export interface PlanWaypointResult {
  readonly raceWaypointId: string;
  readonly sortOrder: number;
  readonly plannedElapsedSeconds: number;
  readonly plannedArrivalAt: string;
  readonly stopDurationSeconds: number;
  readonly plannedDepartureElapsedSeconds: number;
  readonly plannedDepartureAt: string;
  readonly isLocked: boolean;
  readonly lockedElapsedSeconds: number | null;
}

/**
 * Statut de marge — §26.
 *
 * §26 laisse le vocabulaire au schéma : « si la base utilise `exceeded`, le
 * mapping domaine → DB doit utiliser `exceeded` ». L'enum réellement déployé
 * est `cutoff_margin_status` de la migration 0001, dont la quatrième valeur est
 * `beyond` — c'est donc celle-ci.
 */
export type CutoffMarginStatus = 'comfortable' | 'watch' | 'critical' | 'beyond';

export interface PlanCutoffStatusResult {
  readonly cutoffId: string;
  readonly raceWaypointId: string;
  readonly basis: CutoffBasis;
  readonly cutoffElapsedSeconds: number;
  readonly plannedReferenceElapsedSeconds: number;
  readonly marginSeconds: number;
  readonly status: CutoffMarginStatus;
}

/** §51 — données de diagnostic, techniques et sans donnée personnelle (§60). */
export interface PlanCalculationMetadata {
  readonly engineVersion: string;
  readonly preprocessingVersion: string;
  readonly inputHash: string;
  readonly totalWeight: number;
  readonly stopBudgetSeconds: number;
  readonly fixedSegmentBudgetSeconds: number;
  readonly solvedIntervals: number;
  readonly microSegmentCount: number;
  readonly raceSegmentCount: number;
  readonly waypointCount: number;
  readonly anchorCount: number;
  readonly overrideCount: number;
  readonly stopCount: number;
}

/** §31. */
export interface PlanCalculationResult {
  readonly status: 'ok' | 'error';
  readonly targetDurationSeconds: number;
  readonly finishElapsedSeconds: number | null;
  readonly planSegments: readonly PlanSegmentResult[];
  readonly planWaypoints: readonly PlanWaypointResult[];
  readonly cutoffStatuses: readonly PlanCutoffStatusResult[];
  readonly warnings: readonly PlanIssue[];
  readonly conflicts: readonly PlanIssue[];
  readonly changedRange: {
    readonly fromWaypointId: string;
    readonly toWaypointId: string;
  } | null;
  readonly calculationMetadata: PlanCalculationMetadata;
}
