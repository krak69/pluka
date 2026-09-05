import type { ChangeSeverity } from '@pluka/notifications';

/**
 * Frontière des livraisons de notification — §46.
 *
 * `NotificationClaim` porte des données personnelles : l'adresse et le prénom
 * du destinataire. C'est inévitable — il faut bien écrire à quelqu'un — mais
 * c'est le seul endroit du worker où elles apparaissent, et elles n'y sont que
 * le temps d'un envoi. Rien de tout cela n'est journalisé
 * (03_PRIVACY_RLS §130), et rien ne concerne un autre coureur : la
 * réclamation ne rend qu'un destinataire, celui de la livraison.
 *
 * Les champs sont nullables parce qu'une livraison déjà envoyée n'en rend
 * aucun : `alreadySent` suffit, et relire l'adresse d'un envoi terminé serait
 * une lecture sans objet.
 */
export interface NotificationClaim {
  readonly deliveryId: string;
  readonly alreadySent: boolean;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly idempotencyKey: string;
  readonly recipientEmail: string | null;
  readonly recipientFirstName: string | null;
  readonly locale: string | null;
  readonly eventName: string | null;
  readonly raceName: string | null;
  readonly raceId: string | null;
  readonly changeTitle: string | null;
  readonly severity: ChangeSeverity | null;
  readonly modules: readonly string[];
}

export interface NotificationResult {
  readonly provider: string;
  readonly providerMessageId: string | null;
  readonly templateVersion: string;
}

export interface NotificationStore {
  /** Compare-and-set : une livraison déjà envoyée revient `alreadySent`. */
  claim(deliveryId: string): Promise<NotificationClaim>;
  complete(deliveryId: string, result: NotificationResult): Promise<void>;
  /** Rend le statut résultant : `pending` s'il reste des tentatives, `failed` sinon. */
  fail(deliveryId: string, error: string): Promise<string | null>;
}
