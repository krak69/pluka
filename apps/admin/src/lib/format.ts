/**
 * Formats d'affichage de l'administration.
 *
 * Le fuseau est fixé à `Europe/Paris` et la locale à `fr-FR` : sans cela, la
 * même ligne de journal se lirait différemment selon la machine qui rend la
 * page, et deux administrateurs comparant un horodatage ne parleraient pas de
 * la même heure. Un écran d'enquête a besoin d'une référence unique.
 */

const DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

const DATE_ONLY = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeZone: 'Europe/Paris',
});

/** Horodatage complet — pour un journal, où la minute compte. */
export function dateTime(isoInstant: string | null): string {
  if (isoInstant === null) return '—';

  const parsed = new Date(isoInstant);

  return Number.isNaN(parsed.getTime()) ? isoInstant : DATE_TIME.format(parsed);
}

/** Date seule — pour une création d'organisation, où la minute ne dit rien. */
export function day(isoInstant: string | null): string {
  if (isoInstant === null) return '—';

  const parsed = new Date(isoInstant);

  return Number.isNaN(parsed.getTime()) ? isoInstant : DATE_ONLY.format(parsed);
}

/**
 * Nom affichable d'une personne.
 *
 * L'email reste la seule donnée toujours présente : `first_name` et
 * `last_name` sont facultatifs, et un écran de support qui afficherait
 * « undefined undefined » serait pire qu'un écran qui affiche l'adresse.
 */
export function personName(
  firstName: string | null,
  lastName: string | null,
  fallback: string,
): string {
  const full = [firstName, lastName].filter((part) => part !== null && part !== '').join(' ');

  return full === '' ? fallback : full;
}
