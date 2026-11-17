/**
 * Limite de débit en mémoire, par clé — AGENTS §64 pour les routes à jeton.
 *
 * Fenêtre glissante simple, propre à chaque instance du serveur : elle freine
 * un client trop insistant, elle ne remplace pas une limite partagée entre
 * instances (à prévoir avant la mise en production, voir le pense-bête de
 * lancement). Le jeton fait 256 bits : la limite protège la base, pas le
 * secret, qui ne se devine pas.
 */

let hits = new Map<string, number[]>();

/** Vrai si la clé reste sous `limit` appels dans les `windowMs` dernières millisecondes. */
export function underRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);

  // Le tableau ne grossit pas sans fin : les clés inactives partent au passage.
  if (hits.size > 10_000) {
    hits = new Map([...hits].filter(([, times]) => times.some((at) => now - at < windowMs)));
  }
  return true;
}
