import { nightPeriods, type NightPeriod } from './astronomy.js';
import type { WeatherEngineConfig } from './config.js';
import type {
  HourlySeries,
  NormalizedWeatherPoint,
  RunCompleteness,
  WeatherRoutePoint,
  WeatherTimeline,
} from './contracts.js';
import { computeWeatherInputHash } from './hash.js';
import { completenessOf, emptyPoint, projectSeries } from './normalizer.js';
import {
  assembleWeatherRoutePoints,
  planWeatherRoutePoints,
  type RoutePointIssue,
} from './route-points.js';

/**
 * Le run d'un coureur — WEATHER_CONDITIONS §28 à §30, §34, §44, §55.
 *
 * Une projection des séries partagées sur ses heures de passage : aucun appel
 * au fournisseur ici. Un point sans série reste vide, et le run le dit
 * (partiel). Le Plan n'est jamais modifié (§36).
 */

export interface ProviderIdentity {
  readonly provider: string;
  readonly providerModel: string | null;
  readonly providerConfigVersion: string;
  readonly normalizerVersion: string;
}

/** Une série, et quand elle a été obtenue : l'heure de chaque point en dépend (0004). */
export interface FetchedSeries {
  readonly series: HourlySeries;
  readonly fetchedAt: string;
}

export interface RunPoint extends WeatherRoutePoint, Omit<NormalizedWeatherPoint, 'pointKey'> {}

export interface BuiltRun {
  readonly inputHash: string;
  /** La plus récente obtention parmi les points reçus ; nulle si aucun n'a de série. */
  readonly fetchedAt: string | null;
  readonly completeness: RunCompleteness;
  readonly points: readonly RunPoint[];
  readonly nights: readonly NightPeriod[];
  /**
   * §103 : de quoi rejouer le run, sans donnée personnelle inutile — le
   * départ, la géométrie, les points et leurs passages.
   */
  readonly inputSnapshot: {
    readonly startAt: string;
    readonly geometryKey: string | null;
    readonly points: readonly { readonly key: string; readonly elapsedSeconds: number }[];
  };
  readonly issues: readonly RoutePointIssue[];
}

/**
 * Construit le run d'un Plan à partir des séries de ses points, indexées par
 * identifiant de point de course. Les points virtuels ne sont pas couverts
 * par les séries partagées : la v1 n'en crée pas.
 */
export function buildRaceRun(
  timeline: WeatherTimeline,
  series: ReadonlyMap<string, FetchedSeries>,
  provider: ProviderIdentity,
  config: WeatherEngineConfig,
): BuiltRun {
  const plan = planWeatherRoutePoints(timeline, config);
  const { points, issues } = assembleWeatherRoutePoints(timeline, plan, new Map());

  const found = points.map((point) =>
    point.raceWaypointId === null ? undefined : series.get(point.raceWaypointId),
  );
  // La référence du run : la plus récente obtention parmi les points reçus (0004).
  const fetchedAt =
    found
      .flatMap((entry) => (entry === undefined ? [] : [entry.fetchedAt]))
      .sort()
      .at(-1) ?? null;

  const normalized: NormalizedWeatherPoint[] = points.map((point, index) => {
    const fetched = found[index];
    // Sans série, le point reste vide (§54) ; il date de l'obtention du run.
    return fetched === undefined
      ? emptyPoint(point.pointKey, fetchedAt ?? timeline.startAt)
      : projectSeries(point.pointKey, point.plannedDatetime, fetched.series, fetched.fetchedAt);
  });
  const run: RunPoint[] = points.map((point, index) => {
    const { pointKey: _key, ...metrics } = normalized[index] as NormalizedWeatherPoint;
    return { ...point, ...metrics };
  });

  return {
    inputHash: computeWeatherInputHash(
      {
        scope: timeline.scope,
        scopeId: timeline.scopeId,
        geometryKey: timeline.geometryKey,
        timezone: timeline.timezone,
        points,
        providerConfigVersion: provider.providerConfigVersion,
        normalizerVersion: provider.normalizerVersion,
      },
      config,
    ),
    fetchedAt,
    completeness: completenessOf(normalized),
    points: run,
    nights: nightPeriods(timeline.startAt, points, config),
    inputSnapshot: {
      startAt: timeline.startAt,
      geometryKey: timeline.geometryKey,
      points: points.map((point) => ({
        key: point.pointKey,
        elapsedSeconds: point.elapsedSeconds,
      })),
    },
    issues,
  };
}
