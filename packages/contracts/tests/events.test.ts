import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ContractValidationError,
  createDomainEventEnvelope,
  defineDomainEvent,
  DOMAIN_EVENT_TYPES,
  domainEventEnvelopeSchema,
  domainEventTypeSchema,
  parseDomainEvent,
} from '../src/index.js';

const RACE_PLAN_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const planUpdated = defineDomainEvent(
  'plan.updated',
  z.object({ racePlanId: z.uuid(), version: z.number().int().positive() }),
);

const validEnvelope = {
  type: 'plan.updated',
  aggregateType: 'race_plan',
  aggregateId: RACE_PLAN_ID,
  payload: { racePlanId: RACE_PLAN_ID, version: 2 },
  idempotencyKey: 'plan-updated-2',
  occurredAt: '2026-09-04T05:30:00Z',
};

describe('catalogue d’événements', () => {
  it('correspond à 01_ARCHITECTURE §23', () => {
    expect([...DOMAIN_EVENT_TYPES]).toEqual([
      'race.fact.published',
      'race.official_notice.published',
      'race.course_geometry.updated',
      'participant.imported',
      'participant.invited',
      'participant.activated',
      'plan.generated',
      'plan.updated',
      'nutrition.updated',
      'preparation.updated',
      'assistance.configured',
      'outing.created',
      'weather.updated',
      'pluka.question.asked',
      'postrace.completed',
    ]);
  });

  it('refuse un type hors catalogue', () => {
    expect(domainEventTypeSchema.safeParse('plan.deleted').success).toBe(false);
  });
});

describe('enveloppe', () => {
  it('accepte une enveloppe alignée sur private.outbox_events', () => {
    const envelope = domainEventEnvelopeSchema.parse(validEnvelope);

    expect(envelope.aggregateId).toBe(RACE_PLAN_ID);
    expect(envelope.idempotencyKey).toBe('plan-updated-2');
  });

  it('accepte un agrégat et une clé d’idempotence absents, comme la colonne', () => {
    const envelope = domainEventEnvelopeSchema.parse({
      ...validEnvelope,
      aggregateType: null,
      aggregateId: null,
      idempotencyKey: null,
    });

    expect(envelope.aggregateId).toBeNull();
  });

  it.each([
    ['identifiant d’agrégat non UUID', { aggregateId: 'race-plan-2' }],
    ['instant sans fuseau', { occurredAt: '2026-09-04T05:30:00' }],
    ['payload non sérialisable', { payload: { cb: () => null } }],
    ['payload tableau', { payload: [] }],
  ])('refuse une enveloppe invalide : %s', (_label, override) => {
    expect(domainEventEnvelopeSchema.safeParse({ ...validEnvelope, ...override }).success).toBe(
      false,
    );
  });
});

describe('parseDomainEvent', () => {
  it('valide l’enveloppe puis le payload déclaré', () => {
    const event = parseDomainEvent(planUpdated, validEnvelope);

    expect(event.type).toBe('plan.updated');
    expect(event.payload.version).toBe(2);
    expect(event.occurredAt).toBe('2026-09-04T05:30:00Z');
  });

  it('refuse un événement d’un autre type', () => {
    try {
      parseDomainEvent(planUpdated, { ...validEnvelope, type: 'plan.generated' });
      expect.unreachable('le type divergent aurait dû être refusé');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).issues).toEqual([
        { path: 'type', message: 'événement plan.generated reçu' },
      ]);
    }
  });

  it('refuse un payload qui ne respecte pas la déclaration', () => {
    try {
      parseDomainEvent(planUpdated, { ...validEnvelope, payload: { racePlanId: RACE_PLAN_ID } });
      expect.unreachable('le payload incomplet aurait dû être refusé');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).issues[0]?.path).toBe('version');
    }
  });

  it('ne recopie pas la donnée reçue dans le message', () => {
    const secret = 'contenu-prive-a-ne-pas-loguer';

    try {
      parseDomainEvent(planUpdated, {
        ...validEnvelope,
        payload: { racePlanId: secret, version: 2 },
      });
      expect.unreachable('le payload invalide aurait dû être refusé');
    } catch (error) {
      expect((error as ContractValidationError).message).not.toContain(secret);
    }
  });
});

describe('createDomainEventEnvelope', () => {
  it('construit une enveloppe valide', () => {
    const envelope = createDomainEventEnvelope(planUpdated, {
      aggregateType: 'race_plan',
      aggregateId: RACE_PLAN_ID,
      payload: { racePlanId: RACE_PLAN_ID, version: 3 },
      idempotencyKey: 'plan-updated-3',
      occurredAt: '2026-09-04T05:30:00Z',
    });

    expect(envelope.type).toBe('plan.updated');
    expect(envelope.payload).toEqual({ racePlanId: RACE_PLAN_ID, version: 3 });
    expect(parseDomainEvent(planUpdated, envelope).payload.version).toBe(3);
  });

  it('refuse de construire un événement au payload invalide', () => {
    expect(() =>
      createDomainEventEnvelope(planUpdated, {
        aggregateType: 'race_plan',
        aggregateId: RACE_PLAN_ID,
        payload: { racePlanId: RACE_PLAN_ID, version: 0 },
        idempotencyKey: null,
        occurredAt: '2026-09-04T05:30:00Z',
      }),
    ).toThrow(ContractValidationError);
  });
});
