import { describe, expect, it } from 'vitest';

import {
  WEATHER_ENGINE_V1,
  daysToStart,
  horizonOf,
  localDate,
  refreshDue,
  weatherEligibility,
  type WeatherEligibilityInput,
} from '../src/index.js';

/**
 * La fenêtre J-14 — WEATHER_CONDITIONS §6 à §12, W01 à W06. Une course le
 * samedi 12 septembre 2026, départ 06:00 à Chamonix (04:00 UTC).
 */

const RACE_START = '2026-09-12T04:00:00.000Z';

function race(now: string, patch: Partial<WeatherEligibilityInput> = {}): WeatherEligibilityInput {
  return {
    scope: 'race_plan',
    now,
    timezone: 'Europe/Paris',
    startAt: RACE_START,
    startDate: null,
    hasPlan: true,
    entitled: true,
    ...patch,
  };
}

describe('la fenêtre J-14 (§6)', () => {
  it('W01 — J-15 : pas encore, et le jour d’ouverture est connu', () => {
    expect(weatherEligibility(race('2026-08-28T10:00:00.000Z'))).toEqual({
      status: 'too_early',
      daysToStart: 15,
      opensOn: '2026-08-29',
      horizon: null,
    });
  });

  it('W02 — J-14 avec un Race Pass : éligible, prévision lointaine', () => {
    expect(weatherEligibility(race('2026-08-29T00:30:00.000Z'))).toMatchObject({
      status: 'eligible',
      daysToStart: 14,
      horizon: 'far',
    });
  });

  it('W03 — sans droit à J-7 : pas de prévision personnalisée', () => {
    expect(weatherEligibility(race('2026-09-05T08:00:00.000Z', { entitled: false }))).toMatchObject(
      { status: 'not_entitled', daysToStart: 7, horizon: 'medium' },
    );
  });

  it('compte en jours du fuseau de la course, pas en UTC', () => {
    // 22:30 UTC le 28 août, c'est déjà le 29 à Paris : J-14.
    expect(localDate('2026-08-28T22:30:00.000Z', 'Europe/Paris')).toBe('2026-08-29');
    expect(daysToStart('2026-08-28T22:30:00.000Z', '2026-09-12', 'Europe/Paris')).toBe(14);
    expect(weatherEligibility(race('2026-08-28T22:30:00.000Z')).status).toBe('eligible');
  });

  it('le jour J reste ouvert ; le lendemain du départ, c’est passé', () => {
    expect(weatherEligibility(race('2026-09-12T15:00:00.000Z'))).toMatchObject({
      status: 'eligible',
      daysToStart: 0,
      horizon: 'race_day',
    });
    expect(weatherEligibility(race('2026-09-13T09:00:00.000Z')).status).toBe('past');
  });

  it('une course sans Plan attend son Plan (§11)', () => {
    expect(weatherEligibility(race('2026-09-05T08:00:00.000Z', { hasPlan: false })).status).toBe(
      'no_plan',
    );
  });

  it('ne propose pas de droits pour une prévision qui n’existe pas encore', () => {
    expect(weatherEligibility(race('2026-08-01T08:00:00.000Z', { entitled: false })).status).toBe(
      'too_early',
    );
  });
});

describe('une sortie (§12)', () => {
  const outing = (patch: Partial<WeatherEligibilityInput>) =>
    weatherEligibility({
      scope: 'outing',
      now: '2026-09-01T08:00:00.000Z',
      timezone: 'Europe/Paris',
      startAt: null,
      startDate: null,
      hasPlan: false,
      entitled: true,
      ...patch,
    });

  it('W04 — sans date : il manque la date', () => {
    expect(outing({})).toMatchObject({ status: 'missing_date', daysToStart: null });
  });

  it('W05 — à J-5 sans heure : il manque l’heure', () => {
    expect(outing({ startDate: '2026-09-06' })).toMatchObject({
      status: 'missing_time',
      daysToStart: 5,
    });
  });

  it('W06 — à J-5 avec son heure : éligible, sans Plan', () => {
    expect(outing({ startAt: '2026-09-06T07:00:00.000Z' }).status).toBe('eligible');
  });

  it('à J-20 sans heure : on attend d’abord J-14', () => {
    expect(outing({ startDate: '2026-09-21' }).status).toBe('too_early');
  });
});

describe('horizon et fraîcheur (§9, §32)', () => {
  it('donne un libellé qualitatif par tranche de jours', () => {
    expect([14, 8, 7, 4, 3, 1, 0].map(horizonOf)).toEqual([
      'far',
      'far',
      'medium',
      'medium',
      'near',
      'near',
      'race_day',
    ]);
  });

  it('rafraîchit une prévision trop ancienne pour son horizon, jamais à chaque affichage', () => {
    const now = '2026-09-10T12:00:00.000Z';
    expect(refreshDue(null, now, 'near', WEATHER_ENGINE_V1)).toBe(true);
    expect(refreshDue('2026-09-10T10:00:00.000Z', now, 'near', WEATHER_ENGINE_V1)).toBe(false);
    expect(refreshDue('2026-09-10T09:00:00.000Z', now, 'near', WEATHER_ENGINE_V1)).toBe(true);
    expect(refreshDue('2026-09-10T09:00:00.000Z', now, 'far', WEATHER_ENGINE_V1)).toBe(false);
  });
});
