/**
 * Blocks — docs/engines/SOURCES_EXTRACTION.md §18.
 *
 * Le parsing « transforme le snapshot en représentation structurée ». Un block
 * est l'unité de cette représentation : un titre, un paragraphe, une liste, un
 * tableau.
 *
 * Chaque block conserve de quoi revenir à sa position dans le document
 * d'origine — c'est ce que §20 appelle la citation précise, et c'est la raison
 * d'être du parsing : sans provenance, un fait extrait plus tard ne serait plus
 * vérifiable.
 */

/** §18 : les six types de block, pas un de plus. Le check SQL porte la même liste. */
export const BLOCK_TYPES = ['heading', 'paragraph', 'list', 'table', 'caption', 'other'] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * Position d'un block dans le document d'origine — §18 `sourceLocator`.
 *
 * Les champs présents dépendent du format : une page pour un PDF, un sélecteur
 * pour du HTML, des index pour une cellule de tableau. Le locator est stocké
 * tel quel en `jsonb` : ce qui compte est de pouvoir y revenir, pas d'imposer
 * une forme unique à des formats qui n'en partagent pas.
 */
export interface SourceLocator {
  readonly page?: number;
  readonly cssSelector?: string;
  readonly tableIndex?: number;
  readonly rowIndex?: number;
  /** Rang de la ligne dans sa page — les PDF n'ont ni balise ni sélecteur. */
  readonly lineIndex?: number;
  readonly x?: number;
  readonly y?: number;
  /** Décalage en caractères dans le texte source, pour les formats plats. */
  readonly charOffset?: number;
}

export interface ParsedBlock {
  /** Rang dans le document. Stable pour un même parseur et un même contenu. */
  readonly blockIndex: number;
  readonly pageNumber: number | null;
  /** Chemin de sections, du plus général au plus précis. */
  readonly sectionPath: readonly string[];
  readonly heading: string | null;
  readonly blockType: BlockType;
  readonly text: string;
  readonly locator: SourceLocator;
}
