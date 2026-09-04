import type { ZodError } from 'zod';

/** Un problème de configuration, rattaché à une variable d'environnement précise. */
export interface EnvIssue {
  readonly key: string;
  readonly message: string;
}

/**
 * Échec de lecture de la configuration.
 *
 * Invariant : ni le message ni les `issues` ne contiennent la valeur reçue.
 * Une erreur de configuration finit dans les logs ou dans Sentry, et une de ces
 * variables peut être un secret (AGENTS §62, ACCEPTANCE AC-SEC-08).
 */
export class EnvValidationError extends Error {
  readonly code = 'ENV_VALIDATION_FAILED';
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[], context: string) {
    const detail = issues.map((issue) => `${issue.key} — ${issue.message}`).join(' ; ');
    super(`Configuration invalide (${context}) : ${detail}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Convertit une erreur Zod en issues rattachées à une variable.
 *
 * Le chemin d'une erreur d'environnement est toujours de profondeur 1 (le nom de
 * la variable) ; une erreur sans chemin est rattachée à `(configuration)` plutôt
 * que rendue muette.
 */
export function toEnvIssues(error: ZodError): EnvIssue[] {
  return error.issues.map((issue) => ({
    key: issue.path.length > 0 ? issue.path.map(String).join('.') : '(configuration)',
    message: issue.message,
  }));
}
