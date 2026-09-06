import type { GradeCurvePoint, PlanEngineConfig } from './config.js';

/**
 * Facteur de pente — docs/engines/PLAN_ENGINE.md §11.
 *
 * « La V1 utilise une courbe de calibration versionnée, interpolée
 * linéairement entre les points d'ancrage. »
 *
 * La courbe n'est pas une vérité physiologique (§11.3). Elle dit seulement
 * qu'une descente modérée coûte moins qu'un plat, qu'une descente très raide
 * redevient coûteuse, et qu'une montée raide concentre du temps.
 */

/** §11.2 — `grade_used = clamp(raw_grade, -0.40, +0.40)`. */
export function clampGrade(rawGrade: number, clampRatio: number): number {
  if (rawGrade < -clampRatio) return -clampRatio;
  if (rawGrade > clampRatio) return clampRatio;

  return rawGrade;
}

/**
 * Interpolation linéaire entre les deux points encadrant la pente — §11.1.
 *
 * ```text
 * factor(g) = f1 + (f2 - f1) × (g - g1) / (g2 - g1)
 * ```
 *
 * Hors de la courbe, le facteur du point extrême s'applique tel quel. Le cap
 * de §11.2 rend d'ailleurs ce cas inatteignable pour une pente déjà bornée :
 * la garde existe pour qu'une courbe plus étroite ne produise jamais
 * d'extrapolation silencieuse.
 */
export function gradeFactor(grade: number, curve: readonly GradeCurvePoint[]): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('courbe de pente vide : la configuration moteur est incomplète');
  }

  if (grade <= first.grade) return first.factor;
  if (grade >= last.grade) return last.factor;

  for (let index = 1; index < curve.length; index += 1) {
    const lower = curve[index - 1] as GradeCurvePoint;
    const upper = curve[index] as GradeCurvePoint;

    if (grade <= upper.grade) {
      const span = upper.grade - lower.grade;
      // Deux points de même pente rendraient la division indéfinie ; la borne
      // basse fait alors autorité plutôt que de produire un NaN.
      if (span === 0) return lower.factor;

      return lower.factor + ((upper.factor - lower.factor) * (grade - lower.grade)) / span;
    }
  }

  return last.factor;
}

/** Facteur appliqué à une pente brute : cap puis interpolation. */
export function gradeFactorFor(rawGrade: number, config: PlanEngineConfig): number {
  return gradeFactor(clampGrade(rawGrade, config.gradeClampRatio), config.gradeCurve);
}
