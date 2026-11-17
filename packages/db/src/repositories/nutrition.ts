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
  confirmed_at: string | null;
  race_plans: { status: string };
};

export const nutritionRepository = defineRepository<NutritionRepository>((context) => ({
  async findLatest(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('nutrition_plans')
        .select(
          'id, race_plan_id, carbs_target_g_per_hour, hydration_target_ml_per_hour, sodium_target_mg_per_hour, caffeine_target_total_mg, water_share_percent, placement_density, aid_buffer, placement_mode, placement_interval_minutes, enabled, confirmed_at, race_plans!inner(participant_race_id, status)',
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
}

export function createNutritionRepositories(context: RepositoryContext): NutritionRepositories {
  return {
    nutrition: nutritionRepository(context),
    racePlans: racePlanRepository(context),
    planCourse: planCourseRepository(context),
    waypoints: raceWaypointRepository(context),
    races: raceRepository(context),
  };
}
