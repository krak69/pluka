import type { WaypointKind } from './contracts.js';

/**
 * Configuration versionnée du moteur Conditions — WEATHER_CONDITIONS §18,
 * §20, §30, §32, §102.
 *
 * Le choix des points et la fraîcheur ne sont pas fixés par la spec : ce sont
 * des décisions et propositions du 2026-11-25, à ajuster après essais sur des
 * parcours réels. Toute modification change sa version, qui entre dans
 * l'empreinte d'un run.
 */

/** §20 : au-delà de cet écart entre deux points retenus, le moteur en ajoute sur la trace. */
export interface WeatherVirtualCheckpointsConfig {
  readonly maxDistanceGapKm: number;
  readonly maxTimeGapSeconds: number;
}

/** §18 à §20 : les points du Plan qui reçoivent une prévision. */
export interface WeatherRoutePointsConfig {
  readonly version: string;
  /** Les types retenus ; le départ et l'arrivée le sont toujours. */
  readonly kinds: readonly WaypointKind[];
  /** Nul : aucun point n'est ajouté sur la trace entre deux points retenus. */
  readonly virtual: WeatherVirtualCheckpointsConfig | null;
}

/** §9 : la distance au départ, en libellés qualitatifs, jamais en pourcentage. */
export type WeatherHorizon = 'far' | 'medium' | 'near' | 'race_day';

/** §32 : l'âge au-delà duquel une prévision doit être rafraîchie, selon l'horizon. */
export interface WeatherRefreshConfig {
  readonly version: string;
  readonly maxAgeSeconds: Readonly<Record<WeatherHorizon, number>>;
}

export interface WeatherEngineConfig {
  /** Version des règles du moteur (sélection des points, nuit, empreinte). */
  readonly conditionsEngineVersion: string;
  readonly routePoints: WeatherRoutePointsConfig;
  readonly refresh: WeatherRefreshConfig;
  /**
   * §93 : la fenêtre des séries partagées d'une course, autour de son départ.
   * Elle couvre tous les coureurs, rapides ou lents ; au-delà de l'horizon du
   * fournisseur, elle s'arrête d'elle-même.
   */
  readonly series: {
    readonly beforeStartSeconds: number;
    readonly afterStartSeconds: number;
  };
  /** §46 : la nuit se calcule localement, par un algorithme versionné. */
  readonly astronomy: {
    readonly version: string;
    /** Pas de balayage de la course, avant affinage à `precisionSeconds`. */
    readonly stepSeconds: number;
    readonly precisionSeconds: number;
  };
}

const HOUR = 3600;

export const WEATHER_ENGINE_V1: WeatherEngineConfig = {
  conditionsEngineVersion: 'conditions-engine-1.0.0',
  routePoints: {
    version: 'route-points-1.0.0',
    // Décision du 2026-11-25 : départ, arrivée, points de passage,
    // ravitaillements, sommets et cols. Ni points d'eau, ni barrières seules,
    // ni points d'assistance, et rien d'ajouté entre deux points.
    kinds: ['start', 'checkpoint', 'aid_station', 'summit', 'pass', 'finish'],
    virtual: null,
  },
  refresh: {
    version: 'refresh-1.0.0',
    maxAgeSeconds: {
      far: 12 * HOUR,
      medium: 6 * HOUR,
      near: 3 * HOUR,
      race_day: 1 * HOUR,
    },
  },
  series: {
    beforeStartSeconds: 1 * HOUR,
    // Sept jours : au-delà, Open-Meteo compte la requête pour plus d'un appel.
    afterStartSeconds: 7 * 24 * HOUR,
  },
  astronomy: {
    version: 'astronomy-noaa-1.0.0',
    stepSeconds: 5 * 60,
    precisionSeconds: 30,
  },
};
