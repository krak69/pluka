import {
  isNotificationError,
  sendChangeImpactNotice,
  type ImpactedModule,
} from '@pluka/notifications';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `email.send` — notification du coureur, §46.
 *
 *   participant_change_impact → livraison → EmailProvider
 *
 * « Le Plan existant est marqué potentiellement impacté ; **le coureur est
 * informé** ; le recalcul se fait selon le workflow produit. »
 *
 * IDEMPOTENCE (§22.1)
 *
 * Deux verrous, parce que la fenêtre entre « le fournisseur a accepté » et
 * « la base le sait » ne se ferme pas toute seule :
 *
 * - la réclamation est un compare-and-set : une livraison déjà `sent` revient
 *   marquée telle quelle, et le job s'arrête sans écrire ni envoyer ;
 * - la clé d'idempotence part au fournisseur, qui dédoublonne si le worker
 *   meurt entre l'envoi et l'écriture.
 *
 * DÉGRADATION (§35)
 *
 * « Email indisponible → l'invitation reste persistée et le job est retenté. »
 * Ici : aucun fournisseur configuré, ou fournisseur en panne, laisse la
 * livraison en attente et l'impact lisible dans l'application. Rien n'est
 * perdu en silence — la livraison porte son compteur de tentatives, son
 * erreur normalisée, et finit `failed` de façon visible si elle épuise ses
 * tentatives.
 */

export const EMAIL_QUEUE = 'pluka_email';

interface NotificationJobPayload {
  readonly deliveryId: string;
  readonly idempotencyKey: string;
}

function readPayload(message: QueueMessage): NotificationJobPayload {
  const { deliveryId, idempotencyKey } = message.payload;

  if (typeof deliveryId !== 'string' || typeof idempotencyKey !== 'string') {
    throw permanent('PAYLOAD_INVALID', 'charge utile incomplète');
  }

  return { deliveryId, idempotencyKey };
}

export type NotificationOutcome =
  | { readonly kind: 'sent'; readonly deliveryId: string }
  | { readonly kind: 'already_done'; readonly deliveryId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît une demande d'envoi parmi les messages de la file `pluka_email`. */
export function isNotificationMessage(message: QueueMessage): boolean {
  return typeof message.payload.deliveryId === 'string';
}

export async function handleNotificationMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<NotificationOutcome> {
  let payload: NotificationJobPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('message de notification illisible', {
      msgId: message.msgId,
      code: normalized.code,
    });
    return { kind: 'abandoned', code: normalized.code };
  }

  try {
    const claim = await ports.notifications.claim(payload.deliveryId);

    if (claim.alreadySent) {
      // Le message revient après un envoi réussi : il a rempli son office.
      ports.logger.info('notification déjà envoyée', { deliveryId: payload.deliveryId });
      return { kind: 'already_done', deliveryId: payload.deliveryId };
    }

    if (ports.email === null) {
      // §35 : pas de fournisseur, pas d'envoi — mais rien n'est perdu. La
      // livraison redevient en attente, et l'impact reste lisible dans
      // l'application, qui est le canal qui ne dépend de personne.
      throw transient('EMAIL_NOT_CONFIGURED', 'aucun fournisseur email configuré');
    }

    const sent = await sendChangeImpactNotice(ports.email, {
      idempotencyKey: claim.idempotencyKey,
      notice: {
        recipientEmail: claim.recipientEmail ?? '',
        recipientFirstName: claim.recipientFirstName,
        eventName: claim.eventName ?? '',
        raceName: claim.raceName ?? '',
        changeTitle: claim.changeTitle ?? '',
        severity: claim.severity ?? 'info',
        modules: (claim.modules ?? []) as readonly ImpactedModule[],
        raceUrl: `${ports.appUrl}/courses/${claim.raceId ?? ''}`,
      },
    });

    await ports.notifications.complete(payload.deliveryId, {
      provider: sent.provider,
      providerMessageId: sent.providerMessageId,
      templateVersion: sent.templateVersion,
    });

    ports.logger.info('notification envoyée', {
      deliveryId: payload.deliveryId,
      provider: sent.provider,
      // Ni adresse, ni nom, ni contenu : un journal n'a pas à savoir qui a été
      // notifié de quoi (03_PRIVACY_RLS §130, 00_PRODUCT_SPEC §37).
      attempts: claim.attempts,
    });

    return { kind: 'sent', deliveryId: payload.deliveryId };
  } catch (error) {
    return failDelivery(ports, payload.deliveryId, error);
  }
}

async function failDelivery(
  ports: WorkerPorts,
  deliveryId: string,
  error: unknown,
): Promise<NotificationOutcome> {
  // Une adresse inexploitable ne guérira pas ; un fournisseur en panne, si.
  const normalized = isNotificationError(error)
    ? {
        kind: error.permanent ? ('permanent' as const) : ('transient' as const),
        code: error.code,
        message: error.message,
      }
    : normalizeError(error);

  // §35 : la trace est écrite avant tout. Une notification qui échoue reste
  // visible, avec son compteur et sa raison — jamais silencieusement perdue.
  const status = await ports.notifications
    .fail(deliveryId, formatForStorage(normalized))
    .catch(() => null);

  ports.logger.error('notification en échec', {
    deliveryId,
    code: normalized.code,
    kind: normalized.kind,
    status,
  });

  // Tentatives épuisées : le message quitte la file, la livraison reste
  // `failed` et consultable. Continuer à la rejouer n'enverrait rien de plus.
  if (status === 'failed' || normalized.kind === 'permanent') {
    return { kind: 'abandoned', code: normalized.code };
  }

  return { kind: 'retry', code: normalized.code };
}
