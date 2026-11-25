export {
  WEATHER_ENGINE_V1,
  type WeatherEngineConfig,
  type WeatherHorizon,
  type WeatherRefreshConfig,
  type WeatherRoutePointsConfig,
  type WeatherVirtualCheckpointsConfig,
} from './config.js';
export type {
  HourlySeries,
  NormalizedWeatherPoint,
  RunCompleteness,
  SeriesLocation,
  SeriesRequest,
  SeriesResponse,
  TimelinePoint,
  TracePosition,
  VirtualCheckpointRequest,
  WaypointKind,
  WeatherProvider,
  WeatherProviderRequest,
  WeatherProviderResponse,
  WeatherRoutePoint,
  WeatherScope,
  WeatherSeriesProvider,
  WeatherSky,
  WeatherTimeline,
} from './contracts.js';
export {
  WINDOW_DAYS,
  daysToStart,
  horizonOf,
  localDate,
  refreshDue,
  weatherEligibility,
  type WeatherEligibility,
  type WeatherEligibilityInput,
  type WeatherEligibilityStatus,
} from './eligibility.js';
export {
  assembleWeatherRoutePoints,
  planWeatherRoutePoints,
  plannedDatetime,
  type RoutePointIssue,
  type RoutePointPlan,
} from './route-points.js';
export { computeWeatherInputHash, type WeatherHashInput } from './hash.js';
export {
  completenessOf,
  emptyPoint,
  hasForecast,
  projectSeries,
  skyFromWmo,
} from './normalizer.js';
export { seriesReusable, seriesWindow, type CachedSeries, type WantedLocation } from './series.js';
export {
  buildRaceRun,
  type BuiltRun,
  type FetchedSeries,
  type ProviderIdentity,
  type RunPoint,
} from './run.js';
export {
  SUNRISE_ALTITUDE_DEG,
  nightPeriods,
  solarAltitudeDeg,
  type NightPeriod,
} from './astronomy.js';
export {
  OPEN_METEO,
  WeatherProviderError,
  createOpenMeteoProvider,
  openMeteoQueries,
  openMeteoSeriesQueries,
  parseOpenMeteoResponse,
  parseOpenMeteoSeries,
  type OpenMeteoDependencies,
  type OpenMeteoQuery,
  type WeatherProviderErrorCode,
} from './providers/open-meteo.js';
