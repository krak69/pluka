import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';

/*
 * Checklist de matériel du coureur — migration 0091.
 *
 * Sous la session du coureur : la RLS (0005) borne chaque ligne au propriétaire
 * de la participation, et un trigger refuse un fact d'une autre course. Le
 * droit d'écrire du matériel personnel (Race Pass) se décide dans le domaine.
 *
 * Aucune lecture `select *` (AGENTS §80) : les colonnes sont nommées.
 */

/** « Prêt » = dans le sac. La checklist n'utilise que ces deux états. */
export type EquipmentReadiness = 'ready' | 'not_ready';

export interface ParticipantEquipmentRecord {
  readonly id: string;
  /** Le fact de matériel officiel coché ; nul pour une pièce personnelle. */
  readonly raceFactId: string | null;
  /** L'intitulé d'une pièce personnelle ; nul pour une pièce officielle. */
  readonly customLabel: string | null;
  readonly origin: 'official_requirement' | 'personal' | 'pluka_suggestion' | 'conditions';
  readonly ready: boolean;
}

export interface PreparationRepository {
  listEquipment(participantRaceId: string): Promise<readonly ParticipantEquipmentRecord[]>;
  /** Coche ou décoche une pièce officielle : une seule ligne par pièce (upsert). */
  setOfficialEquipment(
    participantRaceId: string,
    raceFactId: string,
    readiness: EquipmentReadiness,
  ): Promise<void>;
  addPersonalEquipment(participantRaceId: string, label: string): Promise<void>;
  setPersonalEquipment(
    participantRaceId: string,
    equipmentId: string,
    readiness: EquipmentReadiness,
  ): Promise<void>;
  removePersonalEquipment(participantRaceId: string, equipmentId: string): Promise<void>;
}

const STATUS: Readonly<Record<EquipmentReadiness, 'packed' | 'planned'>> = {
  ready: 'packed',
  not_ready: 'planned',
};

export const preparationRepository = defineRepository<PreparationRepository>((context) => ({
  async listEquipment(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('participant_equipment')
        .select('id, race_fact_id, custom_label, origin, status')
        .eq('participant_race_id', participantRaceId)
        .order('created_at', { ascending: true }),
      'participant_equipment.list',
    );

    return (rows ?? []).map((row) => ({
      id: row.id,
      raceFactId: row.race_fact_id,
      customLabel: row.custom_label,
      origin: row.origin,
      ready: row.status === 'packed',
    }));
  },

  async setOfficialEquipment(participantRaceId, raceFactId, readiness) {
    unwrapMaybe(
      await context.client.from('participant_equipment').upsert(
        {
          participant_race_id: participantRaceId,
          race_fact_id: raceFactId,
          origin: 'official_requirement',
          status: STATUS[readiness],
        },
        { onConflict: 'participant_race_id,race_fact_id' },
      ),
      'participant_equipment.setOfficial',
    );
  },

  async addPersonalEquipment(participantRaceId, label) {
    unwrapMaybe(
      await context.client.from('participant_equipment').insert({
        participant_race_id: participantRaceId,
        custom_label: label,
        origin: 'personal',
        status: 'planned',
      }),
      'participant_equipment.addPersonal',
    );
  },

  async setPersonalEquipment(participantRaceId, equipmentId, readiness) {
    // La participation borne aussi l'écriture : un identifiant d'une autre
    // participation du même coureur ne serait pas touché.
    unwrapMaybe(
      await context.client
        .from('participant_equipment')
        .update({ status: STATUS[readiness] })
        .eq('id', equipmentId)
        .eq('participant_race_id', participantRaceId)
        .eq('origin', 'personal'),
      'participant_equipment.setPersonal',
    );
  },

  async removePersonalEquipment(participantRaceId, equipmentId) {
    unwrapMaybe(
      await context.client
        .from('participant_equipment')
        .delete()
        .eq('id', equipmentId)
        .eq('participant_race_id', participantRaceId)
        .eq('origin', 'personal'),
      'participant_equipment.removePersonal',
    );
  },
}));

export interface PreparationRepositories {
  readonly preparation: PreparationRepository;
}

export function createPreparationRepositories(context: RepositoryContext): PreparationRepositories {
  return { preparation: preparationRepository(context) };
}
