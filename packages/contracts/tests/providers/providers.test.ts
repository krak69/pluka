import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  aiGroundedAnswerSchema,
  aiModelDescriptorSchema,
  billingCheckoutRequestSchema,
  emailMessageSchema,
  emailSendResultSchema,
  isRetryableByDefault,
  PROVIDER_ERROR_CODES,
  parseProviderResponse,
  ProviderError,
  verifiedBillingEventSchema,
} from '../../src/index.js';

describe('erreurs provider', () => {
  it('retente ce qui est transitoire, jamais une erreur de contrat', () => {
    expect(isRetryableByDefault('timeout')).toBe(true);
    expect(isRetryableByDefault('unavailable')).toBe(true);
    expect(isRetryableByDefault('rate_limited')).toBe(true);

    expect(isRetryableByDefault('unauthorized')).toBe(false);
    expect(isRetryableByDefault('invalid_response')).toBe(false);
    expect(isRetryableByDefault('invalid_request')).toBe(false);
    expect(isRetryableByDefault('not_supported')).toBe(false);
    expect(isRetryableByDefault('unknown')).toBe(false);
  });

  it('couvre chaque code déclaré', () => {
    for (const code of PROVIDER_ERROR_CODES) {
      expect(typeof isRetryableByDefault(code)).toBe('boolean');
    }
  });

  it('porte provider, opération et code', () => {
    const error = new ProviderError({
      provider: 'fixture',
      operation: 'getForecast',
      code: 'timeout',
      message: 'délai dépassé',
    });

    expect(error.provider).toBe('fixture');
    expect(error.operation).toBe('getForecast');
    expect(error.code).toBe('timeout');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('getForecast');
  });

  it('accepte un caractère retryable explicite', () => {
    const error = new ProviderError({
      provider: 'fixture',
      operation: 'send',
      code: 'unknown',
      message: 'erreur inconnue',
      retryable: true,
    });

    expect(error.retryable).toBe(true);
  });
});

describe('parseProviderResponse', () => {
  const schema = z.object({ id: z.string(), amount: z.number() });
  const context = { provider: 'fixture', operation: 'charge' } as const;

  it('laisse passer une réponse conforme', () => {
    expect(parseProviderResponse(schema, { id: 'a', amount: 1 }, context)).toEqual({
      id: 'a',
      amount: 1,
    });
  });

  it('rejette totalement une réponse partielle', () => {
    expect(() => parseProviderResponse(schema, { id: 'a' }, context)).toThrow(ProviderError);
  });

  it('nomme les champs fautifs sans recopier la donnée reçue', () => {
    const secret = 'token-provider-a-ne-pas-loguer';

    try {
      parseProviderResponse(schema, { id: secret, amount: secret }, context);
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      const failure = error as ProviderError;
      expect(failure.code).toBe('invalid_response');
      expect(failure.retryable).toBe(false);
      expect(failure.message).toContain('amount');
      expect(failure.message).not.toContain(secret);
    }
  });
});

describe('contrat IA', () => {
  it('exige une version de prompt auditable', () => {
    expect(aiModelDescriptorSchema.safeParse({ provider: 'fixture', model: 'm1' }).success).toBe(
      false,
    );
    expect(
      aiModelDescriptorSchema.parse({ provider: 'fixture', model: 'm1', promptVersion: 'v3' })
        .promptVersion,
    ).toBe('v3');
  });

  it('accepte une réponse sourcée avec ses citations', () => {
    const answer = aiGroundedAnswerSchema.parse({
      status: 'answered',
      text: 'La barrière horaire est à 12h00.',
      citedEvidenceIds: ['chunk-12'],
    });

    expect(answer.status).toBe('answered');
  });

  it('accepte l’absence d’information comme résultat de plein droit', () => {
    expect(aiGroundedAnswerSchema.parse({ status: 'not_found' }).status).toBe('not_found');
  });

  it('refuse une réponse affirmée sans preuve ni texte', () => {
    expect(
      aiGroundedAnswerSchema.safeParse({ status: 'answered', text: '', citedEvidenceIds: ['c'] })
        .success,
    ).toBe(false);
    expect(
      aiGroundedAnswerSchema.safeParse({ status: 'answered', text: 'oui', citedEvidenceIds: [] })
        .success,
    ).toBe(false);
  });
});

describe('contrat email', () => {
  const message = {
    to: [{ address: 'coureur@exemple.test' }],
    subject: 'Votre invitation',
    textBody: 'Bonjour',
    idempotencyKey: 'invitation-42',
  };

  it('accepte un message rendu', () => {
    expect(emailMessageSchema.parse(message).to).toHaveLength(1);
  });

  it('exige une clé d’idempotence', () => {
    const { idempotencyKey: _omitted, ...withoutKey } = message;

    expect(emailMessageSchema.safeParse(withoutKey).success).toBe(false);
  });

  it('exige au moins un destinataire valide', () => {
    expect(emailMessageSchema.safeParse({ ...message, to: [] }).success).toBe(false);
    expect(
      emailMessageSchema.safeParse({ ...message, to: [{ address: 'pas-une-adresse' }] }).success,
    ).toBe(false);
  });

  it('n’accepte pas d’expéditeur : il vient de la configuration', () => {
    const parsed = emailMessageSchema.parse({ ...message, from: 'attaquant@exemple.test' });

    expect(parsed).not.toHaveProperty('from');
  });

  it('accepte un résultat sans identifiant provider', () => {
    expect(
      emailSendResultSchema.parse({
        providerMessageId: null,
        acceptedAt: '2026-09-04T05:30:00Z',
      }).providerMessageId,
    ).toBeNull();
  });
});

describe('contrat paiement', () => {
  const checkout = {
    productKey: 'race_pass',
    userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    metadata: { participantRaceId: '9a5f0e2c-1111-4d2b-8c3a-77aa0f0e1234' },
    successUrl: 'https://app.pluka.run/retour',
    cancelUrl: 'https://app.pluka.run/paywall',
    idempotencyKey: 'checkout-42',
  };

  it('identifie le produit par une clé stable', () => {
    expect(billingCheckoutRequestSchema.parse(checkout).productKey).toBe('race_pass');
  });

  it('refuse une URL de retour non http(s)', () => {
    expect(
      billingCheckoutRequestSchema.safeParse({ ...checkout, successUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
  });

  it('refuse une métadonnée non sérialisable', () => {
    expect(
      billingCheckoutRequestSchema.safeParse({ ...checkout, metadata: { cb: () => null } }).success,
    ).toBe(false);
  });

  it('exige l’identifiant d’événement qui porte l’idempotence', () => {
    const event = {
      providerEventId: 'evt_123',
      type: 'checkout.completed',
      occurredAt: '2026-09-04T05:30:00Z',
      payload: { sessionId: 'cs_123' },
    };

    expect(verifiedBillingEventSchema.parse(event).providerEventId).toBe('evt_123');

    const { providerEventId: _omitted, ...withoutId } = event;
    expect(verifiedBillingEventSchema.safeParse(withoutId).success).toBe(false);
  });

  it('refuse une empreinte de payload mal formée', () => {
    expect(
      verifiedBillingEventSchema.safeParse({
        providerEventId: 'evt_123',
        type: 'checkout.completed',
        occurredAt: '2026-09-04T05:30:00Z',
        payloadHash: 'abc',
        payload: {},
      }).success,
    ).toBe(false);
  });
});
