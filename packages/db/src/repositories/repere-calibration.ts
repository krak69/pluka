import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';

/*
 * Couples de calibrage du Repère — migration 0074.
 *
 * Les couples sont au coureur, sous sa session : la RLS les borne à lui. Les
 * échantillons du rapport sont anonymes et réservés à un `pluka_admin`.
 */

export interface RepereCalibrationPairRecord {
  readonly id: string;
  readonly referenceDistanceKm: number;
  readonly referenceElevationGainM: number;
  readonly referenceDurationSeconds: number;
  readonly referenceDate: string;
  readonly courseDistanceKm: number;
  readonly courseElevationGainM: number;
  readonly courseDurationSeconds: number;
  readonly courseDate: string;
}

export type RepereCalibrationPairInput = Omit<RepereCalibrationPairRecord, 'id'>;

/** Un échantillon anonyme du rapport : ni compte, ni course, ni date. */
export interface RepereCalibrationSampleRecord {
  readonly source: 'declared' | 'estimate';
  readonly referenceDistanceKm: number;
  readonly referenceElevationGainM: number;
  readonly referenceDurationSeconds: number;
  readonly monthsBefore: number;
  readonly courseDistanceKm: number;
  readonly courseElevationGainM: number;
  readonly actualDurationSeconds: number;
}

export interface RepereCalibrationRepository {
  listOwn(userId: string): Promise<readonly RepereCalibrationPairRecord[]>;
  add(userId: string, pair: RepereCalibrationPairInput): Promise<void>;
  remove(pairId: string): Promise<void>;
  /** Réservé à un `pluka_admin` : la base refuse tout autre appelant. */
  samples(): Promise<readonly RepereCalibrationSampleRecord[]>;
}

export const repereCalibrationRepository = defineRepository<RepereCalibrationRepository>(
  (context) => ({
    async listOwn(userId) {
      const rows = unwrapMaybe(
        await context.client
          .from('repere_calibration_pairs')
          .select(
            'id, reference_distance_km, reference_elevation_gain_m, reference_duration_seconds, reference_date, course_distance_km, course_elevation_gain_m, course_duration_seconds, course_date',
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        'repere_calibration_pairs.listOwn',
      );

      return (rows ?? []).map((row) => ({
        id: row.id,
        referenceDistanceKm: Number(row.reference_distance_km),
        referenceElevationGainM: row.reference_elevation_gain_m,
        referenceDurationSeconds: row.reference_duration_seconds,
        referenceDate: row.reference_date,
        courseDistanceKm: Number(row.course_distance_km),
        courseElevationGainM: row.course_elevation_gain_m,
        courseDurationSeconds: row.course_duration_seconds,
        courseDate: row.course_date,
      }));
    },

    async add(userId, pair) {
      // Une insertion sans relecture ne rend aucune ligne : seule une erreur compte.
      unwrapMaybe(
        await context.client.from('repere_calibration_pairs').insert({
          user_id: userId,
          reference_distance_km: pair.referenceDistanceKm,
          reference_elevation_gain_m: pair.referenceElevationGainM,
          reference_duration_seconds: pair.referenceDurationSeconds,
          reference_date: pair.referenceDate,
          course_distance_km: pair.courseDistanceKm,
          course_elevation_gain_m: pair.courseElevationGainM,
          course_duration_seconds: pair.courseDurationSeconds,
          course_date: pair.courseDate,
        }),
        'repere_calibration_pairs.add',
      );
    },

    async remove(pairId) {
      unwrapMaybe(
        await context.client.from('repere_calibration_pairs').delete().eq('id', pairId),
        'repere_calibration_pairs.remove',
      );
    },

    async samples() {
      const rows = unwrapMaybe(
        await context.client.rpc('admin_repere_calibration_samples'),
        'admin_repere_calibration_samples',
      );

      return (rows ?? []).map((row) => ({
        source: row.source === 'estimate' ? ('estimate' as const) : ('declared' as const),
        referenceDistanceKm: Number(row.reference_distance_km),
        referenceElevationGainM: row.reference_elevation_gain_m,
        referenceDurationSeconds: row.reference_duration_seconds,
        monthsBefore: row.months_before,
        courseDistanceKm: Number(row.course_distance_km),
        courseElevationGainM: row.course_elevation_gain_m,
        actualDurationSeconds: row.actual_duration_seconds,
      }));
    },
  }),
);

export interface RepereCalibrationRepositories {
  readonly repereCalibration: RepereCalibrationRepository;
}

export function createRepereCalibrationRepositories(
  context: RepositoryContext,
): RepereCalibrationRepositories {
  return { repereCalibration: repereCalibrationRepository(context) };
}
