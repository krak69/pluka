import { selectColumns } from '../columns.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';

/**
 * Conditions J-14 — WEATHER_CONDITIONS §28 à §35, §52 à §55 ; migration 0113.
 *
 * Lit les runs du coureur sous sa session (la RLS de 0005 ne lui ouvre que
 * les siens), et lui permet de demander un rafraîchissement. Le paquet ne
 * décide ni de la fenêtre J-14 ni des droits : le domaine le fait.
 */

export interface ConditionsRunRecord {
  readonly id: string;
  readonly status: 'active' | 'stale' | 'failed';
  readonly completeness: 'unknown' | 'complete' | 'partial';
  readonly fetchedAt: string;
  readonly failureCode: string | null;
  readonly provider: string;
}

export interface ConditionsPointRecord {
  readonly pointKey: string;
  readonly raceWaypointId: string | null;
  readonly distanceKm: number | null;
  readonly elapsedSeconds: number | null;
  readonly routeAltitudeM: number | null;
  readonly plannedDatetime: string;
  readonly temperatureC: number | null;
  readonly apparentTemperatureC: number | null;
  readonly precipitationProbabilityPct: number | null;
  readonly precipitationAmountMm: number | null;
  readonly windSpeedKmh: number | null;
  readonly windGustKmh: number | null;
  readonly windDirectionDeg: number | null;
  /** La taxonomie PLUKA du ciel (§56). */
  readonly weatherCode: string | null;
  readonly fetchedAt: string;
}

export interface ConditionsNightRecord {
  readonly startDatetime: string;
  readonly endDatetime: string;
  readonly startElapsedSeconds: number | null;
  readonly endElapsedSeconds: number | null;
  readonly fromStart: boolean;
  readonly untilFinish: boolean;
}

export type ConditionsRefreshRequest = 'queued' | 'already_queued';

export interface ConditionsRepository {
  /** Le run qui fait foi pour cette version du Plan ; nul sans prévision réussie. */
  activeRun(racePlanId: string): Promise<ConditionsRunRecord | null>;
  /** Le dernier run, échoué compris : de quoi dire qu'une mise à jour a échoué. */
  latestRun(racePlanId: string): Promise<ConditionsRunRecord | null>;
  listPoints(runId: string): Promise<readonly ConditionsPointRecord[]>;
  listNights(runId: string): Promise<readonly ConditionsNightRecord[]>;
  /** `request_weather_refresh` : la base revérifie propriété, Plan actif et fenêtre J-14. */
  requestRefresh(participantRaceId: string): Promise<ConditionsRefreshRequest>;
}

const RUN_COLUMNS = [
  'id',
  'status',
  'completeness_status',
  'fetched_at',
  'failure_code',
  'provider',
] as const;

const POINT_COLUMNS = [
  'point_key',
  'race_waypoint_id',
  'distance_km',
  'elapsed_seconds',
  'route_altitude_m',
  'planned_datetime',
  'temperature_c',
  'apparent_temperature_c',
  'precipitation_probability_pct',
  'precipitation_amount_mm',
  'wind_speed_kmh',
  'wind_gust_kmh',
  'wind_direction_deg',
  'weather_code',
  'fetched_at',
] as const;

const NIGHT_COLUMNS = [
  'start_datetime',
  'end_datetime',
  'start_elapsed_seconds',
  'end_elapsed_seconds',
  'summary',
] as const;

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRun(row: {
  id: string;
  status: 'active' | 'stale' | 'failed';
  completeness_status: 'unknown' | 'complete' | 'partial';
  fetched_at: string;
  failure_code: string | null;
  provider: string;
}): ConditionsRunRecord {
  return {
    id: row.id,
    status: row.status,
    completeness: row.completeness_status,
    fetchedAt: row.fetched_at,
    failureCode: row.failure_code,
    provider: row.provider,
  };
}

export const conditionsRepository = defineRepository<ConditionsRepository>(
  (context: RepositoryContext) => ({
    async activeRun(racePlanId) {
      const row = unwrapMaybe(
        await context.client
          .from('weather_forecast_runs')
          .select(selectColumns('weather_forecast_runs', RUN_COLUMNS))
          .eq('race_plan_id', racePlanId)
          .eq('status', 'active')
          .maybeSingle(),
        'weather_forecast_runs.activeRun',
      );
      return row === null ? null : toRun(row);
    },

    async latestRun(racePlanId) {
      const row = unwrapMaybe(
        await context.client
          .from('weather_forecast_runs')
          .select(selectColumns('weather_forecast_runs', RUN_COLUMNS))
          .eq('race_plan_id', racePlanId)
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        'weather_forecast_runs.latestRun',
      );
      return row === null ? null : toRun(row);
    },

    async listPoints(runId) {
      const rows = unwrap(
        await context.client
          .from('weather_forecast_points')
          .select(selectColumns('weather_forecast_points', POINT_COLUMNS))
          .eq('weather_run_id', runId)
          .order('planned_datetime', { ascending: true }),
        'weather_forecast_points.listPoints',
      );
      return rows.map((row) => ({
        pointKey: row.point_key,
        raceWaypointId: row.race_waypoint_id,
        distanceKm: numeric(row.distance_km),
        elapsedSeconds: row.elapsed_seconds,
        routeAltitudeM: row.route_altitude_m,
        plannedDatetime: row.planned_datetime,
        temperatureC: numeric(row.temperature_c),
        apparentTemperatureC: numeric(row.apparent_temperature_c),
        precipitationProbabilityPct: numeric(row.precipitation_probability_pct),
        precipitationAmountMm: numeric(row.precipitation_amount_mm),
        windSpeedKmh: numeric(row.wind_speed_kmh),
        windGustKmh: numeric(row.wind_gust_kmh),
        windDirectionDeg: row.wind_direction_deg,
        weatherCode: row.weather_code,
        fetchedAt: row.fetched_at,
      }));
    },

    async listNights(runId) {
      const rows = unwrap(
        await context.client
          .from('condition_periods')
          .select(selectColumns('condition_periods', NIGHT_COLUMNS))
          .eq('weather_run_id', runId)
          .eq('condition_type', 'night')
          .order('start_datetime', { ascending: true }),
        'condition_periods.listNights',
      );
      return rows.map((row) => {
        const summary = (row.summary ?? {}) as { fromStart?: unknown; untilFinish?: unknown };
        return {
          startDatetime: row.start_datetime,
          endDatetime: row.end_datetime,
          startElapsedSeconds: row.start_elapsed_seconds,
          endElapsedSeconds: row.end_elapsed_seconds,
          fromStart: summary.fromStart === true,
          untilFinish: summary.untilFinish === true,
        };
      });
    },

    async requestRefresh(participantRaceId) {
      const data = unwrap(
        await context.client.rpc('request_weather_refresh', {
          p_participant_race_id: participantRaceId,
        }),
        'request_weather_refresh',
      );
      return data === 'already_queued' ? 'already_queued' : 'queued';
    },
  }),
);
