import { describe, expect, it } from 'vitest';

import {
  aggregateSegmentWeights,
  clampGrade,
  fatigueFactor,
  gradeFactor,
  gradeFactorFor,
  microSegmentWeight,
  PLAN_ENGINE_V1,
  technicalityFactor,
} from '../src/index.js';
import { buildCourse } from './fixtures/course.js';

/**
 * Modèle de coût — docs/engines/PLAN_ENGINE.md §10 à §13.
 *
 * Les valeurs attendues sont celles des tableaux de la spécification, ou des
 * interpolations calculables de tête. Aucune n'est une capture d'exécution.
 */

const config = PLAN_ENGINE_V1;

describe('facteur de pente (§11)', () => {
  it('reprend exactement les points d’ancrage de la courbe', () => {
    const anchors: readonly (readonly [number, number])[] = [
      [-0.4, 1.4],
      [-0.3, 1.2],
      [-0.2, 0.95],
      [-0.15, 0.86],
      [-0.1, 0.82],
      [-0.05, 0.9],
      [0, 1.0],
      [0.05, 1.25],
      [0.1, 1.6],
      [0.15, 2.1],
      [0.2, 2.8],
      [0.3, 4.1],
      [0.4, 5.5],
    ];

    for (const [grade, factor] of anchors) {
      expect(gradeFactor(grade, config.gradeCurve), `pente ${grade}`).toBeCloseTo(factor, 10);
    }
  });

  it('interpole linéairement entre deux points (§11.1)', () => {
    // Milieu de [+5 %, +10 %] : (1.25 + 1.60) / 2 = 1.425.
    expect(gradeFactor(0.075, config.gradeCurve)).toBeCloseTo(1.425, 10);
    // Milieu de [-10 %, -5 %] : (0.82 + 0.90) / 2 = 0.86.
    expect(gradeFactor(-0.075, config.gradeCurve)).toBeCloseTo(0.86, 10);
    // Quart de [0 %, +5 %] : 1.00 + 0.25 × 0.25 = 1.0625.
    expect(gradeFactor(0.0125, config.gradeCurve)).toBeCloseTo(1.0625, 10);
  });

  it('borne la pente du modèle à ±40 % (§11.2)', () => {
    expect(clampGrade(0.75, config.gradeClampRatio)).toBe(0.4);
    expect(clampGrade(-0.75, config.gradeClampRatio)).toBe(-0.4);
    expect(clampGrade(0.12, config.gradeClampRatio)).toBe(0.12);

    // Une pente brute de 60 % coûte comme 40 % : le signal reste dans les
    // données de diagnostic, le modèle ne l'extrapole pas.
    expect(gradeFactorFor(0.6, config)).toBe(5.5);
    expect(gradeFactorFor(-0.6, config)).toBe(1.4);
  });

  it('dit qu’une descente modérée est plus rapide que le plat (§11.3)', () => {
    expect(gradeFactor(-0.1, config.gradeCurve)).toBeLessThan(1);
    expect(gradeFactor(-0.15, config.gradeCurve)).toBeLessThan(1);
  });

  it('et qu’une descente très raide redevient coûteuse (§11.3)', () => {
    expect(gradeFactor(-0.3, config.gradeCurve)).toBeGreaterThan(1);
    expect(gradeFactor(-0.4, config.gradeCurve)).toBeGreaterThan(
      gradeFactor(-0.3, config.gradeCurve),
    );
  });

  it('concentre le temps dans les montées raides (§11.3)', () => {
    expect(gradeFactor(0.2, config.gradeCurve)).toBeGreaterThan(
      2 * gradeFactor(0.05, config.gradeCurve),
    );
  });
});

describe('technicité (§12)', () => {
  it('reprend les quatre classes du tableau', () => {
    expect(technicalityFactor('smooth', config)).toBe(1.0);
    expect(technicalityFactor('standard', config)).toBe(1.05);
    expect(technicalityFactor('technical', config)).toBe(1.12);
    expect(technicalityFactor('very_technical', config)).toBe(1.22);
  });

  it('n’invente rien quand la donnée manque (§12.1)', () => {
    // « Si la technicité n'est pas connue, technicality_factor = 1.00. »
    // Absent ne veut pas dire « trail standard » : ce serait inventer un
    // terrain, et 1.05 au lieu de 1.00 déplacerait du temps sans raison.
    expect(technicalityFactor(null, config)).toBe(1.0);
    expect(technicalityFactor(null, config)).not.toBe(config.technicalityFactors.standard);
  });
});

describe('fatigue de progression (§13)', () => {
  it('suit 1 + alpha × p²', () => {
    expect(fatigueFactor(0, config)).toBe(1);
    expect(fatigueFactor(0.5, config)).toBeCloseTo(1.025, 10);
    expect(fatigueFactor(1, config)).toBeCloseTo(1.1, 10);
  });

  it('reste entre 1.00 et 1.10', () => {
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const factor = fatigueFactor(progress, config);
      expect(factor).toBeGreaterThanOrEqual(1);
      expect(factor).toBeLessThanOrEqual(1.1);
    }
  });
});

describe('poids relatif (§10)', () => {
  it('multiplie distance, pente, technicité et fatigue', () => {
    // 1000 m × facteur(+10 %) 1.60 × technique 1.12 × fatigue(0.5) 1.025
    // = 1000 × 1.60 × 1.12 × 1.025 = 1836.8
    const course = buildCourse([{ distanceMeters: 1000, grade: 0.1, technicality: 'technical' }]);
    const micro = {
      ...(course.microSegments[0] as (typeof course.microSegments)[number]),
      progress: 0.5,
    };

    expect(microSegmentWeight(micro, config).weight).toBeCloseTo(1836.8, 6);
  });

  it('n’est pas une durée : deux segments de même distance pèsent différemment', () => {
    // §67, critère 7 : « le temps n'est pas réparti uniquement selon la
    // distance ».
    const course = buildCourse([
      { distanceMeters: 5000, grade: 0 },
      { distanceMeters: 5000, grade: 0.1 },
    ]);

    const weights = aggregateSegmentWeights(course.microSegments, course.raceSegments, config);

    expect((weights[1] as (typeof weights)[number]).weight).toBeGreaterThan(
      1.5 * (weights[0] as (typeof weights)[number]).weight,
    );
  });

  it('agrège les micro-segments par segment de course', () => {
    const course = buildCourse([{ distanceMeters: 2000, grade: 0 }]);
    const weights = aggregateSegmentWeights(course.microSegments, course.raceSegments, config);

    expect(weights).toHaveLength(1);
    expect((weights[0] as (typeof weights)[number]).microSegmentCount).toBe(1);
  });
});
