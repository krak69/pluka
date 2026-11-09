/**
 * Repère PLUKA V0 — docs/engines/REPERE_PLUKA.md.
 *
 * Une plage indicative, jamais un chrono précis (00_PRODUCT_SPEC §9.2). Pur et
 * déterministe : aucune I/O, aucune horloge implicite — l'âge de l'effort se
 * calcule depuis une date passée par l'appelant (AGENTS §35). Il n'entre jamais
 * dans le calcul du Plan (PLAN_ENGINE §46).
 */

export interface RepereConfig {
  readonly version: string;
  /** Exposant d'endurance : l'allure se dégrade quand l'effort s'allonge. */
  readonly k: number;
  /** Effort fictif, en km-effort, porté par l'allure de secours. */
  readonly paceReferenceEffort: number;
  readonly widthBase: number;
  readonly widthDistance: number;
  readonly widthAgePerMonth: number;
  readonly ageFreeMonths: number;
  readonly widthAgeMax: number;
  readonly widthPace: number;
  readonly minReferenceEffort: number;
  readonly maxEffortRatio: number;
  readonly maxAgeMonths: number;
  /** Allure plausible, en secondes par km-effort. */
  readonly minSecondsPerEffortKm: number;
  readonly maxSecondsPerEffortKm: number;
  /** Arrondi des bornes, en secondes. */
  readonly roundingSeconds: number;
}

/** Valeurs de départ, non calibrées (§4). Une modification crée une nouvelle version. */
export const REPERE_V0: RepereConfig = {
  version: 'repere-v0.1.0',
  k: 1.07,
  paceReferenceEffort: 15,
  widthBase: 0.06,
  widthDistance: 0.05,
  widthAgePerMonth: 0.01,
  ageFreeMonths: 3,
  widthAgeMax: 0.06,
  widthPace: 0.12,
  minReferenceEffort: 5,
  maxEffortRatio: 4,
  maxAgeMonths: 24,
  minSecondsPerEffortKm: 180,
  maxSecondsPerEffortKm: 1800,
  roundingSeconds: 300,
};

export type RepereReference =
  | {
      readonly kind: 'effort';
      readonly distanceKm: number;
      readonly elevationGainM: number;
      readonly durationSeconds: number;
      /** Date civile `YYYY-MM-DD`, ou nulle. */
      readonly date: string | null;
    }
  | { readonly kind: 'pace'; readonly secondsPerKm: number };

export interface RepereInput {
  readonly reference: RepereReference;
  readonly course: { readonly distanceKm: number; readonly elevationGainM: number | null };
  /** Date civile du jour, `YYYY-MM-DD`, passée par l'appelant. */
  readonly today: string;
}

export type RepereRefusal =
  | 'course_elevation_unknown'
  | 'reference_too_short'
  | 'too_far'
  | 'reference_too_old'
  | 'implausible_reference';

export type RepereResult =
  | {
      readonly ok: true;
      readonly lowSeconds: number;
      readonly centralSeconds: number;
      readonly highSeconds: number;
      /** L'allure de secours : la plage se dit « approximative ». */
      readonly approximate: boolean;
      readonly configVersion: string;
    }
  | { readonly ok: false; readonly reason: RepereRefusal; readonly configVersion: string };

/** km-effort : distance + D+ / 100 (§3.1). */
export function effortKm(distanceKm: number, elevationGainM: number): number {
  return distanceKm + elevationGainM / 100;
}

/** Mois entiers écoulés entre deux dates civiles. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

function round(seconds: number, step: number): number {
  return Math.max(step, Math.round(seconds / step) * step);
}

export function computeRepere(input: RepereInput, config: RepereConfig = REPERE_V0): RepereResult {
  const refuse = (reason: RepereRefusal): RepereResult => ({
    ok: false,
    reason,
    configVersion: config.version,
  });

  if (input.course.elevationGainM === null) return refuse('course_elevation_unknown');

  const { reference } = input;
  const effortRef =
    reference.kind === 'effort'
      ? effortKm(reference.distanceKm, reference.elevationGainM)
      : config.paceReferenceEffort;
  const timeRef =
    reference.kind === 'effort'
      ? reference.durationSeconds
      : reference.secondsPerKm * config.paceReferenceEffort;

  if (reference.kind === 'effort' && effortRef < config.minReferenceEffort) {
    return refuse('reference_too_short');
  }

  const pace = timeRef / effortRef;
  if (pace < config.minSecondsPerEffortKm || pace > config.maxSecondsPerEffortKm) {
    return refuse('implausible_reference');
  }

  const age =
    reference.kind === 'effort' && reference.date !== null
      ? monthsBetween(reference.date, input.today)
      : 0;
  if (age > config.maxAgeMonths) return refuse('reference_too_old');

  const ratio = effortKm(input.course.distanceKm, input.course.elevationGainM) / effortRef;
  if (ratio > config.maxEffortRatio || ratio < 1 / config.maxEffortRatio) return refuse('too_far');

  const central = timeRef * ratio ** config.k;
  const width =
    config.widthBase +
    config.widthDistance * Math.abs(Math.log(ratio)) +
    Math.min(
      config.widthAgeMax,
      config.widthAgePerMonth * Math.max(0, age - config.ageFreeMonths),
    ) +
    (reference.kind === 'pace' ? config.widthPace : 0);

  const step = config.roundingSeconds;
  const lowSeconds = round(central * Math.exp(-width), step);
  const centralSeconds = round(central, step);
  // L'arrondi peut écraser une plage étroite : le haut reste au-dessus du bas.
  const highSeconds = Math.max(round(central * Math.exp(width), step), lowSeconds + step);

  return {
    ok: true,
    lowSeconds,
    centralSeconds: Math.min(Math.max(centralSeconds, lowSeconds), highSeconds),
    highSeconds,
    approximate: reference.kind === 'pace',
    configVersion: config.version,
  };
}
