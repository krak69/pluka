import { z } from 'zod';

function hasHttpProtocol(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * URL absolue restreinte à `http`/`https`.
 *
 * Les autres schémas d'URL sont refusés partout où une URL traverse une
 * frontière : redirection de paiement, source à ingérer, lien envoyé par email
 * (01_ARCHITECTURE §32.1, ACCEPTANCE AC-SEC-03 / AC-SEC-04).
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(hasHttpProtocol, { error: 'URL http(s) absolue attendue' });
