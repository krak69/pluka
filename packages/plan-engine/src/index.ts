/**
 * `@pluka/plan-engine` — moteur Plan V1.
 *
 * docs/engines/PLAN_ENGINE.md §68 en donne la responsabilité :
 *
 * > répartir intelligemment et de manière éditable un objectif utilisateur sur
 * > un parcours de trail réel.
 *
 * Pas : prédire ce que le coureur fera réellement.
 *
 * Le paquet est pur et déterministe (§28, §35) : aucune dépendance — ni React,
 * ni Next.js, ni Supabase, ni réseau, ni IA, ni horloge implicite. Il reçoit un
 * snapshot cohérent, rend un résultat, et rien d'autre. Le même input logique
 * avec les mêmes versions produit toujours le même Plan.
 *
 * §6.2 borne ce qui n'entre pas dans la formule : Profil trailer, index ITRA /
 * UTMB, Repère PLUKA, Nutrition, météo, matériel, Assistance, Race Intelligence
 * et entitlement commercial. Ces domaines consomment le résultat ou
 * conditionnent l'accès à l'action ; ils ne changent pas le calcul.
 */

export { calculatePlan } from './calculate.js';
export {
  PLAN_ENGINE_V1,
  type GradeCurvePoint,
  type PlanEngineConfig,
  type TechnicalityLevel,
} from './config.js';
export type {
  CutoffBasis,
  CutoffMarginStatus,
  OfficialCourseReference,
  PlanAnchorInput,
  PlanCalculationInput,
  PlanCalculationMetadata,
  PlanCalculationResult,
  PlanCourseInput,
  PlanCutoffInput,
  PlanCutoffStatusResult,
  PlanIssue,
  PlanIssueCode,
  PlanIssueLevel,
  PlanMicroSegment,
  PlanMode,
  PlanRaceInput,
  PlanRaceSegmentInput,
  PlanSegmentOverrideInput,
  PlanSegmentResult,
  PlanStopInput,
  PlanWaypointInput,
  PlanWaypointResult,
} from './contracts.js';
export { evaluateCutoffs, marginStatus, type CutoffEvaluation } from './cutoffs.js';
export { fatigueFactor } from './fatigue.js';
export { clampGrade, gradeFactor, gradeFactorFor } from './grade-factor.js';
export { canonicalize, computeInputHash } from './hash.js';
export { issueLevel, PlanEngineError, planIssue } from './issues.js';
export {
  preprocessCourse,
  resampleTrack,
  type CourseTrackPoint,
  type CourseWaypointInput,
  type PreprocessCourseInput,
  type PreprocessedCourse,
} from './preprocessing.js';
export { distributeSeconds, type RoundedItem, type RoundingItem } from './rounding.js';
export { referenceDurations, solve, stopSeconds, type SolvedPlan } from './solver.js';
export { technicalityFactor } from './technicality.js';
export { buildTimeline } from './timeline.js';
export { validateInput } from './validation.js';
export {
  aggregateSegmentWeights,
  microSegmentWeight,
  totalWeight,
  type MicroSegmentWeight,
  type SegmentWeight,
} from './weights.js';
