import { createHash } from 'node:crypto';

import type { ParsedBlock } from './blocks.js';

/**
 * Chunking — docs/engines/SOURCES_EXTRACTION.md §19.
 *
 * « Un chunk doit : être suffisamment petit pour rester précis ; conserver un
 * peu de contexte ; ne pas couper arbitrairement une ligne métier importante ;
 * conserver sa relation aux blocks. »
 *
 * Ces quatre contraintes dictent l'algorithme : on assemble des blocks entiers
 * jusqu'à une taille cible, sans jamais couper à l'intérieur d'un block. Un
 * découpage au caractère près sectionnerait « Assistance autorisée uniquement
 * à Lenk » en deux morceaux dont aucun ne porterait l'information — c'est
 * exactement la « ligne métier importante » que §19 protège.
 *
 * La relation aux blocks est conservée explicitement : chaque chunk sait de
 * quels blocks il est fait, et dans quel ordre. C'est ce qui permet à une
 * citation de §20 de remonter jusqu'à une page et une section.
 */

/**
 * Version du chunker.
 *
 * Stockée dans `private.extraction_runs.chunker_version`, à côté de la version
 * de parseur : le couple identifie complètement la façon dont un snapshot a
 * été découpé.
 */
export const CHUNKER_VERSION = 'chunker-1.0.0';

/**
 * Constantes de découpage V1.
 *
 * §19 ne donne pas de valeurs : ce sont des conventions d'implémentation, et
 * elles sont versionnées avec le chunker. Les changer impose d'incrémenter
 * `CHUNKER_VERSION`, sans quoi deux découpages différents porteraient la même
 * étiquette.
 *
 * 1200 caractères tient largement dans une fenêtre de contexte tout en gardant
 * un chunk lisible par un relecteur humain — §30 prévoit une validation
 * humaine, et une preuve illisible ne se valide pas.
 */
export const CHUNKING = {
  targetChars: 1200,
  /** Un titre seul ne fait pas un chunk : il est rattaché à ce qui le suit. */
  minChars: 200,
  /**
   * Blocks de contexte repris du chunk précédent.
   *
   * §19 : « conserver un peu de contexte ». Le recouvrement se fait en blocks
   * entiers, pas en caractères, pour que la relation aux blocks reste exacte.
   */
  overlapBlocks: 1,
} as const;

export interface ParsedChunk {
  readonly chunkIndex: number;
  readonly text: string;
  readonly contentHash: string;
  /** Index des blocks composant le chunk, dans l'ordre du document. */
  readonly blockIndexes: readonly number[];
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  /** Section la plus précise couverte par le chunk, pour la citation (§20). */
  readonly sectionLabel: string | null;
}

export interface ChunkOptions {
  readonly targetChars?: number;
  readonly minChars?: number;
  readonly overlapBlocks?: number;
}

export function chunkBlocks(
  blocks: readonly ParsedBlock[],
  options: ChunkOptions = {},
): readonly ParsedChunk[] {
  const targetChars = options.targetChars ?? CHUNKING.targetChars;
  const minChars = options.minChars ?? CHUNKING.minChars;
  const overlapBlocks = options.overlapBlocks ?? CHUNKING.overlapBlocks;

  const chunks: ParsedChunk[] = [];
  let pending: ParsedBlock[] = [];

  function pendingLength(): number {
    return pending.reduce((total, block) => total + block.text.length + 1, 0);
  }

  function emit(): void {
    if (pending.length === 0) return;

    const text = pending.map((block) => block.text).join('\n');
    const pages = pending
      .map((block) => block.pageNumber)
      .filter((page): page is number => page !== null);

    chunks.push({
      chunkIndex: chunks.length,
      text,
      contentHash: createHash('sha256').update(text, 'utf8').digest('hex'),
      blockIndexes: pending.map((block) => block.blockIndex),
      pageStart: pages.length === 0 ? null : Math.min(...pages),
      pageEnd: pages.length === 0 ? null : Math.max(...pages),
      sectionLabel: sectionLabelOf(pending),
    });

    // Recouvrement : les derniers blocks repartent dans le chunk suivant, pour
    // qu'une information à cheval reste lisible d'un côté au moins.
    pending = overlapBlocks > 0 ? pending.slice(-overlapBlocks) : [];
  }

  for (const block of blocks) {
    // Un block plus grand que la cible n'est pas coupé : le découper
    // sectionnerait la ligne métier que §19 protège. Il forme son propre chunk.
    if (block.text.length >= targetChars) {
      if (pendingLength() >= minChars) emit();
      else pending = [];

      pending = [...pending.filter((kept) => kept.blockIndex !== block.blockIndex), block];
      emit();
      pending = [];
      continue;
    }

    pending.push(block);

    if (pendingLength() >= targetChars) emit();
  }

  // Le reste devient un chunk, même court : une information isolée en fin de
  // document ne doit pas disparaître.
  if (pending.length > 0) {
    const alreadyCovered =
      chunks.length > 0 &&
      pending.every((block) =>
        (chunks[chunks.length - 1] as ParsedChunk).blockIndexes.includes(block.blockIndex),
      );

    // Sans ce garde, le recouvrement produirait un dernier chunk qui ne serait
    // qu'une répétition du précédent.
    if (!alreadyCovered) emit();
  }

  return chunks;
}

/**
 * Section d'un chunk.
 *
 * La plus précise parmi ses blocks : c'est celle qui situe l'information, pas
 * la racine du document.
 */
function sectionLabelOf(blocks: readonly ParsedBlock[]): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index] as ParsedBlock;
    const path = block.sectionPath;

    if (path.length > 0) return path[path.length - 1] ?? null;
    if (block.heading !== null) return block.heading;
  }

  return null;
}
