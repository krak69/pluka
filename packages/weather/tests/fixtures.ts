import {
  WEATHER_ENGINE_V1,
  type TimelinePoint,
  type WeatherEngineConfig,
  type WeatherRoutePoint,
  type WeatherTimeline,
} from '../src/index.js';

/** Un point de passage du Plan pour les tests : géolocalisé, sans arrêt, sauf mention contraire. */
export function point(
  id: string,
  distanceKm: number,
  elapsedSeconds: number,
  patch: Partial<TimelinePoint> = {},
): TimelinePoint {
  return {
    id,
    source: 'race_waypoint',
    kind: 'checkpoint',
    label: id,
    distanceKm,
    latitude: 45.9 + distanceKm / 1000,
    longitude: 6.87 + distanceKm / 1000,
    altitudeM: 1000 + distanceKm,
    elapsedSeconds,
    departureElapsedSeconds: elapsedSeconds,
    nextSegmentId: `seg-${id}`,
    ...patch,
  };
}

export function timeline(
  points: readonly TimelinePoint[],
  patch: Partial<WeatherTimeline> = {},
): WeatherTimeline {
  return {
    scope: 'race_plan',
    scopeId: 'plan-v1',
    startAt: '2026-09-12T04:00:00.000Z',
    timezone: 'Europe/Paris',
    points,
    geometryKey: 'geometry-1',
    ...patch,
  };
}

/** Un point de run immobile : pour la nuit, la position compte, pas la distance. */
export function routePoint(
  pointKey: string,
  elapsedSeconds: number,
  startAt: string,
  latitude: number,
  longitude: number,
): WeatherRoutePoint {
  return {
    pointKey,
    sourceType: 'race_waypoint',
    raceWaypointId: pointKey,
    outingWaypointId: null,
    virtualSegmentId: null,
    label: pointKey,
    distanceKm: elapsedSeconds / 600,
    latitude,
    longitude,
    routeAltitudeM: null,
    plannedDatetime: new Date(Date.parse(startAt) + elapsedSeconds * 1000).toISOString(),
    elapsedSeconds,
  };
}

export const HOUR = 3600;

/**
 * La v1 n'ajoute aucun point sur la trace ; la capacité reste testée avec
 * cette configuration (un point au moins tous les 10 km ou 1 h 30).
 */
export const WITH_VIRTUAL: WeatherEngineConfig = {
  ...WEATHER_ENGINE_V1,
  routePoints: {
    ...WEATHER_ENGINE_V1.routePoints,
    version: 'route-points-test',
    virtual: { maxDistanceGapKm: 10, maxTimeGapSeconds: 90 * 60 },
  },
};
