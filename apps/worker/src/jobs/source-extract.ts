import { createHash } from 'node:crypto';

import {
  AI_PROMPT_VERSION,
  EXTRACTOR_SCHEMA_VERSION,
  SOURCES_ENGINE_VERSION,
  extractCandidates,
  isExtractionError,
} from '@pluka/sources';

import { formatForStorage, normalizeError, permanent } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `source.extract` — étape 3 de docs/engines/SOURCES_EXTRACTION.md.
 *
 * Les blocks et chunks d'un run de parsing deviennent des candidats, chacun
 * portant sa provenance jusqu'à sa position dans le document d'origine.
 *
 * Trois choses que ce job ne fait jamais, et qui sont l'essentiel :
 *
 * - il ne **publie** rien. §25 : un candidat « peut être faux, incomplet,
 *   dupliqué, peut contredire une valeur ». Il entre en revue (§30) ;
 * - il ne **modifie** aucune donnée existante. La comparaison aux facts
 *   courants (§36) est une lecture, et la base refuse de son côté toute
 *   réécriture d'une version publiée (§23, §35) ;
 * - il n'appelle **pas l'IA en premier**. §29 pose l'ordre, et le moteur le
 *   tient : le modèle ne voit que ce qu'aucune règle déterministe n'a lu.
 *
 * Le run porte les cinq éléments de traçabilité de §26 — moteur, schéma,
 * prompt, fournisseur, modèle — et le run de parsing dont il descend. Rejouer
 * à l'identique ne produit rien de nouveau ; changer l'un d'eux ouvre un
 * nouveau run, ce que §77 appelle la ré-extraction.
 */

interface ExtractJobPayload {
  readonly snapshotId: string;
  readonly parseRunId: string;
  readonly idempotencyKey: string;
}

function readPayload(message: QueueMessage): ExtractJobPayload {
  const { snapshotId, parseRunId, idempotencyKey } = message.payload;

  if (
    typeof snapshotId !== 'string' ||
    typeof parseRunId !== 'string' ||
    typeof idempotencyKey !== 'string'
  ) {
    throw permanent('PAYLOAD_INVALID', 'charge utile incomplète');
  }

  return { snapshotId, parseRunId, idempotencyKey };
}

export type ExtractOutcome =
  | { readonly kind: 'extracted'; readonly runId: string; readonly candidateCount: number }
  | { readonly kind: 'already_done'; readonly runId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît un message d'extraction parmi ceux de la file `pluka_sources`. */
export function isExtractMessage(message: QueueMessage): boolean {
  return typeof message.payload.parseRunId === 'string';
}

export async function handleExtractMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<ExtractOutcome> {
  let payload: ExtractJobPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error("message d'extraction illisible", {
      msgId: message.msgId,
      code: normalized.code,
    });
    return { kind: 'abandoned', code: normalized.code };
  }

  const startedAt = Date.now();
  let runId = '';

  try {
    // L'extraction porte sur ce qui a été persisté, pas sur un re-parsing en
    // mémoire : un candidat doit citer un block que la base contient.
    const { blocks, chunks } = await ports.extraction.readParseOutput(payload.parseRunId);

    const run = await ports.extraction.startRun({
      parseRunId: payload.parseRunId,
      snapshotId: payload.snapshotId,
      engineVersion: SOURCES_ENGINE_VERSION,
      schemaVersion: EXTRACTOR_SCHEMA_VERSION,
      promptVersion: AI_PROMPT_VERSION,
      provider: ports.ai?.provider.name ?? null,
      model: ports.ai?.model ?? null,
      // L'empreinte des chunks dit *sur quoi* l'extraction a porté, sans
      // dépendre d'un identifiant de run : deux runs de parsing identiques
      // produisent la même.
      inputHash: chunkFingerprint(chunks),
    });

    runId = run.runId;

    if (run.alreadyCompleted) {
      ports.logger.info('extraction déjà effectuée', {
        snapshotId: payload.snapshotId,
        parseRunId: payload.parseRunId,
        runId: run.runId,
      });
      return { kind: 'already_done', runId: run.runId };
    }

    const outcome = await extractCandidates({
      blocks,
      chunks,
      provider: ports.ai?.provider ?? null,
    });

    const candidateCount = await ports.extraction.recordCandidates({
      runId: run.runId,
      parseRunId: payload.parseRunId,
      snapshotId: payload.snapshotId,
      candidates: outcome.candidates,
    });

    await ports.extraction.completeRun(
      run.runId,
      {
        inputTokens: outcome.descriptor.usage?.inputTokens ?? null,
        outputTokens: outcome.descriptor.usage?.outputTokens ?? null,
        latencyMs: Date.now() - startedAt,
      },
      // Le résumé garde de quoi expliquer un résultat maigre sans relire les
      // logs : combien de chunks n'ont pas été soumis parce qu'un parseur les
      // avait lus, combien de candidats du modèle ont été écartés et pourquoi.
      {
        proposed: outcome.candidates.length,
        deterministic: outcome.candidates.filter((c) => c.origin === 'deterministic').length,
        ai: outcome.candidates.filter((c) => c.origin === 'ai').length,
        submittedChunks: outcome.submittedChunkIndexes.length,
        skippedChunks: outcome.skippedChunkIndexes.length,
        supersededByDeterministic: outcome.supersededByDeterministic,
        rejected: outcome.rejected,
      },
    );

    ports.logger.info('candidats extraits', {
      snapshotId: payload.snapshotId,
      runId: run.runId,
      candidateCount,
      proposed: outcome.candidates.length,
      rejected: outcome.rejected.length,
      provider: outcome.descriptor.provider,
      model: outcome.descriptor.model,
      promptVersion: outcome.descriptor.promptVersion,
    });

    return { kind: 'extracted', runId: run.runId, candidateCount };
  } catch (error) {
    return failRun(ports, payload, runId, error);
  }
}

/**
 * Empreinte de l'entrée d'une extraction.
 *
 * Les empreintes de chunk, pas leur contenu : le contenu est déjà en base, et
 * ce qu'on veut prouver est qu'une extraction a porté sur ce découpage-là.
 */
function chunkFingerprint(chunks: readonly { readonly contentHash: string }[]): string {
  return createHash('sha256')
    .update(chunks.map((chunk) => chunk.contentHash).join('\n'), 'utf8')
    .digest('hex');
}

async function failRun(
  ports: WorkerPorts,
  payload: ExtractJobPayload,
  runId: string,
  error: unknown,
): Promise<ExtractOutcome> {
  // Un run de parsing sans chunk ou un candidat invalide ne guériront pas ;
  // une sortie de modèle hors schéma, peut-être — §27 autorise « retry borné
  // si pertinent ». `ExtractionError` porte déjà cette distinction.
  const normalized = isExtractionError(error)
    ? {
        kind: error.permanent ? ('permanent' as const) : ('transient' as const),
        code: error.code,
        message: error.message,
      }
    : normalizeError(error);

  if (runId !== '') {
    // §61 : « un échec extraction ne doit jamais invalider un RaceFact déjà
    // publié. » Le run porte son échec, et rien d'autre n'est touché.
    await ports.extraction
      .failRun(runId, normalized.code, formatForStorage(normalized))
      .catch(() => undefined);
  }

  ports.logger.error('extraction en échec', {
    snapshotId: payload.snapshotId,
    parseRunId: payload.parseRunId,
    code: normalized.code,
    kind: normalized.kind,
  });

  return normalized.kind === 'permanent'
    ? { kind: 'abandoned', code: normalized.code }
    : { kind: 'retry', code: normalized.code };
}
