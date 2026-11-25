import type {
  HourlySeries,
  NormalizedWeatherPoint,
  RunCompleteness,
  WeatherSky,
} from './contracts.js';

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

const HOUR = 3600;

function at(series: HourlySeries, values: readonly (number | null)[], slot: number): number | null {
  const index = series.times.indexOf(slot);
  return index < 0 ? null : (values[index] ?? null);
}

/**
 * §34 : projette la série d'un lieu sur une heure de passage, sans nouvel
 * appel. L'instantané (température, ressenti, vent, ciel) est lu à l'heure la
 * plus proche du passage ; ce qui porte sur l'heure écoulée (probabilité,
 * cumul, rafale) à l'heure qui contient le passage. Une heure absente de la
 * série laisse la mesure nulle (§54).
 */
export function projectSeries(
  pointKey: string,
  plannedDatetime: string,
  series: HourlySeries,
  fetchedAt: string,
): NormalizedWeatherPoint {
  const passage = Date.parse(plannedDatetime) / 1000;
  const instant = Math.round(passage / HOUR) * HOUR;
  const preceding = Math.ceil(passage / HOUR) * HOUR;
  const wmo = at(series, series.weatherCode, instant);
  const direction = at(series, series.windDirectionDeg, instant);
  return {
    pointKey,
    forecastIssuedAt: null,
    fetchedAt,
    temperatureC: at(series, series.temperatureC, instant),
    apparentTemperatureC: at(series, series.apparentTemperatureC, instant),
    precipitationProbabilityPct: at(series, series.precipitationProbabilityPct, preceding),
    precipitationAmountMm: at(series, series.precipitationAmountMm, preceding),
    windSpeedKmh: at(series, series.windSpeedKmh, instant),
    windGustKmh: at(series, series.windGustKmh, preceding),
    windDirectionDeg: direction === null ? null : Math.round(direction) % 360,
    weatherCode: skyFromWmo(wmo === null ? null : Math.round(wmo)),
    providerPayload: {
      wmoCode: wmo,
      // L'altitude du modèle de terrain du fournisseur, pour l'audit (W18) ;
      // jamais affichée à la place de celle du parcours.
      providerElevationM: series.providerElevationM,
      instantSlot: new Date(instant * 1000).toISOString(),
      precedingHourSlot: new Date(preceding * 1000).toISOString(),
    },
  };
}
