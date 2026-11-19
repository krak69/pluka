/**
 * @pluka/nutrition-engine — NUTRITION_ENGINE.md.
 *
 * Pur, déterministe, versionné : ni Next.js, ni Supabase, ni réseau (§107).
 * Le coureur fixe ses cibles ; le moteur les répartit sur son Plan.
 */
export { NUTRITION_ENGINE_V1, type NutritionEngineConfig } from './config.js';
export type {
  MilestoneReason,
  NutritionDensity,
  NutritionInput,
  NutritionMilestone,
  NutritionNeeds,
  NutritionPlacement,
  NutritionResult,
  NutritionSection,
  NutritionTargets,
  NutritionTerrainSpan,
  NutritionTimeline,
  NutritionTimelinePoint,
} from './contracts.js';
export { generateNutrition } from './engine.js';
export {
  planFlasks,
  type FlaskAction,
  type FlaskActionKind,
  type FlaskContainer,
  type FlaskPlan,
  type FlaskStop,
  type FlaskWarning,
  type NutritionContainers,
} from './flasks.js';
export { computeNutritionHash } from './hash.js';
export {
  allocateProducts,
  type AllocatedItem,
  type Allocation,
  type AllocationWarning,
  type Coverage,
  type CustomItem,
  type NutritionProduct,
} from './allocator.js';
