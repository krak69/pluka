import type {
  FactCandidateReviewRecord,
  FactCandidateScopeRecord,
  FactPublicationActRecord,
  FactRepositories,
  MembershipRecord,
  PlatformIdentityRecord,
  PublishFactInput,
  PublishedFactRecord,
} from '@pluka/db';

import { EDITOR_A, ORG_A, PLUKA_ADMIN, RACE_ID, VIEWER_A } from './repositories.js';

/**
 * Repositories de publication en mémoire.
 *
 * Ils implémentent les mêmes interfaces que `@pluka/db` : les use cases testés
 * sont exactement ceux qui tourneront en production. On ne simule que les
 * dépendances, jamais la fonction testée.
 *
 * Le fake reproduit un comportement que le domaine tient pour acquis et qui
 * vient en réalité de la base : `findCandidateScope` rend `null` pour un
 * candidat qu'on n'a pas le droit de voir, parce que la fonction SQL filtre
 * elle-même (03_PRIVACY_RLS §8, §120). Sans cela, les tests de refus
 * passeraient sur un chemin qui n'existe pas en production.
 */

export const CANDIDATE_NEW = 'dddddddd-0000-4000-8000-000000000010';
export const CANDIDATE_CONFLICT = 'dddddddd-0000-4000-8000-000000000011';
export const CANDIDATE_NO_EVIDENCE = 'dddddddd-0000-4000-8000-000000000012';
export const CANDIDATE_ACCEPTED = 'dddddddd-0000-4000-8000-000000000013';
export const EXISTING_FACT = 'aaaaaaaa-0000-4000-8000-000000000093';

export interface FactFakeState {
  scopes: FactCandidateScopeRecord[];
  reviews: FactCandidateReviewRecord[];
  memberships: MembershipRecord[];
  identities: PlatformIdentityRecord[];
  /** Ce que le use case a réellement demandé à la base. */
  published: PublishFactInput[];
  decided: { candidateId: string; actorUserId: string; action: string; note: string | null }[];
  /** Utilisateurs auxquels la lecture de portée est refusée, comme en base. */
  invisibleTo: string[];
  acts: (FactPublicationActRecord & { raceId: string })[];
}

function scope(overrides: Partial<FactCandidateScopeRecord>): FactCandidateScopeRecord {
  return {
    candidateId: CANDIDATE_NEW,
    raceId: RACE_ID,
    organizationId: ORG_A,
    category: 'assistance',
    factKey: 'assistance/lenk/authorization',
    status: 'needs_review',
    origin: 'ai',
    matchedFactId: null,
    valueText: 'autorisée uniquement à Lenk',
    valueNumber: null,
    unit: null,
    evidenceCount: 1,
    conflictStatus: null,
    ...overrides,
  };
}

export function baseFactState(overrides: Partial<FactFakeState> = {}): FactFakeState {
  return {
    scopes: [
      scope({}),
      scope({
        candidateId: CANDIDATE_CONFLICT,
        category: 'equipment',
        factKey: 'veste-impermeable',
        status: 'conflict',
        matchedFactId: EXISTING_FACT,
        valueText: 'Veste coupe-vent simple',
        conflictStatus: 'open',
      }),
      scope({
        candidateId: CANDIDATE_NO_EVIDENCE,
        category: 'rules',
        factKey: 'rules/sans_preuve',
        status: 'detected',
        evidenceCount: 0,
      }),
      scope({
        candidateId: CANDIDATE_ACCEPTED,
        category: 'start',
        factKey: 'start/start_time',
        status: 'accepted',
      }),
    ],
    reviews: [],
    memberships: [
      { organizationId: ORG_A, userId: EDITOR_A, role: 'editor' },
      { organizationId: ORG_A, userId: VIEWER_A, role: 'viewer' },
    ],
    identities: [{ id: PLUKA_ADMIN, platformRole: 'pluka_admin' }],
    published: [],
    decided: [],
    invisibleTo: [],
    acts: [],
    ...overrides,
  };
}

export function createFactRepositoriesFake(
  state: FactFakeState,
  actorUserId: string,
): FactRepositories {
  return {
    identity: {
      findMembership: (userId, organizationId) =>
        Promise.resolve(
          state.memberships.find(
            (m) => m.userId === userId && m.organizationId === organizationId,
          ) ?? null,
        ),
      findPlatformIdentity: (userId) =>
        Promise.resolve(state.identities.find((i) => i.id === userId) ?? null),
    },

    factReview: {
      findCandidateScope: (candidateId) => {
        if (state.invisibleTo.includes(actorUserId)) return Promise.resolve(null);

        return Promise.resolve(state.scopes.find((s) => s.candidateId === candidateId) ?? null);
      },

      listForReview: (raceId, limit) =>
        Promise.resolve(state.reviews.filter((r) => r.raceId === raceId).slice(0, limit)),

      publish: (input) => {
        state.published.push(input);

        return Promise.resolve({
          factId: EXISTING_FACT,
          factVersionId: 'eeeeeeee-0000-4000-8000-000000000001',
          versionNumber: 2,
          // La base décide de l'action au vu de la valeur reçue : corriger
          // avant de publier est `edit_and_publish` (§31).
          action:
            input.valueText !== null || input.valueNumber !== null
              ? ('edit_and_publish' as const)
              : ('publish' as const),
          supersededVersionId: null,
          trustLevel: input.trustLevel,
        } satisfies PublishedFactRecord);
      },

      listPublicationActs: (raceId, limit) =>
        Promise.resolve(state.acts.filter((act) => act.raceId === raceId).slice(0, limit)),

      decide: (candidateId, userId, action, note) => {
        state.decided.push({ candidateId, actorUserId: userId, action, note });

        return Promise.resolve(
          action === 'reject'
            ? 'rejected'
            : action === 'mark_duplicate'
              ? 'duplicate'
              : 'needs_review',
        );
      },
    },
  };
}
