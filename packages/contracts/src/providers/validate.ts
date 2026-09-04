import type { z } from 'zod';

import { toContractIssues } from '../errors.js';
import { ProviderError } from './errors.js';

export interface ProviderCallContext {
  readonly provider: string;
  readonly operation: string;
}

/**
 * Valide la réponse d'un provider externe avant de la laisser entrer dans le
 * domaine (AGENTS §60, 01_ARCHITECTURE §32).
 *
 * Rejet total en cas d'écart : pas de parse partiel, pas de champ complété par
 * défaut (SOURCES_EXTRACTION §27, AGENTS §38). Le message rapporte les champs
 * fautifs, jamais les valeurs reçues — une réponse provider peut contenir des
 * données personnelles ou un secret.
 */
export function parseProviderResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: ProviderCallContext,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const detail = toContractIssues(result.error)
    .map((issue) => `${issue.path} — ${issue.message}`)
    .join(' ; ');

  throw new ProviderError({
    provider: context.provider,
    operation: context.operation,
    code: 'invalid_response',
    message: `réponse non conforme au contrat : ${detail}`,
  });
}
