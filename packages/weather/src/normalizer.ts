import type { NormalizedWeatherPoint, RunCompleteness, WeatherSky } from './contracts.js';

/**
 * Lecture commune des fournisseurs — WEATHER_CONDITIONS §26, §55, §56.
 */

/**
 * §56 : un code météo WMO (table 4677 simplifiée, celle d'Open-Meteo et
 * d'autres fournisseurs) vers la taxonomie d'affichage PLUKA. Un code inconnu
 * reste `unknown`, jamais rapproché d'un voisin.
 */
export function skyFromWmo(code: number | null): WeatherSky | null {
  if (code === null) return null;
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly_cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 65 || code === 67 || code === 82) return 'heavy_rain';
  if ((code >= 61 && code <= 66) || code === 80 || code === 81) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code === 95 || code === 96 || code === 99) return 'storm';
  return 'unknown';
}

const METRICS = [
  'temperatureC',
  'apparentTemperatureC',
  'precipitationProbabilityPct',
  'precipitationAmountMm',
  'windSpeedKmh',
  'windGustKmh',
  'windDirectionDeg',
  'weatherCode',
] as const satisfies readonly (keyof NormalizedWeatherPoint)[];

/** Un point a reçu une prévision dès qu'une de ses mesures est connue. */
export function hasForecast(point: NormalizedWeatherPoint): boolean {
  return METRICS.some((metric) => point[metric] !== null);
}

/** §55 : complet, partiel ou échoué — jamais un run partiel présenté comme complet. */
export function completenessOf(points: readonly NormalizedWeatherPoint[]): RunCompleteness {
  const received = points.filter(hasForecast).length;
  if (received === 0) return 'failed';
  return received === points.length ? 'complete' : 'partial';
}

/** Un point demandé pour lequel le fournisseur n'a rien rendu : tout reste `null` (§54). */
export function emptyPoint(pointKey: string, fetchedAt: string): NormalizedWeatherPoint {
  return {
    pointKey,
    forecastIssuedAt: null,
    fetchedAt,
    temperatureC: null,
    apparentTemperatureC: null,
    precipitationProbabilityPct: null,
    precipitationAmountMm: null,
    windSpeedKmh: null,
    windGustKmh: null,
    windDirectionDeg: null,
    weatherCode: null,
  };
}
