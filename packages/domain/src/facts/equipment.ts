import { EQUIPMENT_REQUIREMENTS, equipmentFactKey } from '@pluka/contracts';
import { z } from 'zod';

import { DbError, type EditableFactRecord, type EquipmentRequirement } from '@pluka/db';

import {
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';
import { PUBLISHABLE_TRUST_LEVELS } from './commands.js';
import type { FactEditingContext } from './editing.js';

/**
 * Matériel d'une épreuve — migration 0045, 00_PRODUCT_SPEC §14.1,
 * SOURCES_EXTRACTION §82 (décision produit du 2026-10-08 : pas de catalogue,
 * chaque événement nomme son matériel comme il l'entend).
 *
 * Un élément est une information de course de catégorie `equipment` : son
 * nom en `valueText`, et en `valueJson` l'exigence — obligatoire,
 * conditionnel, recommandé —, sa condition et une précision. Il se corrige
 * en version N+1, se retire et se restaure comme toute information (0043).
 *
 * Ici : la validation à la frontière, la clé de rapprochement tirée du nom,
 * la lecture d'une valeur structurée, et la traduction des refus. L'autorité
 * et la provenance sont en base.
 */

export { EQUIPMENT_REQUIREMENTS };

const uuid = z.uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value));

const equipmentFields = {
  label: z.string().trim().min(1, { error: 'donne un nom au matériel' }).max(200),
  requirement: z.enum(EQUIPMENT_REQUIREMENTS, { error: 'choisis une exigence' }),
  condition: optionalText(300),
  detail: optionalText(500),
  trustLevel: z.enum(PUBLISHABLE_TRUST_LEVELS),
  note: optionalText(1000),
};

/** §82 : un conditionnel dit sa condition, sinon il se lirait comme obligatoire ou comme facultatif. */
function conditionStated(command: {
  readonly requirement: EquipmentRequirement;
  readonly condition: string | null;
}): boolean {
  return command.requirement !== 'conditional' || command.condition !== null;
}

const CONDITION_REQUIRED = {
  error: 'précise la condition — « si température < 5 °C », par exemple',
  path: ['condition'],
};

export const addRaceEquipmentCommandSchema = z
  .object({
    raceIds: z
      .array(uuid)
      .min(1, { error: 'choisis au moins une épreuve' })
      .max(50)
      .transform((ids) => [...new Set(ids)]),
    ...equipmentFields,
  })
  .refine(conditionStated, CONDITION_REQUIRED);

export type AddRaceEquipmentCommand = z.infer<typeof addRaceEquipmentCommandSchema>;

export const reviseRaceEquipmentCommandSchema = z
  .object({ factId: uuid, ...equipmentFields })
  .refine(conditionStated, CONDITION_REQUIRED);

export type ReviseRaceEquipmentCommand = z.infer<typeof reviseRaceEquipmentCommandSchema>;

/** La clé de rapprochement d'un nom — la même que celle de l'extraction (`@pluka/contracts`). */
export function equipmentKey(label: string): string | null {
  return equipmentFactKey(label);
}

export interface RaceEquipmentItem {
  readonly factId: string;
  /** La clé de rapprochement : la même pièce d'une épreuve à l'autre de l'édition. */
  readonly factKey: string;
  readonly label: string;
  /**
   * `null` pour un matériel extrait d'un document sans exigence précisée :
   * la lecture le dit, elle ne l'invente pas (§82 — un « recommandé » ne
   * devient jamais « obligatoire »).
   */
  readonly requirement: EquipmentRequirement | null;
  readonly condition: string | null;
  readonly detail: string | null;
  readonly trustLevel: EditableFactRecord['trustLevel'];
  readonly retired: boolean;
  readonly versionNumber: number;
  readonly publishedAt: string | null;
  readonly source: EditableFactRecord['source'];
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export interface EquipmentValue {
  readonly requirement: EquipmentRequirement | null;
  readonly condition: string | null;
  readonly detail: string | null;
}

/**
 * La structure d'une version « Matériel » (0045), lue sans rien supposer :
 * une exigence absente ou inconnue reste `null`. Partagée par la console et
 * par l'app coureur — un même élément se lit pareil des deux côtés.
 */
export function equipmentValueOf(
  valueJson: Readonly<Record<string, unknown>> | null,
): EquipmentValue {
  const json = valueJson ?? {};
  const requirement = json['requirement'];

  return {
    requirement: (EQUIPMENT_REQUIREMENTS as readonly unknown[]).includes(requirement)
      ? (requirement as EquipmentRequirement)
      : null,
    condition: stringOf(json['condition']),
    detail: stringOf(json['detail']),
  };
}

/** Lit une information « Matériel » ; une structure absente ou inconnue reste inconnue. */
export function equipmentOf(fact: EditableFactRecord): RaceEquipmentItem {
  return {
    factId: fact.factId,
    factKey: fact.factKey,
    label: fact.valueText ?? '',
    ...equipmentValueOf(fact.valueJson),
    trustLevel: fact.trustLevel,
    retired: fact.archivedAt !== null,
    versionNumber: fact.versionNumber,
    publishedAt: fact.publishedAt,
    source: fact.source,
  };
}

/**
 * Ce qui manque à une structure de matériel pour être publiée — la même règle
 * que la base (0045, 0046), dite champ par champ pour le formulaire de revue.
 * `null` si elle est bien formée.
 */
export function equipmentStructureIssue(
  valueJson: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> | null {
  const unknownKey = Object.keys(valueJson).find(
    (key) => key !== 'requirement' && key !== 'condition' && key !== 'detail',
  );
  if (unknownKey !== undefined) return { requirement: `structure inconnue (${unknownKey})` };

  const value = equipmentValueOf(valueJson);
  if (value.requirement === null) return { requirement: 'choisis une exigence' };
  if (!conditionStated({ requirement: value.requirement, condition: value.condition })) {
    return { condition: CONDITION_REQUIRED.error };
  }
  return null;
}

/** Refus de la base, nommés. `reason` porte le code de §32 quand c'est le niveau de confiance. */
function translate(error: unknown, useCase: string, refusal: string): unknown {
  if (!(error instanceof DbError)) return error;

  if (error.code === 'permission_denied') {
    const reason = /OFFICIAL_AUTHORIZATION_REQUIRED|PLUKA_VALIDATION_REQUIRED/.exec(error.message);
    return forbiddenError(useCase, reason === null ? undefined : { reason: reason[0] });
  }
  if (error.code === 'not_found') return notFoundError(useCase, 'épreuve ou matériel');
  if (error.code === 'invalid_state') return invalidStateError(useCase, refusal);
  return error;
}

export async function listRaceEquipment(
  context: FactEditingContext,
  input: unknown,
): Promise<readonly RaceEquipmentItem[]> {
  const useCase = 'listRaceEquipment';
  const { raceId } = parseCommand(z.object({ raceId: uuid }), input, useCase);

  try {
    const facts = await context.repositories.factEditing.listForEditing(raceId);
    return facts.filter((fact) => fact.category === 'equipment').map(equipmentOf);
  } catch (error) {
    throw translate(error, useCase, 'lecture impossible');
  }
}

export async function addRaceEquipment(
  context: FactEditingContext,
  input: unknown,
): Promise<{ readonly added: number }> {
  const useCase = 'addRaceEquipment';
  const command = parseCommand(addRaceEquipmentCommandSchema, input, useCase);

  const factKey = equipmentKey(command.label);
  if (factKey === null) {
    throw validationError(useCase, 'nom illisible', {
      label: 'le nom doit contenir au moins une lettre ou un chiffre',
    });
  }

  try {
    return {
      added: await context.repositories.factEditing.addEquipment({ ...command, factKey }),
    };
  } catch (error) {
    if (error instanceof DbError && error.code === 'conflict') {
      throw validationError(useCase, 'déjà présent', {
        label: 'ce matériel figure déjà sur les épreuves choisies',
      });
    }
    throw translate(error, useCase, 'ajout impossible dans l’état actuel');
  }
}

export async function reviseRaceEquipment(
  context: FactEditingContext,
  input: unknown,
): Promise<{ readonly versionId: string }> {
  const useCase = 'reviseRaceEquipment';
  const command = parseCommand(reviseRaceEquipmentCommandSchema, input, useCase);

  try {
    return { versionId: await context.repositories.factEditing.reviseEquipment(command) };
  } catch (error) {
    if (
      error instanceof DbError &&
      error.code === 'invalid_state' &&
      /aucune modification/.test(error.message)
    ) {
      throw validationError(useCase, 'aucune modification', {
        label: 'rien n’a changé par rapport à la version publiée',
      });
    }
    throw translate(error, useCase, 'matériel retiré : restaure-le avant de le corriger');
  }
}

// ============================================================
// Le matériel d'une édition — migration 0047
// ============================================================

const editionEquipmentLineSchema = z.object({
  /** La ligne modifiée ; absente pour un ajout, la clé se tire alors du nom. */
  factKey: z.string().trim().min(1).max(90).nullable().default(null),
  label: equipmentFields.label,
  condition: optionalText(300),
  detail: optionalText(500),
  /** Par épreuve : son exigence, ou `null` si elle n'est pas concernée. */
  requirements: z.record(uuid, z.enum(EQUIPMENT_REQUIREMENTS).nullable()),
});

export const saveEditionEquipmentCommandSchema = z
  .object({
    editionId: uuid,
    lines: z.array(editionEquipmentLineSchema).min(1, { error: 'rien à enregistrer' }).max(200),
    trustLevel: equipmentFields.trustLevel,
    note: equipmentFields.note,
  })
  .superRefine((command, context) => {
    command.lines.forEach((line, index) => {
      const cells = Object.values(line.requirements);
      // §82 : une case conditionnelle se lit avec sa condition.
      if (cells.includes('conditional') && line.condition === null) {
        context.addIssue({
          code: 'custom',
          path: ['lines', index, 'condition'],
          message: CONDITION_REQUIRED.error,
        });
      }
      if (line.factKey === null && !cells.some((cell) => cell !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['lines', index, 'requirements'],
          message: 'règle au moins une épreuve',
        });
      }
    });
  });

export type SaveEditionEquipmentCommand = z.infer<typeof saveEditionEquipmentCommandSchema>;

/**
 * Enregistre le brouillon du tableau du matériel — migration 0048. Chaque
 * ligne porte une exigence par épreuve ; la base fait les gestes case par
 * case, en une transaction. Une ligne sans `factKey` est un ajout : sa clé
 * se tire du nom, et une pièce déjà dans l'édition est refusée.
 */
export async function saveEditionEquipment(
  context: FactEditingContext,
  input: unknown,
): Promise<{ readonly changed: number }> {
  const useCase = 'saveEditionEquipment';
  const command = parseCommand(saveEditionEquipmentCommandSchema, input, useCase);

  const lines = command.lines.map((line, index) => {
    const factKey = line.factKey ?? equipmentKey(line.label);
    if (factKey === null) {
      throw validationError(useCase, 'nom illisible', {
        [`lines.${index}.label`]: 'le nom doit contenir au moins une lettre ou un chiffre',
      });
    }
    return {
      factKey,
      create: line.factKey === null,
      label: line.label,
      condition: line.condition,
      detail: line.detail,
      requirements: line.requirements,
    };
  });

  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (seen.has(line.factKey)) {
      throw validationError(useCase, 'doublon', {
        [`lines.${index}.label`]: 'ce matériel figure deux fois dans le tableau',
      });
    }
    seen.add(line.factKey);
  });

  try {
    return {
      changed: await context.repositories.factEditing.saveEditionEquipment({
        editionId: command.editionId,
        lines,
        trustLevel: command.trustLevel,
        note: command.note,
      }),
    };
  } catch (error) {
    if (error instanceof DbError && error.code === 'conflict') {
      throw validationError(useCase, 'déjà présent', {
        lines: 'un matériel ajouté existe déjà dans l’édition : règle plutôt sa ligne',
      });
    }
    if (error instanceof DbError && error.code === 'invalid_state') {
      throw validationError(useCase, 'aucune modification', { lines: 'rien n’a changé' });
    }
    throw translate(error, useCase, 'enregistrement impossible dans l’état actuel');
  }
}

export interface EditionEquipmentRace {
  readonly raceId: string;
  readonly raceName: string;
  /** `null` si la lecture a échoué pour cette épreuve. */
  readonly items: readonly RaceEquipmentItem[] | null;
}

export interface EditionEquipmentRow {
  readonly factKey: string;
  readonly label: string;
  /** L'exigence commune ; `'mixed'` si elle diffère d'une épreuve à l'autre. */
  readonly requirement: EquipmentRequirement | null | 'mixed';
  /** L'exigence la plus forte de la ligne : c'est elle qui la classe. */
  readonly strongest: EquipmentRequirement | null;
  /** La condition des cases conditionnelles ; la ligne n'en porte qu'une. */
  readonly condition: string | null;
  readonly detail: string | null;
  /** Dans l'ordre des épreuves reçues : l'élément de chaque épreuve, ou `null`. */
  readonly cells: readonly (RaceEquipmentItem | null)[];
  readonly trustLevel: EditableFactRecord['trustLevel'];
  /** Les titres de source distincts — « Règlement 2026 », « Saisie PLUKA ». */
  readonly sources: readonly string[];
}

const STRENGTH: Readonly<Record<EquipmentRequirement, number>> = {
  mandatory: 0,
  conditional: 1,
  recommended: 2,
};

/**
 * Le tableau « matériel × épreuves » d'une édition. Une ligne par clé ; une
 * case par épreuve, vide où l'élément n'est pas (ou plus) affiché, et chaque
 * case garde sa propre exigence. Les lignes se classent par leur exigence la
 * plus forte, puis par nom. Les retirés n'apparaissent pas.
 */
export function editionEquipmentRows(
  races: readonly EditionEquipmentRace[],
): readonly EditionEquipmentRow[] {
  const keys = new Map<string, RaceEquipmentItem>();
  for (const race of races) {
    for (const item of race.items ?? []) {
      if (!item.retired && !keys.has(item.factKey)) keys.set(item.factKey, item);
    }
  }

  const rows = [...keys.entries()].map(([factKey, first]): EditionEquipmentRow => {
    const cells = races.map(
      (race) => race.items?.find((item) => item.factKey === factKey && !item.retired) ?? null,
    );
    const present = cells.filter((cell): cell is RaceEquipmentItem => cell !== null);
    const firstOf = (pick: (item: RaceEquipmentItem) => string | null): string | null =>
      present.map(pick).find((value) => value !== null) ?? null;
    const known = present
      .map((item) => item.requirement)
      .filter((requirement): requirement is EquipmentRequirement => requirement !== null)
      .sort((left, right) => STRENGTH[left] - STRENGTH[right]);

    return {
      factKey,
      label: first.label,
      requirement: present.every((item) => item.requirement === first.requirement)
        ? first.requirement
        : 'mixed',
      strongest: known[0] ?? null,
      condition: firstOf((item) => (item.requirement === 'conditional' ? item.condition : null)),
      detail: firstOf((item) => item.detail),
      cells,
      trustLevel: first.trustLevel,
      sources: [
        ...new Set(
          present
            .map((item) => item.source?.title ?? null)
            .filter((title): title is string => title !== null),
        ),
      ],
    };
  });

  return rows.sort((left, right) => {
    const rank = (row: EditionEquipmentRow) =>
      row.strongest === null ? 3 : STRENGTH[row.strongest];
    return rank(left) - rank(right) || left.label.localeCompare(right.label, 'fr');
  });
}
