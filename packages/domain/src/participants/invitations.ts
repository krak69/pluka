import { z } from 'zod';

import {
  DbError,
  type ParticipantInvitationPreviewRecord,
  type ParticipantInvitationRecord,
  type ParticipantInvitationRepositories,
  type RaceAdoptionRecord,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { forbiddenError, invalidStateError, notFoundError, parseCommand } from '../errors.js';
import { OTHER_EMAIL_REASON, hashInvitationToken } from '../team/use-cases.js';

/**
 * Invitations des participants — 00_PRODUCT_SPEC §29.2 · 03_PRIVACY_RLS §115–§118 ·
 * migration 0069.
 *
 * Les gardes sont dans les fonctions SQL et seulement là : owner ou admin pour
 * envoyer, compte de l'adresse invitée pour activer, PLUKA pour l'accès inclus.
 * Le domaine valide les entrées, hache le jeton venu de l'URL, et traduit les
 * refus. L'interrupteur de mise en production (`participant_invitations`) est
 * tenu par l'application : un flag n'est pas une règle métier (AGENTS §47).
 */

export interface ParticipantInvitationContext {
  readonly repositories: ParticipantInvitationRepositories;
  /** Non consulté : la base lit l'acteur dans le jeton (`auth.uid()`). */
  readonly actor: Actor;
}

const uuid = z.string().uuid();
/** 32 octets en base64url, comme les invitations d'équipe. */
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'lien d’invitation invalide' });

export const sendParticipantInvitationsCommandSchema = z
  .object({
    editionId: uuid,
    /** Absente : toutes les invitations à faire. Présente : un renvoi. */
    participantRaceIds: z.array(uuid).min(1).max(500).optional(),
  })
  .strict();

export const participantInvitationEditionQuerySchema = z.object({ editionId: uuid }).strict();

export const setEditionParticipantsIncludedCommandSchema = z
  .object({ editionId: uuid, included: z.boolean() })
  .strict();

export const setEditionPartnerSalesCommandSchema = z
  .object({ editionId: uuid, enabled: z.boolean() })
  .strict();

export const participantInvitationTokenSchema = z.object({ token }).strict();

function translate(error: unknown, useCase: string, refusal: string): unknown {
  if (!(error instanceof DbError)) return error;

  const translated: Partial<Record<DbError['code'], Error>> = {
    permission_denied: forbiddenError(useCase),
    not_found: notFoundError(useCase, 'invitation'),
    invalid_state: invalidStateError(useCase, refusal),
  };

  return translated[error.code] ?? error;
}

/** Rend le nombre d'invitations parties. */
export async function sendParticipantInvitations(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<number> {
  const useCase = 'sendParticipantInvitations';
  const command = parseCommand(sendParticipantInvitationsCommandSchema, input, useCase);

  try {
    return await context.repositories.participantInvitations.send(
      command.editionId,
      command.participantRaceIds ?? null,
    );
  } catch (error) {
    throw translate(error, useCase, 'ces participants ne peuvent pas être invités');
  }
}

export async function listParticipantInvitations(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<readonly ParticipantInvitationRecord[]> {
  const useCase = 'listParticipantInvitations';
  const query = parseCommand(participantInvitationEditionQuerySchema, input, useCase);

  try {
    return await context.repositories.participantInvitations.list(query.editionId);
  } catch (error) {
    throw translate(error, useCase, 'invitations illisibles');
  }
}

/** L'édition ouvre-t-elle l'accès inclus à l'activation ? Faux si elle est illisible. */
export async function isEditionParticipantsIncluded(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<boolean> {
  const query = parseCommand(
    participantInvitationEditionQuerySchema,
    input,
    'isEditionParticipantsIncluded',
  );

  return (
    (await context.repositories.participantInvitations.editionIncluded(query.editionId)) === true
  );
}

/** Réservé à PLUKA : l'accès inclus est contractuel (04_ENTITLEMENTS §12). */
export async function setEditionParticipantsIncluded(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setEditionParticipantsIncluded';
  const command = parseCommand(setEditionParticipantsIncludedCommandSchema, input, useCase);

  try {
    await context.repositories.participantInvitations.setEditionIncluded(
      command.editionId,
      command.included,
    );
  } catch (error) {
    throw translate(error, useCase, 'édition indisponible');
  }
}

/** Le canal B est-il ouvert sur l'édition (0086) ? Faux si elle est illisible. */
export async function isEditionPartnerSalesOpen(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<boolean> {
  const query = parseCommand(
    participantInvitationEditionQuerySchema,
    input,
    'isEditionPartnerSalesOpen',
  );

  return (
    (await context.repositories.participantInvitations.editionPartnerSales(query.editionId)) ===
    true
  );
}

/**
 * Réservé à PLUKA : le canal B s'ouvre à la signature du contrat, qui fixe le
 * prix de cession (00_PRODUCT_SPEC §6.5.5). Il exclut l'accès inclus : la base
 * refuse les deux à la fois.
 */
export async function setEditionPartnerSales(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setEditionPartnerSales';
  const command = parseCommand(setEditionPartnerSalesCommandSchema, input, useCase);

  try {
    await context.repositories.participantInvitations.setEditionPartnerSales(
      command.editionId,
      command.enabled,
    );
  } catch (error) {
    throw translate(error, useCase, 'l’accès inclus est ouvert sur cette édition');
  }
}

/** Un jeton mal formé est un lien inconnu, pas une erreur : la page n'a qu'une chose à dire. */
export async function previewParticipantInvitation(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<ParticipantInvitationPreviewRecord> {
  const parsed = participantInvitationTokenSchema.safeParse(input);

  if (!parsed.success) {
    return {
      state: 'unknown',
      eventName: null,
      raceName: null,
      raceStart: null,
      raceTimezone: null,
      organizationName: null,
      maskedEmail: null,
      included: false,
      prepaid: false,
    };
  }

  return context.repositories.participantInvitations.preview(
    hashInvitationToken(parsed.data.token),
  );
}

/**
 * Refuser d'être contacté, depuis le lien de l'e-mail, sans compte (0075).
 * Un jeton mal formé est un lien inconnu.
 */
export async function declineParticipantInvitation(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<'declined' | 'closed' | 'unknown'> {
  const parsed = participantInvitationTokenSchema.safeParse(input);
  if (!parsed.success) return 'unknown';

  return context.repositories.participantInvitations.decline(
    hashInvitationToken(parsed.data.token),
  );
}

/** Les participations de l'édition qui ont refusé d'être contactées (0075). */
export async function listContactOptouts(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<readonly string[]> {
  const useCase = 'listContactOptouts';
  const query = parseCommand(participantInvitationEditionQuerySchema, input, useCase);

  try {
    return await context.repositories.participantInvitations.listOptouts(query.editionId);
  } catch (error) {
    throw translate(error, useCase, 'refus illisibles');
  }
}

/**
 * L'adoption par épreuve — 00_PRODUCT_SPEC §36. La base applique le seuil de
 * 10 (§70) : un chiffre nul se dit « groupe trop petit », jamais « 0 ».
 */
export async function getRaceAdoption(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<readonly RaceAdoptionRecord[]> {
  const useCase = 'getRaceAdoption';
  const query = parseCommand(participantInvitationEditionQuerySchema, input, useCase);

  try {
    return await context.repositories.participantInvitations.adoption(query.editionId);
  } catch (error) {
    throw translate(error, useCase, 'adoption illisible');
  }
}

/**
 * Active une invitation. Le refus d'un compte d'une autre adresse porte
 * `details.reason = other_email` (§117), sans jamais citer l'adresse attendue.
 */
export async function acceptParticipantInvitation(
  context: ParticipantInvitationContext,
  input: unknown,
): Promise<{ readonly participantRaceId: string }> {
  const useCase = 'acceptParticipantInvitation';
  const command = parseCommand(participantInvitationTokenSchema, input, useCase);

  try {
    const participantRaceId = await context.repositories.participantInvitations.accept(
      hashInvitationToken(command.token),
    );
    return { participantRaceId };
  } catch (error) {
    if (error instanceof DbError && error.code === 'permission_denied') {
      throw forbiddenError(useCase, { reason: OTHER_EMAIL_REASON });
    }

    throw translate(
      error,
      useCase,
      'cette invitation a expiré ou a déjà été utilisée : demandez-en une nouvelle',
    );
  }
}
