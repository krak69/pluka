/**
 * Taxonomie d'échec commune aux providers externes.
 *
 * Elle sert à décider d'un retry et d'une dégradation, pas à afficher un
 * message : une panne provider dégrade la seule feature concernée et ne
 * fabrique jamais de valeur de remplacement
 * (01_ARCHITECTURE §35 / §37, AGENTS §38, ACCEPTANCE AC-FAIL-01).
 */
export const PROVIDER_ERROR_CODES = [
  'timeout',
  'unavailable',
  'rate_limited',
  'unauthorized',
  'invalid_request',
  'invalid_response',
  'not_supported',
  'unknown',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const RETRYABLE_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'timeout',
  'unavailable',
  'rate_limited',
]);

/** Un échec transitoire mérite un retry borné ; une erreur de contrat, jamais. */
export function isRetryableByDefault(code: ProviderErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

export interface ProviderErrorParams {
  readonly provider: string;
  readonly operation: string;
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

/**
 * Erreur levée par un adapter provider.
 *
 * Ne transporte jamais la réponse brute ni un identifiant d'authentification :
 * une erreur provider doit être diagnosticable sans exposer de secret
 * (ACCEPTANCE AC-OBS-07). La `cause` reste disponible pour un log serveur
 * délibéré, elle n'entre pas dans le message.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly operation: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(params: ProviderErrorParams) {
    super(`[${params.provider}] ${params.operation} : ${params.message}`, {
      ...(params.cause === undefined ? {} : { cause: params.cause }),
    });
    this.name = 'ProviderError';
    this.provider = params.provider;
    this.operation = params.operation;
    this.code = params.code;
    this.retryable = params.retryable ?? isRetryableByDefault(params.code);
  }
}
