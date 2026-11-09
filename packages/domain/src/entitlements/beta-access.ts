import { z } from 'zod';

import {
  DbError,
  type BetaAccessGrantOutcome,
  type BetaAccessRecord,
  type BetaAccessRepositories,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';

/**
 * Accès bêta — 04_ENTITLEMENTS §14, §61, §125 (`grantBetaAccess`) · migration 0073.
 *
 * Global et temporaire : un testeur a tout, sur toutes ses courses, jusqu'à une
 * date de fin. La garde `pluka_admin` est en base ; le domaine découpe la liste
 * d'adresses, valide la date et traduit les refus.
 */

export interface BetaAccessContext {
  readonly repositories: BetaAccessRepositories;
  /** Non consulté : la base lit l'acteur dans le jeton. */
  readonly actor: Actor;
  readonly now: () => Date;
}

export const MAX_BETA_EMAILS = 500;

export const grantBetaAccessCommandSchema = z
  .object({
    /** Adresses séparées par des virgules, des points-virgules ou des retours à la ligne. */
    emails: z.string().min(1, { error: 'Indique au moins une adresse.' }),
    /** Dernier jour d'accès, en date civile. */
    endsOn: z.iso.date({ error: 'Choisis une date de fin.' }),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();

export const revokeBetaAccessCommandSchema = z
  .object({ grantId: z.string().uuid(), reason: z.string().trim().max(200).optional() })
  .strict();

export const cancelBetaReservationCommandSchema = z
  .object({ email: z.string().trim().min(3).max(320) })
  .strict();

function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;

  const translated: Partial<Record<DbError['code'], Error>> = {
    permission_denied: forbiddenError(useCase),
    not_found: notFoundError(useCase, 'accès bêta'),
    invalid_state: invalidStateError(useCase, 'cet accès est déjà clos'),
  };

  return translated[error.code] ?? error;
}

/** La liste découpée, sans doublon, dans l'ordre de saisie. */
export function splitEmails(raw: string): readonly string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/u)) {
    const email = part.trim().toLowerCase();
    if (email !== '') seen.add(email);
  }
  return [...seen];
}

export async function listBetaAccess(
  context: BetaAccessContext,
): Promise<readonly BetaAccessRecord[]> {
  try {
    return await context.repositories.betaAccess.list();
  } catch (error) {
    throw translate(error, 'listBetaAccess');
  }
}

export async function grantBetaAccess(
  context: BetaAccessContext,
  input: unknown,
): Promise<BetaAccessGrantOutcome> {
  const useCase = 'grantBetaAccess';
  const command = parseCommand(grantBetaAccessCommandSchema, input, useCase);
  const emails = splitEmails(command.emails);

  if (emails.length === 0) {
    throw validationError(useCase, 'aucune adresse', { emails: 'Indique au moins une adresse.' });
  }
  if (emails.length > MAX_BETA_EMAILS) {
    throw validationError(useCase, 'trop d’adresses', {
      emails: `${String(MAX_BETA_EMAILS)} adresses au plus par envoi.`,
    });
  }

  // L'accès vaut jusqu'au bout du dernier jour, heure de Paris.
  const endsAt = new Date(`${command.endsOn}T23:59:59+01:00`);
  if (endsAt.getTime() <= context.now().getTime()) {
    throw validationError(useCase, 'date de fin passée', {
      endsOn: 'La date de fin doit être dans le futur.',
    });
  }

  try {
    return await context.repositories.betaAccess.grant(
      emails,
      endsAt.toISOString(),
      command.reason === undefined || command.reason === '' ? null : command.reason,
    );
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function revokeBetaAccess(context: BetaAccessContext, input: unknown): Promise<void> {
  const useCase = 'revokeBetaAccess';
  const command = parseCommand(revokeBetaAccessCommandSchema, input, useCase);

  try {
    await context.repositories.betaAccess.revoke(
      command.grantId,
      command.reason === undefined || command.reason === '' ? null : command.reason,
    );
  } catch (error) {
    throw translate(error, useCase);
  }
}

export async function cancelBetaReservation(
  context: BetaAccessContext,
  input: unknown,
): Promise<void> {
  const useCase = 'cancelBetaReservation';
  const command = parseCommand(cancelBetaReservationCommandSchema, input, useCase);

  try {
    await context.repositories.betaAccess.cancelReservation(command.email);
  } catch (error) {
    throw translate(error, useCase);
  }
}
