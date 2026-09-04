import { EnvValidationError, type EnvIssue } from './errors.js';
import type { EnvSource } from './load.js';

/**
 * Variables qui ne doivent jamais quitter le serveur.
 *
 * Aucune ne peut porter le préfixe `NEXT_PUBLIC_` — vérifié par les tests.
 */
export const SERVER_ONLY_ENV_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'AI_API_KEY',
  'WEATHER_API_KEY',
  'EMAIL_API_KEY',
  'BILLING_API_KEY',
  'BILLING_WEBHOOK_SECRET',
] as const;

export const PUBLIC_ENV_PREFIX = 'NEXT_PUBLIC_';

/** Une variable publique portant la valeur d'un secret serveur. */
export interface LeakedSecret {
  readonly publicKey: string;
  readonly secretKey: string;
}

/**
 * Détecte une valeur de secret serveur recopiée dans une variable publique.
 *
 * Le préfixe seul ne dit rien : `NEXT_PUBLIC_SUPABASE_ANON_KEY` est publique par
 * construction. Ce qui se vérifie, c'est qu'aucune variable inlinée dans le
 * bundle client ne porte la *valeur* d'un secret serveur — l'erreur réelle étant
 * la clé `service_role` recopiée dans une variable publique
 * (ACCEPTANCE AC-SEC-02, NO GO §67.5).
 */
export function findLeakedServerSecrets(source: EnvSource): LeakedSecret[] {
  const secrets = SERVER_ONLY_ENV_KEYS.map((key) => [key, source[key]] as const).filter(
    (entry): entry is readonly [(typeof SERVER_ONLY_ENV_KEYS)[number], string] =>
      typeof entry[1] === 'string' && entry[1].trim() !== '',
  );

  const leaks: LeakedSecret[] = [];

  for (const [publicKey, publicValue] of Object.entries(source)) {
    if (!publicKey.startsWith(PUBLIC_ENV_PREFIX)) continue;
    if (typeof publicValue !== 'string' || publicValue.trim() === '') continue;

    for (const [secretKey, secretValue] of secrets) {
      if (publicValue === secretValue) {
        leaks.push({ publicKey, secretKey });
      }
    }
  }

  return leaks;
}

/** Garde de démarrage. Lève `EnvValidationError` sans divulguer la valeur fautive. */
export function assertNoLeakedServerSecrets(source: EnvSource): void {
  const leaks = findLeakedServerSecrets(source);
  if (leaks.length === 0) return;

  const issues: EnvIssue[] = leaks.map((leak) => ({
    key: leak.publicKey,
    message: `porte la valeur du secret serveur ${leak.secretKey} et serait exposée au navigateur`,
  }));

  throw new EnvValidationError(issues, 'fuite de secret');
}
