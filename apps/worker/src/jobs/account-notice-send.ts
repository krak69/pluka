import { isNotificationError, sendAccountInactivityNotice } from '@pluka/notifications';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `email.account_inactivity` — migration 0079, file `pluka_email`.
 *
 *   bientôt 3 ans sans connexion → avertissement → 30 jours → effacement
 *
 * Tant que l'e-mail n'est pas parti, la base n'efface pas : une panne retarde
 * la suppression, elle ne la rend pas silencieuse. Le journal ne porte que
 * l'identifiant du compte, jamais l'adresse (AGENTS §62).
 */

const MAX_ATTEMPTS = 5;

export type AccountNoticeOutcome =
  | { readonly kind: 'sent'; readonly userId: string }
  | { readonly kind: 'already_done'; readonly userId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît un avertissement de compte inactif parmi les messages de `pluka_email`. */
export function isAccountNoticeMessage(message: QueueMessage): boolean {
  return typeof message.payload.accountNoticeUserId === 'string';
}

export async function handleAccountNoticeMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<AccountNoticeOutcome> {
  const userId = message.payload.accountNoticeUserId;

  if (typeof userId !== 'string') {
    ports.logger.error('avertissement de compte illisible', { msgId: message.msgId });
    return { kind: 'abandoned', code: 'PAYLOAD_INVALID' };
  }

  let attempt = 0;
  try {
    if (ports.email === null) {
      throw transient('EMAIL_NOT_CONFIGURED', 'aucun fournisseur email configuré');
    }

    const claim = await ports.accountNotices.claim(userId);
    if (!claim.sendable) {
      ports.logger.info('avertissement de compte sans envoi à faire', { userId });
      return { kind: 'already_done', userId };
    }
    attempt = claim.attempt;

    if (claim.recipientEmail === null || claim.purgeAfter === null) {
      throw permanent('CLAIM_INCOMPLETE', 'avertissement incomplet');
    }

    await sendAccountInactivityNotice(ports.email, {
      idempotencyKey: `account-inactivity:${userId}`,
      notice: {
        recipientEmail: claim.recipientEmail,
        recipientFirstName: claim.firstName,
        purgeAfter: claim.purgeAfter,
        signInUrl: `${ports.appUrl}/connexion`,
        exportUrl: `${ports.appUrl}/profil/donnees`,
        privacyUrl: `${ports.siteUrl}/confidentialite`,
      },
    });

    await ports.accountNotices.complete(userId);
    ports.logger.info('avertissement de compte envoyé', { userId, attempt });

    return { kind: 'sent', userId };
  } catch (error) {
    const normalized = isNotificationError(error)
      ? {
          kind: error.permanent ? ('permanent' as const) : ('transient' as const),
          code: error.code,
          message: error.message,
        }
      : normalizeError(error);

    const abandon = normalized.kind === 'permanent' || attempt >= MAX_ATTEMPTS;
    await ports.accountNotices
      .fail(userId, formatForStorage(normalized), abandon)
      .catch(() => undefined);

    ports.logger.error('avertissement de compte en échec', {
      userId,
      code: normalized.code,
      kind: normalized.kind,
      attempt,
    });

    return abandon
      ? { kind: 'abandoned', code: normalized.code }
      : { kind: 'retry', code: normalized.code };
  }
}
