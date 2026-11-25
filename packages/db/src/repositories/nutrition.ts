import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import { raceRepository, type RaceRepository } from './course.js';
import {
  planCourseRepository,
  racePlanRepository,
  type PlanCourseRepository,
  type RacePlanRepository,
} from './plan.js';
import { raceWaypointRepository, type RaceWaypointRepository } from './waypoints.js';

/*
 * Nutrition, tranche 1 — migrations 0001, 0003, 0102 ; NUTRITION_ENGINE §81.
 *
 * Lecture sous la session du coureur (policy de 0005) ; écriture par
 * `save_nutrition_settings`, qui vérifie la propriété et vise le Plan actif.
 */

export type NutritionDensityValue = 'frequent' | 'auto' | 'sparse';

export interface NutritionSettingsRecord {
  readonly id: string;
  readonly racePlanId: string;
  /** Faux quand la stratégie a été réglée sur une version du Plan qui n'est plus active. */
  readonly onActivePlan: boolean;
  readonly carbsGPerHour: number;
  readonly hydrationMlPerHour: number;
  readonly sodiumMgPerHour: number;
  readonly caffeineTotalMg: number | null;
  readonly waterSharePercent: number;
  readonly density: NutritionDensityValue;
  readonly aidBuffer: boolean;
  readonly placementMode: 'smart' | 'interval';
  readonly intervalMinutes: number | null;
  readonly confirmedAt: string | null;
  /** La Nutrition est activée ; désactivée, ses réglages restent pour une réactivation. */
  readonly enabled: boolean;
  /** Les produits de « Mes produits » choisis pour cette stratégie (0104). */
  readonly selectedProductIds: readonly string[];
  /** Ce que le coureur porte (0107). */
  readonly flaskCount: number;
  readonly flaskCapacityMl: number;
  readonly bladderMl: number | null;
  /** Les ravitaillements où il ne remplit pas ses flasques (0107). */
  readonly noRefillWaypointIds: readonly string[];
  /** Réserve de sécurité, 0 à 100 % (0001, réglable depuis 0108). */
  readonly reservePercent: number;
  /** D'où viennent les produits à un ravitaillement, quand le coureur l'a choisi (0108). */
  readonly supplyChoices: Readonly<Record<string, SupplyChoice>>;
  /** Les ravitaillements où il prend la boisson d'effort fournie (0110). */
  readonly aidDrinkWaypointIds: readonly string[];
  /** Répartition de la caféine (0112). */
  readonly caffeineSpread: CaffeineSpreadValue;
}

export type CaffeineSpreadValue = 'auto' | 'late' | 'night' | 'manual';
export type ConditionTypeValue = 'hot' | 'cold' | 'night';

/** Une condition de la stratégie et ses plages (0001, 0112) ; une cible nulle suit la proposition PLUKA. */
export interface NutritionConditionRecord {
  readonly type: ConditionTypeValue;
  readonly enabled: boolean;
  readonly carbsGPerHour: number | null;
  readonly hydrationMlPerHour: number | null;
  readonly sodiumMgPerHour: number | null;
  readonly ranges: readonly {
    readonly startElapsedSeconds: number;
    readonly endElapsedSeconds: number;
  }[];
}

/** Ce qui sert après un ravitaillement : porté depuis le départ, drop bag ou Assistance. */
export type SupplyChoice = 'start' | 'bag' | 'assistance';

export interface SaveNutritionSettings {
  readonly carbsGPerHour: number;
  readonly hydrationMlPerHour: number;
  readonly sodiumMgPerHour: number;
  readonly caffeineTotalMg: number | null;
  readonly waterSharePercent: number;
  readonly density: NutritionDensityValue;
  readonly aidBuffer: boolean;
  readonly placementMode: 'smart' | 'interval';
  readonly intervalMinutes: number | null;
  readonly engineVersion: string;
  readonly engineConfigVersion: string;
  readonly inputHash: string;
  readonly inputSnapshot: Readonly<Record<string, unknown>>;
}

export interface NutritionRepository {
  /** La stratégie la plus récente de la participation, quelle que soit la version du Plan. */
  findLatest(participantRaceId: string): Promise<NutritionSettingsRecord | null>;
  save(participantRaceId: string, settings: SaveNutritionSettings): Promise<void>;
  disable(participantRaceId: string): Promise<void>;
  /** Retient les produits choisis pour la stratégie du Plan actif (0104). */
  setProducts(participantRaceId: string, userProductIds: readonly string[]): Promise<void>;
  /** Les contenants portés, sur la stratégie du Plan actif (0107). */
  setContainers(participantRaceId: string, containers: ContainersInput): Promise<void>;
  /** « Je remplis ici » ou non, à un point de la course (0107). */
  setRefillPoint(participantRaceId: string, raceWaypointId: string, refill: boolean): Promise<void>;
  /** La réserve de la stratégie du Plan actif (0108). */
  setReserve(participantRaceId: string, reservePercent: number): Promise<void>;
  /** « Je prends la boisson du ravito ici », ou non (0110). */
  setAidDrink(participantRaceId: string, raceWaypointId: string, use: boolean): Promise<void>;
  /** D'où viennent les produits à un point ; nul, retour à l'automatique (0108). */
  setSupplyPoint(
    participantRaceId: string,
    raceWaypointId: string,
    source: SupplyChoice | null,
  ): Promise<void>;
  /** Les prises dont le coureur a fixé les produits (0106, §57-58). */
  listCustomMilestones(nutritionPlanId: string): Promise<readonly CustomMilestoneRecord[]>;
  setMilestoneItems(participantRaceId: string, milestone: CustomMilestoneInput): Promise<void>;
  /** Rend la prise au moteur : la proposition PLUKA revient. */
  resetMilestone(participantRaceId: string, stableKey: string): Promise<void>;
  /**
   * Recopie la stratégie validée sur la version active du Plan (0111, §61, §66).
   * Sans effet si elle y est déjà ; refusée si `fromNutritionPlanId` n'est plus
   * la stratégie la plus récente.
   */
  applyToActivePlan(participantRaceId: string, apply: ApplyNutritionInput): Promise<void>;
  /** Les conditions Chaud / Froid / Nuit d'une stratégie (0112). */
  listConditions(nutritionPlanId: string): Promise<readonly NutritionConditionRecord[]>;
  /** Remplace les conditions et la répartition de la caféine de la stratégie du Plan actif (0112). */
  saveConditions(
    participantRaceId: string,
    conditions: readonly NutritionConditionRecord[],
    caffeineSpread: CaffeineSpreadValue,
  ): Promise<void>;
  /** Porte les produits d'une prise sans place sur une prise du Plan actif (0111, N27). */
  placeOrphan(
    participantRaceId: string,
    orphanKey: string,
    target: CustomMilestoneInput,
  ): Promise<void>;
}

export interface ApplyNutritionInput {
  readonly fromNutritionPlanId: string;
  readonly engineVersion: string;
  readonly engineConfigVersion: string;
  readonly inputHash: string;
  readonly inputSnapshot: Readonly<Record<string, unknown>>;
  /** Les prises modifiées qui gardent leur place, à leur position sur le nouveau Plan. */
  readonly kept: readonly {
    readonly stableKey: string;
    readonly label: string;
    readonly elapsedSeconds: number;
    readonly distanceKm: number | null;
  }[];
  /** Le diff validé, gardé dans `nutrition_recalculations` (02 §15.6). */
  readonly diff: Readonly<Record<string, unknown>>;
}

export interface ContainersInput {
  readonly flaskCount: number;
  readonly flaskCapacityMl: number;
  readonly bladderMl: number | null;
}

export interface CustomMilestoneItemRecord {
  /** Nul si le produit a depuis été retiré de « Mes produits ». */
  readonly userProductId: string | null;
  readonly label: string;
  readonly quantity: number;
  /** Par portion, recopiés à l'enregistrement. */
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number;
}

export interface CustomMilestoneRecord {
  readonly stableKey: string;
  /** Là où la prise était quand le coureur l'a fixée, sur la version de sa stratégie. */
  readonly label: string;
  readonly elapsedSeconds: number;
  readonly distanceKm: number | null;
  readonly items: readonly CustomMilestoneItemRecord[];
}

export interface CustomMilestoneInput {
  readonly stableKey: string;
  readonly label: string;
  readonly elapsedSeconds: number;
  readonly distanceKm: number | null;
  readonly items: readonly { readonly userProductId: string; readonly quantity: number }[];
}

type CustomMilestoneRow = {
  stable_key: string;
  label: string;
  elapsed_seconds: number;
  distance_km: number | string | null;
  nutrition_waypoint_items: {
    user_nutrition_product_id: string | null;
    generic_label: string | null;
    product_label_snapshot: string | null;
    quantity: number;
    carbs_g: number;
    sodium_mg: number;
    caffeine_mg: number;
    hydration_ml: number;
    created_at: string;
  }[];
};

type SettingsRow = {
  id: string;
  race_plan_id: string;
  carbs_target_g_per_hour: number;
  hydration_target_ml_per_hour: number;
  sodium_target_mg_per_hour: number;
  caffeine_target_total_mg: number | null;
  water_share_percent: number;
  placement_density: string;
  aid_buffer: boolean;
  placement_mode: string;
  placement_interval_minutes: number | null;
  enabled: boolean;
  selected_user_product_ids: string[];
  flask_count: number;
  flask_capacity_ml: number;
  bladder_ml: number | null;
  no_refill_waypoint_ids: string[];
  reserve_percent: number;
  supply_start_waypoint_ids: string[];
  supply_bag_waypoint_ids: string[];
  supply_assistance_waypoint_ids: string[];
  aid_drink_waypoint_ids: string[];
  caffeine_spread: string;
  confirmed_at: string | null;
  race_plans: { status: string };
};

type ConditionRow = {
  condition_type: string;
  enabled: boolean;
  carbs_g_per_hour: number | string | null;
  hydration_ml_per_hour: number | null;
  sodium_mg_per_hour: number | null;
  nutrition_condition_ranges: { start_elapsed_seconds: number; end_elapsed_seconds: number }[];
};

const CAFFEINE_SPREADS: readonly string[] = ['auto', 'late', 'night', 'manual'];
const CONDITION_ORDER: readonly string[] = ['hot', 'cold', 'night'];

export const nutritionRepository = defineRepository<NutritionRepository>((context) => ({
  async findLatest(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('nutrition_plans')
        .select(
          'id, race_plan_id, carbs_target_g_per_hour, hydration_target_ml_per_hour, sodium_target_mg_per_hour, caffeine_target_total_mg, water_share_percent, placement_density, aid_buffer, placement_mode, placement_interval_minutes, enabled, selected_user_product_ids, flask_count, flask_capacity_ml, bladder_ml, no_refill_waypoint_ids, reserve_percent, supply_start_waypoint_ids, supply_bag_waypoint_ids, supply_assistance_waypoint_ids, aid_drink_waypoint_ids, caffeine_spread, confirmed_at, race_plans!inner(participant_race_id, status)',
        )
        .eq('race_plans.participant_race_id', participantRaceId)
        .order('generated_at', { ascending: false })
        .limit(1),
      'nutrition_plans.findLatest',
    ) as SettingsRow[] | null;

    const row = rows?.[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      racePlanId: row.race_plan_id,
      onActivePlan: row.race_plans.status === 'active',
      carbsGPerHour: Number(row.carbs_target_g_per_hour),
      hydrationMlPerHour: row.hydration_target_ml_per_hour,
      sodiumMgPerHour: row.sodium_target_mg_per_hour,
      caffeineTotalMg: row.caffeine_target_total_mg,
      waterSharePercent: Number(row.water_share_percent),
      density: row.placement_density as NutritionDensityValue,
      aidBuffer: row.aid_buffer,
      placementMode: row.placement_mode === 'interval' ? 'interval' : 'smart',
      intervalMinutes: row.placement_interval_minutes,
      enabled: row.enabled,
      selectedProductIds: row.selected_user_product_ids,
      flaskCount: row.flask_count,
      flaskCapacityMl: row.flask_capacity_ml,
      bladderMl: row.bladder_ml,
      noRefillWaypointIds: row.no_refill_waypoint_ids,
      reservePercent: Number(row.reserve_percent),
      supplyChoices: Object.fromEntries([
        ...row.supply_start_waypoint_ids.map((id) => [id, 'start'] as const),
        ...row.supply_bag_waypoint_ids.map((id) => [id, 'bag'] as const),
        ...row.supply_assistance_waypoint_ids.map((id) => [id, 'assistance'] as const),
      ]),
      aidDrinkWaypointIds: row.aid_drink_waypoint_ids,
      caffeineSpread: (CAFFEINE_SPREADS.includes(row.caffeine_spread)
        ? row.caffeine_spread
        : 'auto') as CaffeineSpreadValue,
      confirmedAt: row.confirmed_at,
    };
  },

  async listConditions(nutritionPlanId) {
    const rows = unwrapMaybe(
      await context.client
        .from('nutrition_conditions')
        .select(
          'condition_type, enabled, carbs_g_per_hour, hydration_ml_per_hour, sodium_mg_per_hour, nutrition_condition_ranges(start_elapsed_seconds, end_elapsed_seconds)',
        )
        .eq('nutrition_plan_id', nutritionPlanId),
      'nutrition_conditions.list',
    ) as ConditionRow[] | null;

    return (rows ?? [])
      .filter((row) => CONDITION_ORDER.includes(row.condition_type))
      .sort(
        (left, right) =>
          CONDITION_ORDER.indexOf(left.condition_type) -
          CONDITION_ORDER.indexOf(right.condition_type),
      )
      .map((row) => ({
        type: row.condition_type as ConditionTypeValue,
        enabled: row.enabled,
        carbsGPerHour: row.carbs_g_per_hour === null ? null : Number(row.carbs_g_per_hour),
        hydrationMlPerHour: row.hydration_ml_per_hour,
        sodiumMgPerHour: row.sodium_mg_per_hour,
        ranges: [...row.nutrition_condition_ranges]
          .sort((left, right) => left.start_elapsed_seconds - right.start_elapsed_seconds)
          .map((range) => ({
            startElapsedSeconds: range.start_elapsed_seconds,
            endElapsedSeconds: range.end_elapsed_seconds,
          })),
      }));
  },

  async saveConditions(participantRaceId, conditions, caffeineSpread) {
    unwrapMaybe(
      await context.client.rpc('save_nutrition_conditions', {
        p_participant_race_id: participantRaceId,
        p_conditions: conditions.map((condition) => ({
          type: condition.type,
          enabled: condition.enabled,
          carbs: condition.carbsGPerHour,
          hydration: condition.hydrationMlPerHour,
          sodium: condition.sodiumMgPerHour,
          ranges: condition.ranges.map((range) => ({
            start: Math.round(range.startElapsedSeconds),
            end: Math.round(range.endElapsedSeconds),
          })),
        })) as never,
        p_caffeine_spread: caffeineSpread,
      }),
      'save_nutrition_conditions',
    );
  },

  async save(participantRaceId, settings) {
    unwrap(
      await context.client.rpc('save_nutrition_settings', {
        p_participant_race_id: participantRaceId,
        p_carbs_g_per_hour: settings.carbsGPerHour,
        p_hydration_ml_per_hour: settings.hydrationMlPerHour,
        p_sodium_mg_per_hour: settings.sodiumMgPerHour,
        // Le type généré ne connaît pas la nullabilité des paramètres : la fonction l'accepte.
        p_caffeine_total_mg: settings.caffeineTotalMg as number,
        p_water_share_percent: settings.waterSharePercent,
        p_placement_density: settings.density,
        p_aid_buffer: settings.aidBuffer,
        p_placement_mode: settings.placementMode,
        p_placement_interval_minutes: settings.intervalMinutes as number,
        p_engine_version: settings.engineVersion,
        p_engine_config_version: settings.engineConfigVersion,
        p_input_hash: settings.inputHash,
        p_input_snapshot: settings.inputSnapshot as never,
      }),
      'save_nutrition_settings',
    );
  },

  async disable(participantRaceId) {
    unwrapMaybe(
      await context.client.rpc('disable_nutrition', { p_participant_race_id: participantRaceId }),
      'disable_nutrition',
    );
  },

  async setProducts(participantRaceId, userProductIds) {
    unwrapMaybe(
      await context.client.rpc('set_nutrition_products', {
        p_participant_race_id: participantRaceId,
        p_user_product_ids: [...userProductIds],
      }),
      'set_nutrition_products',
    );
  },

  async setContainers(participantRaceId, containers) {
    unwrapMaybe(
      await context.client.rpc('set_nutrition_containers', {
        p_participant_race_id: participantRaceId,
        p_flask_count: containers.flaskCount,
        p_flask_capacity_ml: containers.flaskCapacityMl,
        // Le type généré ne connaît pas la nullabilité des paramètres : la fonction l'accepte.
        p_bladder_ml: containers.bladderMl as number,
      }),
      'set_nutrition_containers',
    );
  },

  async setRefillPoint(participantRaceId, raceWaypointId, refill) {
    unwrapMaybe(
      await context.client.rpc('set_nutrition_refill_point', {
        p_participant_race_id: participantRaceId,
        p_race_waypoint_id: raceWaypointId,
        p_refill: refill,
      }),
      'set_nutrition_refill_point',
    );
  },

  async setReserve(participantRaceId, reservePercent) {
    unwrapMaybe(
      await context.client.rpc('set_nutrition_reserve', {
        p_participant_race_id: participantRaceId,
        p_reserve_percent: reservePercent,
      }),
      'set_nutrition_reserve',
    );
  },

  async setAidDrink(participantRaceId, raceWaypointId, use) {
    unwrapMaybe(
      await context.client.rpc('set_nutrition_aid_drink', {
        p_participant_race_id: participantRaceId,
        p_race_waypoint_id: raceWaypointId,
        p_use: use,
      }),
      'set_nutrition_aid_drink',
    );
  },

  async setSupplyPoint(participantRaceId, raceWaypointId, source) {
    unwrapMaybe(
      await context.client.rpc('set_nutrition_supply_point', {
        p_participant_race_id: participantRaceId,
        p_race_waypoint_id: raceWaypointId,
        // Le type généré ne connaît pas la nullabilité des paramètres : la fonction l'accepte.
        p_source: source as string,
      }),
      'set_nutrition_supply_point',
    );
  },

  async listCustomMilestones(nutritionPlanId) {
    const rows = unwrapMaybe(
      await context.client
        .from('nutrition_waypoints')
        .select(
          'stable_key, label, elapsed_seconds, distance_km, nutrition_waypoint_items(user_nutrition_product_id, generic_label, product_label_snapshot, quantity, carbs_g, sodium_mg, caffeine_mg, hydration_ml, created_at)',
        )
        .eq('nutrition_plan_id', nutritionPlanId)
        .eq('is_customized', true),
      'nutrition_waypoints.listCustom',
    ) as CustomMilestoneRow[] | null;

    return (rows ?? []).map((row) => ({
      stableKey: row.stable_key,
      label: row.label,
      elapsedSeconds: row.elapsed_seconds,
      distanceKm: row.distance_km === null ? null : Number(row.distance_km),
      items: [...row.nutrition_waypoint_items]
        .sort((left, right) => (left.created_at < right.created_at ? -1 : 1))
        .map((item) => ({
          userProductId: item.user_nutrition_product_id,
          label: item.generic_label ?? item.product_label_snapshot ?? 'Produit',
          // Une portion entière : la fonction n'écrit que des entiers (0106).
          quantity: Number(item.quantity),
          carbsG: Number(item.carbs_g),
          sodiumMg: item.sodium_mg,
          caffeineMg: item.caffeine_mg,
          hydrationMl: item.hydration_ml,
        })),
    }));
  },

  async setMilestoneItems(participantRaceId, milestone) {
    unwrapMaybe(
      await context.client.rpc('set_nutrition_milestone_items', {
        p_participant_race_id: participantRaceId,
        p_stable_key: milestone.stableKey,
        p_label: milestone.label,
        p_elapsed_seconds: Math.round(milestone.elapsedSeconds),
        // Le type généré ne connaît pas la nullabilité des paramètres : la fonction l'accepte.
        p_distance_km: milestone.distanceKm as number,
        p_user_product_ids: milestone.items.map((item) => item.userProductId),
        p_quantities: milestone.items.map((item) => item.quantity),
      }),
      'set_nutrition_milestone_items',
    );
  },

  async resetMilestone(participantRaceId, stableKey) {
    unwrapMaybe(
      await context.client.rpc('reset_nutrition_milestone', {
        p_participant_race_id: participantRaceId,
        p_stable_key: stableKey,
      }),
      'reset_nutrition_milestone',
    );
  },

  async applyToActivePlan(participantRaceId, apply) {
    unwrapMaybe(
      await context.client.rpc('apply_nutrition_to_active_plan', {
        p_participant_race_id: participantRaceId,
        p_from_nutrition_plan_id: apply.fromNutritionPlanId,
        p_engine_version: apply.engineVersion,
        p_engine_config_version: apply.engineConfigVersion,
        p_input_hash: apply.inputHash,
        p_input_snapshot: apply.inputSnapshot as never,
        p_kept: Object.fromEntries(
          apply.kept.map((milestone) => [
            milestone.stableKey,
            {
              label: milestone.label,
              elapsed_seconds: Math.round(milestone.elapsedSeconds),
              distance_km: milestone.distanceKm,
            },
          ]),
        ) as never,
        p_diff: apply.diff as never,
      }),
      'apply_nutrition_to_active_plan',
    );
  },

  async placeOrphan(participantRaceId, orphanKey, target) {
    unwrapMaybe(
      await context.client.rpc('place_nutrition_orphan', {
        p_participant_race_id: participantRaceId,
        p_orphan_key: orphanKey,
        p_target_key: target.stableKey,
        p_label: target.label,
        p_elapsed_seconds: Math.round(target.elapsedSeconds),
        // Le type généré ne connaît pas la nullabilité des paramètres : la fonction l'accepte.
        p_distance_km: target.distanceKm as number,
        p_user_product_ids: target.items.map((item) => item.userProductId),
        p_quantities: target.items.map((item) => item.quantity),
      }),
      'place_nutrition_orphan',
    );
  },
}));

/*
 * « Mes produits » — 0001, 0104. Sous la session du coureur : la RLS (0005)
 * réserve ses produits au coureur ; le catalogue validé est lisible de tous.
 * Pas de stock : une liste de produits, sans quantités (décision du 2026-11-17).
 */

export type NutritionProductCategory =
  | 'gel'
  | 'drink'
  | 'bar'
  | 'chew'
  | 'puree'
  | 'solid'
  | 'salty'
  | 'capsule'
  | 'electrolyte'
  | 'generic_aid'
  | 'other';

export interface MyProductRecord {
  readonly id: string;
  /** Le produit du catalogue d'origine ; nul pour un produit personnel. */
  readonly catalogueProductId: string | null;
  readonly brand: string | null;
  readonly name: string;
  readonly category: NutritionProductCategory;
  readonly servingLabel: string | null;
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number;
}

export interface CatalogueProductRecord {
  readonly id: string;
  readonly brand: string | null;
  readonly name: string;
  readonly category: NutritionProductCategory;
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number;
  /** Photo de la fiche (https, site de la marque) ; null si la fiche n'en a pas. */
  readonly imageUrl: string | null;
}

export interface CustomProductInput {
  readonly brand: string | null;
  readonly name: string;
  readonly category: NutritionProductCategory;
  readonly servingLabel: string | null;
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number;
}

export interface MyProductsRepository {
  list(userId: string): Promise<readonly MyProductRecord[]>;
  /**
   * Le catalogue validé ; 30 résultats au plus. Chaque mot tapé doit se
   * retrouver dans la marque, le nom ou la variante, sans tenir compte des
   * accents ni de la casse (« naak » trouve « Näak », 0105).
   */
  searchCatalogue(query: string): Promise<readonly CatalogueProductRecord[]>;
  /** Ajoute un produit du catalogue ; déjà présent, ne fait rien. Rend l'identifiant. */
  addFromCatalogue(userId: string, catalogueProductId: string): Promise<string>;
  createCustom(userId: string, product: CustomProductInput): Promise<string>;
  /** Volume de dilution d'une boisson en poudre : un réglage personnel (`custom_hydration_ml`). */
  setHydration(userId: string, userProductId: string, hydrationMl: number): Promise<void>;
}

type MyProductRow = {
  id: string;
  nutrition_product_id: string | null;
  custom_brand: string | null;
  custom_name: string | null;
  custom_serving_label: string | null;
  custom_carbs_g: number | null;
  custom_sodium_mg: number | null;
  custom_caffeine_mg: number | null;
  custom_hydration_ml: number | null;
  custom_category: NutritionProductCategory | null;
  nutrition_products: {
    brand: string | null;
    name: string;
    variant: string | null;
    category: NutritionProductCategory;
    serving_label: string | null;
    carbs_g: number;
    sodium_mg: number;
    caffeine_mg: number;
    hydration_ml: number;
  } | null;
};

const CATALOGUE_COLUMNS =
  'id, brand, name, variant, category, carbs_g, sodium_mg, caffeine_mg, hydration_ml, image_url';

type CatalogueRow = {
  id: string;
  brand: string | null;
  name: string;
  variant: string | null;
  category: NutritionProductCategory;
  carbs_g: number;
  sodium_mg: number;
  caffeine_mg: number;
  hydration_ml: number;
  image_url: string | null;
};

/** Même repli que `public.nutrition_search_fold` (0105) : casse et accents. */
function foldSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/gu, 'oe')
    .replace(/æ/gu, 'ae')
    .replace(/ß/gu, 'ss')
    .replace(/ł/gu, 'l')
    .replace(/ø/gu, 'o')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function nameOf(name: string, variant: string | null): string {
  return variant === null || variant === '' ? name : `${name} ${variant}`;
}

export const myProductsRepository = defineRepository<MyProductsRepository>((context) => ({
  async list(userId) {
    const rows = unwrapMaybe(
      await context.client
        .from('user_nutrition_products')
        .select(
          'id, nutrition_product_id, custom_brand, custom_name, custom_serving_label, custom_carbs_g, custom_sodium_mg, custom_caffeine_mg, custom_hydration_ml, custom_category, nutrition_products(brand, name, variant, category, serving_label, carbs_g, sodium_mg, caffeine_mg, hydration_ml)',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      'user_nutrition_products.list',
    ) as MyProductRow[] | null;

    return (rows ?? []).flatMap((row) => {
      const canonical = row.nutrition_products;
      if (canonical !== null) {
        return [
          {
            id: row.id,
            catalogueProductId: row.nutrition_product_id,
            brand: canonical.brand,
            name: nameOf(canonical.name, canonical.variant),
            category: canonical.category,
            servingLabel: canonical.serving_label,
            // Un réglage personnel l'emporte sur la fiche du catalogue.
            carbsG: Number(row.custom_carbs_g ?? canonical.carbs_g),
            sodiumMg: row.custom_sodium_mg ?? canonical.sodium_mg,
            caffeineMg: row.custom_caffeine_mg ?? canonical.caffeine_mg,
            hydrationMl: row.custom_hydration_ml ?? canonical.hydration_ml,
          },
        ];
      }
      if (row.custom_name === null || row.custom_category === null) return [];
      return [
        {
          id: row.id,
          catalogueProductId: null,
          brand: row.custom_brand,
          name: row.custom_name,
          category: row.custom_category,
          servingLabel: row.custom_serving_label,
          carbsG: Number(row.custom_carbs_g ?? 0),
          sodiumMg: row.custom_sodium_mg ?? 0,
          caffeineMg: row.custom_caffeine_mg ?? 0,
          hydrationMl: row.custom_hydration_ml ?? 0,
        },
      ];
    });
  },

  async searchCatalogue(query) {
    // `%` et `_` sont des jokers de `ilike` : on les retire de la saisie.
    const words = foldSearchText(query)
      .replace(/[%_\\]/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word !== '')
      .slice(0, 6);
    let request = context.client
      .from('nutrition_products')
      .select(CATALOGUE_COLUMNS)
      .eq('status', 'validated')
      .order('brand', { ascending: true })
      .order('name', { ascending: true })
      .limit(30);
    for (const word of words) request = request.ilike('search_key', `%${word}%`);
    const rows = unwrapMaybe(await request, 'nutrition_products.search') as CatalogueRow[] | null;

    return (rows ?? []).map((row) => ({
      id: row.id,
      brand: row.brand,
      name: nameOf(row.name, row.variant),
      category: row.category,
      carbsG: Number(row.carbs_g),
      sodiumMg: row.sodium_mg,
      caffeineMg: row.caffeine_mg,
      hydrationMl: row.hydration_ml,
      imageUrl: row.image_url,
    }));
  },

  async addFromCatalogue(userId, catalogueProductId) {
    const existing = unwrapMaybe(
      await context.client
        .from('user_nutrition_products')
        .select('id')
        .eq('user_id', userId)
        .eq('nutrition_product_id', catalogueProductId)
        .maybeSingle(),
      'user_nutrition_products.find',
    );
    if (existing !== null) return existing.id;

    const created = unwrap(
      await context.client
        .from('user_nutrition_products')
        .insert({ user_id: userId, nutrition_product_id: catalogueProductId })
        .select('id')
        .single(),
      'user_nutrition_products.addFromCatalogue',
    );
    return created.id;
  },

  async createCustom(userId, product) {
    const created = unwrap(
      await context.client
        .from('user_nutrition_products')
        .insert({
          user_id: userId,
          custom_brand: product.brand,
          custom_name: product.name,
          custom_category: product.category,
          custom_serving_label: product.servingLabel,
          custom_carbs_g: product.carbsG,
          custom_sodium_mg: product.sodiumMg,
          custom_caffeine_mg: product.caffeineMg,
          custom_hydration_ml: product.hydrationMl,
        })
        .select('id')
        .single(),
      'user_nutrition_products.createCustom',
    );
    return created.id;
  },

  async setHydration(userId, userProductId, hydrationMl) {
    unwrapMaybe(
      await context.client
        .from('user_nutrition_products')
        .update({ custom_hydration_ml: hydrationMl, updated_at: new Date().toISOString() })
        .eq('id', userProductId)
        .eq('user_id', userId),
      'user_nutrition_products.setHydration',
    );
  },
}));

export interface NutritionRepositories {
  readonly nutrition: NutritionRepository;
  /** Le Plan actif, ses points et ses sections : la timeline de la stratégie (§7). */
  readonly racePlans: RacePlanRepository;
  /** Segments et micro-segments du parcours : le terrain des prises (§35.9). */
  readonly planCourse: PlanCourseRepository;
  /** Les points du parcours, leur type et l'assistance autorisée. */
  readonly waypoints: RaceWaypointRepository;
  readonly races: RaceRepository;
  /** « Mes produits » et le catalogue (0104). */
  readonly myProducts: MyProductsRepository;
}

export function createNutritionRepositories(context: RepositoryContext): NutritionRepositories {
  return {
    nutrition: nutritionRepository(context),
    racePlans: racePlanRepository(context),
    planCourse: planCourseRepository(context),
    waypoints: raceWaypointRepository(context),
    races: raceRepository(context),
    myProducts: myProductsRepository(context),
  };
}
