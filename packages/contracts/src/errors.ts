import type { ZodError } from 'zod';

/** Un problème de validation, rattaché à un champ du contrat. */
export interface ContractIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Échec de validation d'un contrat partagé.
 *
 * Invariant : ni le message ni les `issues` ne contiennent la donnée reçue. Une
 * frontière non fiable transporte des secrets (payload de webhook, réponse
 * provider, contenu de source) et l'erreur finit dans les logs ou Sentry
 * (01_ARCHITECTURE §34.1, ACCEPTANCE AC-OBS-06 / AC-SEC-08).
 */
export class ContractValidationError extends Error {
  readonly code = 'CONTRACT_VALIDATION_FAILED';
  readonly issues: readonly ContractIssue[];

  constructor(subject: string, issues: readonly ContractIssue[]) {
    const detail = issues.map((issue) => `${issue.path} — ${issue.message}`).join(' ; ');
    super(`Contrat invalide (${subject}) : ${detail}`);
    this.name = 'ContractValidationError';
    this.issues = issues;
  }
}

export function toContractIssues(error: ZodError): ContractIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(racine)',
    message: issue.message,
  }));
}
