import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { Enum } from '../types.js';

/*
 * Repository de la correction des informations publiées — migration 0043.
 *
 * Corriger crée une version, retirer pose `archived_at`, restaurer le lève :
 * chaque geste est une fonction SQL qui porte son autorité (éditeur de
 * l'organisation de la course, ou administration PLUKA), son journal et son
 * signal d'impact. Ce repository traduit, rien de plus.
 */

export type TrustLevel = Enum<'trust_level'>;
export type FactCategoryValue = Enum<'fact_category'>;

export interface EditableFactRecord {
  readonly factId: string;
  readonly category: FactCategoryValue;
  readonly factKey: string;
  readonly archivedAt: string | null;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  /** Valeur structurée de la version — l'exigence d'un matériel (0045). */
  readonly valueJson: Readonly<Record<string, unknown>> | null;
  readonly trustLevel: TrustLevel;
  readonly publishedAt: string | null;
  readonly source: {
    readonly title: string;
    readonly page: number | null;
    readonly excerpt: string | null;
  } | null;
}

export type FactHistoryAction =
  | 'publish'
  | 'edit_and_publish'
  | 'revise'
  | 'retire'
  | 'restore'
  | 'reject'
  | 'mark_duplicate'
  | 'needs_review';

export interface FactHistoryEntry {
  readonly action: FactHistoryAction;
  readonly at: string;
  readonly actorEmail: string | null;
  readonly versionNumber: number | null;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly trustLevel: TrustLevel | null;
  readonly note: string | null;
}

export interface ReviseFactInput {
  readonly factId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly trustLevel: TrustLevel;
  readonly note: string | null;
}

/** Matériel — migration 0045. */
export type EquipmentRequirement = 'mandatory' | 'conditional' | 'recommended';

export interface AddEquipmentInput {
  readonly raceIds: readonly string[];
  readonly factKey: string;
  readonly label: string;
  readonly requirement: EquipmentRequirement;
  readonly condition: string | null;
  readonly detail: string | null;
  readonly trustLevel: TrustLevel;
  readonly note: string | null;
}

export interface ReviseEquipmentInput {
  readonly factId: string;
  readonly label: string;
  readonly requirement: EquipmentRequirement;
  readonly condition: string | null;
  readonly detail: string | null;
  readonly trustLevel: TrustLevel;
  readonly note: string | null;
}

export interface FactEditingRepository {
  listForEditing(raceId: string): Promise<readonly EditableFactRecord[]>;
  history(factId: string): Promise<readonly FactHistoryEntry[]>;
  /** Rend la nouvelle version. */
  revise(input: ReviseFactInput): Promise<string>;
  retire(factId: string, note: string | null): Promise<void>;
  restore(factId: string, note: string | null): Promise<void>;
  /** Rend le nombre d'épreuves où le matériel a été ajouté. */
  addEquipment(input: AddEquipmentInput): Promise<number>;
  /** Rend la nouvelle version. */
  reviseEquipment(input: ReviseEquipmentInput): Promise<string>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function invoke(
  context: RepositoryContext,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await (context.client as unknown as RpcCapableClient).rpc(operation, args);
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }
  return result.data;
}

function list(data: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

/** PostgREST rend un `numeric` en nombre ou en chaîne ; `null` reste `null`. */
function num(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== '') return Number(value);
  return null;
}

export const factEditingRepository = defineRepository<FactEditingRepository>((context) => ({
  async listForEditing(raceId) {
    const data = await invoke(context, 'list_race_facts_for_editing', { p_race_id: raceId });

    return list(data).map((row) => {
      const source = row['source'];
      const sourceRow =
        source !== null && typeof source === 'object' ? (source as Record<string, unknown>) : null;

      return {
        factId: text(row, 'factId') ?? '',
        category: (text(row, 'category') ?? 'other') as FactCategoryValue,
        factKey: text(row, 'factKey') ?? '',
        archivedAt: text(row, 'archivedAt'),
        versionId: text(row, 'versionId') ?? '',
        versionNumber: num(row, 'versionNumber') ?? 0,
        valueText: text(row, 'valueText'),
        valueNumber: num(row, 'valueNumber'),
        unit: text(row, 'unit'),
        valueJson:
          row['valueJson'] !== null && typeof row['valueJson'] === 'object'
            ? (row['valueJson'] as Record<string, unknown>)
            : null,
        trustLevel: (text(row, 'trustLevel') ?? 'community') as TrustLevel,
        publishedAt: text(row, 'publishedAt'),
        source:
          sourceRow === null
            ? null
            : {
                title: text(sourceRow, 'title') ?? '',
                page: num(sourceRow, 'page'),
                excerpt: text(sourceRow, 'excerpt'),
              },
      };
    });
  },

  async history(factId) {
    const data = await invoke(context, 'list_race_fact_history', { p_fact_id: factId });

    return list(data).map((row) => ({
      action: (text(row, 'action') ?? 'publish') as FactHistoryAction,
      at: text(row, 'at') ?? '',
      actorEmail: text(row, 'actorEmail'),
      versionNumber: num(row, 'versionNumber'),
      valueText: text(row, 'valueText'),
      valueNumber: num(row, 'valueNumber'),
      unit: text(row, 'unit'),
      trustLevel: text(row, 'trustLevel') as TrustLevel | null,
      note: text(row, 'note'),
    }));
  },

  async revise(input) {
    const operation = 'revise_race_fact';
    const data = await invoke(context, operation, {
      p_fact_id: input.factId,
      p_value_text: input.valueText,
      p_value_number: input.valueNumber,
      p_unit: input.unit,
      p_trust_level: input.trustLevel,
      p_note: input.note,
    });
    if (typeof data !== 'string') {
      throw new DbError({
        code: 'unknown',
        operation,
        message: 'la fonction devait rendre un uuid',
      });
    }
    return data;
  },

  async retire(factId, note) {
    await invoke(context, 'retire_race_fact', { p_fact_id: factId, p_note: note });
  },

  async restore(factId, note) {
    await invoke(context, 'restore_race_fact', { p_fact_id: factId, p_note: note });
  },

  async addEquipment(input) {
    const operation = 'add_race_equipment';
    const data = await invoke(context, operation, {
      p_race_ids: input.raceIds,
      p_fact_key: input.factKey,
      p_label: input.label,
      p_requirement: input.requirement,
      p_condition: input.condition,
      p_detail: input.detail,
      p_trust_level: input.trustLevel,
      p_note: input.note,
    });
    if (typeof data !== 'number') {
      throw new DbError({
        code: 'unknown',
        operation,
        message: 'la fonction devait rendre un entier',
      });
    }
    return data;
  },

  async reviseEquipment(input) {
    const operation = 'revise_race_equipment';
    const data = await invoke(context, operation, {
      p_fact_id: input.factId,
      p_label: input.label,
      p_requirement: input.requirement,
      p_condition: input.condition,
      p_detail: input.detail,
      p_trust_level: input.trustLevel,
      p_note: input.note,
    });
    if (typeof data !== 'string') {
      throw new DbError({
        code: 'unknown',
        operation,
        message: 'la fonction devait rendre un uuid',
      });
    }
    return data;
  },
}));

export interface FactEditingRepositories {
  readonly factEditing: FactEditingRepository;
}

export function createFactEditingRepositories(context: RepositoryContext): FactEditingRepositories {
  return { factEditing: factEditingRepository(context) };
}
