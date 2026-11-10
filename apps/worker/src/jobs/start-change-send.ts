import { isNotificationError, sendStartChangedNotice } from '@pluka/notifications';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `email.start_changed` — migration 0082, file `pluka_email`.
 *
 *   un coureur change de vague, ou sa vague change d'heure → e-mail
 *
 * L'alerte dans l'application existe déjà, écrite par la base : l'e-mail en
 * est le double. Le journal ne porte que l'identifiant du changement, jamais
 * l'adresse ni la course (AGENTS §62).
 */

const MAX_ATTEMPTS = 5;

export type StartChangeOutcome =
  | { readonly kind: 'sent'; readonly changeId: string }
  | { readonly kind: 'already_done'; readonly changeId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît un changement d'heure de départ parmi les messages de `pluka_email`. */
export function isStartChangeMessage(message: QueueMessage): boolean {
  return typeof message.payload.startChangeId === 'string';
}

export async function handleStartChangeMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<StartChangeOutcome> {
  const changeId = message.payload.startChangeId;

  if (typeof changeId !== 'string') {
    ports.logger.error('changement de départ illisible', { msgId: message.msgId });
    return { kind: 'abandoned', code: 'PAYLOAD_INVALID' };
  }

  let attempt = 0;
  try {
    if (ports.email === null) {
      throw transient('EMAIL_NOT_CONFIGURED', 'aucun fournisseur email configuré');
    }

    const claim = await ports.startChanges.claim(changeId);
    if (!claim.sendable) {
      ports.logger.info('changement de départ sans envoi à faire', { changeId });
      return { kind: 'already_done', changeId };
    }
    attempt = claim.attempt;

    if (
      claim.recipientEmail === null ||
      claim.eventName === null ||
      claim.raceName === null ||
      claim.timezone === null ||
      claim.participantRaceId === null ||
      claim.previousStartAt === null ||
      claim.newStartAt === null
    ) {
      throw permanent('CLAIM_INCOMPLETE', 'changement incomplet');
    }

    await sendStartChangedNotice(ports.email, {
      idempotencyKey: `start-changed:${changeId}`,
      notice: {
        recipientEmail: claim.recipientEmail,
        recipientFirstName: claim.firstName,
        eventName: claim.eventName,
        raceName: claim.raceName,
        timezone: claim.timezone,
        previousWaveName: claim.previousWaveName,
        newWaveName: claim.newWaveName,
        previousStartAt: claim.previousStartAt,
        newStartAt: claim.newStartAt,
        hasPlan: claim.hasPlan,
        planUrl: `${ports.appUrl}/courses/${claim.participantRaceId}/plan`,
      },
    });

    await ports.startChanges.complete(changeId);
    ports.logger.info('changement de départ envoyé', { changeId, attempt });

    return { kind: 'sent', changeId };
  } catch (error) {
    const normalized = isNotificationError(error)
      ? {
          kind: error.permanent ? ('permanent' as const) : ('transient' as const),
          code: error.code,
          message: error.message,
        }
      : normalizeError(error);

    const abandon = normalized.kind === 'permanent' || attempt >= MAX_ATTEMPTS;
    await ports.startChanges
      .fail(changeId, formatForStorage(normalized), abandon)
      .catch(() => undefined);

    ports.logger.error('changement de départ en échec', {
      changeId,
      code: normalized.code,
      kind: normalized.kind,
      attempt,
    });

    return abandon
      ? { kind: 'abandoned', code: normalized.code }
      : { kind: 'retry', code: normalized.code };
  }
}
