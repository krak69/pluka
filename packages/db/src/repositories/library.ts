import { DbError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';
import type { Enum } from '../types.js';

/*
 * « Mon matériel » — migrations 0092, 0093.
 *
 * Sous la session du coureur : la RLS borne chaque pièce à son propriétaire,
 * l'index unique refuse un doublon à la casse près, un trigger vérifie la
 * forme des tags. Le droit d'écrire (PLUKA+, `library.edit`) se décide dans le
 * domaine, comme la catégorie devinée à l'ajout.
 */

export type GearCategoryValue = Enum<'gear_category'>;

export interface UserEquipmentItemRecord {
  readonly id: string;
  readonly label: string;
  readonly category: GearCategoryValue;
  readonly tags: readonly string[];
}

export interface NewEquipmentItem {
  readonly label: string;
  readonly category: GearCategoryValue;
}

export interface LibraryRepository {
  listEquipment(userId: string): Promise<readonly UserEquipmentItemRecord[]>;
  /** Ajoute des pièces ; une pièce déjà présente (à la casse près) est ignorée. */
  addEquipment(userId: string, items: readonly NewEquipmentItem[]): Promise<void>;
  /** Reclasse une pièce : sa catégorie et ses tags. */
  updateEquipment(
    itemId: string,
    category: GearCategoryValue,
    tags: readonly string[],
  ): Promise<void>;
  removeEquipment(itemId: string): Promise<void>;
}

export const libraryRepository = defineRepository<LibraryRepository>((context) => ({
  async listEquipment(userId) {
    const rows = unwrapMaybe(
      await context.client
        .from('user_equipment_items')
        .select('id, label, category, tags')
        .eq('user_id', userId)
        .order('label', { ascending: true }),
      'user_equipment_items.list',
    );
    return (rows ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      category: row.category,
      tags: row.tags,
    }));
  },

  async addEquipment(userId, items) {
    // Une par une : l'index unique porte sur une expression, qu'un upsert ne
    // sait pas viser. Un doublon (23505) est attendu et sans conséquence.
    for (const item of items) {
      try {
        unwrapMaybe(
          await context.client
            .from('user_equipment_items')
            .insert({ user_id: userId, label: item.label, category: item.category }),
          'user_equipment_items.add',
        );
      } catch (error) {
        if (error instanceof DbError && error.code === 'conflict') continue;
        throw error;
      }
    }
  },

  async updateEquipment(itemId, category, tags) {
    unwrapMaybe(
      await context.client
        .from('user_equipment_items')
        .update({ category, tags: [...tags] })
        .eq('id', itemId),
      'user_equipment_items.update',
    );
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
