import { z } from 'zod';

import type {
  NormalizedWeatherPoint,
  WeatherProvider,
  WeatherProviderRequest,
  WeatherProviderResponse,
} from '../contracts.js';
import { completenessOf, emptyPoint, skyFromWmo } from '../normalizer.js';

/**
 * Adaptateur Open-Meteo — WEATHER_CONDITIONS §23 à §27 ; choix du 2026-11-25.
 *
 * Open-Meteo prévoit jusqu'à 16 jours, donc toute la fenêtre J-14, et corrige
 * la température selon l'altitude qu'on lui donne (`elevation`) : la
 * correction d'altitude reste chez le fournisseur (§23), et l'altitude du
 * parcours reste celle qu'on affiche (§22). Données sous licence CC BY 4.0 :
 * la source se cite à côté de la donnée. L'offre gratuite ne couvre pas un
 * usage commercial : un abonnement est à prendre avant la mise en ligne.
 */

export const OPEN_METEO = {
  provider: 'open-meteo',
  providerConfigVersion: 'open-meteo-1.0.0',
  /**
   * Règles de lecture : la valeur instantanée la plus proche du passage, et
   * l'heure qui contient le passage pour les cumuls et maxima de l'heure
   * écoulée (pluie, probabilité, rafales).
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
  readonly pointKeys: readonly string[];
  readonly url: string;
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
 * Les appels à faire : un par groupe d'au plus 50 points, en séparant les
 * points sans altitude (le fournisseur prend alors son propre modèle de
 * terrain) de ceux qui en ont une. La fenêtre horaire couvre les passages, une
 * heure de part et d'autre, bornée à l'horizon du fournisseur ; un passage
 * au-delà n'est pas demandé et restera sans valeur.
 */
export function openMeteoQueries(
  request: WeatherProviderRequest,
  now: Date,
  baseUrl: string = OPEN_METEO.baseUrl,
): readonly OpenMeteoQuery[] {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const firstHour = Math.floor(nowSeconds / DAY) * DAY;
  const lastHour = firstHour + OPEN_METEO.forecastDays * DAY - HOUR;
  const inHorizon = request.points.filter((point) => {
    const at = Date.parse(point.plannedDatetime) / 1000;
    return at >= firstHour && at <= lastHour;
  });

  const groups = [
    inHorizon.filter((point) => point.routeAltitudeM !== null),
    inHorizon.filter((point) => point.routeAltitudeM === null),
  ];
  return groups.flatMap((group) =>
    chunks(group, OPEN_METEO.maxLocationsPerCall).map((points) => {
      const times = points.map((point) => Date.parse(point.plannedDatetime) / 1000);
      const start = Math.max(firstHour, Math.floor(Math.min(...times) / HOUR) * HOUR - HOUR);
      const end = Math.min(lastHour, Math.ceil(Math.max(...times) / HOUR) * HOUR + HOUR);
      const params = new URLSearchParams({
        latitude: points.map((point) => point.latitude.toFixed(4)).join(','),
        longitude: points.map((point) => point.longitude.toFixed(4)).join(','),
        hourly: [...INSTANT, ...PRECEDING_HOUR].join(','),
        timezone: 'GMT',
        timeformat: 'unixtime',
        wind_speed_unit: 'kmh',
        start_hour: utcHour(start),
        end_hour: utcHour(end),
      });
      // Un groupe a l'altitude de tous ses points, ou d'aucun.
      const altitudes = points.flatMap((point) =>
        point.routeAltitudeM === null ? [] : [String(Math.round(point.routeAltitudeM))],
      );
      if (altitudes.length === points.length) params.set('elevation', altitudes.join(','));
      return { pointKeys: points.map((point) => point.pointKey), url: `${baseUrl}?${params}` };
    }),
  );
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

/** Une réponse à un seul point est un objet ; à plusieurs, une liste. */
const responseSchema = z.union([z.array(locationSchema), locationSchema]);

type Location = z.infer<typeof locationSchema>;
type Hourly = Location['hourly'];

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

function valueAt(hourly: Hourly, name: keyof Omit<Hourly, 'time'>, slot: number): number | null {
  const index = hourly.time.indexOf(slot);
  if (index < 0) return null;
  return hourly[name]?.[index] ?? null;
}

/** Lit un point : l'heure la plus proche pour l'instantané, l'heure qui contient le passage pour le reste. */
function normalizePoint(
  pointKey: string,
  plannedDatetime: string,
  location: Location,
  fetchedAt: string,
): NormalizedWeatherPoint {
  const at = Date.parse(plannedDatetime) / 1000;
  const instant = Math.round(at / HOUR) * HOUR;
  const preceding = Math.ceil(at / HOUR) * HOUR;
  const { hourly } = location;
  const wmo = valueAt(hourly, 'weather_code', instant);
  const direction = valueAt(hourly, 'wind_direction_10m', instant);
  const point: NormalizedWeatherPoint = {
    pointKey,
    forecastIssuedAt: null,
    fetchedAt,
    temperatureC: valueAt(hourly, 'temperature_2m', instant),
    apparentTemperatureC: valueAt(hourly, 'apparent_temperature', instant),
    precipitationProbabilityPct: valueAt(hourly, 'precipitation_probability', preceding),
    precipitationAmountMm: valueAt(hourly, 'precipitation', preceding),
    windSpeedKmh: valueAt(hourly, 'wind_speed_10m', instant),
    windGustKmh: valueAt(hourly, 'wind_gusts_10m', preceding),
    windDirectionDeg: direction === null ? null : Math.round(direction) % 360,
    weatherCode: skyFromWmo(wmo === null ? null : Math.round(wmo)),
  };
  return {
    ...point,
    providerPayload: {
      wmoCode: wmo,
      // L'altitude du modèle de terrain du fournisseur, pour l'audit (W18) ;
      // jamais affichée à la place de celle du parcours.
      providerElevationM: location.elevation ?? null,
      instantSlot: new Date(instant * 1000).toISOString(),
      precedingHourSlot: new Date(preceding * 1000).toISOString(),
    },
  };
}

/**
 * Lit la réponse d'un appel. Une réponse qui ne correspond pas à la demande
 * est refusée en bloc, plutôt que d'attribuer une prévision au mauvais point.
 */
export function parseOpenMeteoResponse(
  query: OpenMeteoQuery,
  request: WeatherProviderRequest,
  body: unknown,
  fetchedAt: string,
): readonly NormalizedWeatherPoint[] {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new WeatherProviderError('malformed', 'réponse Open-Meteo illisible');
  const locations = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (locations.length !== query.pointKeys.length) {
    throw new WeatherProviderError('malformed', 'réponse Open-Meteo incomplète');
  }
  const planned = new Map(request.points.map((point) => [point.pointKey, point.plannedDatetime]));
  return query.pointKeys.map((pointKey, index) =>
    normalizePoint(
      pointKey,
      planned.get(pointKey) as string,
      locations[index] as Location,
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

/** Le fournisseur Open-Meteo derrière le contrat `WeatherProvider` (§24). */
export function createOpenMeteoProvider(dependencies: OpenMeteoDependencies): WeatherProvider {
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

  return {
    async getForecast(request) {
      const now = dependencies.now();
      const fetchedAt = now.toISOString();
      const queries = openMeteoQueries(request, now, dependencies.baseUrl);
      const received = new Map<string, NormalizedWeatherPoint>();
      for (const query of queries) {
        const body = await call(query.url);
        for (const point of parseOpenMeteoResponse(query, request, body, fetchedAt)) {
          received.set(point.pointKey, point);
        }
      }
      // Un passage hors de l'horizon n'a pas été demandé : il reste sans valeur.
      const points = request.points.map(
        (point) => received.get(point.pointKey) ?? emptyPoint(point.pointKey, fetchedAt),
      );
      const response: WeatherProviderResponse = {
        provider: OPEN_METEO.provider,
        providerModel: OPEN_METEO.model,
        providerConfigVersion: OPEN_METEO.providerConfigVersion,
        normalizerVersion: OPEN_METEO.normalizerVersion,
        fetchedAt,
        forecastIssuedAt: null,
        points,
        completeness: completenessOf(points),
      };
      return response;
    },
  };
}
