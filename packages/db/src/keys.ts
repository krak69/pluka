/**
 * Nature d'une clé d'API Supabase.
 *
 * `publishable` : destinée au navigateur, soumise à la RLS.
 * `secret` : `service_role` / `sb_secret_*`, contourne la RLS, serveur uniquement.
 *
 * Sert de garde-fou au démarrage : une clé secrète ne doit jamais atteindre le
 * navigateur, et une clé publiable ne doit jamais faire croire à un accès de
 * service (01_ARCHITECTURE §9, 03_PRIVACY_RLS §8).
 */
export type SupabaseKeyKind = 'publishable' | 'secret' | 'unknown';

function decodeJwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;

  const payload = parts[1];
  if (payload === undefined) return null;

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const parsed: unknown = JSON.parse(atob(base64));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const role = (parsed as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/**
 * Classe une clé sans jamais la journaliser.
 *
 * Supporte les deux formats : clés `sb_publishable_*` / `sb_secret_*` et clés
 * JWT historiques dont la revendication `role` vaut `anon` ou `service_role`.
 *
 * `unknown` n'est pas une erreur : une clé inconnue n'est simplement pas une
 * preuve. C'est à l'appelant de décider s'il l'accepte — le client navigateur
 * refuse ce qui est prouvé secret, il ne devine pas le reste (AGENTS §38).
 */
export function classifySupabaseKey(key: string): SupabaseKeyKind {
  const value = key.trim();
  if (value === '') return 'unknown';

  if (value.startsWith('sb_publishable_')) return 'publishable';
  if (value.startsWith('sb_secret_')) return 'secret';

  const role = decodeJwtRole(value);
  if (role === 'anon') return 'publishable';
  if (role === 'service_role') return 'secret';

  return 'unknown';
}
