import { isNotificationError, sendEventSiteContact } from '@pluka/notifications';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `email.event_site_contact` — migration 0052, file `pluka_email`.
 *
 *   message en file → envoi à l'organisation, Reply-To au coureur → effacé
 *
 * Le contenu n'est lu qu'ici, et n'est ni journalisé ni recopié : les logs ne
 * portent que l'identifiant du message (AGENTS §62). Envoyé ou abandonné, il
 * est effacé ; seule reste la trace sans contenu de la limite de débit.
 *
 * DÉGRADATION (01_ARCHITECTURE §35)
 *
 * Pas de fournisseur, ou fournisseur en panne : le message reste en file et
 * l'envoi est retenté, jusqu'à MAX_ATTEMPTS. Au-delà, il est abandonné et
 * son contenu effacé : un message de coureur ne traîne pas en base.
 */

const MAX_ATTEMPTS = 5;

export type EventSiteContactOutcome =
  | { readonly kind: 'sent'; readonly messageId: string }
  | { readonly kind: 'already_done'; readonly messageId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît un message du formulaire de contact parmi ceux de `pluka_email`. */
export function isEventSiteContactMessage(message: QueueMessage): boolean {
  return typeof message.payload.contactMessageId === 'string';
}

export async function handleEventSiteContactMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<EventSiteContactOutcome> {
  const messageId = message.payload.contactMessageId;

  if (typeof messageId !== 'string') {
    ports.logger.error('message de contact illisible', { msgId: message.msgId });
    return { kind: 'abandoned', code: 'PAYLOAD_INVALID' };
  }

  let attempt = 0;
  try {
    if (ports.email === null) {
      throw transient('EMAIL_NOT_CONFIGURED', 'aucun fournisseur email configuré');
    }

    const claim = await ports.siteContacts.claim(messageId);
    if (!claim.sendable) {
      ports.logger.info('message de contact sans envoi à faire', { messageId });
      return { kind: 'already_done', messageId };
    }
    attempt = claim.attempt;

    if (
      claim.recipientEmail === null ||
      claim.eventName === null ||
      claim.senderName === null ||
      claim.senderEmail === null ||
      claim.body === null
    ) {
      throw permanent('CLAIM_INCOMPLETE', 'message incomplet');
    }

    await sendEventSiteContact(ports.email, {
      idempotencyKey: `event-site-contact:${messageId}`,
      notice: {
        recipientEmail: claim.recipientEmail,
        eventName: claim.eventName,
        raceName: claim.raceName,
        senderName: claim.senderName,
        senderEmail: claim.senderEmail,
        body: claim.body,
      },
    });

    await ports.siteContacts.complete(messageId);
    ports.logger.info('message de contact envoyé', { messageId, attempt });

    return { kind: 'sent', messageId };
  } catch (error) {
    const normalized = isNotificationError(error)
      ? {
          kind: error.permanent ? ('permanent' as const) : ('transient' as const),
          code: error.code,
          message: error.message,
        }
      : normalizeError(error);

    const abandon = normalized.kind === 'permanent' || attempt >= MAX_ATTEMPTS;
    await ports.siteContacts
      .fail(messageId, formatForStorage(normalized), abandon)
      .catch(() => undefined);

    ports.logger.error('message de contact en échec', {
      messageId,
      code: normalized.code,
      kind: normalized.kind,
      attempt,
    });

    return abandon
      ? { kind: 'abandoned', code: normalized.code }
      : { kind: 'retry', code: normalized.code };
  }
}
