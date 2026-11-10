import type { EmailMessage, EmailProvider, EmailSendResult } from '@pluka/contracts';

import {
  renderAccountInactivityNotice,
  type AccountInactivityNotice,
} from './templates/account-inactivity.js';
import { renderChangeImpactNotice, type ChangeImpactNotice } from './templates/change-impact.js';
import { renderStartChangedNotice, type StartChangedNotice } from './templates/start-changed.js';
import {
  renderOrganizationInvitation,
  type OrganizationInvitationNotice,
} from './templates/organization-invitation.js';
import {
  renderRaceCancelledNotice,
  renderRaceReinstatedNotice,
  type RaceStatusNotice,
  type RenderedRaceStatusNotice,
} from './templates/race-reinstated.js';
import {
  renderParticipantInvitation,
  type ParticipantInvitationNotice,
} from './templates/participant-invitation.js';
import { renderStaffInvitation, type StaffInvitationNotice } from './templates/staff-invitation.js';
import {
  renderEventSiteContact,
  type EventSiteContactNotice,
} from './templates/event-site-contact.js';

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

export const RACE_REINSTATED_TEMPLATE_VERSION = 'race-reinstated-1.0.0';

export const RACE_CANCELLED_TEMPLATE_VERSION = 'race-cancelled-1.0.0';

export const INVITATION_TEMPLATE_VERSION = 'organization-invitation-1.0.0';

export const STAFF_INVITATION_TEMPLATE_VERSION = 'staff-invitation-1.0.0';

export const PARTICIPANT_INVITATION_TEMPLATE_VERSION = 'participant-invitation-1.0.0';

export const EVENT_SITE_CONTACT_TEMPLATE_VERSION = 'event-site-contact-1.0.0';

export const ACCOUNT_INACTIVITY_TEMPLATE_VERSION = 'account-inactivity-1.0.0';

export const START_CHANGED_TEMPLATE_VERSION = 'start-changed-1.0.0';

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

/**
 * Ne guériront pas au prochain essai : une adresse invalide, et un refus que le
 * fournisseur dit définitif (expéditeur non autorisé, destinataire refusé).
 */
const PERMANENT_CODES = new Set<NotificationErrorCode>(['RECIPIENT_INVALID', 'PROVIDER_REJECTED']);

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
 * L'échec d'un fournisseur, nommé sans laisser fuir son message d'origine, qui
 * peut contenir l'adresse.
 *
 * Deux choses en sont gardées, parce qu'elles décident de la suite : le statut
 * HTTP s'il y en a un, et le caractère définitif que l'adapter a signalé
 * (`kind = 'permanent'`). Sans elles, un expéditeur refusé était retenté cinq
 * fois et l'écran ne pouvait pas dire pourquoi. Le contrat `EmailProvider` ne
 * type pas ses erreurs : la forme est lue, jamais supposée.
 */
function providerFailure(error: unknown): NotificationError {
  const kind =
    typeof error === 'object' && error !== null && 'kind' in error
      ? (error as { readonly kind: unknown }).kind
      : undefined;
  const status = error instanceof Error ? /\b([45]\d\d)\b/u.exec(error.message)?.[1] : undefined;
  const reason =
    status === undefined ? 'envoi refusé par le fournisseur' : `réponse ${status} du fournisseur`;
  const detail = error instanceof Error ? error.name : 'inconnu';

  return kind === 'permanent'
    ? new NotificationError('PROVIDER_REJECTED', reason, detail)
    : new NotificationError('PROVIDER_UNAVAILABLE', reason, detail);
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
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: NOTIFICATION_TEMPLATE_VERSION,
  };
}

export interface RaceStatusDelivery {
  readonly notice: RaceStatusNotice;
  readonly idempotencyKey: string;
}

/** Écrit puis envoie l'avis d'annulation d'une course (§4.1). */
export function sendRaceCancelledNotice(
  provider: EmailProvider,
  delivery: RaceStatusDelivery,
): Promise<NotificationSent> {
  return sendRaceStatusNotice(
    provider,
    delivery,
    renderRaceCancelledNotice,
    RACE_CANCELLED_TEMPLATE_VERSION,
  );
}

/** Écrit puis envoie l'avis de rétablissement d'une course annulée (§4.1). */
export function sendRaceReinstatedNotice(
  provider: EmailProvider,
  delivery: RaceStatusDelivery,
): Promise<NotificationSent> {
  return sendRaceStatusNotice(
    provider,
    delivery,
    renderRaceReinstatedNotice,
    RACE_REINSTATED_TEMPLATE_VERSION,
  );
}

async function sendRaceStatusNotice(
  provider: EmailProvider,
  delivery: RaceStatusDelivery,
  render: (notice: RaceStatusNotice) => RenderedRaceStatusNotice,
  templateVersion: string,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = render(notice);
  let result: EmailSendResult;

  try {
    result = await provider.send({
      // Un seul destinataire : l'organisation ne reçoit rien (§37).
      to: [
        notice.recipientFirstName === null
          ? { address: notice.recipientEmail }
          : { address: notice.recipientEmail, name: notice.recipientFirstName },
      ],
      subject: rendered.subject,
      textBody: rendered.textBody,
      idempotencyKey: delivery.idempotencyKey,
    });
  } catch (error) {
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion,
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
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: INVITATION_TEMPLATE_VERSION,
  };
}

export interface ParticipantInvitationDelivery {
  readonly notice: ParticipantInvitationNotice;
  /** Inclut le numéro de tentative : une relance porte un nouveau jeton. */
  readonly idempotencyKey: string;
}

/** Écrit puis envoie l'invitation d'un participant (migration 0069). */
export async function sendParticipantInvitation(
  provider: EmailProvider,
  delivery: ParticipantInvitationDelivery,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = renderParticipantInvitation(notice);
  let result: EmailSendResult;

  try {
    result = await provider.send({
      // Un seul destinataire : l'adresse invitée. L'organisation ne reçoit rien.
      to: [
        notice.recipientFirstName === null
          ? { address: notice.recipientEmail }
          : { address: notice.recipientEmail, name: notice.recipientFirstName },
      ],
      subject: rendered.subject,
      textBody: rendered.textBody,
      idempotencyKey: delivery.idempotencyKey,
    });
  } catch (error) {
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: PARTICIPANT_INVITATION_TEMPLATE_VERSION,
  };
}

export interface StaffInvitationDelivery {
  readonly notice: StaffInvitationNotice;
  /** Inclut le numéro de tentative, comme l'invitation d'organisation. */
  readonly idempotencyKey: string;
}

/** Écrit puis envoie l'invitation à l'équipe PLUKA (migration 0036). */
export async function sendStaffInvitation(
  provider: EmailProvider,
  delivery: StaffInvitationDelivery,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = renderStaffInvitation(notice);
  let result: EmailSendResult;

  try {
    result = await provider.send({
      to: [{ address: notice.recipientEmail }],
      subject: rendered.subject,
      textBody: rendered.textBody,
      idempotencyKey: delivery.idempotencyKey,
    });
  } catch (error) {
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: STAFF_INVITATION_TEMPLATE_VERSION,
  };
}

export interface EventSiteContactDelivery {
  readonly idempotencyKey: string;
  readonly notice: EventSiteContactNotice;
}

/**
 * Le message d'un coureur à l'organisation, depuis le site (EVENT_SITE §6).
 *
 * Une adresse d'expéditeur inexploitable ne bloque pas l'envoi : l'organisation
 * reçoit le message, sans `Reply-To`. Un destinataire inexploitable, si.
 */
export async function sendEventSiteContact(
  provider: EmailProvider,
  delivery: EventSiteContactDelivery,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = renderEventSiteContact(notice);
  const message: EmailMessage = {
    to: [{ address: notice.recipientEmail }],
    subject: rendered.subject,
    textBody: rendered.textBody,
    idempotencyKey: delivery.idempotencyKey,
    ...(isPlausibleAddress(notice.senderEmail)
      ? {
          replyTo: {
            address: notice.senderEmail,
            // Un nom saisi par un visiteur entre dans un en-tête : jamais de saut de ligne.
            name: notice.senderName.replace(/[\r\n\t"<>]+/gu, ' ').trim() || 'Coureur',
          },
        }
      : {}),
  };

  let result: EmailSendResult;
  try {
    result = await provider.send(message);
  } catch (error) {
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: EVENT_SITE_CONTACT_TEMPLATE_VERSION,
  };
}

export interface AccountInactivityDelivery {
  readonly idempotencyKey: string;
  readonly notice: AccountInactivityNotice;
}

/** Prévient un coureur inactif, 30 jours avant la suppression de son compte (0079). */
export async function sendAccountInactivityNotice(
  provider: EmailProvider,
  delivery: AccountInactivityDelivery,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = renderAccountInactivityNotice(notice);
  let result: EmailSendResult;
  try {
    result = await provider.send({
      to: [
        notice.recipientFirstName === null
          ? { address: notice.recipientEmail }
          : { address: notice.recipientEmail, name: notice.recipientFirstName },
      ],
      subject: rendered.subject,
      textBody: rendered.textBody,
      idempotencyKey: delivery.idempotencyKey,
    });
  } catch (error) {
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: ACCOUNT_INACTIVITY_TEMPLATE_VERSION,
  };
}

export interface StartChangedDelivery {
  readonly idempotencyKey: string;
  readonly notice: StartChangedNotice;
}

/** Prévient un coureur que son heure de départ change (0082). */
export async function sendStartChangedNotice(
  provider: EmailProvider,
  delivery: StartChangedDelivery,
): Promise<NotificationSent> {
  const { notice } = delivery;

  if (!isPlausibleAddress(notice.recipientEmail)) {
    throw new NotificationError('RECIPIENT_INVALID', 'adresse destinataire inexploitable');
  }

  const rendered = renderStartChangedNotice(notice);
  let result: EmailSendResult;
  try {
    result = await provider.send({
      to: [
        notice.recipientFirstName === null
          ? { address: notice.recipientEmail }
          : { address: notice.recipientEmail, name: notice.recipientFirstName },
      ],
      subject: rendered.subject,
      textBody: rendered.textBody,
      idempotencyKey: delivery.idempotencyKey,
    });
  } catch (error) {
    throw providerFailure(error);
  }

  return {
    provider: provider.name,
    providerMessageId: result.providerMessageId,
    acceptedAt: result.acceptedAt,
    templateVersion: START_CHANGED_TEMPLATE_VERSION,
  };
}
