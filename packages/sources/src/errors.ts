/**
 * Erreurs d'acquisition — docs/engines/SOURCES_EXTRACTION.md §11, §12.
 *
 * Codes stables : le worker les normalise dans `ingestion_jobs.last_error` et
 * décide, à partir d'eux, s'il faut réessayer. Une URL bloquée par la
 * politique SSRF ne guérira pas ; un délai dépassé, peut-être.
 */
export const ACQUISITION_ERROR_CODES = [
  'URL_REJECTED',
  'ADDRESS_BLOCKED',
  'TOO_MANY_REDIRECTS',
  'CONTENT_TOO_LARGE',
  'HTTP_ERROR',
  'TIMEOUT',
  'NETWORK',
] as const;

export type AcquisitionErrorCode = (typeof ACQUISITION_ERROR_CODES)[number];

/** Codes qui ne guériront pas : les réessayer est du gaspillage. */
const PERMANENT_CODES = new Set<AcquisitionErrorCode>([
  'URL_REJECTED',
  'ADDRESS_BLOCKED',
  'TOO_MANY_REDIRECTS',
  'CONTENT_TOO_LARGE',
]);

export class AcquisitionError extends Error {
  readonly code: AcquisitionErrorCode;
  /** Détail court et sûr à journaliser : jamais de contenu, jamais d'identifiant. */
  readonly detail: string | undefined;

  constructor(code: AcquisitionErrorCode, message: string, detail?: string) {
    super(`${code} : ${message}`);
    this.name = 'AcquisitionError';
    this.code = code;
    this.detail = detail;
  }

  get permanent(): boolean {
    return PERMANENT_CODES.has(this.code);
  }
}

export function isAcquisitionError(error: unknown): error is AcquisitionError {
  return error instanceof AcquisitionError;
}
