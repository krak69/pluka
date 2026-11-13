import { createHash } from 'node:crypto';

import type {
  BillingProvider,
  BillingWebhookDelivery,
  VerifiedBillingEvent,
} from '@pluka/contracts';
import {
  DbError,
  type BillingRepository,
  type BillingInboxRepository,
  type BillingWebhookRepository,
  type CheckoutEventResult,
  type PurchaseStatusRecord,
  type RacePassCoverage,
} from '@pluka/db';
import { z } from 'zod';

import {
  conflictError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
} from '../errors.js';

import { earlyBirdWindow, isEarlyBirdEligible } from './early-bird.js';

/**
 * Acheter un Race Pass — 00_PRODUCT_SPEC §6.2, §6.5 ; 04_ENTITLEMENTS §26,
 * §70 à §73.1 ; 01_ARCHITECTURE §28.1 ; migration 0088.
 *
 * Le prestataire encaisse ; il ne décide jamais d'un droit. La base décide du
 * tarif à son heure et crée le droit à la réception d'un webhook vérifié. Le
 * domaine calcule la même offre pour l'afficher, avec l'horloge passée par
 * l'appelant (AGENTS §35) : ce qui s'affiche est ce qui sera demandé.
 */

export interface BillingContext {
  readonly repositories: { readonly billing: BillingRepository };
  /** Nul : aucun prestataire configuré, aucun paiement possible (AGENTS §37). */
  readonly provider: BillingProvider | null;
  /** Base des URL de retour du paiement. */
  readonly appUrl: string;
  readonly actor: { readonly userId: string };
}

export interface BillingWebhookContext {
  readonly repositories: { readonly billingWebhook: BillingWebhookRepository };
  readonly provider: BillingProvider;
}

export type RacePassOffer =
  | { readonly state: 'covered'; readonly coverage: RacePassCoverage }
  | {
      readonly state: 'available';
      readonly productKey: 'race_pass' | 'race_pass_early';
      readonly amountMinor: number;
      readonly currency: string;
      /** Le prix standard, pour dire ce que le tarif inscrit fait gagner. */
      readonly standardAmountMinor: number;
      /** Dernier jour du tarif inscrit (« Tarif inscrit jusqu'au … ») ; nul hors tarif. */
      readonly earlyBirdLastDay: string | null;
      readonly registrationOrigin: 'verified' | 'declared';
      readonly pendingPurchaseId: string | null;
    }
  | { readonly state: 'unavailable' };

const participationQuery = z.object({ participantRaceId: z.uuid() }).strict();

function translate(error: unknown, useCase: string): unknown {
  if (!(error instanceof DbError)) return error;
  if (error.code === 'not_found') return notFoundError(useCase, 'participation');
  if (error.code === 'permission_denied') return forbiddenError(useCase);
  if (error.code === 'conflict') {
    // 04_ENTITLEMENTS §70, §77 : une course déjà couverte ne se revend pas.
    return conflictError(useCase, 'course déjà couverte', { code: 'DUPLICATE_PURCHASE' });
  }
  return error;
}

/** L'offre d'une course, telle que la base la vendra à `now`. */
export async function getRacePassOffer(
  context: BillingContext,
  input: unknown,
  now: string,
): Promise<RacePassOffer> {
  const useCase = 'getRacePassOffer';
  const { participantRaceId } = parseCommand(participationQuery, input, useCase);

  let offer;
  try {
    offer = await context.repositories.billing.offer(participantRaceId);
  } catch (error) {
    throw translate(error, useCase);
  }

  if (offer.coverage !== null) return { state: 'covered', coverage: offer.coverage };
  if (offer.standardAmountMinor === null) return { state: 'unavailable' };

  const registration = { day: offer.registrationDay, origin: offer.registrationOrigin };
  const early =
    offer.earlyAmountMinor !== null &&
    isEarlyBirdEligible(registration, offer.raceStart, offer.raceTimeZone, now);

  return {
    state: 'available',
    productKey: early ? 'race_pass_early' : 'race_pass',
    amountMinor: early ? (offer.earlyAmountMinor ?? 0) : offer.standardAmountMinor,
    currency: offer.currency,
    standardAmountMinor: offer.standardAmountMinor,
    earlyBirdLastDay: early
      ? (earlyBirdWindow(registration, offer.raceStart, offer.raceTimeZone)?.lastDay ?? null)
      : null,
    registrationOrigin: offer.registrationOrigin,
    pendingPurchaseId: offer.pendingPurchaseId,
  };
}

/**
 * PLUKA+ sur l'écran d'offre (0090). Il n'est pas encore en vente
 * (05_ROUTES_FLOWS §12.8) : l'offre le montre, sans l'ouvrir à l'achat.
 */
export type PlusOffer =
  | { readonly state: 'active' }
  | { readonly state: 'soon'; readonly amountMinor: number; readonly currency: string }
  | { readonly state: 'unavailable' };

export async function getPlusOffer(context: BillingContext): Promise<PlusOffer> {
  const useCase = 'getPlusOffer';
  let offer;
  try {
    offer = await context.repositories.billing.plusOffer();
  } catch (error) {
    throw translate(error, useCase);
  }
  if (offer.active) return { state: 'active' };
  if (offer.amountMinor === null) return { state: 'unavailable' };
  return { state: 'soon', amountMinor: offer.amountMinor, currency: offer.currency };
}

/**
 * Ouvre la page de paiement du prestataire. Rend l'adresse où envoyer le
 * coureur. Sans prestataire configuré, refuse plutôt que de simuler un droit
 * (01_ARCHITECTURE §35, « Paiement webhook en retard »).
 */
export async function startRacePassCheckout(
  context: BillingContext,
  input: unknown,
): Promise<{ readonly purchaseId: string; readonly checkoutUrl: string }> {
  const useCase = 'startRacePassCheckout';
  const { participantRaceId } = parseCommand(participationQuery, input, useCase);

  if (context.provider === null) {
    throw invalidStateError(useCase, 'paiement indisponible', { code: 'FEATURE_DISABLED' });
  }

  let started;
  try {
    started = await context.repositories.billing.startRacePass(
      participantRaceId,
      context.provider.name,
    );
  } catch (error) {
    throw translate(error, useCase);
  }

  const base = context.appUrl.replace(/\/$/u, '');
  const session = await context.provider.createCheckoutSession({
    productKey: started.productKey,
    userId: context.actor.userId,
    // Le webhook rapproche par la référence de session ; l'achat suffit à
    // tout retrouver. Aucun prix ici : le prestataire lit le montant fixé en base.
    metadata: { purchaseId: started.purchaseId },
    successUrl: `${base}/offre/merci?achat=${started.purchaseId}`,
    cancelUrl: `${base}/offre?course=${participantRaceId}`,
    idempotencyKey: `purchase:${started.purchaseId}`,
  });

  await context.repositories.billing.setCheckoutReference(
    started.purchaseId,
    session.providerSessionId,
  );

  return { purchaseId: started.purchaseId, checkoutUrl: session.checkoutUrl };
}

/** L'état d'un achat du coureur, pour l'écran de retour. */
export async function getMyPurchase(
  context: BillingContext,
  input: unknown,
): Promise<PurchaseStatusRecord> {
  const useCase = 'getMyPurchase';
  const { purchaseId } = parseCommand(z.object({ purchaseId: z.uuid() }).strict(), input, useCase);

  const purchase = await context.repositories.billing.purchase(purchaseId);
  if (purchase === null) throw notFoundError(useCase, 'achat');
  return purchase;
}

/**
 * Les événements de fin de paiement, dans le vocabulaire du prestataire. Un
 * autre type est reçu, journalisé, et sans effet. Un adaptateur réel ajoutera
 * ici ses propres noms (ex. Stripe `checkout.session.completed`).
 */
const OUTCOME_BY_EVENT: Readonly<Record<string, 'paid' | 'failed' | 'cancelled'>> = {
  'checkout.completed': 'paid',
  'checkout.failed': 'failed',
  'checkout.cancelled': 'cancelled',
};

const checkoutPayload = z.object({
  checkoutReference: z.string().min(1).max(200),
  paymentReference: z.string().min(1).max(200).nullable().optional(),
});

export type BillingWebhookResult = CheckoutEventResult | 'ignored_event';

/**
 * Le webhook — 01_ARCHITECTURE §28.1 : « payment event → validation signature
 * → commande domaine → entitlement PLUKA ». Une signature invalide lève avant
 * toute écriture (`verifyWebhook`).
 */
export async function handleBillingWebhook(
  context: BillingWebhookContext,
  delivery: BillingWebhookDelivery,
): Promise<BillingWebhookResult> {
  const event: VerifiedBillingEvent = await context.provider.verifyWebhook(delivery);
  const outcome = OUTCOME_BY_EVENT[event.type];
  if (outcome === undefined) return 'ignored_event';

  const payload = checkoutPayload.safeParse(event.payload);
  if (!payload.success) {
    throw invalidStateError('handleBillingWebhook', 'événement de paiement illisible');
  }

  return context.repositories.billingWebhook.recordCheckoutEvent({
    provider: context.provider.name,
    eventId: event.providerEventId,
    eventType: event.type,
    payloadHash: event.payloadHash ?? createHash('sha256').update(delivery.rawBody).digest('hex'),
    checkoutReference: payload.data.checkoutReference,
    paymentReference: payload.data.paymentReference ?? null,
    outcome,
    occurredAt: event.occurredAt,
  });
}

export interface BillingInboxContext {
  readonly repositories: { readonly billingInbox: BillingInboxRepository };
}

const inboxDelivery = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/u),
  // Bornes de la boîte de réception (0089) : au-delà, la livraison est refusée.
  rawBody: z.string().min(1).max(65_536),
  signature: z.string().max(2_048),
});

/**
 * Dépose une livraison du webhook, telle quelle, pour le worker (0089). Ne
 * vérifie ni n'applique rien : la signature se vérifie là où vit la clé de
 * service, et un dépôt invalide sera rejeté là-bas.
 */
export async function receiveBillingWebhook(
  context: BillingInboxContext,
  input: unknown,
): Promise<string> {
  const delivery = parseCommand(inboxDelivery, input, 'receiveBillingWebhook');
  return context.repositories.billingInbox.receive(
    delivery.provider,
    delivery.rawBody,
    delivery.signature,
  );
}
