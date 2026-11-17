/**
 * L'échéance d'une tâche, telle que « À faire » et l'Accueil l'écrivent :
 * « jeu. 19 nov. · dans 2 jours ».
 *
 * Le délai est compté depuis aujourd'hui (décision produit du 2026-11-17). Pas
 * de « J-x » : dans PLUKA, « J » est le jour de la course.
 */
export function dueDelay(days: number): string {
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  if (days > 1) return `dans ${String(days)} jours`;
  return days === -1 ? 'en retard d’1 jour' : `en retard de ${String(-days)} jours`;
}

/** « jeu. 19 nov. » — l'année seulement quand elle diffère de celle d'aujourd'hui. */
export function dueCalendarDay(day: string, daysLeft: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  const today = new Date(date.getTime() - daysLeft * 86_400_000);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getUTCFullYear() === today.getUTCFullYear() ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date);
}
