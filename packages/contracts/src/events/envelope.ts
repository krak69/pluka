import { z } from 'zod';

import { ContractValidationError, toContractIssues } from '../errors.js';
import { nonEmptyStringSchema, uuidSchema } from '../primitives/ids.js';
import { jsonObjectSchema, type JsonObject } from '../primitives/json.js';
import { instantSchema } from '../primitives/time.js';
import { domainEventTypeSchema, type DomainEventType } from './names.js';

/**
 * Enveloppe d'un événement métier.
 *
 * Alignée sur `private.outbox_events` (migration 0001) : l'événement est écrit
 * dans la même transaction que la mutation, puis dispatché vers pgmq
 * (01_ARCHITECTURE §22.2, §33). Rien ne doit être publié avant le commit de la
 * transaction source.
 *
 * `payload` reste minimal — des identifiants et l'indispensable, jamais des
 * données personnelles ni le contenu d'une préparation (§23, §33, AGENTS §62).
 */
export const domainEventEnvelopeSchema = z.object({
  type: domainEventTypeSchema,

  /** Agrégat concerné, tel que persisté dans l'outbox. */
  aggregateType: nonEmptyStringSchema.nullable(),
  aggregateId: uuidSchema.nullable(),

  payload: jsonObjectSchema,

  /**
   * Clé d'idempotence du dispatch : un retry ne doit pas publier deux fois le
   * même événement (01_ARCHITECTURE §22.1, AGENTS §32).
   */
  idempotencyKey: nonEmptyStringSchema.nullable(),

  occurredAt: instantSchema,
});

export type DomainEventEnvelope = z.infer<typeof domainEventEnvelopeSchema>;

/**
 * Déclaration typée d'un événement.
 *
 * `01_ARCHITECTURE.md` §23 fige les *noms* et la règle de minimalité, pas le
 * contenu de chaque payload. Chaque lot déclare le sien au moment où la donnée
 * est décidée, plutôt que de laisser ce paquet deviner une forme
 * (AGENTS §9, §103).
 */
export interface DomainEventDefinition<TType extends DomainEventType, TPayload> {
  readonly type: TType;
  readonly payloadSchema: z.ZodType<TPayload>;
}

export function defineDomainEvent<TType extends DomainEventType, TPayload>(
  type: TType,
  payloadSchema: z.ZodType<TPayload>,
): DomainEventDefinition<TType, TPayload> {
  return { type, payloadSchema };
}

export interface DomainEvent<TType extends DomainEventType, TPayload> {
  readonly type: TType;
  readonly aggregateType: string | null;
  readonly aggregateId: string | null;
  readonly payload: TPayload;
  readonly idempotencyKey: string | null;
  readonly occurredAt: string;
}

/**
 * Relit une enveloppe issue de l'outbox et valide son payload.
 *
 * Deux échecs distincts, jamais silencieux : enveloppe non conforme, ou
 * événement d'un autre type que celui attendu par le consommateur.
 */
export function parseDomainEvent<TType extends DomainEventType, TPayload>(
  definition: DomainEventDefinition<TType, TPayload>,
  value: unknown,
): DomainEvent<TType, TPayload> {
  const envelope = domainEventEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    throw new ContractValidationError(
      `événement ${definition.type}`,
      toContractIssues(envelope.error),
    );
  }

  if (envelope.data.type !== definition.type) {
    throw new ContractValidationError(`événement ${definition.type}`, [
      { path: 'type', message: `événement ${envelope.data.type} reçu` },
    ]);
  }

  const payload = definition.payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) {
    throw new ContractValidationError(
      `payload ${definition.type}`,
      toContractIssues(payload.error),
    );
  }

  return {
    type: definition.type,
    aggregateType: envelope.data.aggregateType,
    aggregateId: envelope.data.aggregateId,
    payload: payload.data,
    idempotencyKey: envelope.data.idempotencyKey,
    occurredAt: envelope.data.occurredAt,
  };
}

/** Construit une enveloppe valide à partir d'une déclaration typée. */
export function createDomainEventEnvelope<TType extends DomainEventType, TPayload>(
  definition: DomainEventDefinition<TType, TPayload>,
  input: {
    readonly aggregateType: string | null;
    readonly aggregateId: string | null;
    readonly payload: TPayload;
    readonly idempotencyKey: string | null;
    readonly occurredAt: string;
  },
): DomainEventEnvelope {
  const payload = definition.payloadSchema.safeParse(input.payload);
  if (!payload.success) {
    throw new ContractValidationError(
      `payload ${definition.type}`,
      toContractIssues(payload.error),
    );
  }

  const jsonPayload = jsonObjectSchema.safeParse(payload.data);
  if (!jsonPayload.success) {
    throw new ContractValidationError(`payload ${definition.type}`, [
      { path: 'payload', message: 'payload non sérialisable en jsonb' },
    ]);
  }

  return domainEventEnvelopeSchema.parse({
    type: definition.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: jsonPayload.data satisfies JsonObject,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
  });
}
