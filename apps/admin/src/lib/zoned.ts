/**
 * Une heure locale de la ligne de départ, devenue un instant (AGENTS §34).
 *
 * Les formulaires demandent ce qu'un organisateur lit dans son règlement —
 * « samedi 12 juin, 5 h » — et non un ISO 8601 à décalage. La conversion se
 * fait ici, côté serveur, avec le fuseau de l'épreuve : le décalage est celui
 * de cette date-là dans ce fuseau, heure d'été comprise.
 *
 * Le résultat garde l'heure murale et porte son décalage
 * (`2027-06-12T05:00:00+02:00`) : c'est un instant valide pour le domaine, et
 * il se relit tel qu'on l'a saisi. Une saisie invalide rend `null` ; le
 * domaine reste seul juge de ce qui est accepté.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

/** Décalage du fuseau, en minutes, à l'instant donné. */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value);

  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return Math.round((wall - instant) / 60_000);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function zonedInstant(date: string, time: string, timeZone: string): string | null {
  const day = DATE.exec(date);
  const clock = TIME.exec(time);
  if (day === null || clock === null) return null;

  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const [hour, minute] = [Number(clock[1]), Number(clock[2])];
  if (hour > 23 || minute > 59) return null;

  const wall = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
  // Un 30 février glisse au 2 mars dans `Date.UTC` : on le refuse.
  if (new Date(wall).getUTCDate() !== dayOfMonth) return null;

  let offset: number;
  try {
    // Deux passes : le décalage au voisinage du changement d'heure est celui
    // de l'instant visé, pas celui de l'heure murale lue comme UTC.
    offset = offsetMinutes(wall, timeZone);
    offset = offsetMinutes(wall - offset * 60_000, timeZone);
  } catch {
    // Fuseau inconnu.
    return null;
  }

  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return `${date}T${time}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * L'inverse : un instant relu en date et heure murales du fuseau, pour
 * pré-remplir un formulaire. Un instant ou un fuseau illisible rend `null` :
 * le champ reste vide plutôt que de montrer une heure fausse.
 */
export function localParts(
  instant: string | null,
  timeZone: string,
): { readonly date: string; readonly time: string } | null {
  if (instant === null) return null;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(parsed);
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((candidate) => candidate.type === type)?.value ?? '';

    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      time: `${part('hour')}:${part('minute')}`,
    };
  } catch {
    return null;
  }
}
