import { describe, expect, it } from 'vitest';

import {
  normalizedWeatherPointSchema,
  weatherProviderRequestSchema,
  weatherProviderResponseSchema,
  type WeatherProvider,
} from '../../src/index.js';

const validPoint = {
  pointKey: 'wp-col-du-joly',
  forecastIssuedAt: '2026-09-04T00:00:00Z',
  fetchedAt: '2026-09-04T05:12:00Z',
  temperatureC: 4.5,
  apparentTemperatureC: 1.2,
  precipitationProbabilityPct: 60,
  precipitationAmountMm: 1.4,
  windSpeedKmh: 25,
  windGustKmh: 48,
  windDirectionDeg: 270,
  weatherCode: 'rain_light',
};

const validRequest = {
  points: [
    {
      pointKey: 'wp-col-du-joly',
      latitude: 45.832,
      longitude: 6.712,
      routeAltitudeM: 1989,
      plannedDatetime: '2026-09-05T03:20:00Z',
    },
  ],
  timezone: 'Europe/Paris',
};

describe('WeatherProviderRequest', () => {
  it('accepte une requête de points utiles', () => {
    const request = weatherProviderRequestSchema.parse(validRequest);

    expect(request.points).toHaveLength(1);
    expect(request.points[0]?.routeAltitudeM).toBe(1989);
  });

  it('accepte une altitude de parcours inconnue sans la remplacer', () => {
    const request = weatherProviderRequestSchema.parse({
      ...validRequest,
      points: [{ ...validRequest.points[0], routeAltitudeM: null }],
    });

    expect(request.points[0]?.routeAltitudeM).toBeNull();
  });

  it('refuse une requête sans point', () => {
    expect(weatherProviderRequestSchema.safeParse({ ...validRequest, points: [] }).success).toBe(
      false,
    );
  });

  it('refuse une heure de passage sans fuseau', () => {
    expect(
      weatherProviderRequestSchema.safeParse({
        ...validRequest,
        points: [{ ...validRequest.points[0], plannedDatetime: '2026-09-05T03:20:00' }],
      }).success,
    ).toBe(false);
  });

  it('refuse un fuseau invalide', () => {
    expect(
      weatherProviderRequestSchema.safeParse({ ...validRequest, timezone: 'Europe/Pariss' })
        .success,
    ).toBe(false);
  });
});

describe('NormalizedWeatherPoint', () => {
  it('accepte un point complet', () => {
    expect(normalizedWeatherPointSchema.parse(validPoint).weatherCode).toBe('rain_light');
  });

  it('laisse chaque grandeur absente à null sans valeur de repli', () => {
    const point = normalizedWeatherPointSchema.parse({
      pointKey: 'wp-1',
      forecastIssuedAt: null,
      fetchedAt: '2026-09-04T05:12:00Z',
      temperatureC: null,
      apparentTemperatureC: null,
      precipitationProbabilityPct: null,
      precipitationAmountMm: null,
      windSpeedKmh: null,
      windGustKmh: null,
      windDirectionDeg: null,
      weatherCode: null,
    });

    expect(point.temperatureC).toBeNull();
    expect(point.apparentTemperatureC).toBeNull();
    expect(point.weatherCode).toBeNull();
  });

  it('exige la date de récupération, base de la fraîcheur affichée', () => {
    const { fetchedAt: _omitted, ...withoutFetchedAt } = validPoint;

    expect(normalizedWeatherPointSchema.safeParse(withoutFetchedAt).success).toBe(false);
  });

  it.each([
    ['probabilité > 100', { precipitationProbabilityPct: 101 }],
    ['précipitation négative', { precipitationAmountMm: -0.1 }],
    ['vent négatif', { windSpeedKmh: -3 }],
    ['direction 360', { windDirectionDeg: 360 }],
    ['direction non entière', { windDirectionDeg: 27.5 }],
    ['température NaN', { temperatureC: Number.NaN }],
  ])('refuse une valeur hors contrat : %s', (_label, override) => {
    expect(normalizedWeatherPointSchema.safeParse({ ...validPoint, ...override }).success).toBe(
      false,
    );
  });

  it('accepte les bornes exactes de direction du vent', () => {
    expect(
      normalizedWeatherPointSchema.parse({ ...validPoint, windDirectionDeg: 0 }).windDirectionDeg,
    ).toBe(0);
    expect(
      normalizedWeatherPointSchema.parse({ ...validPoint, windDirectionDeg: 359 }).windDirectionDeg,
    ).toBe(359);
  });

  it('conserve un payload provider sérialisable pour l’audit', () => {
    const point = normalizedWeatherPointSchema.parse({
      ...validPoint,
      providerPayload: { raw: { t: 4.5 } },
    });

    expect(point.providerPayload).toEqual({ raw: { t: 4.5 } });
  });

  it('refuse un payload provider non sérialisable', () => {
    expect(
      normalizedWeatherPointSchema.safeParse({ ...validPoint, providerPayload: () => null })
        .success,
    ).toBe(false);
  });
});

describe('WeatherProvider', () => {
  it('se satisfait d’une implémentation sans réseau', async () => {
    const provider: WeatherProvider = {
      name: 'fixture',
      getForecast: async (request) => ({
        points: request.points.map((point) => ({ ...validPoint, pointKey: point.pointKey })),
      }),
    };

    const response = weatherProviderResponseSchema.parse(
      await provider.getForecast(weatherProviderRequestSchema.parse(validRequest)),
    );

    expect(response.points[0]?.pointKey).toBe('wp-col-du-joly');
  });
});
