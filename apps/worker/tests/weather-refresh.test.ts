import {
  WeatherProviderError,
  type HourlySeries,
  type SeriesRequest,
  type SeriesResponse,
  type TimelinePoint,
} from '@pluka/weather';
import { describe, expect, it } from 'vitest';

import {
  handleWeatherRefreshMessage,
  isWeatherRefreshMessage,
} from '../src/jobs/weather-refresh.js';
import type {
  QueueMessage,
  StoredWeatherSeries,
  WeatherRacePlan,
  WeatherRunRecord,
  WorkerPorts,
} from '../src/ports.js';

/**
 * Job `weather.refresh` — WEATHER_CONDITIONS §28 à §34, §88 à §94 ; 0113.
 * Aucun réseau, aucune base : le fournisseur et le store sont simulés.
 */

const NOW = new Date('2026-09-10T08:00:00.000Z');
const HOUR = 3600;
const USER = '11111111-1111-4111-8111-111111111111';

function waypoint(
  id: string,
  kind: TimelinePoint['kind'],
  km: number,
  hours: number,
): TimelinePoint {
  return {
    id,
    source: 'race_waypoint',
    kind,
    label: id,
    distanceKm: km,
    latitude: 45.9 + km / 1000,
    longitude: 6.87 + km / 1000,
    altitudeM: 1000 + km * 10,
    elapsedSeconds: hours * HOUR,
    departureElapsedSeconds: hours * HOUR,
    nextSegmentId: null,
  };
}

const PLAN: WeatherRacePlan = {
  racePlanId: 'plan-1',
  participantRaceId: 'pr-1',
  userId: USER,
  status: 'active',
  // Départ 08:00 à Paris, dans deux jours.
  startAt: '2026-09-12T06:00:00.000Z',
  timezone: 'Europe/Paris',
  geometryKey: 'geometry-1',
  points: [
    waypoint('depart', 'start', 0, 0),
    waypoint('eau', 'water', 5, 1),
    waypoint('ravito', 'aid_station', 12, 2),
    waypoint('arrivee', 'finish', 25, 4),
  ],
};

function hourly(): HourlySeries {
  const first = Date.parse('2026-09-12T00:00:00.000Z') / 1000;
  const times = Array.from({ length: 24 }, (_, index) => first + index * HOUR);
  const fill = (value: number) => times.map(() => value);
  return {
    times,
    temperatureC: fill(8),
    apparentTemperatureC: fill(5),
    weatherCode: fill(3),
    windSpeedKmh: fill(15),
    windDirectionDeg: fill(200),
    precipitationProbabilityPct: fill(10),
    precipitationAmountMm: fill(0),
    windGustKmh: fill(30),
    providerElevationM: 1100,
  };
}

interface Setup {
  readonly plan?: WeatherRacePlan | null;
  readonly entitled?: boolean;
  readonly cache?: readonly StoredWeatherSeries[];
  readonly fail?: WeatherProviderError;
  readonly empty?: boolean;
}

function setup(options: Setup = {}) {
  const requests: SeriesRequest[] = [];
  const saved: unknown[][] = [];
  const runs: { run: WeatherRunRecord; points: number; nights: number }[] = [];
  const logs: unknown[][] = [];
  const log = (...args: unknown[]) => void logs.push(args);

  const ports = {
    logger: { info: log, warn: log, error: log },
    weather: {
      now: () => NOW,
      identity: {
        provider: 'open-meteo',
        providerModel: 'best_match',
        providerConfigVersion: 'open-meteo-1.0.0',
        normalizerVersion: 'open-meteo-normalizer-1.0.0',
      },
      entitled: async () => options.entitled ?? true,
      provider: {
        async getSeries(request: SeriesRequest): Promise<SeriesResponse> {
          requests.push(request);
          if (options.fail !== undefined) throw options.fail;
          return {
            provider: 'open-meteo',
            providerModel: 'best_match',
            providerConfigVersion: 'open-meteo-1.0.0',
            normalizerVersion: 'open-meteo-normalizer-1.0.0',
            fetchedAt: NOW.toISOString(),
            windowStart: options.empty === true ? null : request.from,
            windowEnd: options.empty === true ? null : request.to,
            series: new Map(
              options.empty === true
                ? []
                : request.locations.map((location) => [location.key, hourly()]),
            ),
          };
        },
      },
      store: {
        racePlan: async () => (options.plan === undefined ? PLAN : options.plan),
        series: async () => options.cache ?? [],
        saveSeries: async (rows: readonly unknown[]) => {
          saved.push([...rows]);
        },
        recordRun: async (
          run: WeatherRunRecord,
          points: readonly unknown[],
          nights: readonly unknown[],
        ) => {
          runs.push({ run, points: points.length, nights: nights.length });
          return 'run-1';
        },
      },
    },
  } as unknown as WorkerPorts;

  return { ports, requests, saved, runs, logs };
}

function message(readCount = 1, payload: Record<string, unknown> = {}): QueueMessage {
  return {
    msgId: 7,
    readCount,
    payload: { racePlanId: 'plan-1', participantRaceId: 'pr-1', idempotencyKey: 'k', ...payload },
  };
}

describe('le rafraîchissement des Conditions', () => {
  it('se reconnaît dans la file météo', () => {
    expect(isWeatherRefreshMessage(message())).toBe(true);
    expect(isWeatherRefreshMessage({ ...message(), payload: { deliveryId: 'x' } })).toBe(false);
  });

  it('demande les séries des points clés, les partage, et enregistre le run', async () => {
    const { ports, requests, saved, runs } = setup();

    await expect(handleWeatherRefreshMessage(ports, message())).resolves.toEqual({
      kind: 'recorded',
      runId: 'run-1',
      completeness: 'complete',
      fetched: 3,
    });
    // Le point d'eau n'est pas retenu (décision du 2026-11-25).
    expect(requests[0]?.locations.map((location) => location.key)).toEqual([
      'depart',
      'ravito',
      'arrivee',
    ]);
    expect(requests[0]).toMatchObject({
      from: '2026-09-12T05:00:00.000Z',
      to: '2026-09-19T06:00:00.000Z',
    });
    expect(saved[0]).toHaveLength(3);
    expect(runs[0]).toMatchObject({
      points: 3,
      run: {
        racePlanId: 'plan-1',
        provider: 'open-meteo',
        routePointsVersion: 'route-points-1.0.0',
        astronomyVersion: 'astronomy-noaa-1.0.0',
        completeness: 'complete',
        failureCode: null,
        fetchedAt: NOW.toISOString(),
      },
    });
  });

  it('réutilise une série encore fraîche, sans appel au fournisseur', async () => {
    const cache: StoredWeatherSeries[] = PLAN.points
      .filter((point) => point.kind !== 'water')
      .map((point) => ({
        raceWaypointId: point.id,
        latitude: point.latitude as number,
        longitude: point.longitude as number,
        elevationM: point.altitudeM,
        windowStart: '2026-09-12T05:00:00.000Z',
        windowEnd: '2026-09-19T06:00:00.000Z',
        // Deux heures, à J-2 : sous les 3 h permises (§32).
        fetchedAt: '2026-09-10T06:00:00.000Z',
        providerModel: 'best_match',
        series: hourly(),
      }));
    const { ports, requests, runs } = setup({ cache });

    await expect(handleWeatherRefreshMessage(ports, message())).resolves.toMatchObject({
      kind: 'recorded',
      fetched: 0,
    });
    expect(requests).toEqual([]);
    expect(runs[0]?.run.fetchedAt).toBe('2026-09-10T06:00:00.000Z');
  });

  it('W03 — sans droit, aucun appel au fournisseur', async () => {
    const { ports, requests, runs } = setup({ entitled: false });

    await expect(handleWeatherRefreshMessage(ports, message())).resolves.toEqual({
      kind: 'skipped',
      reason: 'not_entitled',
    });
    expect(requests).toEqual([]);
    expect(runs).toEqual([]);
  });

  it('W01 — hors de la fenêtre J-14, aucun appel au fournisseur', async () => {
    const { ports, requests } = setup({
      plan: { ...PLAN, startAt: '2026-09-26T06:00:00.000Z' },
    });

    await expect(handleWeatherRefreshMessage(ports, message())).resolves.toEqual({
      kind: 'skipped',
      reason: 'too_early',
    });
    expect(requests).toEqual([]);
  });

  it('un Plan remplacé ne reçoit plus de prévision', async () => {
    const { ports, requests } = setup({ plan: { ...PLAN, status: 'superseded' } });

    await expect(handleWeatherRefreshMessage(ports, message())).resolves.toEqual({
      kind: 'skipped',
      reason: 'plan_inactive',
    });
    expect(requests).toEqual([]);
  });

  it('§91 — un fournisseur trop lent se retente, sans enregistrer d’échec', async () => {
    const { ports, runs } = setup({ fail: new WeatherProviderError('timeout', 'lent') });

    await expect(handleWeatherRefreshMessage(ports, message(1))).resolves.toEqual({
      kind: 'retry',
      code: 'PROVIDER_TIMEOUT',
    });
    expect(runs).toEqual([]);
  });

  it('W16 — au dernier essai, l’échec est enregistré, sans aucune valeur', async () => {
    const { ports, runs } = setup({ fail: new WeatherProviderError('timeout', 'lent') });

    await expect(handleWeatherRefreshMessage(ports, message(3))).resolves.toMatchObject({
      kind: 'recorded',
      completeness: 'failed',
    });
    expect(runs[0]).toMatchObject({
      points: 0,
      nights: 0,
      run: { completeness: 'failed', failureCode: 'provider_timeout' },
    });
  });

  it('une requête refusée par le fournisseur ne se retente pas', async () => {
    const { ports, runs } = setup({ fail: new WeatherProviderError('http', 'refus', 400) });

    await expect(handleWeatherRefreshMessage(ports, message(1))).resolves.toMatchObject({
      kind: 'recorded',
      completeness: 'failed',
    });
    expect(runs[0]?.run.failureCode).toBe('provider_http');
  });

  it('sans aucune série dans l’horizon, le run échoue proprement', async () => {
    const { ports, saved, runs } = setup({ empty: true });

    await handleWeatherRefreshMessage(ports, message());

    expect(saved).toEqual([]);
    expect(runs[0]).toMatchObject({ points: 0, run: { failureCode: 'no_forecast' } });
  });

  it('abandonne une demande illisible', async () => {
    const { ports } = setup();

    await expect(
      handleWeatherRefreshMessage(ports, { msgId: 1, readCount: 1, payload: { racePlanId: 3 } }),
    ).resolves.toEqual({ kind: 'abandoned', code: 'PAYLOAD_INVALID' });
  });

  it('ne journalise ni le coureur ni ses heures de passage', async () => {
    const { ports, logs } = setup();

    await handleWeatherRefreshMessage(ports, message());

    const written = JSON.stringify(logs);
    expect(written).not.toContain(USER);
    expect(written).not.toContain('2026-09-12T06:00');
  });
});
