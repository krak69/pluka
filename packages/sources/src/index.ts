/**
 * `@pluka/sources` — acquisition et provenance.
 *
 * Périmètre : **étapes 1 à 3** de l'ingestion.
 *
 * Étape 1 — récupérer une source, en conserver le contenu original de façon
 * immuable, en tracer la provenance, et ne pas recréer un snapshot identique
 * (§6, §9, §10, §11, §12).
 *
 * Étape 2 — transformer ce snapshot en blocks et en chunks, chacun portant de
 * quoi revenir à sa position dans le document d'origine (§18, §19, §20).
 *
 * Étape 3 — produire des candidats à partir de ces blocks, chacun portant sa
 * provenance jusqu'à sa position dans le document d'origine (§21, §24, §26).
 * L'ordre de §29 est tenu : la passe déterministe lit d'abord, l'IA n'est
 * appelée que sur ce qu'elle n'a pas lu. Un candidat est une proposition, et
 * rien ici ne publie (§25, §30).
 *
 * Ce paquet ne définit **aucune interface de fournisseur** : `AIProvider`
 * appartient à `packages/contracts` (§56), d'où il est importé. Il ne connaît
 * le nom d'aucun fournisseur non plus — `provider.name` lui arrive, il le
 * journalise, il ne le teste jamais. L'adapter concret vit hors du paquet.
 *
 * Le module ne fait aucune I/O : la requête HTTP et la résolution DNS sont
 * faites par l'appelant, qui repasse ses résultats ici pour décision. C'est ce
 * qui rend la politique SSRF testable sans réseau, et l'extraction testable
 * sans modèle.
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

export {
  CANDIDATE_ORIGINS,
  CANDIDATE_REVIEW_STATES,
  CONFIDENCE_LABELS,
  FACT_CATEGORIES,
  factKeyOf,
  slug,
  type CandidateEvidence,
  type CandidateOrigin,
  type CandidateReviewState,
  type ConfidenceLabel,
  type ExtractedCandidate,
  type FactCategory,
} from './extraction/candidates.js';
export {
  AI_INSTRUCTIONS,
  AI_PROMPT_HASH,
  AI_PROMPT_VERSION,
  EXTRACTOR_SCHEMA_VERSION,
  aiCandidateSchema,
  aiExtractionSchema,
  containsQuote,
  evidenceIdOf,
  promptHash,
  runAIExtraction,
  type AIExtraction,
  type AIExtractionInput,
  type AIExtractionOutcome,
} from './extraction/ai.js';
export {
  DETERMINISTIC_EXTRACTOR_VERSION,
  extractDeterministic,
  readDate,
  readNumber,
  readTime,
  type DeterministicInput,
  type DeterministicOutcome,
} from './extraction/deterministic.js';
export {
  EXTRACTION_ERROR_CODES,
  ExtractionError,
  isExtractionError,
  type ExtractionErrorCode,
  type RejectedCandidate,
} from './extraction/errors.js';
export {
  SOURCES_ENGINE_VERSION,
  extractCandidates,
  type ExtractionDescriptor,
  type ExtractionInput,
  type ExtractionOutcome,
} from './extraction/extract.js';

export { isPdfContentType, parseSnapshotBytes, type ParseBinaryInput } from './parsing/parse.js';
export {
  isPdfParseError,
  parsePdfBlocks,
  PDF_LIMITS,
  PDF_REJECTION_REASONS,
  PdfParseError,
  type PdfDocumentInfo,
  type PdfEngine,
  type PdfParseResult,
  type PdfRejectionReason,
} from './parsing/pdf.js';
