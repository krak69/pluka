import {
  DbError,
  type EditionReferralCodeRecord,
  type ReferralCodeRepository,
  type ResolvedReferralCodeRecord,
} from '@pluka/db';
import { z } from 'zod';

import { forbiddenError, notFoundError, parseCommand } from '../errors.js';

/**
 * Canal A — le lien de l'organisation (00_PRODUCT_SPEC §6.5.4, 04 §73.1, 0087).
 *
 * Un code par édition, créé avec elle. Il suit le coureur dans l'adresse,
 * jamais dans un cookie (décision du 2026-11-12), et se pose sur sa
 * participation quand il valide sa course. Le prix ne dépend jamais du canal.
 */

export interface ReferralCodeContext {
  readonly repositories: { readonly referralCodes: ReferralCodeRepository };
}

/** La forme d'un code. Toute autre chaîne est un lien inconnu, pas une erreur. */
export const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9]{4,24}$/u;

/** Le code tel qu'il voyage dans une adresse ; nul s'il ne peut pas en être un. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return REFERRAL_CODE_PATTERN.test(trimmed) ? trimmed.toUpperCase() : null;
}

const uuid = z.uuid();

function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;
  if (error.code === 'permission_denied') return forbiddenError(useCase);
  if (error.code === 'not_found') return notFoundError(useCase, 'édition');
  return error;
}

/** La page ouverte par le lien. Nul : code inconnu, désactivé ou mal formé. */
export async function resolveReferralCode(
  context: ReferralCodeContext,
  input: unknown,
): Promise<ResolvedReferralCodeRecord | null> {
  const code = normalizeReferralCode((input as { code?: unknown } | null)?.code);
  if (code === null) return null;

  return context.repositories.referralCodes.resolve(code);
}

/** Le code de l'édition, pour l'organisation qui le diffuse. */
export async function getEditionReferralCode(
  context: ReferralCodeContext,
  input: unknown,
): Promise<EditionReferralCodeRecord | null> {
  const useCase = 'getEditionReferralCode';
  const { editionId } = parseCommand(z.object({ editionId: uuid }).strict(), input, useCase);

  try {
    return await context.repositories.referralCodes.forEdition(editionId);
  } catch (error) {
    throw translate(error, useCase);
  }
}

/** Réservé à PLUKA : couper un lien sans supprimer le code déjà diffusé. */
export async function setEditionReferralCodeActive(
  context: ReferralCodeContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setEditionReferralCodeActive';
  const command = parseCommand(
    z.object({ editionId: uuid, active: z.boolean() }).strict(),
    input,
    useCase,
  );

  try {
    await context.repositories.referralCodes.setActive(command.editionId, command.active);
  } catch (error) {
    throw translate(error, useCase);
  }
}
