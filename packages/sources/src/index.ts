/**
 * `@pluka/sources` — acquisition et provenance.
 *
 * Périmètre de ce lot : **étape 1 seulement** — récupérer une source, en
 * conserver le contenu original de façon immuable, en tracer la provenance,
 * et ne pas recréer un snapshot identique
 * (docs/engines/SOURCES_EXTRACTION.md §6, §9, §10, §11, §12).
 *
 * Aucun parsing, aucun chunking, aucune extraction, aucune IA. §29 rappelle
 * l'ordre : « extraction déterministe avant IA » — et avant l'extraction, il
 * faut d'abord un contenu figé et daté auquel se référer.
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
