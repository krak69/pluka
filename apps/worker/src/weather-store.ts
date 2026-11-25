import type { PlukaClient } from '@pluka/db';
import type { HourlySeries, TimelinePoint, WaypointKind } from '@pluka/weather';

import { permanent, transient } from './errors.js';
import type { StoredWeatherSeries, WeatherRacePlan, WeatherStore } from './ports.js';

/**
 * Adaptateur des Conditions — migration 0113. Quatre fonctions `worker_*`,
 * réservées à `service_role`.
 */

type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

function rpc(client: PlukaClient): RpcClient {
  return client as unknown as RpcClient;
}

function unwrapRpc(result: { data: unknown; error: unknown }, operation: string): unknown {
  if (result.error !== null && result.error !== undefined) {
    throw transient('DB_UNAVAILABLE', `${operation} a échoué`, result.error);
  }
  return result.data;
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

const KINDS: ReadonlySet<string> = new Set([
  'start',
  'aid_station',
  'water',
  'checkpoint',
  'cutoff',
  'assistance',
  'summit',
  'pass',
  'finish',
  'other',
]);

function pointOf(row: Row): TimelinePoint {
  const kind = text(row.kind) ?? 'other';
  const elapsed = number(row.elapsedSeconds) ?? 0;
  return {
    id: String(row.id),
    source: 'race_waypoint',
    kind: (KINDS.has(kind) ? kind : 'other') as WaypointKind,
    label: text(row.label) ?? '',
    distanceKm: number(row.distanceKm) ?? 0,
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    altitudeM: number(row.altitudeM),
    elapsedSeconds: elapsed,
    departureElapsedSeconds: number(row.departureElapsedSeconds) ?? elapsed,
    nextSegmentId: text(row.nextSegmentId),
  };
}

function planOf(data: unknown): WeatherRacePlan | null {
  if (data === null || typeof data !== 'object') return null;
  const row = data as Row;
  const points = Array.isArray(row.points) ? (row.points as Row[]) : [];
  return {
    racePlanId: String(row.racePlanId),
    participantRaceId: String(row.participantRaceId),
    userId: text(row.userId),
    status: text(row.status) ?? 'unknown',
    startAt: text(row.startAt),
    timezone: text(row.timezone) ?? 'UTC',
    geometryKey: text(row.geometryKey),
    points: points.map(pointOf),
  };
}

function seriesOf(row: Row): StoredWeatherSeries {
  const series = row.series as HourlySeries | null;
  if (series === null || typeof series !== 'object' || !Array.isArray(series.times)) {
    throw permanent('WEATHER_SERIES_INVALID', 'série météo illisible en cache');
  }
  return {
    raceWaypointId: String(row.race_waypoint_id),
    latitude: number(row.latitude) ?? 0,
    longitude: number(row.longitude) ?? 0,
    elevationM: number(row.elevation_m),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    fetchedAt: new Date(String(row.fetched_at)).toISOString(),
    providerModel: text(row.provider_model),
    series,
  };
}

export function createWeatherStore(client: PlukaClient): WeatherStore {
  return {
    async racePlan(racePlanId) {
      const operation = 'worker_weather_race_plan';
      return planOf(
        unwrapRpc(await rpc(client).rpc(operation, { p_race_plan_id: racePlanId }), operation),
      );
    },

    async series(raceWaypointIds, providerConfigVersion) {
      const operation = 'worker_weather_series';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, {
          p_race_waypoint_ids: raceWaypointIds,
          p_provider_config_version: providerConfigVersion,
        }),
        operation,
      );
      return Array.isArray(data) ? (data as Row[]).map(seriesOf) : [];
    },

    async saveSeries(rows) {
      const operation = 'worker_save_weather_series';
      unwrapRpc(await rpc(client).rpc(operation, { p_rows: rows }), operation);
    },

    async recordRun(run, points, nights) {
      const operation = 'worker_record_weather_run';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, { p_run: run, p_points: points, p_periods: nights }),
        operation,
      );
      return text(data);
    },
  };
}
