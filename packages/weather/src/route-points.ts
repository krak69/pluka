import type { WeatherEngineConfig } from './config.js';
import type {
  TimelinePoint,
  TracePosition,
  VirtualCheckpointRequest,
  WeatherRoutePoint,
  WeatherTimeline,
} from './contracts.js';

/**
 * Les points météo d'un Plan — WEATHER_CONDITIONS §17 à §21.
 *
 * Les points utiles sont ceux du Plan, jamais chaque point du GPX (§18) : en
 * v1, le départ, l'arrivée, les points de passage, les ravitaillements, les
 * sommets et les cols (décision du 2026-11-25). Une configuration peut aussi
 * ajouter des points sur la trace entre deux points trop éloignés (§19, §20) ;
 * la v1 ne le fait pas. Le moteur le ferait en deux temps, pour rester pur : il
 * dit où et quand ; la position réelle sur la trace vient de la géométrie
 * (§21), puis il assemble.
 */

export type RoutePointIssue =
  /** Un point du Plan sans coordonnées ne reçoit pas de prévision. */
  | { readonly kind: 'missing_coordinates'; readonly pointId: string }
  /** La trace n'a pas su placer un point virtuel : il est écarté, pas inventé. */
  | { readonly kind: 'virtual_unresolved'; readonly pointKey: string };

export interface RoutePointPlan {
  readonly waypoints: readonly WeatherRoutePoint[];
  readonly virtual: readonly VirtualCheckpointRequest[];
  readonly issues: readonly RoutePointIssue[];
}

/** L'instant réel d'un passage : le départ plus le temps écoulé (§13, §14). */
export function plannedDatetime(startAt: string, elapsedSeconds: number): string {
  return new Date(Date.parse(startAt) + Math.round(elapsedSeconds) * 1000).toISOString();
}

function located(point: TimelinePoint): boolean {
  return point.latitude !== null && point.longitude !== null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function waypointOf(timeline: WeatherTimeline, point: TimelinePoint): WeatherRoutePoint {
  return {
    pointKey: `wp-${point.id}`,
    sourceType: point.source,
    raceWaypointId: point.source === 'race_waypoint' ? point.id : null,
    outingWaypointId: point.source === 'outing_waypoint' ? point.id : null,
    virtualSegmentId: null,
    label: point.label,
    distanceKm: point.distanceKm,
    latitude: point.latitude as number,
    longitude: point.longitude as number,
    routeAltitudeM: point.altitudeM,
    plannedDatetime: plannedDatetime(timeline.startAt, point.elapsedSeconds),
    elapsedSeconds: point.elapsedSeconds,
  };
}

/**
 * Les points retenus et géolocalisés, et les éventuels points virtuels à
 * placer entre deux points trop éloignés. Un point virtuel prend une distance
 * régulière dans l'écart, et l'heure à la même proportion du temps de
 * déplacement — du départ du premier point, arrêt compris, à l'arrivée au
 * second.
 */
export function planWeatherRoutePoints(
  timeline: WeatherTimeline,
  config: WeatherEngineConfig,
): RoutePointPlan {
  const { kinds, virtual: sampling } = config.routePoints;
  const last = timeline.points.length - 1;
  const issues: RoutePointIssue[] = [];
  const kept: { readonly point: TimelinePoint; readonly index: number }[] = [];
  timeline.points.forEach((point, index) => {
    // Un point d'eau ou d'assistance n'est pas retenu : ce n'est pas un manque.
    const wanted = index === 0 || index === last || kinds.includes(point.kind);
    if (!wanted) return;
    if (located(point)) kept.push({ point, index });
    else issues.push({ kind: 'missing_coordinates', pointId: point.id });
  });

  const virtual: VirtualCheckpointRequest[] = [];
  for (let k = 0; sampling !== null && k + 1 < kept.length; k += 1) {
    const from = kept[k] as (typeof kept)[number];
    const to = kept[k + 1] as (typeof kept)[number];
    const distance = to.point.distanceKm - from.point.distanceKm;
    const moving = to.point.elapsedSeconds - from.point.departureElapsedSeconds;
    if (distance <= 0) continue;
    const count =
      Math.max(
        Math.ceil(distance / sampling.maxDistanceGapKm),
        Math.ceil(Math.max(0, moving) / sampling.maxTimeGapSeconds),
      ) - 1;
    for (let step = 1; step <= count; step += 1) {
      const share = step / (count + 1);
      virtual.push({
        // §19 : une clé par point, jamais réutilisée — « weather-mid-seg-05-01 ».
        pointKey: `weather-mid-seg-${pad(from.index + 1)}-${pad(step)}`,
        virtualSegmentId: from.point.nextSegmentId,
        label: `Entre ${from.point.label} et ${to.point.label}`,
        distanceKm: Number((from.point.distanceKm + distance * share).toFixed(3)),
        elapsedSeconds: Math.round(
          from.point.departureElapsedSeconds + Math.max(0, moving) * share,
        ),
      });
    }
  }

  return { waypoints: kept.map(({ point }) => waypointOf(timeline, point)), virtual, issues };
}

/**
 * Les points météo du run, dans l'ordre du parcours : ceux du Plan et les
 * virtuels que la trace a su placer. Un virtuel sans position est écarté et
 * signalé, jamais placé en ligne droite entre deux points (§21).
 */
export function assembleWeatherRoutePoints(
  timeline: WeatherTimeline,
  plan: RoutePointPlan,
  positions: ReadonlyMap<string, TracePosition | null>,
): { readonly points: readonly WeatherRoutePoint[]; readonly issues: readonly RoutePointIssue[] } {
  const issues: RoutePointIssue[] = [...plan.issues];
  const virtual = plan.virtual.flatMap((request): WeatherRoutePoint[] => {
    const position = positions.get(request.pointKey) ?? null;
    if (position === null) {
      issues.push({ kind: 'virtual_unresolved', pointKey: request.pointKey });
      return [];
    }
    return [
      {
        pointKey: request.pointKey,
        sourceType: 'virtual_checkpoint',
        raceWaypointId: null,
        outingWaypointId: null,
        virtualSegmentId: request.virtualSegmentId,
        label: request.label,
        distanceKm: request.distanceKm,
        latitude: position.latitude,
        longitude: position.longitude,
        routeAltitudeM: position.altitudeM,
        plannedDatetime: plannedDatetime(timeline.startAt, request.elapsedSeconds),
        elapsedSeconds: request.elapsedSeconds,
      },
    ];
  });
  const points = [...plan.waypoints, ...virtual].sort(
    (left, right) =>
      left.elapsedSeconds - right.elapsedSeconds ||
      left.distanceKm - right.distanceKm ||
      (left.pointKey < right.pointKey ? -1 : left.pointKey > right.pointKey ? 1 : 0),
  );
  return { points, issues };
}
