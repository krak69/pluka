import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';

/*
 * Changements d'heure de départ du coureur — migration 0082.
 *
 * Lus sous sa session : la RLS ne rend que les siens, et l'organisation n'y a
 * jamais accès. Refermer l'alerte passe par une fonction qui revérifie que la
 * participation est à lui.
 */

export interface StartChangeRecord {
  readonly id: string;
  readonly previousWaveName: string | null;
  readonly newWaveName: string | null;
  readonly previousStartAt: string;
  readonly newStartAt: string;
  readonly createdAt: string;
}

export interface StartChangeRepository {
  /** Les alertes pas encore refermées, la plus récente d'abord. */
  listUnseen(participantRaceId: string): Promise<readonly StartChangeRecord[]>;
  /** Rend le nombre d'alertes refermées. */
  acknowledge(participantRaceId: string): Promise<number>;
}

export const startChangeRepository = defineRepository<StartChangeRepository>((context) => ({
  async listUnseen(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('participant_start_changes')
        .select(
          'id, previous_wave_name, new_wave_name, previous_start_at, new_start_at, created_at',
        )
        .eq('participant_race_id', participantRaceId)
        .is('seen_at', null)
        .order('created_at', { ascending: false }),
      'participant_start_changes.listUnseen',
    );

    return (rows ?? []).map((row) => ({
      id: row.id,
      previousWaveName: row.previous_wave_name,
      newWaveName: row.new_wave_name,
      previousStartAt: row.previous_start_at,
      newStartAt: row.new_start_at,
      createdAt: row.created_at,
    }));
  },

  async acknowledge(participantRaceId) {
    const data = unwrapMaybe(
      await context.client.rpc('acknowledge_start_changes', {
        p_participant_race_id: participantRaceId,
      }),
      'acknowledge_start_changes',
    );
    return typeof data === 'number' ? data : 0;
  },
}));

export interface StartChangeRepositories {
  readonly startChanges: StartChangeRepository;
}

export function createStartChangeRepositories(context: RepositoryContext): StartChangeRepositories {
  return { startChanges: startChangeRepository(context) };
}
