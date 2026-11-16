import { DbError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';
import { participantRaceSettingsRepository } from './participation.js';
import type { ParticipantRaceSettingsRepository } from './participation.js';

/*
 * Sacs de la Préparation — migrations 0001, 0095.
 *
 * Sous la session du coureur : la RLS (0005) borne chaque sac au propriétaire
 * de la participation, chaque contenu au propriétaire de son sac, et un
 * trigger (0095) refuse un point qui ne convient pas au sac. Le droit
 * commercial (Race Pass) se décide dans le domaine.
 *
 * Aucune lecture `select *` (AGENTS §80) : les colonnes sont nommées.
 */

export type BagType = 'start' | 'drop_bag' | 'assistance' | 'finish' | 'other';

export interface BagItemRecord {
  readonly id: string;
  readonly label: string;
  readonly quantity: number;
  readonly checked: boolean;
}

export interface BagRecord {
  readonly id: string;
  readonly bagType: BagType;
  readonly name: string;
  /** Nul pour départ, arrivée, « autre » — ou quand l'organisation a retiré le point. */
  readonly raceWaypointId: string | null;
  readonly items: readonly BagItemRecord[];
}

export interface NewBag {
  readonly bagType: BagType;
  readonly name: string;
  readonly raceWaypointId: string | null;
}

export interface NewBagItem {
  readonly label: string;
  readonly quantity: number;
}

export interface BagRepository {
  listBags(participantRaceId: string): Promise<readonly BagRecord[]>;
  /**
   * Crée un sac. Un sac qui existe déjà pour ce rôle (0095, index uniques)
   * n'est pas recréé : la suggestion acceptée deux fois reste un seul sac.
   */
  createBag(participantRaceId: string, bag: NewBag): Promise<void>;
  renameBag(participantRaceId: string, bagId: string, name: string): Promise<void>;
  deleteBag(participantRaceId: string, bagId: string): Promise<void>;
  addItems(bagId: string, items: readonly NewBagItem[]): Promise<void>;
  setItemChecked(bagId: string, itemId: string, checked: boolean): Promise<void>;
  removeItem(bagId: string, itemId: string): Promise<void>;
  listDismissedSuggestions(participantRaceId: string): Promise<readonly string[]>;
  dismissSuggestion(participantRaceId: string, key: string): Promise<void>;
  restoreSuggestions(participantRaceId: string): Promise<void>;
}

type ItemRow = {
  id: string;
  label: string | null;
  quantity: number;
  checked: boolean;
  created_at: string;
};

type BagRow = {
  id: string;
  bag_type: BagType;
  name: string;
  race_waypoint_id: string | null;
  bag_items: ItemRow[] | null;
};

function toBag(row: BagRow): BagRecord {
  return {
    id: row.id,
    bagType: row.bag_type,
    name: row.name,
    raceWaypointId: row.race_waypoint_id,
    items: [...(row.bag_items ?? [])]
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((item) => ({
        id: item.id,
        label: item.label ?? '',
        quantity: Number(item.quantity),
        checked: item.checked,
      })),
  };
}

export const bagRepository = defineRepository<BagRepository>((context) => ({
  async listBags(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('bags')
        .select(
          'id, bag_type, name, race_waypoint_id, bag_items(id, label, quantity, checked, created_at)',
        )
        .eq('participant_race_id', participantRaceId)
        .order('created_at', { ascending: true }),
      'bags.list',
    );

    return ((rows ?? []) as BagRow[]).map(toBag);
  },

  async createBag(participantRaceId, bag) {
    try {
      unwrapMaybe(
        await context.client.from('bags').insert({
          participant_race_id: participantRaceId,
          bag_type: bag.bagType,
          name: bag.name,
          race_waypoint_id: bag.raceWaypointId,
        }),
        'bags.create',
      );
    } catch (error) {
      // Le sac existe déjà : ce qu'on demandait est déjà vrai.
      if (error instanceof DbError && error.code === 'conflict') return;
      throw error;
    }
  },

  async renameBag(participantRaceId, bagId, name) {
    unwrapMaybe(
      await context.client
        .from('bags')
        .update({ name })
        .eq('id', bagId)
        .eq('participant_race_id', participantRaceId),
      'bags.rename',
    );
  },

  async deleteBag(participantRaceId, bagId) {
    unwrapMaybe(
      await context.client
        .from('bags')
        .delete()
        .eq('id', bagId)
        .eq('participant_race_id', participantRaceId),
      'bags.delete',
    );
  },

  async addItems(bagId, items) {
    if (items.length === 0) return;
    unwrapMaybe(
      await context.client.from('bag_items').insert(
        items.map((item) => ({
          bag_id: bagId,
          item_type: 'free_text' as const,
          label: item.label,
          quantity: item.quantity,
        })),
      ),
      'bag_items.add',
    );
  },

  async setItemChecked(bagId, itemId, checked) {
    unwrapMaybe(
      await context.client
        .from('bag_items')
        .update({ checked })
        .eq('id', itemId)
        .eq('bag_id', bagId),
      'bag_items.setChecked',
    );
  },

  async removeItem(bagId, itemId) {
    unwrapMaybe(
      await context.client.from('bag_items').delete().eq('id', itemId).eq('bag_id', bagId),
      'bag_items.remove',
    );
  },

  async listDismissedSuggestions(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('bag_suggestion_dismissals')
        .select('suggestion_key')
        .eq('participant_race_id', participantRaceId),
      'bag_suggestion_dismissals.list',
    );

    return (rows ?? []).map((row) => row.suggestion_key);
  },

  async dismissSuggestion(participantRaceId, key) {
    unwrapMaybe(
      await context.client
        .from('bag_suggestion_dismissals')
        .upsert(
          { participant_race_id: participantRaceId, suggestion_key: key },
          { onConflict: 'participant_race_id,suggestion_key', ignoreDuplicates: true },
        ),
      'bag_suggestion_dismissals.dismiss',
    );
  },

  async restoreSuggestions(participantRaceId) {
    unwrapMaybe(
      await context.client
        .from('bag_suggestion_dismissals')
        .delete()
        .eq('participant_race_id', participantRaceId),
      'bag_suggestion_dismissals.restore',
    );
  },
}));

export interface BagRepositories {
  readonly bags: BagRepository;
  /** Le choix « autonome » de l'Assistance : plus de suggestion de sac d'assistance. */
  readonly participantRaceSettings: ParticipantRaceSettingsRepository;
}

export function createBagRepositories(context: RepositoryContext): BagRepositories {
  return {
    bags: bagRepository(context),
    participantRaceSettings: participantRaceSettingsRepository(context),
  };
}
