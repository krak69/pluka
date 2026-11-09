import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';

/*
 * Estimations du Repère PLUKA — migration 0070.
 *
 * Écrites sous la session du coureur : la RLS n'ouvre la table qu'au
 * propriétaire de la participation. Aucune lecture organisation n'existe.
 */

export type RepereOutcome =
  | 'range'
  | 'course_elevation_unknown'
  | 'reference_too_short'
  | 'too_far'
  | 'reference_too_old'
  | 'implausible_reference';

export interface RepereEstimateInput {
  readonly participantRaceId: string;
  readonly configVersion: string;
  readonly referenceKind: 'effort' | 'pace';
  readonly input: Readonly<Record<string, unknown>>;
  readonly outcome: RepereOutcome;
  readonly lowSeconds: number | null;
  readonly centralSeconds: number | null;
  readonly highSeconds: number | null;
}

export interface RepereEstimateRepository {
  record(estimate: RepereEstimateInput): Promise<void>;
}

export const repereEstimateRepository = defineRepository<RepereEstimateRepository>((context) => ({
  async record(estimate) {
    // Une insertion sans relecture ne rend aucune ligne : seule une erreur compte.
    unwrapMaybe(
      await context.client.from('repere_estimates').insert({
        participant_race_id: estimate.participantRaceId,
        config_version: estimate.configVersion,
        reference_kind: estimate.referenceKind,
        input: estimate.input as never,
        outcome: estimate.outcome,
        low_seconds: estimate.lowSeconds,
        central_seconds: estimate.centralSeconds,
        high_seconds: estimate.highSeconds,
      }),
      'repere_estimates.record',
    );
  },
}));

export interface RepereRepositories {
  readonly repereEstimates: RepereEstimateRepository;
}

export function createRepereRepositories(context: RepositoryContext): RepereRepositories {
  return { repereEstimates: repereEstimateRepository(context) };
}
