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
}

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
}

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
  confirmed_at: string | null;
  race_plans: { status: string };
};

export const nutritionRepository = defineRepository<NutritionRepository>((context) => ({
  async findLatest(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('nutrition_plans')
        .select(
          'id, race_plan_id, carbs_target_g_per_hour, hydration_target_ml_per_hour, sodium_target_mg_per_hour, caffeine_target_total_mg, water_share_percent, placement_density, aid_buffer, placement_mode, placement_interval_minutes, enabled, selected_user_product_ids, confirmed_at, race_plans!inner(participant_race_id, status)',
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
      confirmedAt: row.confirmed_at,
    };
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
  /** Le catalogue validé, par nom ou marque ; 30 résultats au plus. */
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
  'id, brand, name, variant, category, carbs_g, sodium_mg, caffeine_mg, hydration_ml';

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
};

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
    const term = query.trim().replace(/[%_,()]/gu, ' ');
    let request = context.client
      .from('nutrition_products')
      .select(CATALOGUE_COLUMNS)
      .eq('status', 'validated')
      .order('brand', { ascending: true })
      .order('name', { ascending: true })
      .limit(30);
    if (term !== '') request = request.or(`name.ilike.%${term}%,brand.ilike.%${term}%`);
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
