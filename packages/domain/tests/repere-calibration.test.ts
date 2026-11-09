import { describe, expect, it } from 'vitest';

import { REPERE_V0, calibrateRepere, type CalibrationSample } from '../src/index.js';

/**
 * Calibrage du Repère — REPERE_PLUKA §5. Des couples construits à la main,
 * dont on connaît la réponse.
 */

/** Un couple où le temps couru suit exactement t = t_ref × r^k. */
function sample(k: number, courseDistanceKm: number, factor = 1): CalibrationSample {
  const reference = 28; // 20 km + 800 m D+
  const course = courseDistanceKm + 1800 / 100;
  return {
    referenceDistanceKm: 20,
    referenceElevationGainM: 800,
    referenceDurationSeconds: 9000,
    monthsBefore: 2,
    courseDistanceKm,
    courseElevationGainM: 1800,
    actualDurationSeconds: Math.round(9000 * (course / reference) ** k * factor),
  };
}

describe('calibrateRepere', () => {
  it('retrouve l’exposant qui a produit les temps', () => {
    const report = calibrateRepere([sample(1.12, 30), sample(1.12, 42), sample(1.12, 55)]);

    expect(report.fittedK).toBeCloseTo(1.12, 3);
    expect(report.samples).toBe(3);
  });

  it('des temps conformes à la version tombent dans la plage, sans biais', () => {
    const report = calibrateRepere([sample(REPERE_V0.k, 30), sample(REPERE_V0.k, 42)]);

    expect(report.coverage).toBe(1);
    expect(Math.abs(report.medianBias ?? 1)).toBeLessThan(0.02);
  });

  it('des coureurs plus lents de 20 % sortent de la plage et donnent un biais positif', () => {
    const report = calibrateRepere([sample(REPERE_V0.k, 30, 1.2), sample(REPERE_V0.k, 42, 1.2)]);

    expect(report.coverage).toBe(0);
    expect(report.medianBias ?? 0).toBeGreaterThan(0.15);
  });

  it('compte à part les couples que la version refuse', () => {
    const tooFar = { ...sample(1.07, 42), courseDistanceKm: 160, courseElevationGainM: 9000 };
    const report = calibrateRepere([tooFar, sample(1.07, 42)]);

    expect(report.refused).toBe(1);
    expect(report.coverage).toBe(1);
  });

  it('sans couple, ne conclut rien', () => {
    expect(calibrateRepere([])).toMatchObject({
      samples: 0,
      coverage: null,
      medianBias: null,
      fittedK: null,
      suggestedWidth: null,
    });
  });

  it('même entrée, même rapport', () => {
    const samples = [sample(1.1, 30, 1.05), sample(1.1, 50, 0.95)];
    expect(calibrateRepere(samples)).toEqual(calibrateRepere(samples));
  });
});
