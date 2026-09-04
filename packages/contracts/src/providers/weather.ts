import { z } from 'zod';

import { latitudeSchema, longitudeSchema, routeAltitudeMetersSchema } from '../primitives/geo.js';
import { nonEmptyStringSchema } from '../primitives/ids.js';
import { jsonValueSchema } from '../primitives/json.js';
import { ianaTimeZoneSchema, instantSchema } from '../primitives/time.js';

/**
 * Contrat provider météo — `WEATHER_CONDITIONS.md` §24 à §26.
 *
 * Le fournisseur concret n'est pas figé (§27, AGENTS §68) : le domaine ne
 * connaît que ce contrat. Le provider reçoit des points utiles du parcours et
 * une date/heure de passage résolue, jamais une notion de Plan ni d'utilisateur.
 */
export const weatherProviderPointRequestSchema = z.object({
  pointKey: nonEmptyStringSchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  routeAltitudeM: routeAltitudeMetersSchema.nullable(),
  plannedDatetime: instantSchema,
});

export type WeatherProviderPointRequest = z.infer<typeof weatherProviderPointRequestSchema>;

/**
 * Requête météo.
 *
 * Les points sont les points *utiles* — waypoints, points significatifs,
 * checkpoints virtuels — jamais chaque point GPX (ACCEPTANCE AC-WX-04).
 * L'adapter reste libre de regrouper les appels (§25).
 */
export const weatherProviderRequestSchema = z.object({
  points: z.array(weatherProviderPointRequestSchema).min(1),
  timezone: ianaTimeZoneSchema,
});

export type WeatherProviderRequest = z.infer<typeof weatherProviderRequestSchema>;

/**
 * Point météo normalisé (§26).
 *
 * Chaque grandeur est nullable et le reste : un champ absent chez le provider
 * demeure absent. Aucune estimation, aucune correction d'altitude, aucun
 * ressenti recalculé (AGENTS §38, ACCEPTANCE AC-WX-05 / AC-WX-06).
 */
export const normalizedWeatherPointSchema = z.object({
  pointKey: nonEmptyStringSchema,

  forecastIssuedAt: instantSchema.nullable(),
  fetchedAt: instantSchema,

  temperatureC: z.number().nullable(),
  apparentTemperatureC: z.number().nullable(),

  precipitationProbabilityPct: z.number().min(0).max(100).nullable(),
  precipitationAmountMm: z.number().min(0).nullable(),

  windSpeedKmh: z.number().min(0).nullable(),
  windGustKmh: z.number().min(0).nullable(),
  windDirectionDeg: z.number().int().min(0).max(359).nullable(),

  weatherCode: z.string().nullable(),

  // Conservé pour l'audit d'un run ; doit rester sérialisable en `jsonb`.
  providerPayload: jsonValueSchema.optional(),
});

export type NormalizedWeatherPoint = z.infer<typeof normalizedWeatherPointSchema>;

export const weatherProviderResponseSchema = z.object({
  points: z.array(normalizedWeatherPointSchema),
});

export type WeatherProviderResponse = z.infer<typeof weatherProviderResponseSchema>;

export interface WeatherProvider {
  /** Nom du provider, persisté avec le forecast run pour la provenance. */
  readonly name: string;

  getForecast(request: WeatherProviderRequest): Promise<WeatherProviderResponse>;
}
