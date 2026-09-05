/** Destination par défaut après authentification. */
export const DEFAULT_RETURN_TO = '/';

/** Antislash : certains navigateurs le normalisent en `/`, donc un `/` suivi d'un antislash sortirait du site. */
const BACKSLASH = 0x5c;

const SPACE = 0x20;
const DELETE = 0x7f;

/**
 * Caractères de contrôle, saut de ligne et tabulation compris.
 *
 * Testés par code plutôt que par une classe d'échappements : la règle se lit
 * sans décodage mental, et la source ne contient elle-même aucun octet
 * invisible.
 *
 * L'enjeu : un saut de ligne glissé dans une valeur qui finit en en-tête
 * `Location` permettrait d'en injecter un second.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < SPACE || code === DELETE) return true;
  }

  return false;
}

/**
 * Assainit un `returnTo`.
 *
 * Un `returnTo` vient de l'URL : il est hostile par défaut. Seul un chemin
 * interne est accepté — pas d'URL absolue, pas de `//hôte` interprété comme
 * protocol-relative, pas de caractère de contrôle. Sans cela, le tunnel de
 * connexion devient une redirection ouverte : un lien
 * `…/connexion?returnTo=https://faux-pluka.test` renverrait l'utilisateur
 * fraîchement authentifié vers un site tiers.
 *
 * L'assainissement a lieu à la sortie du tunnel, au moment de rediriger, et
 * non à l'entrée : c'est là qu'une valeur hostile serait exploitée.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (typeof value !== 'string') return DEFAULT_RETURN_TO;

  const candidate = value.trim();

  if (candidate === '') return DEFAULT_RETURN_TO;
  if (!candidate.startsWith('/')) return DEFAULT_RETURN_TO;
  if (candidate.startsWith('//')) return DEFAULT_RETURN_TO;
  if (candidate.codePointAt(1) === BACKSLASH) return DEFAULT_RETURN_TO;
  if (candidate.includes('://')) return DEFAULT_RETURN_TO;
  if (hasControlCharacter(candidate)) return DEFAULT_RETURN_TO;

  return candidate;
}
