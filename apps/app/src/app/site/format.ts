/**
 * Mise en forme des pages d'un site d'événement.
 *
 * Les dates d'édition sont des dates civiles (`date`), sans fuseau ; une heure
 * de départ est un instant, lu dans le fuseau de l'épreuve (AGENTS §34).
 */

const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function civil(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** « 20 juin 2027 », ou « 19 – 20 juin 2027 », ou « 30 juin – 1 juillet 2027 ». */
export function editionDateRange(startDate: string, endDate: string | null): string {
  const start = civil(startDate);
  if (endDate === null || endDate === startDate) return DAY_MONTH_YEAR.format(start);

  const end = civil(endDate);
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  const head = sameMonth ? String(start.getUTCDate()) : DAY_MONTH.format(start);
  return `${head} – ${DAY_MONTH_YEAR.format(end)}`;
}

/** « sam. 20 juin, 06:00 » dans le fuseau de l'épreuve. */
export function raceStartLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(instant));
}

/** « sam. 20 juin » et « 06:00 », séparés pour une carte d'épreuve. */
export function raceDayLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(instant));
}

export function raceTimeLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(instant),
  );
}

/**
 * Une adresse saisie ailleurs, rendue en lien seulement si elle est `http` ou
 * `https`. Un site partage le site navigateur de l'app (EVENT_SITE §7.2) : un
 * `javascript:` dans le lien d'un partenaire y exécuterait du script.
 */
export function safeHttpUrl(value: string | null): string | null {
  if (value === null) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
