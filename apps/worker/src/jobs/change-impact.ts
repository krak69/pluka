import { normalizeError, permanent } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `race.fact.published` — Impact Analyzer de §44.
 *
 *   race.fact.published → Impact Analyzer → Plans, Préparation, Assistance…
 *
 * Le worker ne fait ici presque rien, et c'est délibéré : il transmet un
 * identifiant d'événement et reçoit un nombre. Toute l'analyse est une
 * fonction SQL.
 *
 * La raison est de confidentialité, pas de commodité. Déterminer qui est
 * concerné suppose de regarder qui court, qui a un Plan actif, qui a déclaré
 * un assistant. Faire transiter cela par la mémoire du worker — donc,
 * potentiellement, par ses journaux — exposerait exactement ce que
 * `00_PRODUCT_SPEC` §37 interdit. Rien de tout cela ne franchit la frontière
 * de la base.
 *
 * Ce job **ne modifie aucun objet downstream**. §46 : « le Plan existant est
 * marqué potentiellement impacté ; le coureur est informé ; le recalcul se
 * fait selon le workflow produit. » Un impact est un signal, pas une mutation.
 */

export const IMPACT_QUEUE = 'pluka_plan';

/** Types d'événements de course que l'analyse traite (§43, §44). */
const ANALYZED_EVENTS = new Set(['race.fact.published']);

interface ImpactJobPayload {
  readonly changeEventId: string;
  readonly factId: string;
  readonly idempotencyKey: string;
}

function readPayload(message: QueueMessage): ImpactJobPayload {
  const { changeEventId, factId, idempotencyKey } = message.payload;

  if (typeof changeEventId !== 'string' || typeof idempotencyKey !== 'string') {
    throw permanent('PAYLOAD_INVALID', 'charge utile incomplète');
  }

  return {
    changeEventId,
    factId: typeof factId === 'string' ? factId : '',
    idempotencyKey,
  };
}

export type ImpactOutcome =
  | { readonly kind: 'analyzed'; readonly impactCount: number }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/**
 * Reconnaît un message d'analyse d'impact.
 *
 * La file `pluka_plan` accueillera aussi les recalculs de Plan et de Nutrition
 * (0002) : le routage se fait donc sur le type d'événement, pas sur la file.
 */
export function isImpactMessage(message: QueueMessage): boolean {
  const eventType = message.payload.eventType;

  return (
    typeof message.payload.changeEventId === 'string' &&
    (typeof eventType !== 'string' || ANALYZED_EVENTS.has(eventType))
  );
}

export async function handleImpactMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<ImpactOutcome> {
  let payload: ImpactJobPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error("message d'impact illisible", {
      msgId: message.msgId,
      code: normalized.code,
    });
    return { kind: 'abandoned', code: normalized.code };
  }

  try {
    // §22.1 : rejouer le message ne recrée rien. L'unicité
    // (événement, coureur, module) est portée par la table, et la fonction
    // insère en `on conflict do nothing` — un retry est donc gratuit.
    const impactCount = await ports.impacts.analyze(payload.changeEventId);

    ports.logger.info('impacts analysés', {
      changeEventId: payload.changeEventId,
      factId: payload.factId,
      // Un nombre, jamais une liste : le journal ne doit pas dire *qui* est
      // concerné (03_PRIVACY_RLS §130, 00_PRODUCT_SPEC §37).
      impactCount,
    });

    return { kind: 'analyzed', impactCount };
  } catch (error) {
    const normalized = normalizeError(error);

    ports.logger.error("analyse d'impact en échec", {
      changeEventId: payload.changeEventId,
      code: normalized.code,
      kind: normalized.kind,
    });

    return normalized.kind === 'permanent'
      ? { kind: 'abandoned', code: normalized.code }
      : { kind: 'retry', code: normalized.code };
  }
}
