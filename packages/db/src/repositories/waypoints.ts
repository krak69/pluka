import { selectColumns } from '../columns.js';
import { defineRepository } from '../repository.js';
import { unwrap } from '../results.js';
import type { RaceCutoffRecord, RaceWaypointRecord } from './plan.js';

/**
 * Référentiel de parcours d'une épreuve — 02_DATA_MODEL §6.6, §6.7.
 *
 * La lecture est une requête ordinaire, sous RLS. L'écriture ne l'est pas :
 * elle passe par `set_race_waypoints` (0025), qui réécrit la chaîne entière —
 * waypoints, segments dérivés, barrières — et enfile la relance du
 * prétraitement, en une transaction.
 *
 * Aucune méthode n'insère ni ne supprime ligne à ligne. Ce serait laisser,
 * entre deux requêtes, un référentiel dont les segments ne relient plus les
 * bons points, et que le moteur Plan refuserait (PLAN_ENGINE §7).
 */

const WAYPOINT_COLUMNS = [
  'id',
  'race_id',
  'name',
  'waypoint_type',
  'distance_km',
  'sort_order',
  'altitude_m',
  'drop_bag_allowed',
  'assistance_allowed',
] as const;

const CUTOFF_COLUMNS = [
  'id',
  'race_id',
  'race_waypoint_id',
  'cutoff_datetime',
  'cutoff_type',
  'basis',
] as const;

type WaypointRow = {
  id: string;
  race_id: string;
  name: string;
  waypoint_type: RaceWaypointRecord['waypointType'];
  distance_km: number;
  sort_order: number;
  altitude_m: number | null;
  drop_bag_allowed: boolean;
  assistance_allowed: boolean;
};

type CutoffRow = {
  id: string;
  race_id: string;
  race_waypoint_id: string;
  cutoff_datetime: string;
  cutoff_type: RaceCutoffRecord['cutoffType'];
  basis: RaceCutoffRecord['basis'];
};

/**
 * Un point du référentiel tel que la Course le montre.
 *
 * Le drop bag et l'assistance ne sont pas dans `RaceWaypointRecord` : le moteur Plan n'en a que
 * faire, et son snapshot ne doit pas changer pour une case cochée.
 */
export interface CourseWaypointRecord extends RaceWaypointRecord {
  /** L'organisation accepte un drop bag à ce point (migration 0094). */
  readonly dropBagAllowed: boolean;
  /** L'organisation autorise l'assistance à ce point (migration 0098). */
  readonly assistanceAllowed: boolean;
}

function toWaypoint(row: WaypointRow): CourseWaypointRecord {
  return {
    id: row.id,
    raceId: row.race_id,
    name: row.name,
    waypointType: row.waypoint_type,
    distanceKm: row.distance_km,
    sortOrder: row.sort_order,
    altitudeM: row.altitude_m,
    dropBagAllowed: row.drop_bag_allowed,
    assistanceAllowed: row.assistance_allowed,
  };
}

function toCutoff(row: CutoffRow): RaceCutoffRecord {
  return {
    id: row.id,
    raceId: row.race_id,
    raceWaypointId: row.race_waypoint_id,
    cutoffDatetime: row.cutoff_datetime,
    cutoffType: row.cutoff_type,
    basis: row.basis,
  };
}

/** Ce qu'un écran transmet pour une ligne de la chaîne. */
export interface RaceWaypointInput {
  /** Absent pour un waypoint qu'on ajoute. */
  readonly id?: string | undefined;
  readonly name: string;
  readonly waypointType: RaceWaypointRecord['waypointType'];
  readonly distanceKm: number;
  /** Barrière horaire, ou son absence. */
  readonly cutoffAt?: string | null | undefined;
  /** Drop bag accepté à ce point. Absent, il ne l'est pas. */
  readonly dropBagAllowed?: boolean | undefined;
  /** Assistance autorisée à ce point. Absente, elle ne l'est pas. */
  readonly assistanceAllowed?: boolean | undefined;
}

/** Ce que la réécriture rend : de quoi dire à l'écran ce qui a été demandé. */
export interface SetRaceWaypointsResult {
  readonly raceId: string;
  readonly waypointCount: number;
  readonly courseGeometryId: string | null;
  /** Faux quand l'épreuve n'a pas encore de géométrie : rien à prétraiter. */
  readonly preprocessingRequested: boolean;
}

export interface RaceWaypointRepository {
  listByRace(raceId: string): Promise<readonly CourseWaypointRecord[]>;
  listCutoffsByRace(raceId: string): Promise<readonly RaceCutoffRecord[]>;
  replace(raceId: string, waypoints: readonly RaceWaypointInput[]): Promise<SetRaceWaypointsResult>;
}

export const raceWaypointRepository = defineRepository<RaceWaypointRepository>((context) => ({
  async listByRace(raceId) {
    const rows = unwrap(
      await context.client
        .from('race_waypoints')
        .select(selectColumns('race_waypoints', WAYPOINT_COLUMNS))
        .eq('race_id', raceId)
        .order('sort_order', { ascending: true }),
      'race_waypoints.listByRace',
    );

    return rows.map(toWaypoint);
  },

  async listCutoffsByRace(raceId) {
    const rows = unwrap(
      await context.client
        .from('race_cutoffs')
        .select(selectColumns('race_cutoffs', CUTOFF_COLUMNS))
        .eq('race_id', raceId),
      'race_cutoffs.listByRace',
    );

    return rows.map(toCutoff);
  },

  async replace(raceId, waypoints) {
    const payload = unwrap(
      await context.client.rpc('set_race_waypoints', {
        p_race_id: raceId,
        // La forme du tableau est le contrat de la fonction : ordre du tableau,
        // clés en camelCase. Le rang n'est pas transmis — c'est la position.
        p_waypoints: waypoints.map((waypoint) => ({
          id: waypoint.id ?? null,
          name: waypoint.name,
          waypointType: waypoint.waypointType,
          distanceKm: waypoint.distanceKm,
          cutoffAt: waypoint.cutoffAt ?? null,
          dropBagAllowed: waypoint.dropBagAllowed ?? false,
          assistanceAllowed: waypoint.assistanceAllowed ?? false,
        })),
      }),
      'set_race_waypoints',
    );

    return payload as unknown as SetRaceWaypointsResult;
  },
}));
