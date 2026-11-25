import type { WeatherEngineConfig, WeatherHorizon } from './config.js';
import { refreshDue } from './eligibility.js';

/**
 * Les séries partagées d'une course — WEATHER_CONDITIONS §31, §32, §92 à §94.
 *
 * Tous les coureurs d'une course passent aux mêmes points : une série par
 * point, rafraîchie selon l'horizon, les sert tous. Le run de chacun en est
 * une projection sur ses heures de passage (§34).
 */

/** La fenêtre à demander pour une course : autour du départ, pour tous les rythmes. */
export function seriesWindow(
  startAt: string,
  config: WeatherEngineConfig,
): { readonly from: string; readonly to: string } {
  const start = Date.parse(startAt);
  return {
    from: new Date(start - config.series.beforeStartSeconds * 1000).toISOString(),
    to: new Date(start + config.series.afterStartSeconds * 1000).toISOString(),
  };
}

export interface CachedSeries {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationM: number | null;
  readonly fetchedAt: string;
}

export interface WantedLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationM: number | null;
}

/** Les coordonnées comparées à 1e-4 près (une dizaine de mètres), comme on les envoie. */
function samePlace(left: number, right: number): boolean {
  return Math.round(left * 1e4) === Math.round(right * 1e4);
}

/**
 * Une série en cache sert encore si elle porte sur le même lieu, à la même
 * altitude, et qu'elle n'a pas dépassé l'âge permis à cet horizon. Une trace
 * modifiée déplace le point : la série est alors redemandée.
 */
export function seriesReusable(
  cached: CachedSeries | null,
  wanted: WantedLocation,
  now: string,
  horizon: WeatherHorizon,
  config: WeatherEngineConfig,
): boolean {
  if (cached === null) return false;
  if (!samePlace(cached.latitude, wanted.latitude)) return false;
  if (!samePlace(cached.longitude, wanted.longitude)) return false;
  if (cached.elevationM !== wanted.elevationM) return false;
  return !refreshDue(cached.fetchedAt, now, horizon, config);
}
