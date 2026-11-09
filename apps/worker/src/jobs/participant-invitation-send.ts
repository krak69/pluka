import { isNotificationError, sendParticipantInvitation } from '@pluka/notifications';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';
import { drawInvitationToken } from './organization-invitation-send.js';

/**
 * Job `email.participant_invitation` — migration 0069, file `pluka_email`.
 *
 *   invitation pending → jeton tiré ici → hash en base → email → sent
 *
 * Même contrat que l'invitation d'équipe : le jeton n'existe que dans l'email,
 * une relance en tire un nouveau, et la clé d'idempotence inclut la tentative
 * pour que le fournisseur ne renvoie pas l'ancien lien.
 */

const MAX_ATTEMPTS = 5;

export type ParticipantInvitationOutcome =
  | { readonly kind: 'sent'; readonly invitationId: string }
  | { readonly kind: 'already_done'; readonly invitationId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît une invitation de participant parmi les messages de `pluka_email`. */
export function isParticipantInvitationMessage(message: QueueMessage): boolean {
  return typeof message.payload.participantInvitationId === 'string';
}

export async function handleParticipantInvitationMessage(
  ports: WorkerPorts,
  message: QueueMessage,
  draw: () => { readonly token: string; readonly hash: string } = drawInvitationToken,
): Promise<ParticipantInvitationOutcome> {
  const invitationId = message.payload.participantInvitationId;

  if (typeof invitationId !== 'string') {
    const normalized = normalizeError(permanent('PAYLOAD_INVALID', 'charge utile incomplète'));
    ports.logger.error('message d’invitation illisible', { msgId: message.msgId });
    return { kind: 'abandoned', code: normalized.code };
  }

  try {
    if (ports.email === null) {
      throw transient('EMAIL_NOT_CONFIGURED', 'aucun fournisseur email configuré');
    }

    const { token, hash } = draw();
    const claim = await ports.participantInvitations.claim(invitationId, hash);

    if (!claim.sendable) {
      ports.logger.info('invitation sans envoi à faire', { invitationId });
      return { kind: 'already_done', invitationId };
    }

    if (
      claim.email === null ||
      claim.eventName === null ||
      claim.raceName === null ||
      claim.raceStart === null ||
      claim.raceTimezone === null
    ) {
      throw permanent('CLAIM_INCOMPLETE', 'réclamation incomplète');
    }

    await sendParticipantInvitation(ports.email, {
      idempotencyKey: `participant-invitation:${invitationId}:${String(claim.attempt)}`,
      notice: {
        recipientEmail: claim.email,
        recipientFirstName: claim.firstName,
        eventName: claim.eventName,
        raceName: claim.raceName,
        organizationName: claim.organizationName,
        raceStart: claim.raceStart,
        raceTimezone: claim.raceTimezone,
        included: claim.included,
        acceptUrl: `${ports.appUrl}/invitation/${token}`,
        declineUrl: `${ports.appUrl}/invitation/${token}?refus=1`,
        privacyUrl: `${ports.siteUrl}/confidentialite`,
      },
    });

    await ports.participantInvitations.complete(invitationId);

    // Ni adresse, ni jeton, ni course : l'identifiant suffit au diagnostic.
    ports.logger.info('invitation envoyée', { invitationId, attempt: claim.attempt });

    return { kind: 'sent', invitationId };
  } catch (error) {
    const normalized = isNotificationError(error)
      ? {
          kind: error.permanent ? ('permanent' as const) : ('transient' as const),
          code: error.code,
          message: error.message,
        }
      : normalizeError(error);

    const attempts = await ports.participantInvitations
      .fail(invitationId, formatForStorage(normalized))
      .catch(() => MAX_ATTEMPTS);

    ports.logger.error('invitation en échec', {
      invitationId,
      code: normalized.code,
      kind: normalized.kind,
      attempts,
    });

    if (normalized.kind === 'permanent' || attempts >= MAX_ATTEMPTS) {
      return { kind: 'abandoned', code: normalized.code };
    }

    return { kind: 'retry', code: normalized.code };
  }
}
