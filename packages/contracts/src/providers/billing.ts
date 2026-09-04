import { z } from 'zod';

import { nonEmptyStringSchema, sha256HexSchema, uuidSchema } from '../primitives/ids.js';
import { jsonObjectSchema } from '../primitives/json.js';
import { instantSchema } from '../primitives/time.js';
import { httpUrlSchema } from '../primitives/url.js';

/**
 * Contrat provider de paiement — `01_ARCHITECTURE.md` §28.1,
 * `04_ENTITLEMENTS.md` §25 à §26.
 *
 * Le provider encaisse ; il ne décide jamais d'un droit. Le droit applicatif est
 * créé par le domaine après confirmation serveur, et stocké dans PLUKA
 * (01_ARCHITECTURE §11, ACCEPTANCE AC-ENT-12, AC-FAIL-04).
 */
export const billingCheckoutRequestSchema = z.object({
  /**
   * Clé produit stable (`race_pass`, `plus_annual`…), jamais un prix
   * (ACCEPTANCE AC-BILL-01). Le catalogue lui-même appartient au domaine des
   * entitlements : ce contrat ne transporte qu'une clé opaque.
   */
  productKey: nonEmptyStringSchema,
  userId: uuidSchema,

  /**
   * Attribution renvoyée telle quelle par le webhook — par exemple le
   * `participantRaceId` d'un Race Pass. C'est le domaine qui décide de la portée
   * du droit, pas le provider (ACCEPTANCE AC-ENT-02 à AC-ENT-04).
   */
  metadata: jsonObjectSchema,

  successUrl: httpUrlSchema,
  cancelUrl: httpUrlSchema,
  idempotencyKey: nonEmptyStringSchema,
});

export type BillingCheckoutRequest = z.infer<typeof billingCheckoutRequestSchema>;

export const billingCheckoutSessionSchema = z.object({
  providerSessionId: nonEmptyStringSchema,
  checkoutUrl: httpUrlSchema,
});

export type BillingCheckoutSession = z.infer<typeof billingCheckoutSessionSchema>;

/**
 * Charge brute du webhook.
 *
 * La signature se vérifie sur le corps brut : le corps ne doit pas être
 * re-sérialisé avant contrôle. Le secret de signature reste dans l'adapter.
 */
export interface BillingWebhookDelivery {
  readonly rawBody: string;
  readonly signature: string;
}

/**
 * Événement provider vérifié.
 *
 * `providerEventId` porte l'idempotence : le même événement reçu deux fois ne
 * crée pas deux droits (`04_ENTITLEMENTS.md` §26, ACCEPTANCE AC-BILL-02). Il est
 * persisté dans `private.billing_webhook_events`.
 *
 * `type` reste le vocabulaire du provider ; sa traduction en commande métier
 * appartient au domaine.
 */
export const verifiedBillingEventSchema = z.object({
  providerEventId: nonEmptyStringSchema,
  type: nonEmptyStringSchema,
  occurredAt: instantSchema,
  payloadHash: sha256HexSchema.optional(),
  payload: jsonObjectSchema,
});

export type VerifiedBillingEvent = z.infer<typeof verifiedBillingEventSchema>;

export interface BillingProvider {
  readonly name: string;

  createCheckoutSession(request: BillingCheckoutRequest): Promise<BillingCheckoutSession>;

  /**
   * Vérifie la signature et normalise l'événement.
   *
   * Une signature invalide lève `ProviderError('unauthorized')` : un webhook non
   * vérifié n'entre jamais dans le domaine (01_ARCHITECTURE §28.1,
   * ACCEPTANCE NO GO §67.19).
   */
  verifyWebhook(delivery: BillingWebhookDelivery): Promise<VerifiedBillingEvent>;
}
