import { describe, expect, it } from 'vitest';

import { REPERE_V0, computeRepere, effortKm, type RepereInput } from '../src/index.js';

/**
 * Repère PLUKA V0 — docs/engines/REPERE_PLUKA.md §7.
 *
 * Les valeurs attendues sont calculées à la main depuis §3 et la configuration
 * `repere-v0.1.0` : un changement de constante doit casser ces tests.
 */

const BASE: RepereInput = {
  // Une sortie de 20 km et 800 m D+ en 2h30, il y a deux mois.
  reference: {
    kind: 'effort',
    distanceKm: 20,
    elevationGainM: 800,
    durationSeconds: 9000,
    date: '2026-09-09',
  },
  // Un 42 km à 1 800 m D+.
  course: { distanceKm: 42, elevationGainM: 1800 },
  today: '2026-11-09',
};

describe('le km-effort', () => {
  it('ajoute un kilomètre par centaine de mètres de D+', () => {
    expect(effortKm(20, 800)).toBe(28);
    expect(effortKm(42, 1800)).toBe(60);
  });
});

describe('la plage', () => {
  it('transpose la référence avec l’exposant d’endurance', () => {
    const result = computeRepere(BASE);
    // r = 60 / 28 ; central = 9000 × r^1.07 ≈ 20 291 s ≈ 5h38 → 5h40 arrondi.
    const ratio = 60 / 28;
    const central = 9000 * ratio ** 1.07;
    const width = 0.06 + 0.05 * Math.log(ratio);

    expect(result).toEqual({
      ok: true,
      lowSeconds: Math.round((central * Math.exp(-width)) / 300) * 300,
      centralSeconds: Math.round(central / 300) * 300,
      highSeconds: Math.round((central * Math.exp(width)) / 300) * 300,
      approximate: false,
      configVersion: 'repere-v0.1.0',
    });
    if (result.ok) expect(result.centralSeconds).toBe(20400);
  });

  it('REP-01 — même entrée, même plage', () => {
    expect(computeRepere(BASE)).toEqual(computeRepere(BASE));
  });

  it('REP-02 — bas < central < haut, arrondis à 5 minutes', () => {
    const result = computeRepere(BASE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lowSeconds).toBeLessThan(result.centralSeconds);
    expect(result.centralSeconds).toBeLessThan(result.highSeconds);
    for (const value of [result.lowSeconds, result.centralSeconds, result.highSeconds]) {
      expect(value % 300).toBe(0);
    }
  });

  it('REP-03 — plus long ou plus dénivelé, central plus long', () => {
    const longer = computeRepere({ ...BASE, course: { distanceKm: 50, elevationGainM: 1800 } });
    const steeper = computeRepere({ ...BASE, course: { distanceKm: 42, elevationGainM: 2600 } });
    const base = computeRepere(BASE);

    expect(base.ok && longer.ok && steeper.ok).toBe(true);
    if (!base.ok || !longer.ok || !steeper.ok) return;
    expect(longer.centralSeconds).toBeGreaterThan(base.centralSeconds);
    expect(steeper.centralSeconds).toBeGreaterThan(base.centralSeconds);
  });

  it('REP-04 — l’allure de secours élargit la plage et se dit approximative', () => {
    // 600 s/km-effort, soit l'allure de la référence ci-dessus sur 15 km-effort.
    const effort = computeRepere({
      ...BASE,
      reference: {
        kind: 'effort',
        distanceKm: 15,
        elevationGainM: 0,
        durationSeconds: 9000,
        date: null,
      },
    });
    const pace = computeRepere({ ...BASE, reference: { kind: 'pace', secondsPerKm: 600 } });

    expect(effort.ok && pace.ok).toBe(true);
    if (!effort.ok || !pace.ok) return;
    expect(pace.approximate).toBe(true);
    expect(pace.highSeconds - pace.lowSeconds).toBeGreaterThan(
      effort.highSeconds - effort.lowSeconds,
    );
  });

  it('un effort ancien élargit la plage, sans dépasser le plafond', () => {
    const recent = computeRepere(BASE);
    const old = computeRepere({
      ...BASE,
      reference: { ...BASE.reference, date: '2025-05-09' } as RepereInput['reference'],
    });

    expect(recent.ok && old.ok).toBe(true);
    if (!recent.ok || !old.ok) return;
    expect(old.highSeconds - old.lowSeconds).toBeGreaterThan(
      recent.highSeconds - recent.lowSeconds,
    );
  });
});

describe('REP-05 — pas de Repère', () => {
  const reason = (input: RepereInput) => {
    const result = computeRepere(input);
    return result.ok ? null : result.reason;
  };

  it('sans D+ de la course', () => {
    expect(reason({ ...BASE, course: { distanceKm: 42, elevationGainM: null } })).toBe(
      'course_elevation_unknown',
    );
  });

  it('pour une référence trop courte', () => {
    expect(
      reason({
        ...BASE,
        reference: {
          kind: 'effort',
          distanceKm: 3,
          elevationGainM: 50,
          durationSeconds: 1200,
          date: null,
        },
      }),
    ).toBe('reference_too_short');
  });

  it('quand les efforts sont trop éloignés', () => {
    expect(reason({ ...BASE, course: { distanceKm: 100, elevationGainM: 6000 } })).toBe('too_far');
  });

  it('pour une référence trop ancienne', () => {
    expect(
      reason({
        ...BASE,
        reference: { ...BASE.reference, date: '2024-09-01' } as RepereInput['reference'],
      }),
    ).toBe('reference_too_old');
  });

  it('pour une allure invraisemblable', () => {
    expect(
      reason({
        ...BASE,
        reference: {
          kind: 'effort',
          distanceKm: 20,
          elevationGainM: 800,
          durationSeconds: 1800,
          date: null,
        },
      }),
    ).toBe('implausible_reference');
  });

  it('chaque refus porte la version', () => {
    expect(computeRepere({ ...BASE, course: { distanceKm: 42, elevationGainM: null } })).toEqual({
      ok: false,
      reason: 'course_elevation_unknown',
      configVersion: REPERE_V0.version,
    });
  });
});
