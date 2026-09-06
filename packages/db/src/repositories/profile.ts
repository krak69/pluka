import { selectColumns } from '../columns.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import type { UpdateRow } from '../types.js';
import type { TrailProfileRecord } from './records.js';

/*
 * Repository du Profil trailer — 02_DATA_MODEL §4.2.
 *
 * Il exécute des requêtes et traduit des lignes. Aucune décision
 * d'autorisation, d'entitlement ou de complétude n'est prise ici : ces règles
 * vivent dans `@pluka/domain` (01_ARCHITECTURE §4.5, §5 règle 5).
 *
 * Une seule lecture existe, et elle prend un `userId`. Il n'y a volontairement
 * ni `listByRace`, ni jointure depuis `participant_races`, ni filtre par
 * organisation : 03_PRIVACY_RLS §13 est catégorique — « ORGANIZATION : aucun ».
 * Le profil n'est pas rendu invisible à l'organisation par une policy qu'on
 * pourrait contourner avec une clé de service ; il n'existe simplement aucune
 * requête, dans ce paquet, capable de le lire autrement que par son
 * propriétaire.
 */

const TRAIL_PROFILE_COLUMNS = [
  'user_id',
  'representative_effort_label',
  'representative_effort_date',
  'representative_distance_km',
  'representative_elevation_gain_m',
  'representative_duration_seconds',
  'fallback_trail_pace_seconds_per_km',
  'weekly_distance_km',
  'weekly_elevation_gain_m',
  'climb_comfort',
  'descent_comfort',
  'long_distance_experience',
  'profile_completed_at',
] as const;

type TrailProfileRow = {
  user_id: string;
  representative_effort_label: string | null;
  representative_effort_date: string | null;
  representative_distance_km: number | null;
  representative_elevation_gain_m: number | null;
  representative_duration_seconds: number | null;
  fallback_trail_pace_seconds_per_km: number | null;
  weekly_distance_km: number | null;
  weekly_elevation_gain_m: number | null;
  climb_comfort: TrailProfileRecord['climbComfort'];
  descent_comfort: TrailProfileRecord['descentComfort'];
  long_distance_experience: TrailProfileRecord['longDistanceExperience'];
  profile_completed_at: string | null;
};

function toTrailProfile(row: TrailProfileRow): TrailProfileRecord {
  return {
    userId: row.user_id,
    representativeEffortLabel: row.representative_effort_label,
    representativeEffortDate: row.representative_effort_date,
    representativeDistanceKm: row.representative_distance_km,
    representativeElevationGainM: row.representative_elevation_gain_m,
    representativeDurationSeconds: row.representative_duration_seconds,
    fallbackTrailPaceSecondsPerKm: row.fallback_trail_pace_seconds_per_km,
    weeklyDistanceKm: row.weekly_distance_km,
    weeklyElevationGainM: row.weekly_elevation_gain_m,
    climbComfort: row.climb_comfort,
    descentComfort: row.descent_comfort,
    longDistanceExperience: row.long_distance_experience,
    profileCompletedAt: row.profile_completed_at,
  };
}

export interface TrailProfileRepository {
  /**
   * Le profil d'un utilisateur, ou son absence.
   *
   * `null` est un état normal : un compte neuf n'a pas encore de profil, et
   * §7.2 en dépend pour savoir s'il faut poser les questions.
   */
  findByUser(userId: string): Promise<TrailProfileRecord | null>;
  /**
   * Écrit le profil, en créant la ligne si elle manque.
   *
   * Le `user_id` fait partie de la charge parce qu'il est la clé primaire :
   * c'est lui qui décide si l'écriture crée ou remplace. Le use case le
   * remplit avec l'acteur de la session, jamais avec une valeur reçue
   * (03_PRIVACY_RLS §11).
   *
   * L'appelant transmet l'état complet qu'il veut voir en base. Fusionner un
   * patch avec l'existant est une décision métier — savoir si `null` veut dire
   * « efface » ou « ne touche pas » — et elle appartient au domaine.
   */
  upsert(userId: string, values: UpdateRow<'trail_profiles'>): Promise<TrailProfileRecord>;
}

export const trailProfileRepository = defineRepository<TrailProfileRepository>((context) => ({
  async findByUser(userId) {
    const row = unwrapMaybe(
      await context.client
        .from('trail_profiles')
        .select(selectColumns('trail_profiles', TRAIL_PROFILE_COLUMNS))
        .eq('user_id', userId)
        .maybeSingle(),
      'trail_profiles.findByUser',
    );

    return row === null ? null : toTrailProfile(row);
  },

  async upsert(userId, values) {
    return toTrailProfile(
      unwrap(
        await context.client
          .from('trail_profiles')
          .upsert({ ...values, user_id: userId }, { onConflict: 'user_id' })
          .select(selectColumns('trail_profiles', TRAIL_PROFILE_COLUMNS))
          .single(),
        'trail_profiles.upsert',
      ),
    );
  },
}));

/**
 * Bundle passé aux use cases de profil.
 *
 * Il ne contient qu'un repository, et c'est le point : le profil trailer ne se
 * croise avec rien. Pas d'identité d'organisation à relire, pas de hiérarchie
 * de course à remonter — la seule question est « est-ce le sien ? », et elle
 * se répond avec l'acteur de la session.
 */
export interface ProfileRepositories {
  readonly trailProfiles: TrailProfileRepository;
}

export function createProfileRepositories(context: RepositoryContext): ProfileRepositories {
  return { trailProfiles: trailProfileRepository(context) };
}
