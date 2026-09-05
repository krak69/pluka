import type { AIProvider, AIUsage } from '@pluka/contracts';

import type { ParsedBlock } from '../parsing/blocks.js';
import type { ParsedChunk } from '../parsing/chunk.js';
import type { ExtractedCandidate } from './candidates.js';
import {
  AI_PROMPT_VERSION,
  EXTRACTOR_SCHEMA_VERSION,
  runAIExtraction,
  type AIExtractionOutcome,
} from './ai.js';
import { DETERMINISTIC_EXTRACTOR_VERSION, extractDeterministic } from './deterministic.js';
import { ExtractionError, type RejectedCandidate } from './errors.js';

/**
 * Extraction de candidats — docs/engines/SOURCES_EXTRACTION.md §21, §26, §29.
 *
 * L'ordre est la règle : **déterministe d'abord, IA ensuite, et seulement sur
 * ce que le déterministe n'a pas lu**. §29 ne dit pas « préférer » mais « ne
 * pas utiliser un LLM pour parser ce qu'un parseur déterministe sait déjà lire
 * proprement » — un chunk entièrement couvert par la première passe n'est donc
 * pas soumis au modèle, et `submittedChunkIndexes` le prouve après coup.
 *
 * Quand les deux passes proposent la même identité logique, c'est la lecture
 * déterministe qui reste : elle est reproductible, et §29 la juge plus adaptée
 * là où elle s'applique.
 *
 * Rien ici ne publie. Le résultat est une liste de propositions, et §25 en
 * rappelle la nature : un candidat « peut être faux, incomplet, dupliqué, peut
 * contredire une valeur ». La publication est un workflow humain (§30, §33).
 */

/** Version du moteur — §76, et en-tête de SOURCES_EXTRACTION. */
export const SOURCES_ENGINE_VERSION = 'sources-v1.0.0';

/**
 * Traçabilité d'un run — §26.
 *
 * « Ne jamais dépendre uniquement d'un prompt non versionné dans le code. » Un
 * run doit dire quel moteur, quel schéma, quel prompt, quel fournisseur et
 * quel modèle ont produit ses candidats : sans cela, une régression de qualité
 * ne se rattache à aucune cause.
 */
export interface ExtractionDescriptor {
  readonly engineVersion: string;
  readonly schemaVersion: string;
  readonly promptVersion: string;
  readonly deterministicVersion: string;
  /** Nom du fournisseur tel qu'il se déclare. Ce paquet ne l'interprète jamais. */
  readonly provider: string | null;
  readonly model: string | null;
  readonly usage: AIUsage | null;
}

export interface ExtractionInput {
  readonly blocks: readonly ParsedBlock[];
  readonly chunks: readonly ParsedChunk[];
  /**
   * Fournisseur IA, injecté.
   *
   * Absent, l'extraction se limite à la passe déterministe. Ce n'est pas un
   * mode dégradé de circonstance : c'est le comportement correct quand aucune
   * IA n'est configurée, et il garde la chaîne entière fonctionnelle.
   */
  readonly provider?: AIProvider | null;
  readonly maxOutputTokens?: number;
}

export interface ExtractionOutcome {
  readonly candidates: readonly ExtractedCandidate[];
  readonly descriptor: ExtractionDescriptor;
  /** Candidats du modèle écartés par une règle métier — §27. */
  readonly rejected: readonly RejectedCandidate[];
  /** Chunks soumis au modèle. Vide si aucune IA n'est intervenue. */
  readonly submittedChunkIndexes: readonly number[];
  /** Chunks non soumis parce que déjà lus par la passe déterministe — §29. */
  readonly skippedChunkIndexes: readonly number[];
  /** Candidats IA abandonnés au profit d'une lecture déterministe de même identité. */
  readonly supersededByDeterministic: number;
}

export async function extractCandidates(input: ExtractionInput): Promise<ExtractionOutcome> {
  if (input.chunks.length === 0) {
    // Un run de parsing sans chunk n'a rien à offrir. §61 nomme le cas, et il
    // ne guérira pas au retry : le snapshot est ce qu'il est.
    throw new ExtractionError('EXTRACTION_EMPTY', 'aucun chunk dans ce run de parsing');
  }

  const deterministic = extractDeterministic({ blocks: input.blocks, chunks: input.chunks });
  const blockByIndex = new Map(input.blocks.map((block) => [block.blockIndex, block]));

  const alreadyRead = (chunk: ParsedChunk): boolean =>
    isAlreadyRead(chunk, deterministic.readBlockIndexes, blockByIndex);

  const submittable = input.chunks.filter((chunk) => !alreadyRead(chunk));
  const skipped = input.chunks.filter(alreadyRead).map((chunk) => chunk.chunkIndex);

  const provider = input.provider ?? null;

  // Aucun fournisseur, ou plus rien à interpréter : pas d'appel. Un appel à
  // vide coûterait des jetons pour un document déjà lu (§75).
  if (provider === null || submittable.length === 0) {
    return {
      candidates: deterministic.candidates,
      descriptor: descriptorOf(null),
      rejected: [],
      submittedChunkIndexes: [],
      skippedChunkIndexes: skipped,
      supersededByDeterministic: 0,
    };
  }

  const ai: AIExtractionOutcome = await runAIExtraction(provider, {
    blocks: input.blocks,
    chunks: submittable,
    ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
  });

  const deterministicKeys = new Set(deterministic.candidates.map((candidate) => candidate.factKey));
  const kept = ai.candidates.filter((candidate) => !deterministicKeys.has(candidate.factKey));

  return {
    candidates: [...deterministic.candidates, ...kept],
    descriptor: descriptorOf({
      provider: provider.name,
      model: ai.model.model,
      usage: ai.usage,
    }),
    rejected: ai.rejected,
    submittedChunkIndexes: ai.submittedChunkIndexes,
    skippedChunkIndexes: skipped,
    supersededByDeterministic: ai.candidates.length - kept.length,
  };
}

/**
 * Un chunk que la passe déterministe a déjà lu.
 *
 * Un titre non lu ne suffit pas à renvoyer le chunk au modèle : « Barrières
 * horaires » situe le tableau qui suit, il ne porte aucune information que le
 * modèle pourrait en tirer. Sans cette nuance, un chunk contenant un tableau
 * intégralement lu repartirait à l'IA pour son seul titre, et §29 n'aurait
 * aucun effet observable.
 *
 * Tout autre block non lu renvoie en revanche le chunk au modèle : une colonne
 * « commentaire » qu'aucune règle ne regarde doit rester extractible.
 */
function isAlreadyRead(
  chunk: ParsedChunk,
  read: ReadonlySet<number>,
  blockByIndex: ReadonlyMap<number, ParsedBlock>,
): boolean {
  if (chunk.blockIndexes.length === 0) return false;

  return chunk.blockIndexes.every(
    (index) => read.has(index) || blockByIndex.get(index)?.blockType === 'heading',
  );
}

function descriptorOf(
  ai: { readonly provider: string; readonly model: string; readonly usage: AIUsage | null } | null,
): ExtractionDescriptor {
  return {
    engineVersion: SOURCES_ENGINE_VERSION,
    schemaVersion: EXTRACTOR_SCHEMA_VERSION,
    // Le prompt est versionné même quand il n'a pas servi : le run dit alors
    // quelle version *aurait* servi, ce qui rend deux runs comparables.
    promptVersion: AI_PROMPT_VERSION,
    deterministicVersion: DETERMINISTIC_EXTRACTOR_VERSION,
    provider: ai?.provider ?? null,
    model: ai?.model ?? null,
    usage: ai?.usage ?? null,
  };
}
