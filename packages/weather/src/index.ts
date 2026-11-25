export {
  WEATHER_ENGINE_V1,
  type WeatherEngineConfig,
  type WeatherHorizon,
  type WeatherRefreshConfig,
  type WeatherRoutePointsConfig,
  type WeatherVirtualCheckpointsConfig,
} from './config.js';
export type {
  NormalizedWeatherPoint,
  RunCompleteness,
  TimelinePoint,
  TracePosition,
  VirtualCheckpointRequest,
  WaypointKind,
  WeatherProvider,
  WeatherProviderRequest,
  WeatherProviderResponse,
  WeatherRoutePoint,
  WeatherScope,
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
export { completenessOf, emptyPoint, hasForecast, skyFromWmo } from './normalizer.js';
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
  parseOpenMeteoResponse,
  type OpenMeteoDependencies,
  type OpenMeteoQuery,
  type WeatherProviderErrorCode,
} from './providers/open-meteo.js';
