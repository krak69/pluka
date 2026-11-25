import type { WeatherEngineConfig, WeatherHorizon } from './config.js';
import type { WeatherScope } from './contracts.js';

/**
 * La fenêtre J-14 — WEATHER_CONDITIONS §6 à §12, AGENTS §17.
 *
 * Les Conditions personnalisées existent seulement quand
 * `0 <= days_to_start <= 14`, en jours calendaires du fuseau de la course.
 * Le serveur décide ; l'horloge est passée explicitement (AGENTS §35).
 * Les notices officielles ne passent jamais par ici (§8).
 */

const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 14;

/** « 2026-09-11 » : la date calendaire d'un instant dans un fuseau IANA. */
export function localDate(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function epochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / DAY_MS;
}

function shiftDate(date: string, days: number): string {
  return new Date((epochDay(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Jours calendaires entre aujourd'hui et le jour du départ, dans le fuseau du scope. */
export function daysToStart(now: string, startDate: string, timezone: string): number {
  return epochDay(startDate) - epochDay(localDate(now, timezone));
}

/** §9 : J-14 à J-8 lointaine, J-7 à J-4 intermédiaire, J-3 à J-1 rapprochée, le jour J. */
export function horizonOf(days: number): WeatherHorizon {
  if (days <= 0) return 'race_day';
  if (days <= 3) return 'near';
  if (days <= 7) return 'medium';
  return 'far';
}

export interface WeatherEligibilityInput {
  readonly scope: WeatherScope;
  readonly now: string;
  readonly timezone: string;
  /** L'instant de départ, quand l'heure est connue. */
  readonly startAt: string | null;
  /** Le jour de départ seul (une sortie datée sans heure) ; ignoré si `startAt` est connu. */
  readonly startDate: string | null;
  /** Une course a besoin d'un Plan actif (§11). */
  readonly hasPlan: boolean;
  /** Décidé par l'EntitlementService, jamais par le moteur (§10). */
  readonly entitled: boolean;
}

export type WeatherEligibilityStatus =
  'eligible' | 'not_entitled' | 'too_early' | 'past' | 'no_plan' | 'missing_date' | 'missing_time';

export interface WeatherEligibility {
  readonly status: WeatherEligibilityStatus;
  readonly daysToStart: number | null;
  /** Le jour où la fenêtre s'ouvre, dans le fuseau du scope ; nul sans date. */
  readonly opensOn: string | null;
  /** Nul hors de la fenêtre : avant J-14, aucune tendance (§7). */
  readonly horizon: WeatherHorizon | null;
}

/**
 * Pourquoi des Conditions personnalisées sont, ou non, disponibles. Ordre :
 * la date, puis la fenêtre (une sortie à J-20 sans heure attend J-14 avant
 * qu'on lui demande son heure, §12), puis l'heure et le Plan, enfin les
 * droits — on ne propose pas un Race Pass pour une prévision qui n'existe pas
 * encore.
 */
export function weatherEligibility(input: WeatherEligibilityInput): WeatherEligibility {
  const startDate =
    input.startAt === null ? input.startDate : localDate(input.startAt, input.timezone);
  if (startDate === null) {
    return { status: 'missing_date', daysToStart: null, opensOn: null, horizon: null };
  }

  const days = daysToStart(input.now, startDate, input.timezone);
  const window = {
    daysToStart: days,
    opensOn: shiftDate(startDate, -WINDOW_DAYS),
    horizon: days >= 0 && days <= WINDOW_DAYS ? horizonOf(days) : null,
  };
  const status: WeatherEligibilityStatus =
    days > WINDOW_DAYS
      ? 'too_early'
      : days < 0
        ? 'past'
        : input.startAt === null
          ? 'missing_time'
          : input.scope === 'race_plan' && !input.hasPlan
            ? 'no_plan'
            : input.entitled
              ? 'eligible'
              : 'not_entitled';
  return { status, ...window };
}

/** §31, §32 : une prévision trop ancienne pour son horizon doit être rafraîchie. */
export function refreshDue(
  fetchedAt: string | null,
  now: string,
  horizon: WeatherHorizon,
  config: WeatherEngineConfig,
): boolean {
  if (fetchedAt === null) return true;
  const age = (Date.parse(now) - Date.parse(fetchedAt)) / 1000;
  return age >= config.refresh.maxAgeSeconds[horizon];
}
