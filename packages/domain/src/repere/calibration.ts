import { computeRepere, effortKm, REPERE_V0, type RepereConfig } from './engine.js';

/**
 * Calibrage du Repère PLUKA — docs/engines/REPERE_PLUKA.md §5.
 *
 * Pur et déterministe. Lit des couples anonymes (référence, temps couru) et dit
 * comment la version en cours s'en sort, puis ce qu'il faudrait changer. Il ne
 * modifie rien : une nouvelle version reste un changement de code, validé.
 */

export interface CalibrationSample {
  readonly referenceDistanceKm: number;
  readonly referenceElevationGainM: number;
  readonly referenceDurationSeconds: number;
  /** Mois entre la référence et la course. */
  readonly monthsBefore: number;
  readonly courseDistanceKm: number;
  readonly courseElevationGainM: number;
  readonly actualDurationSeconds: number;
}

export interface CalibrationReport {
  readonly configVersion: string;
  readonly samples: number;
  /** Couples où la version en cours refuse de répondre. */
  readonly refused: number;
  /** Part des temps réels dans la plage, sur les couples où une plage existe. */
  readonly coverage: number | null;
  /** Écart médian du temps réel au central : +0,05 = 5 % plus lent que prévu. */
  readonly medianBias: number | null;
  /** Exposant d'endurance ajusté sur les couples. */
  readonly fittedK: number | null;
  /** Demi-largeur (log) qui contiendrait la part visée des temps réels. */
  readonly suggestedWidth: number | null;
  readonly targetCoverage: number;
}

/** En dessous, les chiffres ne diraient rien : le rapport l'affiche sans conclure. */
export const MIN_CALIBRATION_SAMPLES = 10;

const TARGET_COVERAGE = 0.7;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Quantile par rang le plus proche : sans interpolation, reproductible. */
function quantile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index] as number;
}

/** Une date civile reconstituée : seul l'écart en mois compte pour le moteur. */
function referenceDateFor(monthsBefore: number): { readonly date: string; readonly today: string } {
  const year = 2000 + Math.floor((12 * 50 - monthsBefore) / 12);
  const month = (12 * 50 - monthsBefore) % 12;
  return {
    date: `${String(year)}-${String(month + 1).padStart(2, '0')}-15`,
    today: '2050-01-15',
  };
}

export function calibrateRepere(
  samples: readonly CalibrationSample[],
  config: RepereConfig = REPERE_V0,
): CalibrationReport {
  let refused = 0;
  let inside = 0;
  let ranged = 0;
  const biases: number[] = [];
  const points: { readonly x: number; readonly y: number }[] = [];

  for (const sample of samples) {
    const ratio =
      effortKm(sample.courseDistanceKm, sample.courseElevationGainM) /
      effortKm(sample.referenceDistanceKm, sample.referenceElevationGainM);
    const x = Math.log(ratio);
    const y = Math.log(sample.actualDurationSeconds / sample.referenceDurationSeconds);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });

    const { date, today } = referenceDateFor(Math.max(0, Math.round(sample.monthsBefore)));
    const result = computeRepere(
      {
        reference: {
          kind: 'effort',
          distanceKm: sample.referenceDistanceKm,
          elevationGainM: sample.referenceElevationGainM,
          durationSeconds: sample.referenceDurationSeconds,
          date,
        },
        course: {
          distanceKm: sample.courseDistanceKm,
          elevationGainM: sample.courseElevationGainM,
        },
        today,
      },
      config,
    );

    if (!result.ok) {
      refused += 1;
      continue;
    }

    ranged += 1;
    if (
      sample.actualDurationSeconds >= result.lowSeconds &&
      sample.actualDurationSeconds <= result.highSeconds
    ) {
      inside += 1;
    }
    biases.push(sample.actualDurationSeconds / result.centralSeconds - 1);
  }

  // Moindres carrés par l'origine : y = k·x, avec x = ln(r) et y = ln(t / t_ref).
  const sxx = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const sxy = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const fittedK = sxx > 1e-9 ? sxy / sxx : null;

  const residuals =
    fittedK === null ? [] : points.map((point) => Math.abs(point.y - fittedK * point.x));

  return {
    configVersion: config.version,
    samples: samples.length,
    refused,
    coverage: ranged === 0 ? null : inside / ranged,
    medianBias: median(biases),
    fittedK,
    suggestedWidth: quantile(residuals, TARGET_COVERAGE),
    targetCoverage: TARGET_COVERAGE,
  };
}
