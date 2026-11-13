import { DbError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';

/*
 * « Mon matériel » — migration 0092.
 *
 * Sous la session du coureur : la RLS borne chaque pièce à son propriétaire,
 * l'index unique refuse un doublon à la casse près. Le droit d'écrire
 * (PLUKA+, `library.edit`) se décide dans le domaine.
 */

export interface UserEquipmentItemRecord {
  readonly id: string;
  readonly label: string;
}

export interface LibraryRepository {
  listEquipment(userId: string): Promise<readonly UserEquipmentItemRecord[]>;
  /** Ajoute des pièces ; une pièce déjà présente (à la casse près) est ignorée. */
  addEquipment(userId: string, labels: readonly string[]): Promise<void>;
  removeEquipment(itemId: string): Promise<void>;
}

export const libraryRepository = defineRepository<LibraryRepository>((context) => ({
  async listEquipment(userId) {
    const rows = unwrapMaybe(
      await context.client
        .from('user_equipment_items')
        .select('id, label')
        .eq('user_id', userId)
        .order('label', { ascending: true }),
      'user_equipment_items.list',
    );
    return (rows ?? []).map((row) => ({ id: row.id, label: row.label }));
  },

  async addEquipment(userId, labels) {
    // Une par une : l'index unique porte sur une expression, qu'un upsert ne
    // sait pas viser. Un doublon (23505) est attendu et sans conséquence.
    for (const label of labels) {
      try {
        unwrapMaybe(
          await context.client.from('user_equipment_items').insert({ user_id: userId, label }),
          'user_equipment_items.add',
        );
      } catch (error) {
        if (error instanceof DbError && error.code === 'conflict') continue;
        throw error;
      }
    }
  },

  async removeEquipment(itemId) {
    unwrapMaybe(
      await context.client.from('user_equipment_items').delete().eq('id', itemId),
      'user_equipment_items.remove',
    );
  },
}));

export interface LibraryRepositories {
  readonly library: LibraryRepository;
}

export function createLibraryRepositories(context: RepositoryContext): LibraryRepositories {
  return { library: libraryRepository(context) };
}
