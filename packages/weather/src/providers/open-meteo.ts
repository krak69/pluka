import { z } from 'zod';

import type {
  HourlySeries,
  NormalizedWeatherPoint,
  SeriesRequest,
  SeriesResponse,
  WeatherProvider,
  WeatherProviderRequest,
  WeatherProviderResponse,
  WeatherSeriesProvider,
} from '../contracts.js';
import { completenessOf, emptyPoint, projectSeries } from '../normalizer.js';

/**
 * Adaptateur Open-Meteo — WEATHER_CONDITIONS §23 à §27, §93, §94 ; choix du
 * 2026-11-25.
 *
 * Open-Meteo prévoit jusqu'à 16 jours, donc toute la fenêtre J-14, et corrige
 * la température selon l'altitude qu'on lui donne (`elevation`) : la
 * correction d'altitude reste chez le fournisseur (§23), et l'altitude du
 * parcours reste celle qu'on affiche (§22). Données sous licence CC BY 4.0 :
 * la source se cite à côté de la donnée. L'offre gratuite ne couvre pas un
 * usage commercial : un abonnement est à prendre avant la mise en ligne.
 *
 * L'adaptateur rend des séries horaires par lieu (`getSeries`), partageables
 * entre les coureurs d'une même course ; `getForecast` les projette sur des
 * heures de passage. Chaque lieu d'une requête compte pour un appel.
 */

export const OPEN_METEO = {
  provider: 'open-meteo',
  providerConfigVersion: 'open-meteo-1.0.0',
  /**
   * Règles de lecture : la valeur instantanée de l'heure la plus proche du
   * passage, et l'heure qui contient le passage pour les cumuls et maxima de
   * l'heure écoulée (pluie, probabilité, rafales).
   */
  normalizerVersion: 'open-meteo-normalizer-1.0.0',
  model: 'best_match',
  baseUrl: 'https://api.open-meteo.com/v1/forecast',
  /** Au-delà, la prévision n'existe pas : un passage plus lointain reste sans valeur. */
  forecastDays: 16,
  maxLocationsPerCall: 50,
  attribution: {
    text: 'Weather data by Open-Meteo.com',
    url: 'https://open-meteo.com/',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
} as const;

const INSTANT = [
  'temperature_2m',
  'apparent_temperature',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
] as const;
const PRECEDING_HOUR = ['precipitation_probability', 'precipitation', 'wind_gusts_10m'] as const;

const HOUR = 3600;
const DAY = 24 * HOUR;

export interface OpenMeteoQuery {
  /** Les clés des lieux demandés, dans l'ordre de la requête. */
  readonly pointKeys: readonly string[];
  readonly url: string;
  readonly windowStart: number;
  readonly windowEnd: number;
}

/** « 2026-09-11T15:00 » : une heure UTC, au format des paramètres `start_hour` / `end_hour`. */
function utcHour(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 13) + ':00';
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

/**
 * Les appels à faire pour des séries : un par groupe d'au plus 50 lieux, en
 * séparant les lieux sans altitude (le fournisseur prend alors son propre
 * modèle de terrain) de ceux qui en ont une. La fenêtre, arrondie à l'heure,
 * est bornée à l'horizon du fournisseur ; hors de l'horizon, rien n'est
 * demandé.
 */
export function openMeteoSeriesQueries(
  request: SeriesRequest,
  now: Date,
  baseUrl: string = OPEN_METEO.baseUrl,
): readonly OpenMeteoQuery[] {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const firstHour = Math.floor(nowSeconds / DAY) * DAY;
  const lastHour = firstHour + OPEN_METEO.forecastDays * DAY - HOUR;
  const start = Math.max(firstHour, Math.floor(Date.parse(request.from) / 1000 / HOUR) * HOUR);
  const end = Math.min(lastHour, Math.ceil(Date.parse(request.to) / 1000 / HOUR) * HOUR);
  if (request.locations.length === 0 || end < start) return [];

  const groups = [
    request.locations.filter((location) => location.elevationM !== null),
    request.locations.filter((location) => location.elevationM === null),
  ];
  return groups.flatMap((group) =>
    chunks(group, OPEN_METEO.maxLocationsPerCall).map((locations) => {
      const params = new URLSearchParams({
        latitude: locations.map((location) => location.latitude.toFixed(4)).join(','),
        longitude: locations.map((location) => location.longitude.toFixed(4)).join(','),
        hourly: [...INSTANT, ...PRECEDING_HOUR].join(','),
        timezone: 'GMT',
        timeformat: 'unixtime',
        wind_speed_unit: 'kmh',
        start_hour: utcHour(start),
        end_hour: utcHour(end),
      });
      // Un groupe a l'altitude de tous ses lieux, ou d'aucun.
      const altitudes = locations.flatMap((location) =>
        location.elevationM === null ? [] : [String(Math.round(location.elevationM))],
      );
      if (altitudes.length === locations.length) params.set('elevation', altitudes.join(','));
      return {
        pointKeys: locations.map((location) => location.key),
        url: `${baseUrl}?${params}`,
        windowStart: start,
        windowEnd: end,
      };
    }),
  );
}

/** Les appels pour des passages : la fenêtre couvre chaque passage, une heure de part et d'autre. */
export function openMeteoQueries(
  request: WeatherProviderRequest,
  now: Date,
  baseUrl: string = OPEN_METEO.baseUrl,
): readonly OpenMeteoQuery[] {
  return openMeteoSeriesQueries(seriesRequestOf(request), now, baseUrl);
}

function seriesRequestOf(request: WeatherProviderRequest): SeriesRequest {
  const times = request.points.map((point) => Date.parse(point.plannedDatetime));
  return {
    locations: request.points.map((point) => ({
      key: point.pointKey,
      latitude: point.latitude,
      longitude: point.longitude,
      elevationM: point.routeAltitudeM,
    })),
    from: new Date(Math.min(...times) - HOUR * 1000).toISOString(),
    to: new Date(Math.max(...times) + HOUR * 1000).toISOString(),
  };
}

const series = z.array(z.number().nullable());

const locationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().nullable().optional(),
  hourly: z.object({
    time: z.array(z.number()),
    temperature_2m: series.optional(),
    apparent_temperature: series.optional(),
    weather_code: series.optional(),
    wind_speed_10m: series.optional(),
    wind_direction_10m: series.optional(),
    precipitation_probability: series.optional(),
    precipitation: series.optional(),
    wind_gusts_10m: series.optional(),
  }),
});

/** Une réponse à un seul lieu est un objet ; à plusieurs, une liste. */
const responseSchema = z.union([z.array(locationSchema), locationSchema]);

type Location = z.infer<typeof locationSchema>;

export type WeatherProviderErrorCode = 'http' | 'timeout' | 'network' | 'malformed';

/** §90, §91 : l'échec est typé ; le run passe `failed`, aucune valeur n'est inventée. */
export class WeatherProviderError extends Error {
  readonly code: WeatherProviderErrorCode;
  readonly status: number | null;

  constructor(code: WeatherProviderErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'WeatherProviderError';
    this.code = code;
    this.status = status;
  }
}

/** Une variable absente de la réponse reste une série vide de valeurs, jamais estimée. */
function column(
  location: Location,
  name: Exclude<keyof Location['hourly'], 'time'>,
): readonly (number | null)[] {
  return location.hourly[name] ?? location.hourly.time.map(() => null);
}

function seriesOf(location: Location): HourlySeries {
  return {
    times: location.hourly.time,
    temperatureC: column(location, 'temperature_2m'),
    apparentTemperatureC: column(location, 'apparent_temperature'),
    weatherCode: column(location, 'weather_code'),
    windSpeedKmh: column(location, 'wind_speed_10m'),
    windDirectionDeg: column(location, 'wind_direction_10m'),
    precipitationProbabilityPct: column(location, 'precipitation_probability'),
    precipitationAmountMm: column(location, 'precipitation'),
    windGustKmh: column(location, 'wind_gusts_10m'),
    providerElevationM: location.elevation ?? null,
  };
}

/**
 * Lit les séries d'un appel. Une réponse qui ne correspond pas à la demande
 * est refusée en bloc, plutôt que d'attribuer une série au mauvais lieu.
 */
export function parseOpenMeteoSeries(
  query: Pick<OpenMeteoQuery, 'pointKeys'>,
  body: unknown,
): ReadonlyMap<string, HourlySeries> {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new WeatherProviderError('malformed', 'réponse Open-Meteo illisible');
  const locations = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (locations.length !== query.pointKeys.length) {
    throw new WeatherProviderError('malformed', 'réponse Open-Meteo incomplète');
  }
  return new Map(
    query.pointKeys.map((key, index) => [key, seriesOf(locations[index] as Location)]),
  );
}

/** Lit un appel et le projette sur les passages demandés. */
export function parseOpenMeteoResponse(
  query: Pick<OpenMeteoQuery, 'pointKeys'>,
  request: WeatherProviderRequest,
  body: unknown,
  fetchedAt: string,
): readonly NormalizedWeatherPoint[] {
  const parsed = parseOpenMeteoSeries(query, body);
  const planned = new Map(request.points.map((point) => [point.pointKey, point.plannedDatetime]));
  return query.pointKeys.map((pointKey) =>
    projectSeries(
      pointKey,
      planned.get(pointKey) as string,
      parsed.get(pointKey) as HourlySeries,
      fetchedAt,
    ),
  );
}

export interface OpenMeteoDependencies {
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/** Le fournisseur Open-Meteo derrière les contrats du moteur (§24). */
export function createOpenMeteoProvider(
  dependencies: OpenMeteoDependencies,
): WeatherProvider & WeatherSeriesProvider {
  const timeoutMs = dependencies.timeoutMs ?? 10_000;

  async function call(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await dependencies.fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new WeatherProviderError(
          'http',
          `Open-Meteo a répondu ${String(response.status)}`,
          response.status,
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof WeatherProviderError) throw error;
      if (controller.signal.aborted)
        throw new WeatherProviderError('timeout', 'Open-Meteo trop lent');
      throw new WeatherProviderError('network', 'Open-Meteo injoignable');
    } finally {
      clearTimeout(timer);
    }
  }

  async function getSeries(request: SeriesRequest): Promise<SeriesResponse> {
    const now = dependencies.now();
    const queries = openMeteoSeriesQueries(request, now, dependencies.baseUrl);
    const received = new Map<string, HourlySeries>();
    for (const query of queries) {
      for (const [key, value] of parseOpenMeteoSeries(query, await call(query.url))) {
        received.set(key, value);
      }
    }
    const first = queries[0];
    return {
      provider: OPEN_METEO.provider,
      providerModel: OPEN_METEO.model,
      providerConfigVersion: OPEN_METEO.providerConfigVersion,
      normalizerVersion: OPEN_METEO.normalizerVersion,
      fetchedAt: now.toISOString(),
      windowStart: first === undefined ? null : new Date(first.windowStart * 1000).toISOString(),
      windowEnd: first === undefined ? null : new Date(first.windowEnd * 1000).toISOString(),
      series: received,
    };
  }

  return {
    getSeries,
    async getForecast(request) {
      const response = await getSeries(seriesRequestOf(request));
      // Un passage hors de l'horizon n'a pas été demandé : il reste sans valeur.
      const points = request.points.map((point) => {
        const found = response.series.get(point.pointKey);
        return found === undefined
          ? emptyPoint(point.pointKey, response.fetchedAt)
          : projectSeries(point.pointKey, point.plannedDatetime, found, response.fetchedAt);
      });
      const forecast: WeatherProviderResponse = {
        provider: response.provider,
        providerModel: response.providerModel,
        providerConfigVersion: response.providerConfigVersion,
        normalizerVersion: response.normalizerVersion,
        fetchedAt: response.fetchedAt,
        forecastIssuedAt: null,
        points,
        completeness: completenessOf(points),
      };
      return forecast;
    },
  };
}
