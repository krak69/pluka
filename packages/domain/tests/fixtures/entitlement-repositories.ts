import type {
  BetaAccessGrantRecord,
  EntitlementRecord,
  EntitlementRepositories,
  RecordUsageInput,
} from '@pluka/db';

import {
  createFakeParticipationRepositories,
  type ParticipationState,
} from './participation-repositories.js';

/**
 * Repositories de droits commerciaux en mémoire.
 *
 * Ils implémentent les mêmes interfaces que `@pluka/db`, et surtout ils
 * reproduisent la même *absence* de décision : `listByUser` rend toutes les
 * lignes, y compris expirées et révoquées. Un fake qui filtrerait sur le statut
 * ferait passer les tests d'expiration pour de mauvaises raisons — le resolver
 * ne verrait qu'une absence, et répondrait `not_entitled` là où §18 attend
 * `expired`.
 *
 * `recordUsage` reproduit `unique (user_id, capability, usage_key)` : c'est la
 * contrainte qui porte l'idempotence de §34, pas une vérification applicative.
 */
export interface UsageEntry extends RecordUsageInput {
  readonly occurredAt: string;
}

export interface EntitlementState {
  readonly participation: ParticipationState;
  entitlements: EntitlementRecord[];
  betaGrants: BetaAccessGrantRecord[];
  usage: UsageEntry[];
}

export function entitlementBaseState(participation: ParticipationState): EntitlementState {
  return { participation, entitlements: [], betaGrants: [], usage: [] };
}

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(12, '0')}`;
}

export function grantEntitlement(
  state: EntitlementState,
  overrides: Partial<EntitlementRecord> & Pick<EntitlementRecord, 'kind' | 'userId'>,
): EntitlementRecord {
  const record: EntitlementRecord = {
    id: nextId('ent'),
    source: 'checkout',
    status: 'active',
    scopeType: overrides.kind === 'plus' ? 'global' : 'participant_race',
    participantRaceId: null,
    organizationId: null,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: null,
    revokedAt: null,
    ...overrides,
  };

  state.entitlements.push(record);
  return record;
}

export function grantBeta(
  state: EntitlementState,
  overrides: Partial<BetaAccessGrantRecord> & Pick<BetaAccessGrantRecord, 'userId'>,
): BetaAccessGrantRecord {
  const record: BetaAccessGrantRecord = {
    id: nextId('beta'),
    scopeType: 'global',
    participantRaceId: null,
    status: 'active',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: null,
    revokedAt: null,
    ...overrides,
  };

  state.betaGrants.push(record);
  return record;
}

export function createFakeEntitlementRepositories(
  state: EntitlementState,
): EntitlementRepositories {
  const participation = createFakeParticipationRepositories(state.participation);

  return {
    participantRaces: participation.participantRaces,

    entitlements: {
      listByUser: async (userId) =>
        state.entitlements.filter((entitlement) => entitlement.userId === userId),

      listBetaGrantsByUser: async (userId) =>
        state.betaGrants.filter((grant) => grant.userId === userId),

      countUsage: async (userId, capability, participantRaceId) =>
        state.usage.filter(
          (entry) =>
            entry.userId === userId &&
            entry.capability === capability &&
            entry.participantRaceId === participantRaceId,
        ).length,

      recordUsage: async (input) => {
        // `unique (user_id, capability, usage_key)` — la base refuse le
        // doublon, le fake aussi.
        const duplicate = state.usage.some(
          (entry) =>
            entry.userId === input.userId &&
            entry.capability === input.capability &&
            entry.usageKey === input.usageKey,
        );
        if (duplicate) return false;

        state.usage.push({ ...input, occurredAt: '2026-03-01T10:00:00.000Z' });
        return true;
      },
    },
  };
}
