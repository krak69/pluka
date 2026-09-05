import { DbError } from './errors.js';

/**
 * Valide l'URL d'un projet Supabase.
 *
 * Une URL de base mal formée, ou pointant ailleurs qu'en HTTP(S), enverrait
 * chaque requête — et le jeton d'accès qui l'accompagne — vers une
 * destination non prévue. La vérification a lieu à la construction du client,
 * pas à la première requête (01_ARCHITECTURE §32.1).
 *
 * Rend l'URL normalisée, sans barre oblique finale, pour que deux
 * configurations qui ne diffèrent que par elle produisent le même client.
 */
export function assertSupabaseUrl(value: string, operation: string): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new DbError({
      code: 'invalid_configuration',
      operation,
      message: 'URL Supabase invalide',
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DbError({
      code: 'invalid_configuration',
      operation,
      message: `protocole ${parsed.protocol} refusé : http ou https attendu`,
    });
  }

  return parsed.origin;
}
