import {
  DbError,
  type StartChangeRecord,
  type StartChangeRepository,
  type StartWaveRecord,
} from '@pluka/db';
import { z } from 'zod';

import {
  conflictError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
} from '../errors.js';
import { civilToInstant } from '../site/editing.js';
import type { ParticipantImportContext } from './use-cases.js';

/**
 * Vagues de départ — migration 0081, 00_PRODUCT_SPEC §29.
 *
 * Une vague est une information officielle : la déclarer ou la changer publie
 * une version, et le circuit des changements prévient les coureurs dont le
 * Plan en dépend (§46). L'organisation saisit un jour et une heure civils,
 * dans le fuseau de l'épreuve ; la base reçoit un instant (AGENTS §34).
 */

const uuid = z.uuid();

const civilDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Date de départ invalide.');
const civilTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Heure de départ invalide.');
const waveName = z
  .string()
  .trim()
  .min(1, 'Donnez un nom à la vague.')
  .max(120, 'Nom : 120 caractères au plus.');
const timeZone = z.string().min(1).max(64);

function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;
  if (error.code === 'permission_denied') return forbiddenError(useCase);
  if (error.code === 'not_found') return notFoundError(useCase, 'vague');
  if (error.code === 'conflict') {
    return conflictError(useCase, 'vague déjà déclarée', {
      name: 'Une vague porte déjà ce nom sur cette épreuve.',
    });
  }
  if (error.code === 'invalid_state') return invalidStateError(useCase, 'aucune modification');
  return error;
}

export async function listStartWaves(
  context: ParticipantImportContext,
  input: unknown,
): Promise<readonly StartWaveRecord[]> {
  const useCase = 'listStartWaves';
  const { editionId } = parseCommand(z.object({ editionId: uuid }), input, useCase);

  try {
    return await context.repositories.participantImports.listStartWaves(editionId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export const declareStartWaveCommandSchema = z.object({
  raceId: uuid,
  name: waveName,
  day: civilDay,
  time: civilTime,
  timeZone,
});

/** Rend l'identifiant de la vague. */
export async function declareStartWave(
  context: ParticipantImportContext,
  input: unknown,
): Promise<string> {
  const useCase = 'declareStartWave';
  const command = parseCommand(declareStartWaveCommandSchema, input, useCase);

  try {
    return await context.repositories.participantImports.declareStartWave(
      command.raceId,
      command.name,
      civilToInstant(command.day, command.time, command.timeZone),
    );
  } catch (error) {
    throw translate(error, useCase);
  }
}

export const updateStartWaveCommandSchema = z.object({
  waveId: uuid,
  name: waveName,
  day: civilDay,
  time: civilTime,
  timeZone,
});

export async function updateStartWave(
  context: ParticipantImportContext,
  input: unknown,
): Promise<void> {
  const useCase = 'updateStartWave';
  const command = parseCommand(updateStartWaveCommandSchema, input, useCase);

  try {
    await context.repositories.participantImports.updateStartWave(
      command.waveId,
      command.name,
      civilToInstant(command.day, command.time, command.timeZone),
    );
  } catch (error) {
    throw translate(error, useCase);
  }
}

/** Supprimer une vague : ses coureurs repartent à l'heure de l'épreuve, prévenus (0082). */
export async function deleteStartWave(
  context: ParticipantImportContext,
  input: unknown,
): Promise<void> {
  const useCase = 'deleteStartWave';
  const { waveId } = parseCommand(z.object({ waveId: uuid }), input, useCase);

  try {
    await context.repositories.participantImports.deleteStartWave(waveId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

/** Les alertes d'heure de départ du coureur — 0082. Sa session, ses alertes. */
export interface StartChangeContext {
  readonly repositories: { readonly startChanges: StartChangeRepository };
}

export async function listStartChanges(
  context: StartChangeContext,
  input: unknown,
): Promise<readonly StartChangeRecord[]> {
  const useCase = 'listStartChanges';
  const { participantRaceId } = parseCommand(z.object({ participantRaceId: uuid }), input, useCase);

  try {
    return await context.repositories.startChanges.listUnseen(participantRaceId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function acknowledgeStartChanges(
  context: StartChangeContext,
  input: unknown,
): Promise<void> {
  const useCase = 'acknowledgeStartChanges';
  const { participantRaceId } = parseCommand(z.object({ participantRaceId: uuid }), input, useCase);

  try {
    await context.repositories.startChanges.acknowledge(participantRaceId);
  } catch (error) {
    throw translate(error, useCase);
  }
}
