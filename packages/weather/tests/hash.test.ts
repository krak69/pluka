import { describe, expect, it } from 'vitest';

import {
  OPEN_METEO,
  WEATHER_ENGINE_V1,
  computeWeatherInputHash,
  planWeatherRoutePoints,
  type WeatherTimeline,
} from '../src/index.js';
import { HOUR, point, timeline } from './fixtures.js';

/** L'empreinte d'un run — WEATHER_CONDITIONS §30, W10, §116. */

function hashOf(line: WeatherTimeline, config = WEATHER_ENGINE_V1): string {
  const { waypoints } = planWeatherRoutePoints(line, config);
  return computeWeatherInputHash(
    {
      scope: line.scope,
      scopeId: line.scopeId,
      geometryKey: line.geometryKey,
      timezone: line.timezone,
      points: waypoints,
      providerConfigVersion: OPEN_METEO.providerConfigVersion,
      normalizerVersion: OPEN_METEO.normalizerVersion,
    },
    config,
  );
}

const BEFORE = timeline([point('depart', 0, 0), point('rawil', 8, 11 * HOUR + 8 * 60)]);

describe('l’empreinte d’un run', () => {
  it('est un SHA-256 stable', () => {
    expect(hashOf(BEFORE)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOf(BEFORE)).toBe(hashOf(BEFORE));
  });

  it('W10 — un Plan recalé (Rawil 17:08 → 18:02) change l’empreinte', () => {
    const after = timeline([point('depart', 0, 0), point('rawil', 8, 12 * HOUR + 2 * 60)], {
      scopeId: 'plan-v2',
    });

    expect(hashOf(after)).not.toBe(hashOf(BEFORE));
  });

  it('change avec la géométrie ou une version de config', () => {
    expect(hashOf({ ...BEFORE, geometryKey: 'geometry-2' })).not.toBe(hashOf(BEFORE));
    expect(
      hashOf(BEFORE, {
        ...WEATHER_ENGINE_V1,
        routePoints: { ...WEATHER_ENGINE_V1.routePoints, version: 'route-points-1.0.1' },
      }),
    ).not.toBe(hashOf(BEFORE));
  });

  it('ne dépend pas de l’ordre d’écriture des clés', () => {
    const reversed = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    const { waypoints } = planWeatherRoutePoints(BEFORE, WEATHER_ENGINE_V1);
    const input = {
      scope: BEFORE.scope,
      scopeId: BEFORE.scopeId,
      geometryKey: BEFORE.geometryKey,
      timezone: BEFORE.timezone,
      points: waypoints,
      providerConfigVersion: OPEN_METEO.providerConfigVersion,
      normalizerVersion: OPEN_METEO.normalizerVersion,
    };
    const shuffled = reversed({ ...input, points: waypoints.map(reversed) });

    expect(Object.keys(shuffled.points[0] ?? {})[0]).toBe('elapsedSeconds');
    expect(computeWeatherInputHash(shuffled, WEATHER_ENGINE_V1)).toBe(
      computeWeatherInputHash(input, WEATHER_ENGINE_V1),
    );
  });
});
