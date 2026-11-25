import type { WeatherEngineConfig } from './config.js';
import type { WeatherRoutePoint } from './contracts.js';

/**
 * La Nuit — WEATHER_CONDITIONS §44 à §49.
 *
 * Une Condition astronomique, indépendante de toute prévision : elle se
 * calcule localement, de façon déterministe, avec l'algorithme de position
 * solaire de la NOAA (« General Solar Position Calculations », précision de
 * l'ordre de la minute aux latitudes de course). Il fait nuit quand le centre
 * du soleil est sous −0,833° : la convention du lever et du coucher, qui tient
 * compte de la réfraction et du rayon apparent du soleil.
 *
 * La position du coureur suit son Plan : entre deux points, elle est prise au
 * prorata du temps. Une nuit peut donc commencer au départ, ou durer jusqu'à
 * l'arrivée (§47, §48).
 */

const RAD = Math.PI / 180;
/** Hauteur du soleil au lever et au coucher. */
export const SUNRISE_ALTITUDE_DEG = -0.833;

function dayOfYear(date: Date): { day: number; length: number } {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return { day: Math.floor((date.getTime() - start) / 86_400_000) + 1, length: leap ? 366 : 365 };
}

/** Hauteur du soleil au-dessus de l'horizon, en degrés, à un instant et un lieu. */
export function solarAltitudeDeg(instant: Date, latitude: number, longitude: number): number {
  const { day, length } = dayOfYear(instant);
  const hours =
    instant.getUTCHours() + instant.getUTCMinutes() / 60 + instant.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / length) * (day - 1 + (hours - 12) / 24);

  const equationOfTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const trueSolarMinutes = hours * 60 + equationOfTimeMinutes + 4 * longitude;
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
  const phi = latitude * RAD;
  const cosZenith =
    Math.sin(phi) * Math.sin(declination) +
    Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
}

export interface NightPeriod {
  readonly startDatetime: string;
  readonly endDatetime: string;
  readonly startElapsedSeconds: number;
  readonly endElapsedSeconds: number;
  /** Le point du run le plus proche dans le temps du début et de la fin. */
  readonly startPointKey: string;
  readonly endPointKey: string;
  /** La nuit court dès le départ (§47) ou jusqu'à l'arrivée (§48). */
  readonly fromStart: boolean;
  readonly untilFinish: boolean;
}

interface Track {
  readonly startMs: number;
  readonly points: readonly WeatherRoutePoint[];
}

/** La position du coureur à un temps écoulé : au prorata entre les deux points qui l'encadrent. */
function positionAt(track: Track, elapsed: number): { latitude: number; longitude: number } {
  const { points } = track;
  const first = points[0] as WeatherRoutePoint;
  if (elapsed <= first.elapsedSeconds) return first;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index] as WeatherRoutePoint;
    const to = points[index + 1] as WeatherRoutePoint;
    if (elapsed <= to.elapsedSeconds) {
      const span = to.elapsedSeconds - from.elapsedSeconds;
      const share = span <= 0 ? 1 : (elapsed - from.elapsedSeconds) / span;
      return {
        latitude: from.latitude + (to.latitude - from.latitude) * share,
        longitude: from.longitude + (to.longitude - from.longitude) * share,
      };
    }
  }
  return points[points.length - 1] as WeatherRoutePoint;
}

function isNight(track: Track, elapsed: number): boolean {
  const { latitude, longitude } = positionAt(track, elapsed);
  return (
    solarAltitudeDeg(new Date(track.startMs + elapsed * 1000), latitude, longitude) <
    SUNRISE_ALTITUDE_DEG
  );
}

function nearestPoint(points: readonly WeatherRoutePoint[], elapsed: number): string {
  let best = points[0] as WeatherRoutePoint;
  for (const point of points) {
    if (Math.abs(point.elapsedSeconds - elapsed) < Math.abs(best.elapsedSeconds - elapsed)) {
      best = point;
    }
  }
  return best.pointKey;
}

/**
 * Les périodes de nuit d'un run, du départ à l'arrivée, dans l'ordre. La
 * course est balayée à pas réguliers, puis chaque lever ou coucher est affiné
 * par dichotomie : même entrée, mêmes instants, à la seconde.
 */
export function nightPeriods(
  startAt: string,
  points: readonly WeatherRoutePoint[],
  config: WeatherEngineConfig,
): readonly NightPeriod[] {
  if (points.length === 0) return [];
  const ordered = [...points].sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
  const track: Track = { startMs: Date.parse(startAt), points: ordered };
  const start = (ordered[0] as WeatherRoutePoint).elapsedSeconds;
  const finish = (ordered[ordered.length - 1] as WeatherRoutePoint).elapsedSeconds;
  const { stepSeconds, precisionSeconds } = config.astronomy;

  const refine = (low: number, high: number, nightAtLow: boolean): number => {
    let before = low;
    let after = high;
    while (after - before > precisionSeconds) {
      const middle = (before + after) / 2;
      if (isNight(track, middle) === nightAtLow) before = middle;
      else after = middle;
    }
    return Math.round(after);
  };

  const periods: { start: number; end: number }[] = [];
  let night = isNight(track, start);
  let openedAt: number | null = night ? start : null;
  for (let low = start; low < finish; low += stepSeconds) {
    const high = Math.min(finish, low + stepSeconds);
    const next = isNight(track, high);
    if (next !== night) {
      const change = refine(low, high, night);
      if (next) openedAt = change;
      else if (openedAt !== null) {
        periods.push({ start: openedAt, end: change });
        openedAt = null;
      }
      night = next;
    }
  }
  if (openedAt !== null && finish > openedAt) periods.push({ start: openedAt, end: finish });

  return periods
    .filter((period) => period.end > period.start)
    .map((period) => ({
      startDatetime: new Date(track.startMs + period.start * 1000).toISOString(),
      endDatetime: new Date(track.startMs + period.end * 1000).toISOString(),
      startElapsedSeconds: period.start,
      endElapsedSeconds: period.end,
      startPointKey: nearestPoint(ordered, period.start),
      endPointKey: nearestPoint(ordered, period.end),
      fromStart: period.start === start,
      untilFinish: period.end === finish,
    }));
}
