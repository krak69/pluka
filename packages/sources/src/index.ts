/**
 * `@pluka/sources` — acquisition et provenance.
 *
 * Périmètre : **étapes 1 et 2** de l'ingestion.
 *
 * Étape 1 — récupérer une source, en conserver le contenu original de façon
 * immuable, en tracer la provenance, et ne pas recréer un snapshot identique
 * (§6, §9, §10, §11, §12).
 *
 * Étape 2 — transformer ce snapshot en blocks et en chunks, chacun portant de
 * quoi revenir à sa position dans le document d'origine (§18, §19, §20).
 *
 * Aucune extraction de candidats, aucune IA. §29 pose l'ordre : « extraction
 * déterministe avant IA ». Ce paquet ne définit d'ailleurs aucune interface de
 * fournisseur : `AIProvider` appartient à `packages/contracts`, et sera importé
 * de là quand l'étape 3 en aura l'usage.
 *
 * Le module ne fait aucune I/O : la requête HTTP et la résolution DNS sont
 * faites par l'appelant, qui repasse ses résultats ici pour décision. C'est ce
 * qui rend la politique SSRF testable sans réseau.
 */

export {
  ACQUISITION_ERROR_CODES,
  AcquisitionError,
  isAcquisitionError,
  type AcquisitionErrorCode,
} from './errors.js';

export {
  ACQUISITION_LIMITS,
  contentHash,
  decideSnapshot,
  describeCapture,
  snapshotStoragePath,
  type Capture,
  type CaptureProvenance,
  type SnapshotDecision,
} from './snapshot.js';

export {
  isAllowedAddress,
  URL_REJECTION_REASONS,
  validateSourceUrl,
  type UrlRejectionReason,
  type UrlVerdict,
} from './ssrf.js';

export {
  BLOCK_TYPES,
  type BlockType,
  type ParsedBlock,
  type SourceLocator,
} from './parsing/blocks.js';
export {
  CHUNKER_VERSION,
  CHUNKING,
  chunkBlocks,
  type ChunkOptions,
  type ParsedChunk,
} from './parsing/chunk.js';
export { parseHtmlBlocks } from './parsing/html.js';
export {
  hashBlocks,
  isParsableContentType,
  isParseError,
  PARSE_REJECTION_REASONS,
  PARSER_VERSION,
  ParseError,
  parseSnapshot,
  type ParsedDocument,
  type ParseInput,
  type ParseRejectionReason,
} from './parsing/parse.js';
export { parseTextBlocks } from './parsing/text.js';
