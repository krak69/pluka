import { civilMoment, civilToInstant } from '../site/editing.js';

/**
 * Éligibilité au tarif early bird du Race Pass — 00_PRODUCT_SPEC §6.5,
 * 04_ENTITLEMENTS §72.1.
 *
 * Pure, horloge injectée (AGENTS §35). Le tarif change le prix, jamais
 * l'entitlement : cette fonction ne décide d'aucun droit.
 *
 * Deux conditions, toutes deux nécessaires :
 *
 *   1. l'achat a lieu dans les 15 jours suivant le jour d'inscription. Les
 *      jours sont civils, dans le fuseau de la course, et le dernier compte en
 *      entier : inscrit le 1er mars, le tarif tient jusqu'au 16 mars 23:59
 *      (décision du 2026-11-12) ;
 *   2. l'achat a lieu au moins 60 jours avant le départ de la course.
 */

export const EARLY_BIRD_DAYS_AFTER_REGISTRATION = 15;
export const EARLY_BIRD_MIN_DAYS_BEFORE_START = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RegistrationOrigin = 'verified' | 'declared';

export interface RegistrationReference {
  /** Jour civil d'inscription, AAAA-MM-JJ, dans le fuseau de la course. */
  readonly day: string;
  readonly origin: RegistrationOrigin;
}

/**
 * La date d'inscription de référence (§6.5.3). Une date vérifiée prévaut
 * toujours, même quand elle rend l'achat inéligible ; à défaut, le jour de
 * création de la participation, lu dans le fuseau de la course.
 */
export function registrationReference(input: {
  readonly verifiedOn: string | null;
  readonly participationCreatedAt: string;
  readonly timeZone: string;
}): RegistrationReference {
  return input.verifiedOn === null
    ? { day: civilMoment(input.participationCreatedAt, input.timeZone).day, origin: 'declared' }
    : { day: input.verifiedOn, origin: 'verified' };
}

export interface EarlyBirdWindow {
  /** Premier instant hors tarif : l'achat doit avoir lieu strictement avant. */
  readonly endsBefore: string;
  /** Dernier jour civil du tarif, pour l'affichage (« Tarif inscrit jusqu'au … »). */
  readonly lastDay: string;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * La fenêtre du tarif. Nulle sans heure de départ : la seconde condition ne
 * peut pas se vérifier, et rien n'est supposé (AGENTS §38).
 */
export function earlyBirdWindow(
  registration: RegistrationReference,
  raceStartsAt: string | null,
  timeZone: string,
): EarlyBirdWindow | null {
  if (raceStartsAt === null) return null;

  const afterRegistration = Date.parse(
    civilToInstant(
      addDays(registration.day, EARLY_BIRD_DAYS_AFTER_REGISTRATION + 1),
      '00:00',
      timeZone,
    ),
  );
  // « Au moins 60 jours avant » : l'instant exact des 60 jours reste dans le tarif.
  const beforeStart = Date.parse(raceStartsAt) - EARLY_BIRD_MIN_DAYS_BEFORE_START * DAY_MS + 1;

  const endsBefore = Math.min(afterRegistration, beforeStart);

  return {
    endsBefore: new Date(endsBefore).toISOString(),
    lastDay: civilMoment(new Date(endsBefore - 1).toISOString(), timeZone).day,
  };
}

export function isEarlyBirdEligible(
  registration: RegistrationReference,
  raceStartsAt: string | null,
  timeZone: string,
  now: string,
): boolean {
  const window = earlyBirdWindow(registration, raceStartsAt, timeZone);
  return window !== null && Date.parse(now) < Date.parse(window.endsBefore);
}
