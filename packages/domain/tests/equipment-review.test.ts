import type { FactCandidateReviewRecord } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  acceptEquipmentProposal,
  equipmentProposals,
  rejectEquipmentProposal,
  type FactReviewContext,
} from '../src/index.js';
import {
  CANDIDATE_CONFLICT,
  CANDIDATE_NEW,
  CANDIDATE_NO_EVIDENCE,
  baseFactState,
  createFactRepositoriesFake,
  type FactFakeState,
} from './fixtures/fact-repositories.js';
import { EDITOR_A, VIEWER_A } from './fixtures/repositories.js';

/**
 * Relire les propositions de matériel dans le tableau — 0046, 0048. Accepter
 * et écarter passent par la revue habituelle : la garde est la sienne
 * (fact-publication.test.ts, pgTAP 09 et 32). Ici, le regroupement et
 * l'enchaînement des gestes.
 */

const RACE_A = '00000000-0000-4000-8000-000000000401';
const RACE_B = '00000000-0000-4000-8000-000000000402';

function candidate(overrides: Partial<FactCandidateReviewRecord>): FactCandidateReviewRecord {
  return {
    candidateId: 'c',
    raceId: RACE_A,
    category: 'equipment',
    factKey: 'equipment.gants',
    valueText: 'Gants',
    valueNumber: null,
    unit: null,
    valueJson: { requirement: 'mandatory', condition: null, detail: null },
    confidenceLabel: 'high',
    status: 'needs_review',
    origin: 'ai',
    notes: null,
    matchedFactId: null,
    publishedValueText: null,
    publishedVersionId: null,
    publishedTrustLevel: null,
    publishedValueJson: null,
    conflictType: null,
    conflictStatus: null,
    excerpt: 'Gants obligatoires.',
    pageNumber: 4,
    sectionPath: [],
    locator: {},
    snapshotId: null,
    snapshotContentHash: null,
    blockIndex: null,
    chunkIndex: null,
    blockContent: null,
    sourceTitle: 'Règlement 2026',
    sourceUrl: null,
    sourceType: 'pdf',
    organizationName: null,
    snapshotRetrievedAt: null,
    provider: null,
    model: null,
    extractedAt: null,
    ...overrides,
  };
}

function contextFor(userId: string, state: FactFakeState): FactReviewContext {
  return { repositories: createFactRepositoriesFake(state, userId), actor: { userId } };
}

describe('les propositions, une ligne par pièce', () => {
  it('une case par épreuve ; les autres candidats d’une même case sont des doublons', () => {
    const proposals = equipmentProposals([
      {
        raceId: RACE_A,
        candidates: [
          candidate({ candidateId: 'a1', status: 'conflict' }),
          candidate({ candidateId: 'a2' }),
          candidate({ candidateId: 'x', category: 'cutoff', factKey: 'cutoff/x' }),
        ],
      },
      {
        raceId: RACE_B,
        candidates: [
          candidate({
            candidateId: 'b1',
            raceId: RACE_B,
            valueJson: { requirement: 'recommended' },
          }),
        ],
      },
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.cells.map((cell) => cell?.candidateId ?? null)).toEqual(['a1', 'b1']);
    expect(proposals[0]?.cells[0]?.conflict).toBe(true);
    expect(proposals[0]?.cells[1]?.requirement).toBe('recommended');
    expect(proposals[0]?.duplicateIds).toEqual(['a2']);
    expect(proposals[0]?.evidence.sourceTitle).toBe('Règlement 2026');
  });

  it('une exigence que la source ne dit pas reste inconnue', () => {
    const proposals = equipmentProposals([
      { raceId: RACE_A, candidates: [candidate({ valueJson: null })] },
      { raceId: RACE_B, candidates: null },
    ]);

    expect(proposals[0]?.cells[0]?.requirement).toBeNull();
    expect(proposals[0]?.cells[1]).toBeNull();
  });
});

describe('accepter, écarter', () => {
  it('accepter publie chaque candidat retenu, contradiction comprise', async () => {
    const state = baseFactState();

    const outcome = await acceptEquipmentProposal(contextFor(EDITOR_A, state), {
      candidateIds: [CANDIDATE_CONFLICT, CANDIDATE_NEW],
      trustLevel: 'official',
    });

    expect(outcome.done).toBe(2);
    expect(state.published.map((entry) => entry.candidateId)).toEqual([
      CANDIDATE_CONFLICT,
      CANDIDATE_NEW,
    ]);
  });

  it('un refus n’arrête pas les autres, et se rend', async () => {
    const state = baseFactState();

    const outcome = await acceptEquipmentProposal(contextFor(EDITOR_A, state), {
      candidateIds: [CANDIDATE_NO_EVIDENCE, CANDIDATE_NEW],
      trustLevel: 'official',
    });

    expect(outcome.done).toBe(1);
    expect(outcome.failures).toHaveLength(1);
  });

  it('un lecteur ne publie rien', async () => {
    const state = baseFactState();

    const outcome = await acceptEquipmentProposal(contextFor(VIEWER_A, state), {
      candidateIds: [CANDIDATE_NEW],
      trustLevel: 'official',
    });

    expect(outcome.done).toBe(0);
    expect(state.published).toEqual([]);
  });

  it('écarter rejette sans rien publier', async () => {
    const state = baseFactState();

    const outcome = await rejectEquipmentProposal(contextFor(EDITOR_A, state), {
      candidateIds: [CANDIDATE_NEW],
    });

    expect(outcome.done).toBe(1);
    expect(state.decided.map((entry) => entry.action)).toEqual(['reject']);
    expect(state.published).toEqual([]);
  });
});
