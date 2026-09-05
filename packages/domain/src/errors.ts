/**
 * Erreurs de domaine.
 *
 * Codes stables, destinés à être traduits par la couche appelante — jamais
 * affichés bruts. §4.1 en nomme un explicitement : « toute autre [transition]
 * est refusée avec `invalid_state` ».
 *
 * Aucun code ne parle d'entitlement : le droit commercial est résolu par son
 * propre service (01_ARCHITECTURE §11), et un refus de Privacy ne doit jamais
 * pouvoir se confondre avec un refus commercial (03_PRIVACY_RLS §24).
 */
export const DOMAIN_ERROR_CODES = [
  'validation',
  'forbidden',
  'not_found',
  'conflict',
  'invalid_state',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainErrorParams {
  readonly code: DomainErrorCode;
  readonly useCase: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string>>;
  readonly cause?: unknown;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly useCase: string;
  readonly details: Readonly<Record<string, string>>;

  constructor(params: DomainErrorParams) {
    super(`[${params.useCase}] ${params.code} : ${params.message}`, {
      ...(params.cause === undefined ? {} : { cause: params.cause }),
    });
    this.name = 'DomainError';
    this.code = params.code;
    this.useCase = params.useCase;
    this.details = params.details ?? {};
  }
}

export function validationError(
  useCase: string,
  message: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'validation',
    useCase,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

/**
 * Refus d'accès.
 *
 * Volontairement pauvre en détail : préciser « vous n'êtes pas admin de cette
 * organisation » confirmerait l'existence de l'objet visé, et le rôle qu'il
 * aurait fallu avoir (03_PRIVACY_RLS §120).
 */
export function forbiddenError(
  useCase: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'forbidden',
    useCase,
    message: 'action non autorisée',
    ...(details === undefined ? {} : { details }),
  });
}

export function notFoundError(useCase: string, subject: string): DomainError {
  return new DomainError({ code: 'not_found', useCase, message: `${subject} introuvable` });
}

export function conflictError(
  useCase: string,
  message: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'conflict',
    useCase,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

export function invalidStateError(
  useCase: string,
  message: string,
  details?: Readonly<Record<string, string>>,
): DomainError {
  return new DomainError({
    code: 'invalid_state',
    useCase,
    message,
    ...(details === undefined ? {} : { details }),
  });
}
