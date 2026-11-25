import { describe, expect, it } from 'vitest';

import {
  OPEN_METEO,
  WeatherProviderError,
  createOpenMeteoProvider,
  openMeteoQueries,
  parseOpenMeteoResponse,
  skyFromWmo,
  type WeatherProviderRequest,
} from '../src/index.js';

/**
 * L'adaptateur Open-Meteo — WEATHER_CONDITIONS §23 à §27, §54 à §59,
 * W15 à W18. Aucun appel réseau : `fetch` est simulé.
 */

const NOW = new Date('2026-09-10T08:00:00.000Z');
const H = 3600;
const at = (iso: string) => Date.parse(iso) / 1000;

type RequestedPoint = WeatherProviderRequest['points'][number];

const RAWIL: RequestedPoint = {
  pointKey: 'wp-rawil',
  latitude: 46.3712,
  longitude: 7.4521,
  routeAltitudeM: 2429,
  plannedDatetime: '2026-09-12T15:20:00.000Z',
};

const LENK: RequestedPoint = {
  pointKey: 'wp-lenk',
  latitude: 46.4571,
  longitude: 7.4402,
  routeAltitudeM: null,
  plannedDatetime: '2026-09-12T17:40:00.000Z',
};

const REQUEST: WeatherProviderRequest = { timezone: 'Europe/Paris', points: [RAWIL, LENK] };

/** Une série horaire autour d'un passage : 4 heures, de h-1 à h+2. */
function location(firstHourIso: string, patch: Record<string, unknown> = {}) {
  const first = at(firstHourIso);
  return {
    latitude: 46.37,
    longitude: 7.45,
    elevation: 1890,
    hourly: {
      time: [first, first + H, first + 2 * H, first + 3 * H],
      temperature_2m: [5.1, 4.2, 3.6, 3.0],
      apparent_temperature: [2.0, 1.1, 0.4, -0.3],
      weather_code: [3, 61, 63, 63],
      wind_speed_10m: [18, 22, 25, 30],
      wind_direction_10m: [270, 280, 360, 290],
      precipitation_probability: [20, 60, 80, 85],
      precipitation: [0, 0.4, 1.2, 1.5],
      wind_gusts_10m: [35, 45, 52, 60],
      ...patch,
    },
  };
}

describe('les appels (§92)', () => {
  it('sépare les points avec et sans altitude, et passe l’altitude du parcours', () => {
    const queries = openMeteoQueries(REQUEST, NOW);

    expect(queries.map((query) => query.pointKeys)).toEqual([['wp-rawil'], ['wp-lenk']]);
    const withAltitude = new URL(queries[0]?.url ?? '');
    expect(withAltitude.searchParams.get('elevation')).toBe('2429');
    expect(withAltitude.searchParams.get('latitude')).toBe('46.3712');
    expect(withAltitude.searchParams.get('timeformat')).toBe('unixtime');
    expect(withAltitude.searchParams.get('timezone')).toBe('GMT');
    expect(withAltitude.searchParams.get('start_hour')).toBe('2026-09-12T14:00');
    // Une fenêtre commune à la requête : du premier passage moins une heure au dernier plus une.
    expect(withAltitude.searchParams.get('end_hour')).toBe('2026-09-12T19:00');
    expect(withAltitude.searchParams.get('hourly')?.split(',')).toEqual([
      'temperature_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m',
      'precipitation_probability',
      'precipitation',
      'wind_gusts_10m',
    ]);
    // Sans altitude, le fournisseur prend son modèle de terrain.
    expect(new URL(queries[1]?.url ?? '').searchParams.has('elevation')).toBe(false);
  });

  it('regroupe au plus 50 points par appel', () => {
    const points = Array.from({ length: 120 }, (_, index) => ({
      pointKey: `p${String(index)}`,
      latitude: 45,
      longitude: 6,
      routeAltitudeM: 1000,
      plannedDatetime: '2026-09-12T10:00:00.000Z',
    }));

    expect(
      openMeteoQueries({ timezone: 'UTC', points }, NOW).map((query) => query.pointKeys.length),
    ).toEqual([50, 50, 20]);
  });

  it('ne demande rien au-delà des 16 jours de prévision', () => {
    const far = { ...RAWIL, plannedDatetime: '2026-09-30T10:00:00.000Z' };

    expect(openMeteoQueries({ timezone: 'UTC', points: [far] }, NOW)).toEqual([]);
  });
});

describe('la lecture d’une réponse (§26)', () => {
  const query = { pointKeys: ['wp-rawil'] };
  const single: WeatherProviderRequest = { timezone: 'UTC', points: [RAWIL] };

  it('prend l’heure la plus proche pour l’instantané, l’heure du passage pour pluie et rafales', () => {
    // Passage 15:20 : instantané à 15:00, cumuls de l'heure 15:00 → 16:00.
    const [point] = parseOpenMeteoResponse(
      query,
      single,
      location('2026-09-12T14:00:00.000Z'),
      NOW.toISOString(),
    );

    expect(point).toMatchObject({
      pointKey: 'wp-rawil',
      temperatureC: 4.2,
      apparentTemperatureC: 1.1,
      weatherCode: 'rain',
      windSpeedKmh: 22,
      windDirectionDeg: 280,
      precipitationProbabilityPct: 80,
      precipitationAmountMm: 1.2,
      windGustKmh: 52,
      forecastIssuedAt: null,
    });
  });

  it('W15 — un ressenti absent reste nul, jamais calculé', () => {
    const [point] = parseOpenMeteoResponse(
      query,
      single,
      location('2026-09-12T14:00:00.000Z', { apparent_temperature: undefined }),
      NOW.toISOString(),
    );

    expect(point?.apparentTemperatureC).toBeNull();
    expect(point?.temperatureC).toBe(4.2);
  });

  it('une heure absente de la série laisse le point vide', () => {
    const [point] = parseOpenMeteoResponse(
      query,
      single,
      location('2026-09-13T00:00:00.000Z'),
      NOW.toISOString(),
    );

    expect(point?.temperatureC).toBeNull();
    expect(point?.windGustKmh).toBeNull();
  });

  it('W18 — l’altitude du fournisseur est gardée pour l’audit, pas affichée', () => {
    const [point] = parseOpenMeteoResponse(
      query,
      single,
      location('2026-09-12T14:00:00.000Z'),
      NOW.toISOString(),
    );

    expect(point?.providerPayload).toMatchObject({ providerElevationM: 1890, wmoCode: 61 });
    expect(point).not.toHaveProperty('routeAltitudeM');
  });

  it('ramène une direction de 360° à 0°', () => {
    const [point] = parseOpenMeteoResponse(
      query,
      { timezone: 'UTC', points: [{ ...RAWIL, plannedDatetime: '2026-09-12T16:00:00.000Z' }] },
      location('2026-09-12T14:00:00.000Z'),
      NOW.toISOString(),
    );

    expect(point?.windDirectionDeg).toBe(0);
  });

  it('refuse une réponse qui ne correspond pas à la demande', () => {
    expect(() =>
      parseOpenMeteoResponse(
        { pointKeys: ['a', 'b'] },
        REQUEST,
        [location('2026-09-12T14:00:00.000Z')],
        NOW.toISOString(),
      ),
    ).toThrow(WeatherProviderError);
    expect(() =>
      parseOpenMeteoResponse(query, single, { hourly: 'oups' }, NOW.toISOString()),
    ).toThrow(WeatherProviderError);
  });
});

describe('la taxonomie du ciel (§56)', () => {
  it('range les codes WMO, et garde l’inconnu inconnu', () => {
    expect([0, 2, 3, 45, 53, 61, 65, 67, 82, 73, 86, 95, 99, 42].map(skyFromWmo)).toEqual([
      'clear',
      'partly_cloudy',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'heavy_rain',
      'heavy_rain',
      'heavy_rain',
      'snow',
      'snow',
      'storm',
      'storm',
      'unknown',
    ]);
    expect(skyFromWmo(null)).toBeNull();
  });
});

function respond(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('le fournisseur (§24, §90, §91)', () => {
  it('rend un point par point demandé, dans l’ordre, complet', async () => {
    const calls: string[] = [];
    const provider = createOpenMeteoProvider({
      now: () => NOW,
      fetch: (async (url: string) => {
        calls.push(url);
        const first = url.includes('elevation')
          ? '2026-09-12T14:00:00.000Z'
          : '2026-09-12T16:00:00.000Z';
        return new Response(JSON.stringify(location(first)));
      }) as unknown as typeof fetch,
    });
    const response = await provider.getForecast(REQUEST);

    expect(calls).toHaveLength(2);
    expect(response).toMatchObject({
      provider: 'open-meteo',
      providerModel: 'best_match',
      providerConfigVersion: OPEN_METEO.providerConfigVersion,
      normalizerVersion: OPEN_METEO.normalizerVersion,
      fetchedAt: NOW.toISOString(),
      forecastIssuedAt: null,
      completeness: 'complete',
    });
    expect(response.points.map((point) => point.pointKey)).toEqual(['wp-rawil', 'wp-lenk']);
  });

  it('W17 — un passage hors horizon laisse le run partiel, et le dit', async () => {
    const provider = createOpenMeteoProvider({
      now: () => NOW,
      // Le lieu lointain est demandé aussi : sa série couvre les heures dans l'horizon.
      fetch: respond([location('2026-09-12T14:00:00.000Z'), location('2026-09-12T14:00:00.000Z')]),
    });
    const response = await provider.getForecast({
      timezone: 'UTC',
      points: [RAWIL, { ...RAWIL, pointKey: 'loin', plannedDatetime: '2026-09-30T10:00:00.000Z' }],
    });

    expect(response.completeness).toBe('partial');
    expect(response.points[1]).toMatchObject({ pointKey: 'loin', temperatureC: null });
  });

  it('W16 — une erreur du fournisseur échoue, sans aucune valeur', async () => {
    const provider = createOpenMeteoProvider({ now: () => NOW, fetch: respond({}, 503) });

    await expect(provider.getForecast(REQUEST)).rejects.toMatchObject({
      name: 'WeatherProviderError',
      code: 'http',
      status: 503,
    });
  });

  it('un fournisseur trop lent est abandonné', async () => {
    const provider = createOpenMeteoProvider({
      now: () => NOW,
      timeoutMs: 10,
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch,
    });

    await expect(provider.getForecast(REQUEST)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('un fournisseur injoignable échoue proprement', async () => {
    const provider = createOpenMeteoProvider({
      now: () => NOW,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });

    await expect(provider.getForecast(REQUEST)).rejects.toMatchObject({ code: 'network' });
  });
});
