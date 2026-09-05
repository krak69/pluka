/**
 * Erreurs normalisées d'un job — 01_ARCHITECTURE §22.1.
 *
 * « Chaque job possède : idempotency_key, nombre de tentatives, statut,
 * timestamps, erreur normalisée. »
 *
 * Normaliser sert à décider : une erreur `permanent` ne doit pas être
 * réessayée cinq fois — un GPX invalide le restera. Une erreur `transient` —
 * base indisponible, stockage injoignable — mérite au contraire ses
 * tentatives. Sans cette distinction, le worker gaspille des tentatives sur
 * ce qui ne guérira pas, et abandonne ce qui aurait fonctionné.
 */
export type JobFailureKind = 'permanent' | 'transient';

export interface NormalizedError {
  readonly kind: JobFailureKind;
  /** Code stable, destiné à `ingestion_jobs.last_error` et aux logs. */
  readonly code: string;
  /** Texte court, sans donnée personnelle ni contenu de fichier. */
  readonly message: string;
}

export class JobError extends Error {
  readonly kind: JobFailureKind;
  readonly code: string;

  constructor(kind: JobFailureKind, code: string, message: string, cause?: unknown) {
    super(`${code} : ${message}`, { ...(cause === undefined ? {} : { cause }) });
    this.name = 'JobError';
    this.kind = kind;
    this.code = code;
  }
}

export function permanent(code: string, message: string, cause?: unknown): JobError {
  return new JobError('permanent', code, message, cause);
}

export function transient(code: string, message: string, cause?: unknown): JobError {
  return new JobError('transient', code, message, cause);
}

/**
 * Ramène n'importe quel échec à une forme journalisable.
 *
 * Le message d'origine n'est jamais recopié tel quel pour une erreur inconnue :
 * il peut contenir une requête, un chemin, ou un fragment de fichier. §130 de
 * `03_PRIVACY_RLS` interdit ce genre de fuite dans les logs.
 */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof JobError) {
    return { kind: error.kind, code: error.code, message: error.message };
  }

  // Une erreur non classée est traitée comme transitoire : le worker retentera
  // dans la limite de `max_attempts`, plutôt que d'abandonner sur un incident
  // peut-être passager.
  return {
    kind: 'transient',
    code: 'UNEXPECTED',
    message: error instanceof Error ? `${error.name} inattendue` : 'échec inattendu',
  };
}

/** Format court pour `ingestion_jobs.last_error`, tronqué côté SQL également. */
export function formatForStorage(normalized: NormalizedError): string {
  return `[${normalized.kind}] ${normalized.code} : ${normalized.message}`;
}
