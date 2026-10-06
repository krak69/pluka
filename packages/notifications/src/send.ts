import type { EmailMessage, EmailProvider, EmailSendResult } from '@pluka/contracts';

import { renderChangeImpactNotice, type ChangeImpactNotice } from './templates/change-impact.js';
import {
  renderOrganizationInvitation,
  type OrganizationInvitationNotice,
} from './templates/organization-invitation.js';

/**
 * Orchestration d'envoi — `01_ARCHITECTURE.md` §4.5, §35.
 *
 * `packages/notifications` porte « templates et orchestration email ». Le
 * transport appartient au provider, et l'interface `EmailProvider` vit dans
 * `packages/contracts` : ce paquet l'importe et n'en définit aucune. Il ne
 * connaît le nom d'aucun fournisseur — `provider.name` lui arrive, il le rend
 * à l'appelant, il ne le teste jamais. L'adapter concret vit hors d'ici, comme
 * pour `AIProvider`.
 *
 * Le paquet est pur : aucun accès réseau, aucun accès base. Il reçoit de quoi
 * écrire un message, il rend le résultat de l'envoi.
 */

export const NOTIFICATION_TEMPLATE_VERSION = 'change-impact-1.0.0';

export const INVITATION_TEMPLATE_VERSION = 'organization-invitation-1.0.0';

/**
 * Échecs d'envoi, dans un vocabulaire stable.
 *
 * §35 : « email indisponible → l'invitation reste persistée et le job est
 * retenté ». La distinction porte donc sur ce qu'il faut faire ensuite :
 * réessayer, ou renoncer parce que réessayer ne changera rien.
 */
export const NOTIFICATION_ERROR_CODES = [
  'PROVIDER_UNAVAILABLE',
  'RECIPIENT_INVALID',
  'PROVIDER_REJECTED',
] as const;

export type NotificationErrorCode = (typeof NOTIFICATION_ERROR_CODES)[number];

/** Une adresse invalide ne deviendra pas valide au prochain essai. */
const PERMANENT_CODES = new Set<NotificationErrorCode>(['RECIPIENT_INVALID']);

export class NotificationError extends Error {
  readonly code: NotificationErrorCode;
  readonly detail: string | undefined;

  constructor(code: NotificationErrorCode, message: string, detail?: string) {
    super(`${code} : ${message}`);
    this.name = 'NotificationError';
    this.code = code;
    this.detail = detail;
  }

  get permanent(): boolean {
    return PERMANENT_CODES.has(this.code);
  }
}

export function isNotificationError(error: unknown): error is NotificationError {
  return error instanceof NotificationError;
}

/**
 * Adresse plausible.
 *
 * Une validation minimale, volontairement : le seul juge d'une adresse est le
 * serveur qui l'accepte ou la refuse. Ce qu'on écarte ici est ce qui ne peut
 * pas être une adresse — vide, sans arobase — pour ne pas consacrer cinq
 * tentatives à une ligne d'import mal formée.
 */
function isPlausibleAddress(address: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address);
}

export interface ChangeImpactDelivery {
  readonly notice: ChangeImpactNotice;
  /**
   * Clé d'idempotence, transmise au provider.
   *
   * Le contrat la rend obligatoire (§22.1) : un retry ne doit pas produire un
   * second email. La base garde de son côté la trace de l'envoi ; cette clé
   * ferme la fenêtre entre l'appel au provider et l'écriture de cette trace.
   */
  readonly idempotencyKey: string;
}

export interface NotificationSent {
  readonly provider: string;
  readonly providerMessageId: string | null;
  readonly acceptedAt: string;
  readonly templateVersion: string;
}

/**
 * Écrit puis envoie la notification de §46.
 *
 * Le message est construit ici, pas par l'appelant : un gabarit rendu au
 * dehors pourrait recevoir n'importe quel texte, et la garantie « aucune
 * donnée d'un autre coureur » ne tiendrait plus qu'à la discipline.
 */
export async function sendChangeImpactNotice(
  provider: EmailProvider,
  delivery: ChangeImpactDelivery,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = renderChangeImpactNotice(notice);

  const message: EmailMessage = {
    // Un seul destinataire, et c'est structurel : ni copie, ni copie cachée.
    // L'organisation ne reçoit rien (00_PRODUCT_SPEC §37).
    to: [
      notice.recipientFirstName === null
        ? { address: notice.recipientEmail }
        : { address: notice.recipientEmail, name: notice.recipientFirstName },
    ],
    subject: rendered.subject,
    textBody: rendered.textBody,
    idempotencyKey: delivery.idempotencyKey,
  };

  let result: EmailSendResult;

  try {
    result = await provider.send(message);
  } catch (error) {
    // §35 : le provider tombe, l'objet métier reste. L'appelant décidera du
    // retry ; ici on se contente de nommer l'échec sans laisser fuir le
    // message d'origine, qui peut contenir l'adresse.
    throw new NotificationError(
      'PROVIDER_UNAVAILABLE',
      'envoi refusé par le fournisseur',
      error instanceof Error ? error.name : 'inconnu',
    );
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: NOTIFICATION_TEMPLATE_VERSION,
  };
}

export interface OrganizationInvitationDelivery {
  readonly notice: OrganizationInvitationNotice;
  /**
   * Inclut le numéro de tentative : une relance porte un nouveau jeton, et le
   * fournisseur ne doit pas la dédoublonner vers l'email de l'ancien.
   */
  readonly idempotencyKey: string;
}

/** Écrit puis envoie l'invitation d'équipe (migration 0033). */
export async function sendOrganizationInvitation(
  provider: EmailProvider,
  delivery: OrganizationInvitationDelivery,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = renderOrganizationInvitation(notice);

  let result: EmailSendResult;

  try {
    result = await provider.send({
      // Un seul destinataire : l'adresse invitée. Ni copie à l'organisation,
      // ni copie à la personne qui invite.
      to: [{ address: notice.recipientEmail }],
      subject: rendered.subject,
      textBody: rendered.textBody,
      idempotencyKey: delivery.idempotencyKey,
    });
  } catch (error) {
    throw new NotificationError(
      'PROVIDER_UNAVAILABLE',
      'envoi refusé par le fournisseur',
      error instanceof Error ? error.name : 'inconnu',
    );
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: INVITATION_TEMPLATE_VERSION,
  };
}
