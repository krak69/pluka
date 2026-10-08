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

export const EQUIPMENT_REQUIREMENTS = ['mandatory', 'conditional', 'recommended'] as const;

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

/**
 * La clé de rapprochement d'un nom : « Veste imperméable » →
 * `equipment.veste-impermeable`. Elle n'est qu'un identifiant — elle évite
 * le doublon d'un même élément sur une épreuve, elle ne normalise rien de ce
 * que lit le coureur.
 */
export function equipmentKey(label: string): string | null {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  return slug === '' ? null : `equipment.${slug}`;
}

export interface RaceEquipmentItem {
  readonly factId: string;
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
    label: fact.valueText ?? '',
    ...equipmentValueOf(fact.valueJson),
    trustLevel: fact.trustLevel,
    retired: fact.archivedAt !== null,
    versionNumber: fact.versionNumber,
    publishedAt: fact.publishedAt,
    source: fact.source,
  };
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
