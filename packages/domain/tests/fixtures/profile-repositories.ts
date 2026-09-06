import type { ProfileRepositories, TrailProfileRecord } from '@pluka/db';

/**
 * Repository de Profil trailer en mémoire.
 *
 * Il implémente la même interface que `@pluka/db` : les use cases testés sont
 * exactement ceux qui tourneront en production.
 *
 * Il reproduit la contrainte `trail_profiles_effort_is_whole` de la migration
 * 0019 : sans elle, un test « le domaine refuse un effort partiel » pourrait
 * passer alors que le domaine l'aurait laissé filer jusqu'à une base qui, en
 * vrai, l'aurait refusé.
 */
export function createFakeProfileRepositories(
  state: Map<string, TrailProfileRecord>,
): ProfileRepositories {
  return {
    trailProfiles: {
      findByUser: async (userId) => state.get(userId) ?? null,

      upsert: async (userId, values) => {
        const measures = [
          values.representative_distance_km ?? null,
          values.representative_elevation_gain_m ?? null,
          values.representative_duration_seconds ?? null,
        ];
        const present = measures.filter((measure) => measure !== null).length;
        if (present > 0 && present < measures.length) {
          throw new Error('trail_profiles_effort_is_whole : effort représentatif incomplet');
        }

        const record: TrailProfileRecord = {
          userId,
          representativeEffortLabel: values.representative_effort_label ?? null,
          representativeEffortDate: values.representative_effort_date ?? null,
          representativeDistanceKm: values.representative_distance_km ?? null,
          representativeElevationGainM: values.representative_elevation_gain_m ?? null,
          representativeDurationSeconds: values.representative_duration_seconds ?? null,
          fallbackTrailPaceSecondsPerKm: values.fallback_trail_pace_seconds_per_km ?? null,
          weeklyDistanceKm: values.weekly_distance_km ?? null,
          weeklyElevationGainM: values.weekly_elevation_gain_m ?? null,
          climbComfort: values.climb_comfort ?? null,
          descentComfort: values.descent_comfort ?? null,
          longDistanceExperience: values.long_distance_experience ?? null,
          profileCompletedAt: values.profile_completed_at ?? null,
        };

        state.set(userId, record);
        return record;
      },
    },
  };
}
