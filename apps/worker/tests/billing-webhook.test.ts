import { createHmac } from 'node:crypto';

import type { CheckoutEventInput } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import { createBilling } from '../src/billing/index.js';
import { handleBillingWebhookMessage } from '../src/jobs/billing-webhook.js';
import type { BillingWebhookDeliveryRecord, QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Le webhook de paiement, vérifié et appliqué par le worker — 01_ARCHITECTURE
 * §28.1, migrations 0088 et 0089.
 */

const SECRET = 'secret-de-test';
const ID = '00000000-0000-4000-8000-0000000000b1';

function signed(body: object, secret = SECRET): BillingWebhookDeliveryRecord {
  const rawBody = JSON.stringify(body);
  return {
    provider: 'test',
    rawBody,
    signature: createHmac('sha256', secret).update(rawBody).digest('hex'),
  };
}

const COMPLETED = {
  id: 'evt_1',
  type: 'checkout.completed',
  occurredAt: '2026-11-12T10:00:00Z',
  data: { checkoutReference: 'cs_test_1', paymentReference: 'pay_1' },
};

function setup(
  delivery: BillingWebhookDeliveryRecord | null,
  options: { provider?: 'test' | 'none'; recordFails?: boolean } = {},
) {
  const settled: { status: string; result: string }[] = [];
  const recorded: CheckoutEventInput[] = [];
  const ports = {
    billing: {
      provider:
        options.provider === 'none'
          ? null
          : createBilling({ BILLING_PROVIDER: 'test', BILLING_WEBHOOK_SECRET: SECRET }),
      inbox: {
        claim: () => Promise.resolve(delivery),
        settle: (_id: string, status: string, result: string) => {
          settled.push({ status, result });
          return Promise.resolve();
        },
      },
      webhook: {
        recordCheckoutEvent: (event: CheckoutEventInput) => {
          if (options.recordFails === true) return Promise.reject(new Error('base indisponible'));
          recorded.push(event);
          return Promise.resolve('granted' as const);
        },
      },
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  } as unknown as WorkerPorts;

  const message: QueueMessage = { msgId: 1, readCount: 1, payload: { billingWebhookId: ID } };
  return { ports, message, settled, recorded };
}

describe('webhook de paiement', () => {
  it('une signature valide confirme le paiement en base', async () => {
    const { ports, message, settled, recorded } = setup(signed(COMPLETED));

    await expect(handleBillingWebhookMessage(ports, message)).resolves.toEqual({
      kind: 'processed',
      result: 'granted',
    });
    expect(recorded[0]).toMatchObject({
      provider: 'test',
      eventId: 'evt_1',
      checkoutReference: 'cs_test_1',
      outcome: 'paid',
    });
    expect(settled).toEqual([{ status: 'processed', result: 'granted' }]);
  });

  it('une signature fausse est rejetée pour de bon, sans toucher à l’achat', async () => {
    const { ports, message, settled, recorded } = setup(signed(COMPLETED, 'autre-secret'));

    await expect(handleBillingWebhookMessage(ports, message)).resolves.toEqual({
      kind: 'rejected',
      code: 'SIGNATURE',
    });
    expect(recorded).toEqual([]);
    expect(settled).toEqual([{ status: 'rejected', result: 'SIGNATURE' }]);
  });

  it('un corps modifié après signature est rejeté', async () => {
    const delivery = signed(COMPLETED);
    const { ports, message, recorded } = setup({
      ...delivery,
      rawBody: delivery.rawBody.replace('cs_test_1', 'cs_test_2'),
    });

    await expect(handleBillingWebhookMessage(ports, message)).resolves.toMatchObject({
      kind: 'rejected',
    });
    expect(recorded).toEqual([]);
  });

  it('sans prestataire configuré, la livraison attend en boîte', async () => {
    const { ports, message, settled } = setup(signed(COMPLETED), { provider: 'none' });

    await expect(handleBillingWebhookMessage(ports, message)).resolves.toEqual({
      kind: 'retry',
      code: 'BILLING_NOT_CONFIGURED',
    });
    expect(settled).toEqual([]);
  });

  it('une livraison d’un autre prestataire est rejetée', async () => {
    const { ports, message } = setup({ ...signed(COMPLETED), provider: 'stripe' });

    await expect(handleBillingWebhookMessage(ports, message)).resolves.toEqual({
      kind: 'rejected',
      code: 'PROVIDER_MISMATCH',
    });
  });

  it('une livraison déjà traitée ne se rejoue pas', async () => {
    const { ports, message } = setup(null);

    await expect(handleBillingWebhookMessage(ports, message)).resolves.toEqual({
      kind: 'already_done',
    });
  });

  it('une panne de la base se retente : la confirmation est idempotente', async () => {
    const { ports, message, settled } = setup(signed(COMPLETED), { recordFails: true });

    await expect(handleBillingWebhookMessage(ports, message)).resolves.toMatchObject({
      kind: 'retry',
    });
    expect(settled).toEqual([]);
  });

  it('le prestataire de test est refusé en production', () => {
    expect(
      createBilling({
        BILLING_PROVIDER: 'test',
        BILLING_WEBHOOK_SECRET: SECRET,
        NODE_ENV: 'production',
      }),
    ).toBeNull();
  });
});
