import type { FactCandidateReviewRecord } from '@pluka/db';
import { z } from 'zod';

import { DomainError, parseCommand } from '../errors.js';
import { PUBLISHABLE_TRUST_LEVELS } from './commands.js';
import { equipmentValueOf, type EquipmentValue } from './equipment.js';
import { decideFactCandidate, publishFactCandidate, type FactReviewContext } from './use-cases.js';

/**
 * Relire, dans le tableau du matériel, ce que les sources proposent —
 * SOURCES_EXTRACTION §30, §31, §38, §82 ; migrations 0046, 0048.
 *
 * Les candidats « Matériel » des épreuves d'une édition sont regroupés par
 * pièce (leur clé) : une ligne proposée, une case par épreuve. Accepter
 * publie chaque candidat retenu par le geste de revue habituel — autorité,
 * preuve et journal sont les siens ; écarter les rejette. Rien ne se publie
 * sans ce geste humain (AGENTS §13).
 */

export interface ProposedEquipmentCell extends EquipmentValue {
  readonly candidateId: string;
  readonly label: string;
  /** Vrai si le candidat contredit la version publiée de cette épreuve (§38). */
  readonly conflict: boolean;
}

export interface EquipmentProposal {
  readonly factKey: string;
  readonly label: string;
  /** Dans l'ordre des épreuves reçues : le candidat retenu, ou `null`. */
  readonly cells: readonly (ProposedEquipmentCell | null)[];
  /** Un candidat de plus pour une même épreuve et une même pièce : un doublon. */
  readonly duplicateIds: readonly string[];
  readonly evidence: {
    readonly excerpt: string | null;
    readonly sourceTitle: string | null;
    readonly pageNumber: number | null;
    readonly sourceUrl: string | null;
  };
}

export interface EquipmentCandidatesOfRace {
  readonly raceId: string;
  /** `null` si la file de cette épreuve n'a pas pu être lue. */
  readonly candidates: readonly FactCandidateReviewRecord[] | null;
}

/**
 * Les propositions de matériel d'une édition, une ligne par pièce. Par
 * épreuve, le premier candidat de la file est retenu — la file met les
 * contradictions en tête — et les suivants sont des doublons.
 */
export function equipmentProposals(
  races: readonly EquipmentCandidatesOfRace[],
): readonly EquipmentProposal[] {
  const keys: string[] = [];
  const byKey = new Map<string, FactCandidateReviewRecord[]>();

  for (const race of races) {
    for (const candidate of race.candidates ?? []) {
      if (candidate.category !== 'equipment') continue;
      const list = byKey.get(candidate.factKey);
      if (list === undefined) {
        keys.push(candidate.factKey);
        byKey.set(candidate.factKey, [candidate]);
      } else {
        list.push(candidate);
      }
    }
  }

  return keys.map((factKey): EquipmentProposal => {
    const candidates = byKey.get(factKey) ?? [];
    const duplicateIds: string[] = [];
    const cells = races.map((race) => {
      const ofRace = candidates.filter((candidate) => candidate.raceId === race.raceId);
      const [chosen, ...others] = ofRace;
      duplicateIds.push(...others.map((candidate) => candidate.candidateId));
      if (chosen === undefined) return null;
      return {
        candidateId: chosen.candidateId,
        label: chosen.valueText ?? '',
        conflict: chosen.status === 'conflict',
        ...equipmentValueOf(chosen.valueJson),
      };
    });
    const first = candidates[0];

    return {
      factKey,
      label: first?.valueText ?? factKey,
      cells,
      duplicateIds,
      evidence: {
        excerpt: first?.excerpt ?? null,
        sourceTitle: first?.sourceTitle ?? null,
        pageNumber: first?.pageNumber ?? null,
        sourceUrl: first?.sourceUrl ?? null,
      },
    };
  });
}

const uuid = z.uuid();
const ids = z
  .array(uuid)
  .max(100)
  .transform((list) => [...new Set(list)]);

export const acceptEquipmentProposalCommandSchema = z.object({
  candidateIds: ids.refine((list) => list.length > 0, { error: 'aucune proposition retenue' }),
  duplicateIds: ids.default([]),
  trustLevel: z.enum(PUBLISHABLE_TRUST_LEVELS),
  note: z.string().trim().max(1000).nullable().default(null),
});

export const rejectEquipmentProposalCommandSchema = z.object({
  candidateIds: ids.refine((list) => list.length > 0, { error: 'aucune proposition' }),
  note: z.string().trim().max(1000).nullable().default(null),
});

export interface ProposalOutcome {
  readonly done: number;
  /** Les refus, dans l'ordre : chaque candidat est un geste distinct. */
  readonly failures: readonly DomainError[];
}

/**
 * Accepte une ligne proposée : chaque candidat retenu est publié par la revue
 * habituelle. Le relecteur a vu, case par case, ce qui change par rapport au
 * publié : publier par-dessus une contradiction est donc explicite (§38).
 * Les doublons de la ligne sont marqués comme tels.
 */
export async function acceptEquipmentProposal(
  context: FactReviewContext,
  input: unknown,
): Promise<ProposalOutcome> {
  const command = parseCommand(acceptEquipmentProposalCommandSchema, input, 'acceptEquipmentProposal');
  const failures: DomainError[] = [];
  let done = 0;

  for (const candidateId of command.candidateIds) {
    try {
      await publishFactCandidate(context, {
        candidateId,
        trustLevel: command.trustLevel,
        note: command.note,
        resolveConflict: true,
      });
      done += 1;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      failures.push(error);
    }
  }

  for (const candidateId of command.duplicateIds) {
    await decideFactCandidate(context, {
      candidateId,
      decision: 'mark_duplicate',
      note: command.note,
    }).catch((error: unknown) => {
      if (!(error instanceof DomainError)) throw error;
    });
  }

  return { done, failures };
}

/** Écarte une ligne proposée : chaque candidat est rejeté, rien n'est publié. */
export async function rejectEquipmentProposal(
  context: FactReviewContext,
  input: unknown,
): Promise<ProposalOutcome> {
  const command = parseCommand(rejectEquipmentProposalCommandSchema, input, 'rejectEquipmentProposal');
  const failures: DomainError[] = [];
  let done = 0;

  for (const candidateId of command.candidateIds) {
    try {
      await decideFactCandidate(context, { candidateId, decision: 'reject', note: command.note });
      done += 1;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      failures.push(error);
    }
  }

  return { done, failures };
}
