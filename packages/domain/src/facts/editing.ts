import { z } from 'zod';

import {
  DbError,
  type EditableFactRecord,
  type FactEditingRepositories,
  type FactHistoryEntry,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  DomainError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';
import { PUBLISHABLE_TRUST_LEVELS } from './commands.js';

/**
 * Corriger, retirer, restaurer une information publiée — migration 0043,
 * SOURCES_EXTRACTION §35, §37 (décision produit du 2026-10-07 : « toutes les
 * informations doivent pouvoir être modifiées, supprimées »).
 *
 * - Corriger crée la version N+1 ; N reste pour l'audit.
 * - Supprimer est un retrait : l'information disparaît de toute lecture
 *   publique, ses versions restent, et elle se restaure. Une version publiée
 *   n'est jamais effacée (AGENTS §14, §102).
 *
 * L'autorité (éditeur de l'organisation de la course, ou administration
 * PLUKA), le journal et le signal d'impact sont en base. Ce module valide à
 * la frontière et nomme les refus.
 */

export interface FactEditingContext {
  readonly repositories: FactEditingRepositories;
  /** Non consulté : la base lit l'acteur dans le jeton. */
  readonly actor: Actor;
}

const uuid = z.uuid();
const note = z.string().trim().max(1000).nullable().default(null);

export const reviseRaceFactCommandSchema = z
  .object({
    factId: uuid,
    valueText: z.string().trim().max(4000).nullable(),
    valueNumber: z.number().finite().nullable(),
    unit: z.string().trim().max(20).nullable(),
    trustLevel: z.enum(PUBLISHABLE_TRUST_LEVELS),
    note,
  })
  .transform((command) => ({
    ...command,
    valueText: command.valueText === '' ? null : command.valueText,
    unit: command.unit === '' ? null : command.unit,
  }))
  .refine((command) => command.valueText !== null || command.valueNumber !== null, {
    error: 'une valeur, texte ou nombre, est obligatoire',
    path: ['valueText'],
  });

export type ReviseRaceFactCommand = z.infer<typeof reviseRaceFactCommandSchema>;

const factGestureSchema = z.object({ factId: uuid, note });

function translate(
  error: unknown,
  useCase: string,
  refusal = 'geste impossible dans l’état actuel',
): unknown {
  if (!(error instanceof DbError)) return error;

  const translated: Partial<Record<DbError['code'], DomainError>> = {
    permission_denied: forbiddenError(useCase),
    not_found: notFoundError(useCase, 'information'),
  };
  if (error.code === 'invalid_state') return invalidStateError(useCase, refusal);
  return translated[error.code] ?? error;
}

export async function listRaceFactsForEditing(
  context: FactEditingContext,
  input: unknown,
): Promise<readonly EditableFactRecord[]> {
  const useCase = 'listRaceFactsForEditing';
  const { raceId } = parseCommand(z.object({ raceId: uuid }), input, useCase);

  try {
    return await context.repositories.factEditing.listForEditing(raceId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function getRaceFactHistory(
  context: FactEditingContext,
  input: unknown,
): Promise<readonly FactHistoryEntry[]> {
  const useCase = 'getRaceFactHistory';
  const { factId } = parseCommand(z.object({ factId: uuid }), input, useCase);

  try {
    return await context.repositories.factEditing.history(factId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function reviseRaceFact(
  context: FactEditingContext,
  input: unknown,
): Promise<{ readonly versionId: string }> {
  const useCase = 'reviseRaceFact';
  const command = parseCommand(reviseRaceFactCommandSchema, input, useCase);

  try {
    return { versionId: await context.repositories.factEditing.revise(command) };
  } catch (error) {
    // La base refuse une correction qui ne change rien : c'est une saisie,
    // pas un état — le refus se pose contre la valeur.
    if (
      error instanceof DbError &&
      error.code === 'invalid_state' &&
      /aucune modification/.test(error.message)
    ) {
      throw validationError(useCase, 'aucune modification', {
        valueText: 'la valeur est identique à celle publiée',
      });
    }
    throw translate(error, useCase, 'information retirée : restaure-la avant de la corriger');
  }
}

export async function retireRaceFact(context: FactEditingContext, input: unknown): Promise<void> {
  const useCase = 'retireRaceFact';
  const command = parseCommand(factGestureSchema, input, useCase);

  try {
    await context.repositories.factEditing.retire(command.factId, command.note);
  } catch (error) {
    throw translate(error, useCase, 'information déjà retirée');
  }
}

export async function restoreRaceFact(context: FactEditingContext, input: unknown): Promise<void> {
  const useCase = 'restoreRaceFact';
  const command = parseCommand(factGestureSchema, input, useCase);

  try {
    await context.repositories.factEditing.restore(command.factId, command.note);
  } catch (error) {
    throw translate(error, useCase, 'information non retirée');
  }
}
