/**
 * Contrats du moteur Conditions — WEATHER_CONDITIONS §13 à §26.
 *
 * La météo est projetée sur le Plan ; le Plan n'est jamais recalculé à partir
 * de la météo (§1). Tout instant est une vraie date ISO, jamais un nombre de
 * minutes depuis le départ (§13).
 */

export type WeatherScope = 'race_plan' | 'outing';

/**
 * Le type d'un point, celui de `waypoint_type`. Le ravito d'une sortie
 * (`outing_point_type` « aid ») s'y lit `aid_station`.
 */
export type WaypointKind =
  | 'start'
  | 'aid_station'
  | 'water'
  | 'checkpoint'
  | 'cutoff'
  | 'assistance'
  | 'summit'
  | 'pass'
  | 'finish'
  | 'other';

/** Un point du Plan ou de la sortie, tel que la timeline le fournit (§15, §16). */
export interface TimelinePoint {
  readonly id: string;
  readonly source: 'race_waypoint' | 'outing_waypoint';
  readonly kind: WaypointKind;
  readonly label: string;
  readonly distanceKm: number;
  /** Nulles quand le point n'est pas géolocalisé : il ne peut pas recevoir de prévision. */
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** L'altitude du parcours, jamais celle du modèle météo (§22). */
  readonly altitudeM: number | null;
  /** Arrivée au point, en secondes depuis le départ. */
  readonly elapsedSeconds: number;
  /** Départ du point, arrêt compris ; égal à l'arrivée sans arrêt. */
  readonly departureElapsedSeconds: number;
  /** Le segment qui part de ce point vers le suivant ; nul à l'arrivée. */
  readonly nextSegmentId: string | null;
}

/** Le snapshot d'une version de Plan, ou d'une sortie, que la météo projette (§15, §16). */
export interface WeatherTimeline {
  readonly scope: WeatherScope;
  /** `race_plan_id` ou `outing_id` : un run correspond à une version réelle du Plan (§28). */
  readonly scopeId: string;
  /** L'instant de départ, en ISO. */
  readonly startAt: string;
  /** Fuseau IANA du scope. */
  readonly timezone: string;
  /** Dans l'ordre du parcours : le premier est le départ, le dernier l'arrivée. */
  readonly points: readonly TimelinePoint[];
  /** Version de la géométrie utilisée, pour l'empreinte (§30) ; nulle sans trace. */
  readonly geometryKey: string | null;
}

/** Contrat canonique d'un point météo (§17). `pointKey` est unique dans un run. */
export interface WeatherRoutePoint {
  readonly pointKey: string;
  readonly sourceType: 'race_waypoint' | 'outing_waypoint' | 'virtual_checkpoint';
  readonly raceWaypointId: string | null;
  readonly outingWaypointId: string | null;
  readonly virtualSegmentId: string | null;
  readonly label: string;
  readonly distanceKm: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly routeAltitudeM: number | null;
  readonly plannedDatetime: string;
  readonly elapsedSeconds: number;
}

/**
 * Un point virtuel à placer (§19 à §21) : le moteur dit où et quand ; la
 * position réelle sur la trace vient de la géométrie, hors du moteur pur.
 */
export interface VirtualCheckpointRequest {
  readonly pointKey: string;
  readonly virtualSegmentId: string | null;
  readonly label: string;
  readonly distanceKm: number;
  readonly elapsedSeconds: number;
}

/** Une position lue sur la vraie trace. */
export interface TracePosition {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeM: number | null;
}

/** §25. */
export interface WeatherProviderRequest {
  readonly points: readonly {
    readonly pointKey: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly routeAltitudeM: number | null;
    readonly plannedDatetime: string;
  }[];
  readonly timezone: string;
}

/**
 * Taxonomie d'affichage PLUKA, indépendante du fournisseur (§56). Ce n'est pas
 * un `ConditionType` : « pluie » ici décrit le ciel, pas une période détectée.
 */
export type WeatherSky =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'snow'
  | 'storm'
  | 'unknown';

/** §26 : une propriété indisponible reste `null`, jamais estimée. */
export interface NormalizedWeatherPoint {
  readonly pointKey: string;
  /** Nul quand le fournisseur ne dit pas de quel calcul vient la prévision. */
  readonly forecastIssuedAt: string | null;
  readonly fetchedAt: string;
  readonly temperatureC: number | null;
  readonly apparentTemperatureC: number | null;
  /** Une probabilité n'est pas une quantité (§58). */
  readonly precipitationProbabilityPct: number | null;
  readonly precipitationAmountMm: number | null;
  /** Une rafale n'est pas le vent moyen (§57). */
  readonly windSpeedKmh: number | null;
  readonly windGustKmh: number | null;
  readonly windDirectionDeg: number | null;
  /** La taxonomie PLUKA (§56) ; le code du fournisseur reste dans `providerPayload`. */
  readonly weatherCode: WeatherSky | null;
  readonly providerPayload?: unknown;
}

/** §55 : un run partiel ne se fait jamais passer pour complet. */
export type RunCompleteness = 'complete' | 'partial' | 'failed';

export interface WeatherProviderResponse {
  readonly provider: string;
  readonly providerModel: string | null;
  readonly providerConfigVersion: string;
  readonly normalizerVersion: string;
  readonly fetchedAt: string;
  readonly forecastIssuedAt: string | null;
  /** Un point par point demandé, dans l'ordre de la demande. */
  readonly points: readonly NormalizedWeatherPoint[];
  readonly completeness: RunCompleteness;
}

/** §24 : le domaine ne connaît que ce contrat, jamais le SDK d'un fournisseur. */
export interface WeatherProvider {
  getForecast(request: WeatherProviderRequest): Promise<WeatherProviderResponse>;
}
