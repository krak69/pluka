import type { RaceWaypointView } from '@pluka/domain';

import { localParts } from '@/lib/zoned';

/**
 * La saisie des points de passage, sans écran — PLAN_ENGINE §7, §8.1.
 *
 * Une barrière se saisit comme le règlement l'écrit : un jour de course
 * (« samedi », « dimanche ») et une heure. Le formulaire recompose une date
 * et une heure murales dans le fuseau de l'épreuve ; l'action les convertit
 * en instant (`toInstant`). Rien ici ne décide de la cohérence de la chaîne :
 * `setRaceWaypoints` la juge.
 */

export interface WaypointRow {
  readonly key: string;
  /** Vide pour un point ajouté : la base lui donnera son identité. */
  readonly id: string;
  readonly name: string;
  readonly waypointType: string;
  /** Tel que tapé : « 12,5 » vaut 12.5. */
  readonly distanceKm: string;
  /** Jour de course de la barrière, depuis le jour du départ (0 = jour J) ; vide sans barrière. */
  readonly cutoffDay: string;
  /** « HH:MM », vide sans barrière. */
  readonly cutoffTime: string;
}

/** Le départ, à l'heure murale de la ligne de départ. */
export interface LocalStart {
  readonly date: string;
  readonly time: string;
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** La date du jour `offset` de course, « YYYY-MM-DD ». */
export function dateOfDay(start: LocalStart, offset: number): string {
  const base = dayNumber(start.date) ?? 0;
  return new Date((base + offset) * DAY_MS).toISOString().slice(0, 10);
}

/** « sam. 20 juin » : le jour tel qu'un règlement le nomme. */
export function dayLabel(start: LocalStart, offset: number): string {
  const date = new Date(`${dateOfDay(start, offset)}T12:00:00Z`);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function parseKm(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Une distance lisible : « 12,4 km ». */
export function formatKm(value: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)} km`;
}

export function rowsOf(
  waypoints: readonly RaceWaypointView[],
  timezone: string,
  start: LocalStart | null,
): WaypointRow[] {
  if (waypoints.length === 0) {
    return [
      { key: 'new-0', id: '', name: 'Départ', waypointType: 'start', distanceKm: '0', cutoffDay: '', cutoffTime: '' },
      { key: 'new-1', id: '', name: 'Arrivée', waypointType: 'finish', distanceKm: '', cutoffDay: '', cutoffTime: '' },
    ];
  }

  const startDay = start === null ? null : dayNumber(start.date);

  return waypoints.map((waypoint) => {
    const parts = localParts(waypoint.cutoffAt, timezone);
    const day = parts === null || startDay === null ? null : dayNumber(parts.date);
    return {
      // L'identité du point, pas son rang : après un enregistrement, les
      // champs se remontent avec les valeurs relues en base.
      key: `existing-${waypoint.id}`,
      id: waypoint.id,
      name: waypoint.name,
      waypointType: waypoint.waypointType,
      distanceKm: String(waypoint.distanceKm).replace('.', ','),
      cutoffDay: day === null || startDay === null ? '' : String(day - startDay),
      cutoffTime: parts?.time ?? '',
    };
  });
}

/** La valeur postée d'une barrière : date et heure murales, ou rien. */
export function cutoffValue(row: WaypointRow, start: LocalStart | null): string {
  if (start === null || row.cutoffDay === '' || row.cutoffTime === '') return '';
  return `${dateOfDay(start, Number(row.cutoffDay))}T${row.cutoffTime}`;
}

/** Les minutes de course à la barrière, depuis le départ ; `null` sans barrière complète. */
export function elapsedMinutes(row: WaypointRow, start: LocalStart | null): number | null {
  if (start === null || row.cutoffDay === '' || row.cutoffTime === '') return null;
  const [hours, minutes] = row.cutoffTime.split(':').map(Number);
  const [startHours, startMinutes] = start.time.split(':').map(Number);
  if ([hours, minutes, startHours, startMinutes].some((part) => part === undefined || Number.isNaN(part))) {
    return null;
  }
  return (
    Number(row.cutoffDay) * 1440 +
    (hours ?? 0) * 60 +
    (minutes ?? 0) -
    ((startHours ?? 0) * 60 + (startMinutes ?? 0))
  );
}

/** « 9 h 30 », « 26 h » : un temps de course, qui ne repart pas à minuit. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/**
 * Range la chaîne par kilomètre. Le tri est stable : deux points au même
 * kilomètre gardent leur ordre. Un point sans kilomètre reste à sa place
 * relative, en fin de liste — il n'a pas encore de position.
 */
export function sortByKm(rows: readonly WaypointRow[]): WaypointRow[] {
  const placed = rows
    .map((row, index) => ({ row, index, km: parseKm(row.distanceKm) }))
    .filter((entry) => entry.km !== null)
    .sort((left, right) => (left.km ?? 0) - (right.km ?? 0) || left.index - right.index)
    .map((entry) => entry.row);
  const unplaced = rows.filter((row) => parseKm(row.distanceKm) === null);
  return [...placed, ...unplaced];
}

/** L'écart avec le point précédent ayant un kilomètre ; `null` pour le premier. */
export function gapsOf(rows: readonly WaypointRow[]): readonly (number | null)[] {
  let previous: number | null = null;
  return rows.map((row) => {
    const km = parseKm(row.distanceKm);
    if (km === null) return null;
    const gap = previous === null ? null : km - previous;
    previous = km;
    return gap;
  });
}

/** Ce qu'on compare pour savoir si la saisie a changé. */
export function fingerprint(rows: readonly WaypointRow[], start: LocalStart | null): string {
  return JSON.stringify(
    rows.map((row) => [
      row.id,
      row.name.trim(),
      row.waypointType,
      parseKm(row.distanceKm),
      cutoffValue(row, start),
    ]),
  );
}
