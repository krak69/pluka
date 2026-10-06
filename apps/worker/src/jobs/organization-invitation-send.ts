import { createHash, randomBytes } from 'node:crypto';

import {
  ORGANIZATION_ROLES,
  isNotificationError,
  sendOrganizationInvitation,
  type OrganizationRole,
} from '@pluka/notifications';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `email.organization_invitation` — migration 0033, file `pluka_email`.
 *
 *   invitation pending → jeton tiré ici → hash en base → email → sent
 *
 * LE JETON
 *
 * 32 octets aléatoires (`randomBytes`), en base64url. Seul son SHA-256 part en
 * base ; le jeton lui-même n'existe que dans l'email (AGENTS §64). Il n'est ni
 * journalisé, ni renvoyé, ni mis en file.
 *
 * Une relance tire un nouveau jeton : celui d'un email qui n'est peut-être
 * jamais parti n'a pas à rester valide. La clé d'idempotence inclut le numéro
 * de tentative, pour que le fournisseur ne dédoublonne pas le nouvel email
 * vers l'ancien jeton. Le cas résiduel — fournisseur qui accepte, worker qui
 * meurt avant d'écrire `sent` — produit un second email dont le lien est le
 * seul valide. C'est le prix d'un jeton jamais stocké en clair.
 *
 * DÉGRADATION (01_ARCHITECTURE §35)
 *
 * Pas de fournisseur, ou fournisseur en panne : l'invitation reste `pending`,
 * l'erreur est notée, et l'écran d'équipe affiche « envoi en échec ».
 */

const MAX_ATTEMPTS = 5;

interface InvitationJobPayload {
  readonly invitationId: string;
}

export type InvitationOutcome =
  | { readonly kind: 'sent'; readonly invitationId: string }
  | { readonly kind: 'already_done'; readonly invitationId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît une demande d'envoi d'invitation parmi les messages de `pluka_email`. */
export function isInvitationMessage(message: QueueMessage): boolean {
  return typeof message.payload.invitationId === 'string';
}

function readPayload(message: QueueMessage): InvitationJobPayload {
  const { invitationId } = message.payload;

  if (typeof invitationId !== 'string') {
    throw permanent('PAYLOAD_INVALID', 'charge utile incomplète');
  }

  return { invitationId };
}

function isRole(value: string | null): value is OrganizationRole {
  return value !== null && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

/** 43 caractères base64url — la forme que le domaine attend. */
export function drawInvitationToken(): { readonly token: string; readonly hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

export async function handleInvitationMessage(
  ports: WorkerPorts,
  message: QueueMessage,
  draw: () => { readonly token: string; readonly hash: string } = drawInvitationToken,
): Promise<InvitationOutcome> {
  let payload: InvitationJobPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('message d’invitation illisible', {
      msgId: message.msgId,
      code: normalized.code,
    });
    return { kind: 'abandoned', code: normalized.code };
  }

  try {
    if (ports.email === null) {
      // Vérifié avant de réclamer : sans fournisseur, inutile de remplacer le
      // jeton ni de consommer une tentative.
      throw transient('EMAIL_NOT_CONFIGURED', 'aucun fournisseur email configuré');
    }

    const { token, hash } = draw();
    const claim = await ports.invitations.claim(payload.invitationId, hash);

    if (!claim.sendable) {
      ports.logger.info('invitation sans envoi à faire', { invitationId: payload.invitationId });
      return { kind: 'already_done', invitationId: payload.invitationId };
    }

    if (!isRole(claim.role) || claim.expiresAt === null || claim.organizationName === null) {
      throw permanent('CLAIM_INCOMPLETE', 'réclamation incomplète');
    }

    await sendOrganizationInvitation(ports.email, {
      idempotencyKey: `org-invitation:${payload.invitationId}:${claim.attempt}`,
      notice: {
        recipientEmail: claim.email ?? '',
        organizationName: claim.organizationName,
        role: claim.role,
        inviterName: claim.inviterName,
        expiresAt: claim.expiresAt,
        acceptUrl: `${ports.appUrl}/invitation-equipe/${token}`,
      },
    });

    await ports.invitations.complete(payload.invitationId);

    // Ni adresse, ni jeton, ni organisation : l'identifiant suffit au diagnostic.
    ports.logger.info('invitation envoyée', {
      invitationId: payload.invitationId,
      attempt: claim.attempt,
    });

    return { kind: 'sent', invitationId: payload.invitationId };
  } catch (error) {
    return failInvitation(ports, payload.invitationId, error);
  }
}

async function failInvitation(
  ports: WorkerPorts,
  invitationId: string,
  error: unknown,
): Promise<InvitationOutcome> {
  const normalized = isNotificationError(error)
    ? {
        kind: error.permanent ? ('permanent' as const) : ('transient' as const),
        code: error.code,
        message: error.message,
      }
    : normalizeError(error);

  const attempts = await ports.invitations
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
