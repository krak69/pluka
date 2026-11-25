import { describe, expect, it } from 'vitest';

import {
  SUNRISE_ALTITUDE_DEG,
  WEATHER_ENGINE_V1,
  nightPeriods,
  solarAltitudeDeg,
} from '../src/index.js';
import { HOUR, routePoint } from './fixtures.js';

/**
 * La Nuit — WEATHER_CONDITIONS §44 à §49, W23 à W25.
 *
 * Références : Paris, lever 05:47 et coucher 21:58 (heure d'été) au solstice
 * de juin, 08:42 et 16:56 (heure d'hiver) au solstice de décembre — des
 * heures qui varient de moins d'une minute d'une année à l'autre. Tolérance :
 * 2 minutes, la précision annoncée de l'algorithme NOAA.
 */

const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const TOLERANCE_MS = 2 * 60 * 1000;

/** Une course immobile à Paris : seule l'heure fait la nuit. */
function stay(startAt: string, hours: number) {
  return [0, hours / 2, hours].map((share, index) =>
    routePoint(`p${String(index)}`, share * HOUR, startAt, PARIS.latitude, PARIS.longitude),
  );
}

function near(actual: string | undefined, expected: string): void {
  expect(Math.abs(Date.parse(actual ?? '') - Date.parse(expected))).toBeLessThanOrEqual(
    TOLERANCE_MS,
  );
}

describe('la position du soleil', () => {
  it('est au-dessus de l’horizon à midi, en dessous à minuit', () => {
    expect(
      solarAltitudeDeg(new Date('2026-06-21T11:50:00.000Z'), PARIS.latitude, PARIS.longitude),
    ).toBeGreaterThan(60);
    expect(
      solarAltitudeDeg(new Date('2026-06-21T23:50:00.000Z'), PARIS.latitude, PARIS.longitude),
    ).toBeLessThan(SUNRISE_ALTITUDE_DEG);
  });
});

describe('les périodes de nuit', () => {
  it('W23 — un départ avant le lever : nuit du départ au lever', () => {
    // Départ 05:00 (03:00 UTC) le 21 juin, 4 h de course ; lever 05:47.
    const startAt = '2026-06-21T03:00:00.000Z';
    const [period, ...rest] = nightPeriods(startAt, stay(startAt, 4), WEATHER_ENGINE_V1);

    expect(rest).toEqual([]);
    expect(period).toMatchObject({ fromStart: true, untilFinish: false, startPointKey: 'p0' });
    expect(period?.startDatetime).toBe(startAt);
    near(period?.endDatetime, '2026-06-21T03:47:00.000Z');
  });

  it('W24 — un coucher avant l’arrivée : nuit du coucher à l’arrivée', () => {
    // Départ 13:00 (12:00 UTC) le 21 décembre, 6 h ; coucher 16:56.
    const startAt = '2026-12-21T12:00:00.000Z';
    const [period] = nightPeriods(startAt, stay(startAt, 6), WEATHER_ENGINE_V1);

    expect(period).toMatchObject({ fromStart: false, untilFinish: true, endPointKey: 'p2' });
    near(period?.startDatetime, '2026-12-21T15:56:00.000Z');
    expect(period?.endDatetime).toBe('2026-12-21T18:00:00.000Z');
  });

  it('une course de 30 h traverse une nuit entière, puis entame la suivante', () => {
    // Départ 18:00 (16:00 UTC) le 21 juin, arrivée minuit le 23 : coucher
    // 21:58, lever 05:47, puis coucher 21:58 le 22 jusqu'à l'arrivée.
    const startAt = '2026-06-21T16:00:00.000Z';
    const periods = nightPeriods(startAt, stay(startAt, 30), WEATHER_ENGINE_V1);

    expect(periods).toHaveLength(2);
    near(periods[0]?.startDatetime, '2026-06-21T19:58:00.000Z');
    near(periods[0]?.endDatetime, '2026-06-22T03:47:00.000Z');
    expect(periods[0]).toMatchObject({ fromStart: false, untilFinish: false });
    near(periods[1]?.startDatetime, '2026-06-22T19:58:00.000Z');
    expect(periods[1]).toMatchObject({
      endDatetime: '2026-06-22T22:00:00.000Z',
      untilFinish: true,
    });
  });

  it('une course de jour n’a pas de nuit', () => {
    const startAt = '2026-06-21T07:00:00.000Z';

    expect(nightPeriods(startAt, stay(startAt, 8), WEATHER_ENGINE_V1)).toEqual([]);
  });

  it('le soleil de minuit : pas de nuit au-delà du cercle polaire en juin', () => {
    const startAt = '2026-06-21T18:00:00.000Z';
    const tromso = [0, 6, 12].map((hours, index) =>
      routePoint(`t${String(index)}`, hours * HOUR, startAt, 69.65, 18.96),
    );

    expect(nightPeriods(startAt, tromso, WEATHER_ENGINE_V1)).toEqual([]);
  });

  it('suit le coureur : le coucher dépend de l’endroit où il se trouve', () => {
    // Même heure de départ, mais le coureur file vers l'ouest : il garde le soleil plus longtemps.
    const startAt = '2026-12-21T14:00:00.000Z';
    const east = nightPeriods(startAt, stay(startAt, 4), WEATHER_ENGINE_V1)[0];
    const westward = [0, 2, 4].map((hours, index) =>
      routePoint(
        `w${String(index)}`,
        hours * HOUR,
        startAt,
        PARIS.latitude,
        PARIS.longitude - hours * 3,
      ),
    );
    const west = nightPeriods(startAt, westward, WEATHER_ENGINE_V1)[0];

    expect(Date.parse(west?.startDatetime ?? '')).toBeGreaterThan(
      Date.parse(east?.startDatetime ?? ''),
    );
  });

  it('W25 — la nuit est une condition à part, compatible avec le froid : elle ne lit aucune météo', () => {
    // Le calcul ne prend que des positions et des heures : aucune mesure n'entre.
    const startAt = '2026-12-21T12:00:00.000Z';
    expect(nightPeriods(startAt, stay(startAt, 6), WEATHER_ENGINE_V1)).toEqual(
      nightPeriods(startAt, stay(startAt, 6), WEATHER_ENGINE_V1),
    );
  });
});
