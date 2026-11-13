import type { BillingCheckoutRequest, BillingProvider, JsonObject } from '@pluka/contracts';
import {
  DbError,
  type BillingRepository,
  type CheckoutEventInput,
  type RacePassOfferRecord,
} from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  getPlusOffer,
  getRacePassOffer,
  handleBillingWebhook,
  startRacePassCheckout,
  type BillingContext,
} from '../src/index.js';

/** Acheter un Race Pass — 00_PRODUCT_SPEC §6.5, 04_ENTITLEMENTS §26, §70, §72.1, migration 0088. */

const PARTICIPATION = '00000000-0000-4000-8000-000000000031';
const PURCHASE = '00000000-0000-4000-8000-0000000000a1';

const OFFER: RacePassOfferRecord = {
  coverage: null,
  registrationDay: '2026-03-01',
  registrationOrigin: 'verified',
  raceStart: '2026-10-10T05:00:00Z',
  raceTimeZone: 'Europe/Paris',
  standardAmountMinor: 1490,
  earlyAmountMinor: 990,
  currency: 'EUR',
  pendingPurchaseId: null,
};

function provider(requests: BillingCheckoutRequest[] = []): BillingProvider {
  return {
    name: 'test',
    createCheckoutSession: (request) => {
      requests.push(request);
      return Promise.resolve({
        providerSessionId: 'cs_1',
        checkoutUrl: 'https://pay.test/cs_1',
      });
    },
    verifyWebhook: () => Promise.reject(new Error('non utilisé')),
  };
}

function context(
  overrides: Partial<BillingRepository> = {},
  billingProvider: BillingProvider | null = provider(),
): { context: BillingContext; references: string[] } {
  const references: string[] = [];
  return {
    references,
    context: {
      repositories: {
        billing: {
          offer: () => Promise.resolve(OFFER),
          plusOffer: () => Promise.resolve({ amountMinor: 4490, currency: 'EUR', active: false }),
          startRacePass: () =>
            Promise.resolve({
              purchaseId: PURCHASE,
              productKey: 'race_pass_early',
              amountMinor: 990,
              currency: 'EUR',
              reused: false,
            }),
          setCheckoutReference: (_id, reference) => {
            references.push(reference);
            return Promise.resolve();
          },
          purchase: () => Promise.resolve(null),
          ...overrides,
        },
      },
      provider: billingProvider,
      appUrl: 'https://app.pluka.test/',
      actor: { userId: '11111111-1111-4111-8111-111111111111' },
    },
  };
}

describe('l’offre', () => {
  it('dans la fenêtre : tarif inscrit, et son dernier jour', async () => {
    const offer = await getRacePassOffer(
      context().context,
      { participantRaceId: PARTICIPATION },
      '2026-03-10T12:00:00Z',
    );

    expect(offer).toMatchObject({
      state: 'available',
      productKey: 'race_pass_early',
      amountMinor: 990,
      standardAmountMinor: 1490,
      earlyBirdLastDay: '2026-03-16',
    });
  });

  it('après la fenêtre : tarif standard, sans date de fin', async () => {
    const offer = await getRacePassOffer(
      context().context,
      { participantRaceId: PARTICIPATION },
      '2026-03-17T12:00:00Z',
    );

    expect(offer).toMatchObject({
      productKey: 'race_pass',
      amountMinor: 1490,
      earlyBirdLastDay: null,
    });
  });

  it('une course couverte ne s’offre pas : elle dit ce qui la couvre', async () => {
    const offer = await getRacePassOffer(
      context({ offer: () => Promise.resolve({ ...OFFER, coverage: 'organizer_included' }) })
        .context,
      { participantRaceId: PARTICIPATION },
      '2026-03-10T12:00:00Z',
    );

    expect(offer).toEqual({ state: 'covered', coverage: 'organizer_included' });
  });

  it('sans prix au catalogue, rien n’est inventé', async () => {
    const offer = await getRacePassOffer(
      context({ offer: () => Promise.resolve({ ...OFFER, standardAmountMinor: null }) }).context,
      { participantRaceId: PARTICIPATION },
      '2026-03-10T12:00:00Z',
    );

    expect(offer).toEqual({ state: 'unavailable' });
  });
});

describe('commencer un achat', () => {
  it('ouvre la page du prestataire sans lui donner de prix, et garde sa référence', async () => {
    const requests: BillingCheckoutRequest[] = [];
    const { context: ctx, references } = context({}, provider(requests));

    const started = await startRacePassCheckout(ctx, { participantRaceId: PARTICIPATION });

    expect(started).toEqual({ purchaseId: PURCHASE, checkoutUrl: 'https://pay.test/cs_1' });
    expect(requests[0]).toMatchObject({
      productKey: 'race_pass_early',
      metadata: { purchaseId: PURCHASE },
      successUrl: `https://app.pluka.test/offre/merci?achat=${PURCHASE}`,
      cancelUrl: `https://app.pluka.test/offre?course=${PARTICIPATION}`,
      idempotencyKey: `purchase:${PURCHASE}`,
    });
    expect(JSON.stringify(requests[0])).not.toMatch(/990|1490/u);
    expect(references).toEqual(['cs_1']);
  });

  it('sans prestataire, refuse plutôt que de simuler un droit', async () => {
    await expect(
      startRacePassCheckout(context({}, null).context, { participantRaceId: PARTICIPATION }),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { code: 'FEATURE_DISABLED' } });
  });

  it('DUPLICATE_PURCHASE : la base refuse une course déjà couverte', async () => {
    const { context: ctx } = context({
      startRacePass: () =>
        Promise.reject(new DbError({ code: 'conflict', operation: 'start', message: 'couverte' })),
    });

    await expect(
      startRacePassCheckout(ctx, { participantRaceId: PARTICIPATION }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'DUPLICATE_PURCHASE' } });
  });

  it('refuse une participation mal formée avant tout appel', async () => {
    await expect(
      startRacePassCheckout(context().context, { participantRaceId: 'x' }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('le webhook', () => {
  function webhookProvider(type: string, payload: JsonObject): BillingProvider {
    return {
      name: 'test',
      createCheckoutSession: () => Promise.reject(new Error('non utilisé')),
      verifyWebhook: () =>
        Promise.resolve({
          providerEventId: 'evt_1',
          type,
          occurredAt: '2026-03-10T12:00:00Z',
          payload,
        }),
    };
  }

  function recorder() {
    const events: CheckoutEventInput[] = [];
    return {
      events,
      repository: {
        recordCheckoutEvent: (event: CheckoutEventInput) => {
          events.push(event);
          return Promise.resolve('granted' as const);
        },
      },
    };
  }

  it('un paiement réussi devient une commande de la base, jamais un droit écrit ici', async () => {
    const { events, repository } = recorder();

    const result = await handleBillingWebhook(
      {
        repositories: { billingWebhook: repository },
        provider: webhookProvider('checkout.completed', {
          checkoutReference: 'cs_1',
          paymentReference: 'pi_1',
        }),
      },
      { rawBody: '{}', signature: 'sig' },
    );

    expect(result).toBe('granted');
    expect(events[0]).toMatchObject({
      provider: 'test',
      eventId: 'evt_1',
      checkoutReference: 'cs_1',
      paymentReference: 'pi_1',
      outcome: 'paid',
    });
    expect(events[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('un événement d’un autre type est reçu sans effet', async () => {
    const { events, repository } = recorder();

    await expect(
      handleBillingWebhook(
        {
          repositories: { billingWebhook: repository },
          provider: webhookProvider('customer.updated', {}),
        },
        { rawBody: '{}', signature: 'sig' },
      ),
    ).resolves.toBe('ignored_event');
    expect(events).toEqual([]);
  });

  it('une signature refusée n’atteint jamais la base', async () => {
    const { events, repository } = recorder();
    const refusing: BillingProvider = {
      name: 'test',
      createCheckoutSession: () => Promise.reject(new Error('non utilisé')),
      verifyWebhook: () => Promise.reject(new Error('unauthorized')),
    };

    await expect(
      handleBillingWebhook(
        { repositories: { billingWebhook: repository }, provider: refusing },
        { rawBody: '{}', signature: 'fausse' },
      ),
    ).rejects.toThrow('unauthorized');
    expect(events).toEqual([]);
  });
});

describe('getPlusOffer', () => {
  it('montre PLUKA+ au prix du catalogue, sans l’ouvrir à l’achat', async () => {
    expect(await getPlusOffer(context().context)).toEqual({
      state: 'soon',
      amountMinor: 4490,
      currency: 'EUR',
    });
  });

  it('dit qu’un PLUKA+ actif couvre déjà le coureur', async () => {
    const offer = await getPlusOffer(
      context({
        plusOffer: () => Promise.resolve({ amountMinor: 4490, currency: 'EUR', active: true }),
      }).context,
    );
    expect(offer).toEqual({ state: 'active' });
  });

  it('ne montre pas de prix quand le produit est inactif', async () => {
    const offer = await getPlusOffer(
      context({
        plusOffer: () => Promise.resolve({ amountMinor: null, currency: 'EUR', active: false }),
      }).context,
    );
    expect(offer).toEqual({ state: 'unavailable' });
  });
});
