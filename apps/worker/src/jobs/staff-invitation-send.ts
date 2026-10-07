import {
  STAFF_ROLES,
  isNotificationError,
  sendStaffInvitation,
  type StaffRole,
} from '@pluka/notifications';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

import { drawInvitationToken } from './organization-invitation-send.js';

/**
 * Job `email.staff_invitation` — migration 0036, file `pluka_email`.
 *
 * Même contrat que l'invitation d'organisation : le jeton est tiré ici, seul
 * son SHA-256 part en base, le jeton n'existe que dans l'email. Le lien vise
 * la console d'administration (`ADMIN_URL`), où l'invitation s'accepte.
 */

const MAX_ATTEMPTS = 5;

export type StaffInvitationOutcome =
  | { readonly kind: 'sent'; readonly invitationId: string }
  | { readonly kind: 'already_done'; readonly invitationId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

export function isStaffInvitationMessage(message: QueueMessage): boolean {
  return typeof message.payload.staffInvitationId === 'string';
}

function isStaffRole(value: string | null): value is StaffRole {
  return value !== null && (STAFF_ROLES as readonly string[]).includes(value);
}

export async function handleStaffInvitationMessage(
  ports: WorkerPorts,
  message: QueueMessage,
  draw: () => { readonly token: string; readonly hash: string } = drawInvitationToken,
): Promise<StaffInvitationOutcome> {
  const invitationId = message.payload.staffInvitationId;

  if (typeof invitationId !== 'string') {
    ports.logger.error('message d’invitation PLUKA illisible', { msgId: message.msgId });
    return { kind: 'abandoned', code: 'PAYLOAD_INVALID' };
  }

  try {
    if (ports.email === null) {
      throw transient('EMAIL_NOT_CONFIGURED', 'aucun fournisseur email configuré');
    }

    const { token, hash } = draw();
    const claim = await ports.staffInvitations.claim(invitationId, hash);

    if (!claim.sendable) {
      ports.logger.info('invitation PLUKA sans envoi à faire', { invitationId });
      return { kind: 'already_done', invitationId };
    }

    if (!isStaffRole(claim.staffRole) || claim.expiresAt === null) {
      throw permanent('CLAIM_INCOMPLETE', 'réclamation incomplète');
    }

    await sendStaffInvitation(ports.email, {
      idempotencyKey: `staff-invitation:${invitationId}:${claim.attempt}`,
      notice: {
        recipientEmail: claim.email ?? '',
        staffRole: claim.staffRole,
        inviterName: claim.inviterName,
        expiresAt: claim.expiresAt,
        acceptUrl: `${ports.adminUrl}/invitation-equipe/${token}`,
      },
    });

    await ports.staffInvitations.complete(invitationId);
    // Ni adresse, ni jeton : l'identifiant suffit au diagnostic.
    ports.logger.info('invitation PLUKA envoyée', { invitationId, attempt: claim.attempt });

    return { kind: 'sent', invitationId };
  } catch (error) {
    const normalized = isNotificationError(error)
      ? {
          kind: error.permanent ? ('permanent' as const) : ('transient' as const),
          code: error.code,
          message: error.message,
        }
      : normalizeError(error);

    const attempts = await ports.staffInvitations
      .fail(invitationId, formatForStorage(normalized))
      .catch(() => MAX_ATTEMPTS);

    ports.logger.error('invitation PLUKA en échec', {
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
