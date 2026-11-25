import { createHash } from 'node:crypto';

import type { WeatherEngineConfig } from './config.js';
import type { WeatherRoutePoint, WeatherScope } from './contracts.js';

/** JSON aux clés triées : même entrée, même chaîne, quel que soit l'ordre d'écriture. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface WeatherHashInput {
  readonly scope: WeatherScope;
  readonly scopeId: string;
  readonly geometryKey: string | null;
  readonly timezone: string;
  readonly points: readonly WeatherRoutePoint[];
  /** Le fournisseur et ses versions : changer de fournisseur ou de règles de lecture change le run. */
  readonly providerConfigVersion: string;
  readonly normalizerVersion: string;
}

/**
 * §30 : l'empreinte d'un run. Elle couvre le scope, la géométrie, chaque point
 * (position, altitude, passage) et les versions ; elle ignore l'heure d'appel,
 * l'identifiant de tâche et les mesures de performance. Un Plan recalé change
 * les passages, donc l'empreinte (W10).
 */
export function computeWeatherInputHash(
  input: WeatherHashInput,
  config: WeatherEngineConfig,
): string {
  const payload = {
    scope: input.scope,
    scopeId: input.scopeId,
    geometryKey: input.geometryKey,
    timezone: input.timezone,
    points: input.points.map((point) => ({
      key: point.pointKey,
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: point.routeAltitudeM,
      plannedDatetime: point.plannedDatetime,
    })),
    versions: {
      engine: config.conditionsEngineVersion,
      routePoints: config.routePoints.version,
      astronomy: config.astronomy.version,
      provider: input.providerConfigVersion,
      normalizer: input.normalizerVersion,
    },
  };
  return createHash('sha256').update(canonical(payload)).digest('hex');
}
