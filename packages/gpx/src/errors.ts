/**
 * Erreurs de traitement GPX.
 *
 * `GPX_INVALID` est le code que docs/engines/PLAN_ENGINE.md §1575 associe à un
 * « parcours inexploitable ». Le worker le normalise ensuite dans
 * `private.ingestion_jobs.last_error` (01_ARCHITECTURE §22.1).
 *
 * Un fichier invalide n'est pas une panne : le rejeter proprement, avec une
 * raison stable, permet au worker de ne pas le réessayer indéfiniment.
 */
export const GPX_ERROR_REASONS = [
  'not_xml',
  'no_track_point',
  'too_few_points',
  'invalid_coordinate',
  'malformed_number',
] as const;

export type GpxErrorReason = (typeof GPX_ERROR_REASONS)[number];

export class GpxError extends Error {
  readonly code = 'GPX_INVALID';
  readonly reason: GpxErrorReason;
  /** Détail non identifiant, sûr à journaliser. */
  readonly detail: string | undefined;

  constructor(reason: GpxErrorReason, message: string, detail?: string) {
    super(`GPX_INVALID (${reason}) : ${message}`);
    this.name = 'GpxError';
    this.reason = reason;
    this.detail = detail;
  }
}

export function isGpxError(error: unknown): error is GpxError {
  return error instanceof GpxError;
}
