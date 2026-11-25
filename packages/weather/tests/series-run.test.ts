import { describe, expect, it } from 'vitest';

import {
  OPEN_METEO,
  WEATHER_ENGINE_V1,
  buildRaceRun,
  openMeteoSeriesQueries,
  seriesReusable,
  seriesWindow,
  type FetchedSeries,
  type HourlySeries,
} from '../src/index.js';
import { HOUR, point, timeline } from './fixtures.js';

/**
 * Les séries partagées et le run d'un coureur — WEATHER_CONDITIONS §28 à §34,
 * §55, §93, §94.
 */

const PROVIDER = {
  provider: OPEN_METEO.provider,
  providerModel: OPEN_METEO.model,
  providerConfigVersion: OPEN_METEO.providerConfigVersion,
  normalizerVersion: OPEN_METEO.normalizerVersion,
};

/** Une série horaire constante sur deux jours à partir de minuit UTC le 12 septembre. */
function hourly(temperature: number): HourlySeries {
  const first = Date.parse('2026-09-12T00:00:00.000Z') / 1000;
  const times = Array.from({ length: 48 }, (_, index) => first + index * HOUR);
  const fill = (value: number | null) => times.map(() => value);
  return {
    times,
    temperatureC: fill(temperature),
    apparentTemperatureC: fill(temperature - 3),
    weatherCode: fill(61),
    windSpeedKmh: fill(20),
    windDirectionDeg: fill(270),
    precipitationProbabilityPct: fill(70),
    precipitationAmountMm: fill(1.2),
    windGustKmh: fill(45),
    providerElevationM: 1500,
  };
}

describe('la fenêtre d’une course (§93)', () => {
  it('va d’une heure avant le départ à sept jours après, pour tous les rythmes', () => {
    expect(seriesWindow('2026-09-12T04:00:00.000Z', WEATHER_ENGINE_V1)).toEqual({
      from: '2026-09-12T03:00:00.000Z',
      to: '2026-09-19T04:00:00.000Z',
    });
  });

  it('s’arrête à l’horizon du fournisseur, et ne demande rien au-delà', () => {
    const now = new Date('2026-09-10T08:00:00.000Z');
    const location = { key: 'a', latitude: 46, longitude: 7, elevationM: 1000 };
    const [query] = openMeteoSeriesQueries(
      { locations: [location], from: '2026-09-12T03:00:00.000Z', to: '2026-09-30T00:00:00.000Z' },
      now,
    );

    expect(new URL(query?.url ?? '').searchParams.get('end_hour')).toBe('2026-09-25T23:00');
    expect(
      openMeteoSeriesQueries(
        { locations: [location], from: '2026-09-28T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' },
        now,
      ),
    ).toEqual([]);
  });
});

describe('une série en cache (§31, §32, §94)', () => {
  const place = { latitude: 45.900706, longitude: 4.672678, elevationM: 415 };
  const cached = { ...place, fetchedAt: '2026-09-10T08:00:00.000Z' };

  it('sert tant qu’elle est fraîche pour l’horizon, au même lieu', () => {
    expect(
      seriesReusable(cached, place, '2026-09-10T10:00:00.000Z', 'near', WEATHER_ENGINE_V1),
    ).toBe(true);
  });

  it('se redemande quand elle a vieilli, ou n’existe pas', () => {
    expect(
      seriesReusable(cached, place, '2026-09-10T11:30:00.000Z', 'near', WEATHER_ENGINE_V1),
    ).toBe(false);
    expect(seriesReusable(null, place, '2026-09-10T08:30:00.000Z', 'near', WEATHER_ENGINE_V1)).toBe(
      false,
    );
  });

  it('se redemande quand la trace a déplacé le point ou changé son altitude', () => {
    const now = '2026-09-10T08:30:00.000Z';
    expect(
      seriesReusable(cached, { ...place, latitude: 45.9012 }, now, 'near', WEATHER_ENGINE_V1),
    ).toBe(false);
    expect(
      seriesReusable(cached, { ...place, elevationM: 430 }, now, 'near', WEATHER_ENGINE_V1),
    ).toBe(false);
  });
});

describe('le run d’un coureur (§34)', () => {
  const line = timeline([
    point('depart', 0, 0, { kind: 'start' }),
    point('eau', 4, HOUR, { kind: 'water' }),
    point('ravito', 12, 2 * HOUR, { kind: 'aid_station' }),
    point('arrivee', 27, 4 * HOUR, { kind: 'finish', nextSegmentId: null }),
  ]);
  const series = new Map<string, FetchedSeries>([
    ['depart', { series: hourly(9), fetchedAt: '2026-09-10T08:00:00.000Z' }],
    ['ravito', { series: hourly(6), fetchedAt: '2026-09-10T08:05:00.000Z' }],
  ]);

  it('projette les séries sur les passages, sans appel au fournisseur', () => {
    const run = buildRaceRun(line, series, PROVIDER, WEATHER_ENGINE_V1);

    expect(run.points.map((entry) => entry.pointKey)).toEqual([
      'wp-depart',
      'wp-ravito',
      'wp-arrivee',
    ]);
    expect(run.points[1]).toMatchObject({
      raceWaypointId: 'ravito',
      plannedDatetime: '2026-09-12T06:00:00.000Z',
      temperatureC: 6,
      apparentTemperatureC: 3,
      weatherCode: 'rain',
      precipitationProbabilityPct: 70,
      windGustKmh: 45,
      fetchedAt: '2026-09-10T08:05:00.000Z',
      routeAltitudeM: 1012,
    });
  });

  it('un point sans série reste vide, et le run se dit partiel', () => {
    const run = buildRaceRun(line, series, PROVIDER, WEATHER_ENGINE_V1);

    expect(run.completeness).toBe('partial');
    expect(run.points[2]).toMatchObject({
      pointKey: 'wp-arrivee',
      temperatureC: null,
      weatherCode: null,
      fetchedAt: '2026-09-10T08:05:00.000Z',
    });
    expect(run.fetchedAt).toBe('2026-09-10T08:05:00.000Z');
  });

  it('sans aucune série, le run échoue', () => {
    const run = buildRaceRun(line, new Map(), PROVIDER, WEATHER_ENGINE_V1);

    expect(run.completeness).toBe('failed');
    expect(run.fetchedAt).toBeNull();
  });

  it('porte ses nuits, son snapshot minimal et une empreinte stable', () => {
    const run = buildRaceRun(line, series, PROVIDER, WEATHER_ENGINE_V1);

    // Départ 06:00 le 12 septembre dans les Alpes : le soleil se lève vers 07:05.
    expect(run.nights).toHaveLength(1);
    expect(run.nights[0]).toMatchObject({ fromStart: true, startPointKey: 'wp-depart' });
    const sunrise = Date.parse(run.nights[0]?.endDatetime ?? '');
    expect(sunrise).toBeGreaterThanOrEqual(Date.parse('2026-09-12T05:00:00.000Z'));
    expect(sunrise).toBeLessThanOrEqual(Date.parse('2026-09-12T05:15:00.000Z'));
    expect(run.inputSnapshot).toEqual({
      startAt: '2026-09-12T04:00:00.000Z',
      geometryKey: 'geometry-1',
      points: [
        { key: 'wp-depart', elapsedSeconds: 0 },
        { key: 'wp-ravito', elapsedSeconds: 2 * HOUR },
        { key: 'wp-arrivee', elapsedSeconds: 4 * HOUR },
      ],
    });
    expect(run.inputHash).toBe(
      buildRaceRun(line, new Map(), PROVIDER, WEATHER_ENGINE_V1).inputHash,
    );
  });

  it('un départ en plein jour n’a pas de nuit', () => {
    const day = { ...line, startAt: '2026-09-12T08:00:00.000Z' };

    expect(buildRaceRun(day, series, PROVIDER, WEATHER_ENGINE_V1).nights).toEqual([]);
  });
});
