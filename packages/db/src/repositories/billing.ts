import { mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository } from '../repository.js';
import type { PlukaClient } from '../types.js';

/*
 * Achat d'un Race Pass — migration 0088.
 *
 * Le repository traduit des lignes ; les décisions sont en base : la
 * couverture, le tarif applicable à l'heure de la base, l'attribution du canal
 * A, l'idempotence du webhook. Aucun prix ne traverse ce fichier dans le sens
 * client → base.
 */

export type RacePassCoverage = 'race_pass' | 'organizer_included' | 'plus';

export interface RacePassOfferRecord {
  readonly coverage: RacePassCoverage | null;
  /** Jour civil de référence, AAAA-MM-JJ, dans le fuseau de la course. */
  readonly registrationDay: string;
  readonly registrationOrigin: 'verified' | 'declared';
  readonly raceStart: string | null;
  readonly raceTimeZone: string;
  readonly standardAmountMinor: number | null;
  readonly earlyAmountMinor: number | null;
  readonly currency: string;
  readonly pendingPurchaseId: string | null;
}

/** PLUKA+ tel que le catalogue le décrit, et s'il couvre déjà le coureur (0090). */
export interface PlusOfferRecord {
  /** Nul quand le produit est inactif au catalogue. */
  readonly amountMinor: number | null;
  readonly currency: string;
  readonly active: boolean;
}

export interface StartedPurchaseRecord {
  readonly purchaseId: string;
  readonly productKey: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** Un achat déjà en attente a été repris. */
  readonly reused: boolean;
}

export interface PurchaseStatusRecord {
  readonly status: 'pending' | 'paid' | 'refunded' | 'failed' | 'cancelled';
  readonly productKey: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly participantRaceId: string | null;
  /** Payé alors que la course était déjà couverte : à rembourser. */
  readonly conflict: boolean;
  readonly provider: string;
  readonly checkoutReference: string | null;
}

/** Ce que le webhook vérifié transmet à la base. */
export interface CheckoutEventInput {
  readonly provider: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadHash: string | null;
  readonly checkoutReference: string;
  readonly paymentReference: string | null;
  readonly outcome: 'paid' | 'failed' | 'cancelled';
  readonly occurredAt: string;
}

export type CheckoutEventResult =
  | 'granted'
  | 'conflict'
  | 'duplicate'
  | 'unknown_purchase'
  | 'already_settled'
  | 'failed'
  | 'cancelled';

/** Les lectures et écritures du coureur, sous sa session. */
export interface BillingRepository {
  offer(participantRaceId: string): Promise<RacePassOfferRecord>;
  plusOffer(): Promise<PlusOfferRecord>;
  startRacePass(participantRaceId: string, provider: string): Promise<StartedPurchaseRecord>;
  setCheckoutReference(purchaseId: string, reference: string): Promise<void>;
  purchase(purchaseId: string): Promise<PurchaseStatusRecord | null>;
}

/** La confirmation, sous la clé de service, après vérification de la signature. */
export interface BillingWebhookRepository {
  recordCheckoutEvent(event: CheckoutEventInput): Promise<CheckoutEventResult>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function call(client: PlukaClient, operation: string, args: Record<string, unknown>) {
  const result = await (client as unknown as RpcCapableClient).rpc(operation, args);
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }
  return result.data;
}

function firstRow(data: unknown): Record<string, unknown> | undefined {
  return (Array.isArray(data) ? data[0] : undefined) as Record<string, unknown> | undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export const billingRepository = defineRepository<BillingRepository>((context) => ({
  async offer(participantRaceId) {
    const operation = 'get_race_pass_offer';
    const row = firstRow(
      await call(context.client, operation, { p_participant_race_id: participantRaceId }),
    );
    if (row === undefined) throw new Error(`${operation} : aucune ligne`);

    const coverage = row['coverage'];

    return {
      coverage:
        coverage === 'race_pass' || coverage === 'organizer_included' || coverage === 'plus'
          ? coverage
          : null,
      registrationDay: String(row['registration_day']),
      registrationOrigin: row['registration_origin'] === 'verified' ? 'verified' : 'declared',
      raceStart: textOrNull(row['race_start']),
      raceTimeZone: String(row['race_timezone']),
      standardAmountMinor: numberOrNull(row['standard_amount_minor']),
      earlyAmountMinor: numberOrNull(row['early_amount_minor']),
      currency: String(row['currency'] ?? 'EUR'),
      pendingPurchaseId: textOrNull(row['pending_purchase_id']),
    };
  },

  async plusOffer() {
    const operation = 'get_plus_offer';
    const row = firstRow(await call(context.client, operation, {}));
    if (row === undefined) throw new Error(`${operation} : aucune ligne`);
    return {
      amountMinor: numberOrNull(row['amount_minor']),
      currency: String(row['currency'] ?? 'EUR'),
      active: row['active'] === true,
    };
  },

  async startRacePass(participantRaceId, provider) {
    const operation = 'start_race_pass_purchase';
    const row = firstRow(
      await call(context.client, operation, {
        p_participant_race_id: participantRaceId,
        p_provider: provider,
      }),
    );
    if (row === undefined) throw new Error(`${operation} : aucune ligne`);

    return {
      purchaseId: String(row['purchase_id']),
      productKey: String(row['product_key']),
      amountMinor: Number(row['amount_minor']),
      currency: String(row['currency']),
      reused: row['reused'] === true,
    };
  },

  async setCheckoutReference(purchaseId, reference) {
    await call(context.client, 'set_purchase_checkout_reference', {
      p_purchase_id: purchaseId,
      p_reference: reference,
    });
  },

  async purchase(purchaseId) {
    const row = firstRow(
      await call(context.client, 'get_my_purchase', { p_purchase_id: purchaseId }),
    );
    if (row === undefined) return null;

    return {
      status: String(row['status']) as PurchaseStatusRecord['status'],
      productKey: String(row['product_key']),
      amountMinor: numberOrNull(row['amount_minor']),
      currency: textOrNull(row['currency']),
      participantRaceId: textOrNull(row['participant_race_id']),
      conflict: row['conflict'] === true,
      provider: String(row['provider']),
      checkoutReference: textOrNull(row['provider_checkout_reference']),
    };
  },
}));

export const billingWebhookRepository = defineRepository<BillingWebhookRepository>((context) => ({
  async recordCheckoutEvent(event) {
    return (await call(context.client, 'billing_record_checkout_event', {
      p_provider: event.provider,
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_payload_hash: event.payloadHash,
      p_checkout_reference: event.checkoutReference,
      p_payment_reference: event.paymentReference,
      p_outcome: event.outcome,
      p_occurred_at: event.occurredAt,
    })) as CheckoutEventResult;
  },
}));

/** Le dépôt d'une livraison brute du webhook, sans session (0089). */
export interface BillingInboxRepository {
  /** Rend l'identifiant de la livraison déposée. */
  receive(provider: string, rawBody: string, signature: string): Promise<string>;
}

export const billingInboxRepository = defineRepository<BillingInboxRepository>((context) => ({
  async receive(provider, rawBody, signature) {
    return String(
      await call(context.client, 'billing_receive_webhook', {
        p_provider: provider,
        p_raw_body: rawBody,
        p_signature: signature,
      }),
    );
  },
}));
