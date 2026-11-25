import {
  WEATHER_ENGINE_V1,
  WeatherProviderError,
  buildRaceRun,
  planWeatherRoutePoints,
  seriesReusable,
  seriesWindow,
  weatherEligibility,
  type BuiltRun,
  type FetchedSeries,
  type RunCompleteness,
  type WeatherEngineConfig,
  type WeatherRoutePoint,
  type WeatherTimeline,
} from '@pluka/weather';

import { normalizeError } from '../errors.js';
import type {
  QueueMessage,
  WeatherPorts,
  WeatherRacePlan,
  WeatherRunRecord,
  WorkerPorts,
} from '../ports.js';

/**
 * Job `weather.refresh` — WEATHER_CONDITIONS §28 à §34, §88 à §94 ; 0113.
 *
 * Le coureur ouvre ses Conditions, sa prévision a vieilli : l'app demande un
 * rafraîchissement (`request_weather_refresh`). Ici :
 *
 * 1. le Plan doit être actif, avec son heure de départ ;
 * 2. la fenêtre J-14 et les droits du coureur sont revérifiés — l'app ne
 *    porte pas de clé de service, et la base ne connaît pas les offres :
 *    aucun appel au fournisseur sans elles (§6, §10, W01, W03) ;
 * 3. seules les séries trop anciennes pour l'horizon sont redemandées, et
 *    partagées : tous les coureurs de la course passent aux mêmes points (§93) ;
 * 4. le run du coureur est une projection de ces séries (§34), enregistré
 *    avec ses nuits ; l'ancien reste, `stale` (§29).
 *
 * Le Plan n'est jamais modifié (§36). Une panne du fournisseur se retente,
 * puis s'enregistre comme run échoué ; le dernier run réussi reste affiché
 * (§90). Les journaux ne portent ni le coureur ni ses heures de passage.
 */

export const WEATHER_QUEUE = 'pluka_weather';

/** Au-delà, une panne du fournisseur s'enregistre au lieu de se retenter. */
const MAX_ATTEMPTS = 3;

interface WeatherRefreshPayload {
  readonly racePlanId: string;
  readonly participantRaceId: string;
}

export type WeatherRefreshOutcome =
  | {
      readonly kind: 'recorded';
      readonly runId: string;
      readonly completeness: RunCompleteness;
      /** Les points dont la série a été redemandée au fournisseur. */
      readonly fetched: number;
    }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

export function isWeatherRefreshMessage(message: QueueMessage): boolean {
  return typeof message.payload.racePlanId === 'string';
}

function readPayload(message: QueueMessage): WeatherRefreshPayload | null {
  const { racePlanId, participantRaceId } = message.payload;
  if (typeof racePlanId !== 'string' || typeof participantRaceId !== 'string') return null;
  return { racePlanId, participantRaceId };
}

function timelineOf(plan: WeatherRacePlan, startAt: string): WeatherTimeline {
  return {
    scope: 'race_plan',
    scopeId: plan.racePlanId,
    startAt,
    timezone: plan.timezone,
    points: plan.points,
    geometryKey: plan.geometryKey,
  };
}

function recordOf(
  ports: WeatherPorts,
  plan: WeatherRacePlan,
  run: BuiltRun,
  config: WeatherEngineConfig,
  fetchedAt: string,
  failureCode: string | null,
): WeatherRunRecord {
  return {
    racePlanId: plan.racePlanId,
    timezone: plan.timezone,
    ...ports.identity,
    conditionsEngineVersion: config.conditionsEngineVersion,
    routePointsVersion: config.routePoints.version,
    astronomyVersion: config.astronomy.version,
    inputHash: run.inputHash,
    fetchedAt,
    completeness: failureCode === null ? run.completeness : 'failed',
    failureCode,
    inputSnapshot: run.inputSnapshot,
  };
}

/** Une panne du fournisseur qui peut passer : lenteur, réseau, 429, 5xx. */
function passing(error: WeatherProviderError): boolean {
  if (error.code === 'timeout' || error.code === 'network') return true;
  return error.code === 'http' && (error.status === 429 || (error.status ?? 0) >= 500);
}

export async function handleWeatherRefreshMessage(
  ports: WorkerPorts,
  message: QueueMessage,
  config: WeatherEngineConfig = WEATHER_ENGINE_V1,
): Promise<WeatherRefreshOutcome> {
  const payload = readPayload(message);
  if (payload === null) {
    ports.logger.error('demande météo illisible', { msgId: message.msgId });
    return { kind: 'abandoned', code: 'PAYLOAD_INVALID' };
  }

  const weather = ports.weather;
  try {
    const now = weather.now().toISOString();
    const plan = await weather.store.racePlan(payload.racePlanId);
    if (plan === null || plan.status !== 'active')
      return { kind: 'skipped', reason: 'plan_inactive' };
    if (plan.startAt === null) return { kind: 'skipped', reason: 'no_start' };
    if (plan.userId === null) return { kind: 'skipped', reason: 'no_runner' };

    const entitled = await weather.entitled(plan.userId, plan.participantRaceId);
    const eligibility = weatherEligibility({
      scope: 'race_plan',
      now,
      timezone: plan.timezone,
      startAt: plan.startAt,
      startDate: null,
      hasPlan: true,
      entitled,
    });
    if (eligibility.status !== 'eligible' || eligibility.horizon === null) {
      return { kind: 'skipped', reason: eligibility.status };
    }
    const horizon = eligibility.horizon;

    const timeline = timelineOf(plan, plan.startAt);
    const points = planWeatherRoutePoints(timeline, config).waypoints.filter(
      (point): point is WeatherRoutePoint & { raceWaypointId: string } =>
        point.raceWaypointId !== null,
    );
    if (points.length === 0) return { kind: 'skipped', reason: 'no_points' };

    const cached = new Map(
      (
        await weather.store.series(
          points.map((point) => point.raceWaypointId),
          weather.identity.providerConfigVersion,
        )
      ).map((row) => [row.raceWaypointId, row]),
    );
    const series = new Map<string, FetchedSeries>();
    const stale = points.filter((point) => {
      const row = cached.get(point.raceWaypointId) ?? null;
      const wanted = {
        latitude: point.latitude,
        longitude: point.longitude,
        elevationM: point.routeAltitudeM,
      };
      if (row !== null && seriesReusable(row, wanted, now, horizon, config)) {
        series.set(point.raceWaypointId, { series: row.series, fetchedAt: row.fetchedAt });
        return false;
      }
      return true;
    });

    if (stale.length > 0) {
      try {
        const response = await weather.provider.getSeries({
          locations: stale.map((point) => ({
            key: point.raceWaypointId,
            latitude: point.latitude,
            longitude: point.longitude,
            elevationM: point.routeAltitudeM,
          })),
          ...seriesWindow(plan.startAt, config),
        });
        const fresh = stale.flatMap((point) => {
          const found = response.series.get(point.raceWaypointId);
          if (found === undefined || response.windowStart === null || response.windowEnd === null) {
            return [];
          }
          series.set(point.raceWaypointId, { series: found, fetchedAt: response.fetchedAt });
          return [
            {
              raceWaypointId: point.raceWaypointId,
              latitude: point.latitude,
              longitude: point.longitude,
              elevationM: point.routeAltitudeM,
              windowStart: response.windowStart,
              windowEnd: response.windowEnd,
              fetchedAt: response.fetchedAt,
              providerModel: response.providerModel,
              series: found,
              provider: response.provider,
              providerConfigVersion: response.providerConfigVersion,
            },
          ];
        });
        if (fresh.length > 0) await weather.store.saveSeries(fresh);
      } catch (error) {
        if (!(error instanceof WeatherProviderError)) throw error;
        if (passing(error) && message.readCount < MAX_ATTEMPTS) {
          ports.logger.warn('fournisseur météo indisponible, nouvel essai', {
            racePlanId: plan.racePlanId,
            code: error.code,
            status: error.status,
          });
          return { kind: 'retry', code: `PROVIDER_${error.code.toUpperCase()}` };
        }
        // §90 : l'échec est enregistré ; le dernier run réussi reste l'actif.
        const failed = buildRaceRun(timeline, new Map(), weather.identity, config);
        const runId = await weather.store.recordRun(
          recordOf(weather, plan, failed, config, now, `provider_${error.code}`),
          [],
          [],
        );
        ports.logger.error('prévision météo en échec', {
          racePlanId: plan.racePlanId,
          code: error.code,
          status: error.status,
        });
        return runId === null
          ? { kind: 'skipped', reason: 'plan_inactive' }
          : { kind: 'recorded', runId, completeness: 'failed', fetched: 0 };
      }
    }

    const run = buildRaceRun(timeline, series, weather.identity, config);
    const failed = run.completeness === 'failed' || run.fetchedAt === null;
    const runId = await weather.store.recordRun(
      recordOf(weather, plan, run, config, run.fetchedAt ?? now, failed ? 'no_forecast' : null),
      failed ? [] : run.points,
      failed ? [] : run.nights,
    );
    if (runId === null) return { kind: 'skipped', reason: 'plan_inactive' };

    ports.logger.info('prévision météo enregistrée', {
      racePlanId: plan.racePlanId,
      completeness: failed ? 'failed' : run.completeness,
      points: run.points.length,
      fetched: stale.length,
    });
    return {
      kind: 'recorded',
      runId,
      completeness: failed ? 'failed' : run.completeness,
      fetched: stale.length,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('rafraîchissement météo en échec', {
      racePlanId: payload.racePlanId,
      code: normalized.code,
      kind: normalized.kind,
    });
    return normalized.kind === 'permanent'
      ? { kind: 'abandoned', code: normalized.code }
      : { kind: 'retry', code: normalized.code };
  }
}
