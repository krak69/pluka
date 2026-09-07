import { selectColumns } from '../columns.js';
import { mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import type { Enum, PlukaClient } from '../types.js';
import {
  editionRepository,
  eventRepository,
  raceRepository,
  type EditionRepository,
  type EventRepository,
  type RaceRepository,
} from './course.js';
import { participantRaceRepository, type ParticipantRaceRepository } from './participation.js';

/*
 * Repositories du Plan de course — 02_DATA_MODEL §11, PLAN_ENGINE §38.
 *
 * « Le moteur pur ne connaît pas ces tables. » La réciproque tient aussi : rien
 * ici ne calcule une durée, ne choisit un mode, ni ne décide d'un droit. Ce
 * paquet lit le référentiel dont le domaine assemble le snapshot, et range le
 * résultat que le moteur a produit.
 *
 * L'écriture passe par une fonction SQL. Confirmer un Plan touche cinq tables
 * et en archive une sixième ligne (§37) ; PostgREST n'exécute qu'une
 * instruction par appel (01_ARCHITECTURE §31), et les découper laisserait des
 * Plans sans waypoints, ou deux versions actives sur la même participation.
 */

/** Fonctions de la migration 0020, absentes des types générés. */
type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

function rpc(client: PlukaClient): RpcClient {
  return client as unknown as RpcClient;
}

function unwrapRpc(result: { data: unknown; error: unknown }, operation: string): unknown {
  const error = result.error as PostgrestLikeError | null | undefined;
  if (error !== null && error !== undefined) throw mapPostgrestError(error, operation);

  return result.data;
}

function rows(data: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Référentiel de parcours, tel que le snapshot du moteur le consomme. */
export interface RaceWaypointRecord {
  readonly id: string;
  readonly raceId: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly distanceKm: number;
  /** Départ, ravitaillement, base de vie, arrivée… — 02_DATA_MODEL §6.6. */
  readonly waypointType: Enum<'waypoint_type'>;
  /** Altitude officielle, quand elle est connue. Ancre le profil altimétrique. */
  readonly altitudeM: number | null;
}

export interface RaceSegmentRecord {
  readonly id: string;
  readonly raceId: string;
  readonly sortOrder: number;
  readonly fromWaypointId: string;
  readonly toWaypointId: string;
}

export interface RaceCutoffRecord {
  readonly id: string;
  readonly raceId: string;
  readonly raceWaypointId: string;
  readonly cutoffDatetime: string;
  readonly cutoffType: Enum<'cutoff_type'>;
  /** §25 — instant auquel la barrière se compare. */
  readonly basis: Enum<'cutoff_basis'>;
}

/** Micro-segment prétraité — PLAN_ENGINE §8.1, étape 11. */
export interface CourseMicroSegmentRecord {
  readonly id: string;
  readonly raceSegmentId: string;
  readonly sortOrder: number;
  readonly distanceMeters: number;
  readonly elevationDeltaMeters: number;
  readonly elevationGainMeters: number;
  readonly elevationLossMeters: number;
  readonly rawGrade: number;
  readonly modelGrade: number;
  readonly progress: number;
  readonly technicality: 'smooth' | 'standard' | 'technical' | 'very_technical' | null;
  readonly preprocessingVersion: string;
}

/** Une version de Plan persistée — §36. */
export interface RacePlanRecord {
  readonly id: string;
  readonly participantRaceId: string;
  readonly version: number;
  readonly status: Enum<'plan_status'>;
  readonly engineVersion: string;
  readonly initialTargetDurationSeconds: number;
  readonly targetDurationSeconds: number;
  readonly plannedFinishDatetime: string | null;
  readonly inputHash: string | null;
}

/**
 * Contraintes explicites portées par un Plan — §24.
 *
 * Ce sont elles qu'un recalcul relit pour ne pas les écraser : « toute
 * personnalisation explicite reste une contrainte jusqu'à ce que l'utilisateur
 * la retire ».
 */
export interface PlanWaypointRecord {
  readonly raceWaypointId: string;
  readonly sortOrder: number;
  readonly plannedElapsedSeconds: number;
  readonly stopDurationSeconds: number;
  readonly stopOrigin: Enum<'plan_stop_origin'>;
  readonly isLocked: boolean;
  readonly lockedElapsedSeconds: number | null;
}

export interface PlanSegmentRecord {
  readonly raceSegmentId: string;
  readonly sortOrder: number;
  readonly initialDurationSeconds: number;
  readonly plannedDurationSeconds: number;
  readonly manualOverride: boolean;
}

/** Marge calculée à une barrière — §38.4. */
export interface PlanCutoffStatusRecord {
  readonly raceCutoffId: string;
  readonly raceWaypointId: string;
  readonly marginSeconds: number;
  readonly status: Enum<'cutoff_margin_status'>;
}

export interface PlanFactDependency {
  readonly raceFactVersionId: string;
  readonly dependencyType: Enum<'plan_dependency_type'>;
  readonly dependencyKey: string | null;
}

/** Charge d'écriture — reflet exact du résultat moteur, sans interprétation. */
export interface PersistPlanInput {
  readonly participantRaceId: string;
  readonly actorUserId: string;
  readonly summary: {
    readonly engineVersion: string;
    readonly initialTargetDurationSeconds: number;
    readonly targetDurationSeconds: number;
    readonly plannedFinishDatetime: string | null;
    readonly inputHash: string;
    readonly inputSnapshot: Readonly<Record<string, unknown>>;
  };
  readonly waypoints: readonly {
    readonly raceWaypointId: string;
    readonly sortOrder: number;
    readonly plannedElapsedSeconds: number;
    readonly plannedArrivalAt: string;
    readonly stopDurationSeconds: number;
    readonly stopOrigin: Enum<'plan_stop_origin'>;
    readonly isLocked: boolean;
    readonly lockedElapsedSeconds: number | null;
  }[];
  readonly segments: readonly {
    readonly raceSegmentId: string;
    readonly sortOrder: number;
    readonly initialDurationSeconds: number;
    readonly plannedDurationSeconds: number;
    readonly manualOverride: boolean;
  }[];
  readonly cutoffStatuses: readonly {
    readonly raceCutoffId: string;
    readonly raceWaypointId: string;
    readonly marginSeconds: number;
    readonly status: Enum<'cutoff_margin_status'>;
  }[];
  readonly dependencies: readonly PlanFactDependency[];
}

export interface PersistedPlan {
  readonly racePlanId: string;
  readonly version: number;
}

const WAYPOINT_COLUMNS = [
  'id',
  'race_id',
  'name',
  'sort_order',
  'distance_km',
  'waypoint_type',
  'altitude_m',
] as const;
const SEGMENT_COLUMNS = [
  'id',
  'race_id',
  'sort_order',
  'from_waypoint_id',
  'to_waypoint_id',
] as const;
const CUTOFF_COLUMNS = [
  'id',
  'race_id',
  'race_waypoint_id',
  'cutoff_datetime',
  'cutoff_type',
  'basis',
] as const;
const MICRO_COLUMNS = [
  'id',
  'race_segment_id',
  'sort_order',
  'distance_m',
  'elevation_delta_m',
  'elevation_gain_m',
  'elevation_loss_m',
  'raw_grade',
  'model_grade',
  'progress',
  'technicality',
  'preprocessing_version',
] as const;
const RACE_PLAN_COLUMNS = [
  'id',
  'participant_race_id',
  'version',
  'status',
  'engine_version',
  'initial_target_duration_seconds',
  'target_duration_seconds',
  'planned_finish_datetime',
  'input_hash',
] as const;
const PLAN_WAYPOINT_COLUMNS = [
  'race_waypoint_id',
  'sort_order',
  'planned_elapsed_seconds',
  'stop_duration_seconds',
  'stop_origin',
  'is_locked',
  'locked_elapsed_seconds',
] as const;
const PLAN_SEGMENT_COLUMNS = [
  'race_segment_id',
  'sort_order',
  'initial_duration_seconds',
  'planned_duration_seconds',
  'manual_override',
] as const;

/**
 * Lecture du référentiel de parcours.
 *
 * Tout est trié par `sortOrder` : PLAN_ENGINE §35 interdit « l'itération non
 * déterministe sur des objets non ordonnés », et le moteur reçoit donc des
 * collections déjà ordonnées plutôt que de devoir s'en méfier.
 */
export interface PlanCourseRepository {
  listWaypoints(raceId: string): Promise<readonly RaceWaypointRecord[]>;
  listSegments(raceId: string): Promise<readonly RaceSegmentRecord[]>;
  listCutoffs(raceId: string): Promise<readonly RaceCutoffRecord[]>;
  /** Micro-segments de la géométrie courante d'une course (§8.1, étape 11). */
  listMicroSegments(courseGeometryId: string): Promise<readonly CourseMicroSegmentRecord[]>;
  /** Versions de faits dont un Plan de cette course dépendra (§38.5). */
  listFactDependencies(raceId: string): Promise<readonly PlanFactDependency[]>;
  /** Géométrie courante d'une course : celle dont les micro-segments font foi. */
  findCurrentCourseGeometryId(raceId: string): Promise<string | null>;
  /**
   * Géométrie courante et sa mesure de dénivelé.
   *
   * Le D+ mesuré est lu ici parce que §9 en fait une condition d'éligibilité :
   * absent, le contrôle d'écart n'a rien à comparer. Le lire à part de
   * l'identifiant obligerait l'appelant à deux requêtes pour une seule ligne.
   */
  findCurrentCourseGeometry(
    raceId: string,
  ): Promise<{ readonly id: string; readonly elevationGainMeters: number | null } | null>;
  /** Heure de départ d'une vague — deuxième niveau de la priorité de §5.2. */
  findStartWaveDatetime(startWaveId: string): Promise<string | null>;
}

export const planCourseRepository = defineRepository<PlanCourseRepository>((context) => ({
  async listWaypoints(raceId) {
    const result = unwrap(
      await context.client
        .from('race_waypoints')
        .select(selectColumns('race_waypoints', WAYPOINT_COLUMNS))
        .eq('race_id', raceId)
        .order('sort_order', { ascending: true }),
      'race_waypoints.listWaypoints',
    );

    return result.map((row) => ({
      id: row.id,
      raceId: row.race_id,
      name: row.name,
      sortOrder: row.sort_order,
      distanceKm: row.distance_km,
      waypointType: row.waypoint_type,
      altitudeM: row.altitude_m,
    }));
  },

  async listSegments(raceId) {
    const result = unwrap(
      await context.client
        .from('race_segments')
        .select(selectColumns('race_segments', SEGMENT_COLUMNS))
        .eq('race_id', raceId)
        .order('sort_order', { ascending: true }),
      'race_segments.listSegments',
    );

    return result.map((row) => ({
      id: row.id,
      raceId: row.race_id,
      sortOrder: row.sort_order,
      fromWaypointId: row.from_waypoint_id,
      toWaypointId: row.to_waypoint_id,
    }));
  },

  async listCutoffs(raceId) {
    const result = unwrap(
      await context.client
        .from('race_cutoffs')
        .select(selectColumns('race_cutoffs', CUTOFF_COLUMNS))
        .eq('race_id', raceId)
        .order('id', { ascending: true }),
      'race_cutoffs.listCutoffs',
    );

    return result.map((row) => ({
      id: row.id,
      raceId: row.race_id,
      raceWaypointId: row.race_waypoint_id,
      cutoffDatetime: row.cutoff_datetime,
      cutoffType: row.cutoff_type,
      basis: row.basis,
    }));
  },

  async listMicroSegments(courseGeometryId) {
    const result = unwrap(
      await context.client
        .from('race_course_micro_segments')
        .select(selectColumns('race_course_micro_segments', MICRO_COLUMNS))
        .eq('course_geometry_id', courseGeometryId)
        .order('sort_order', { ascending: true }),
      'race_course_micro_segments.listMicroSegments',
    );

    return result.map((row) => ({
      id: row.id,
      raceSegmentId: row.race_segment_id,
      sortOrder: row.sort_order,
      distanceMeters: Number(row.distance_m),
      elevationDeltaMeters: Number(row.elevation_delta_m),
      elevationGainMeters: Number(row.elevation_gain_m),
      elevationLossMeters: Number(row.elevation_loss_m),
      rawGrade: Number(row.raw_grade),
      modelGrade: Number(row.model_grade),
      progress: Number(row.progress),
      technicality: row.technicality as CourseMicroSegmentRecord['technicality'],
      preprocessingVersion: row.preprocessing_version,
    }));
  },

  async findCurrentCourseGeometryId(raceId) {
    const row = unwrapMaybe(
      await context.client
        .from('races')
        .select(selectColumns('races', ['id', 'current_course_geometry_id']))
        .eq('id', raceId)
        .maybeSingle(),
      'races.findCurrentCourseGeometryId',
    );

    return row?.current_course_geometry_id ?? null;
  },

  async findCurrentCourseGeometry(raceId) {
    const race = unwrapMaybe(
      await context.client
        .from('races')
        .select(selectColumns('races', ['id', 'current_course_geometry_id']))
        .eq('id', raceId)
        .maybeSingle(),
      'races.findCurrentCourseGeometry',
    );

    const geometryId = race?.current_course_geometry_id ?? null;
    if (geometryId === null) return null;

    const geometry = unwrapMaybe(
      await context.client
        .from('race_course_geometries')
        .select(selectColumns('race_course_geometries', ['id', 'elevation_gain_m']))
        .eq('id', geometryId)
        .maybeSingle(),
      'race_course_geometries.findCurrent',
    );

    return geometry === null
      ? null
      : { id: geometry.id, elevationGainMeters: geometry.elevation_gain_m };
  },

  async findStartWaveDatetime(startWaveId) {
    const row = unwrapMaybe(
      await context.client
        .from('race_start_waves')
        .select(selectColumns('race_start_waves', ['id', 'start_datetime']))
        .eq('id', startWaveId)
        .maybeSingle(),
      'race_start_waves.findStartWaveDatetime',
    );

    return row?.start_datetime ?? null;
  },

  async listFactDependencies(raceId) {
    const data = unwrapRpc(
      await rpc(context.client).rpc('list_plan_fact_dependencies', { p_race_id: raceId }),
      'list_plan_fact_dependencies',
    );

    return rows(data).map((row) => ({
      raceFactVersionId: String(row['race_fact_version_id']),
      dependencyType: row['dependency_type'] as PlanFactDependency['dependencyType'],
      dependencyKey: row['dependency_key'] === null ? null : String(row['dependency_key']),
    }));
  },
}));

export interface RacePlanRepository {
  /** La version active d'une participation — §36, « une seule version est active ». */
  findActive(participantRaceId: string): Promise<RacePlanRecord | null>;
  listVersions(participantRaceId: string): Promise<readonly RacePlanRecord[]>;
  listWaypoints(racePlanId: string): Promise<readonly PlanWaypointRecord[]>;
  listSegments(racePlanId: string): Promise<readonly PlanSegmentRecord[]>;
  listDependencies(racePlanId: string): Promise<readonly PlanFactDependency[]>;
  /** Marges de barrière du Plan, dans l'ordre du parcours (§38.4). */
  listCutoffStatuses(racePlanId: string): Promise<readonly PlanCutoffStatusRecord[]>;
  /**
   * Confirme un Plan — §37.
   *
   * Une seule transaction : archivage de la version active, création de la
   * suivante, waypoints, segments, marges et dépendances de faits.
   */
  persist(input: PersistPlanInput): Promise<PersistedPlan>;
}

export const racePlanRepository = defineRepository<RacePlanRepository>((context) => ({
  async findActive(participantRaceId) {
    const row = unwrapMaybe(
      await context.client
        .from('race_plans')
        .select(selectColumns('race_plans', RACE_PLAN_COLUMNS))
        .eq('participant_race_id', participantRaceId)
        .eq('status', 'active')
        .maybeSingle(),
      'race_plans.findActive',
    );

    return row === null ? null : toRacePlan(row);
  },

  async listVersions(participantRaceId) {
    const result = unwrap(
      await context.client
        .from('race_plans')
        .select(selectColumns('race_plans', RACE_PLAN_COLUMNS))
        .eq('participant_race_id', participantRaceId)
        .order('version', { ascending: true }),
      'race_plans.listVersions',
    );

    return result.map(toRacePlan);
  },

  async listWaypoints(racePlanId) {
    const result = unwrap(
      await context.client
        .from('plan_waypoints')
        .select(selectColumns('plan_waypoints', PLAN_WAYPOINT_COLUMNS))
        .eq('race_plan_id', racePlanId)
        .order('sort_order', { ascending: true }),
      'plan_waypoints.listWaypoints',
    );

    return result.map((row) => ({
      raceWaypointId: row.race_waypoint_id,
      sortOrder: row.sort_order,
      plannedElapsedSeconds: row.planned_elapsed_seconds,
      stopDurationSeconds: row.stop_duration_seconds,
      stopOrigin: row.stop_origin,
      isLocked: row.is_locked,
      lockedElapsedSeconds: row.locked_elapsed_seconds,
    }));
  },

  async listSegments(racePlanId) {
    const result = unwrap(
      await context.client
        .from('plan_segments')
        .select(selectColumns('plan_segments', PLAN_SEGMENT_COLUMNS))
        .eq('race_plan_id', racePlanId)
        .order('sort_order', { ascending: true }),
      'plan_segments.listSegments',
    );

    return result.map((row) => ({
      raceSegmentId: row.race_segment_id,
      sortOrder: row.sort_order,
      initialDurationSeconds: row.initial_duration_seconds,
      plannedDurationSeconds: row.planned_duration_seconds,
      manualOverride: row.manual_override,
    }));
  },

  async listDependencies(racePlanId) {
    const result = unwrap(
      await context.client
        .from('plan_version_dependencies')
        .select(
          selectColumns('plan_version_dependencies', [
            'race_fact_version_id',
            'dependency_type',
            'dependency_key',
          ]),
        )
        .eq('race_plan_id', racePlanId)
        .order('race_fact_version_id', { ascending: true }),
      'plan_version_dependencies.listDependencies',
    );

    return result.map((row) => ({
      raceFactVersionId: row.race_fact_version_id,
      dependencyType: row.dependency_type,
      dependencyKey: row.dependency_key,
    }));
  },

  async listCutoffStatuses(racePlanId) {
    const result = unwrap(
      await context.client
        .from('plan_cutoff_statuses')
        .select(
          selectColumns('plan_cutoff_statuses', [
            'race_cutoff_id',
            'plan_waypoint_id',
            'margin_seconds',
            'status',
          ]),
        )
        .eq('race_plan_id', racePlanId)
        .order('margin_seconds', { ascending: true }),
      'plan_cutoff_statuses.listCutoffStatuses',
    );

    const waypoints = unwrap(
      await context.client
        .from('plan_waypoints')
        .select(selectColumns('plan_waypoints', ['id', 'race_waypoint_id']))
        .eq('race_plan_id', racePlanId),
      'plan_waypoints.forCutoffStatuses',
    );

    const waypointById = new Map(waypoints.map((row) => [row.id, row.race_waypoint_id]));

    return result.map((row) => ({
      raceCutoffId: row.race_cutoff_id,
      raceWaypointId: waypointById.get(row.plan_waypoint_id) ?? '',
      marginSeconds: row.margin_seconds,
      status: row.status,
    }));
  },

  async persist(input) {
    const data = unwrapRpc(
      await rpc(context.client).rpc('persist_race_plan', {
        p_participant_race_id: input.participantRaceId,
        p_actor_user_id: input.actorUserId,
        p_summary: {
          engine_version: input.summary.engineVersion,
          initial_target_duration_seconds: input.summary.initialTargetDurationSeconds,
          target_duration_seconds: input.summary.targetDurationSeconds,
          planned_finish_datetime: input.summary.plannedFinishDatetime,
          input_hash: input.summary.inputHash,
          input_snapshot: input.summary.inputSnapshot,
        },
        p_waypoints: input.waypoints.map((waypoint) => ({
          race_waypoint_id: waypoint.raceWaypointId,
          sort_order: waypoint.sortOrder,
          planned_elapsed_seconds: waypoint.plannedElapsedSeconds,
          planned_arrival_at: waypoint.plannedArrivalAt,
          stop_duration_seconds: waypoint.stopDurationSeconds,
          stop_origin: waypoint.stopOrigin,
          is_locked: waypoint.isLocked,
          locked_elapsed_seconds: waypoint.lockedElapsedSeconds,
        })),
        p_segments: input.segments.map((segment) => ({
          race_segment_id: segment.raceSegmentId,
          sort_order: segment.sortOrder,
          initial_duration_seconds: segment.initialDurationSeconds,
          planned_duration_seconds: segment.plannedDurationSeconds,
          manual_override: segment.manualOverride,
        })),
        p_cutoff_statuses: input.cutoffStatuses.map((status) => ({
          race_cutoff_id: status.raceCutoffId,
          race_waypoint_id: status.raceWaypointId,
          margin_seconds: status.marginSeconds,
          status: status.status,
        })),
        p_dependencies: input.dependencies.map((dependency) => ({
          race_fact_version_id: dependency.raceFactVersionId,
          dependency_type: dependency.dependencyType,
          dependency_key: dependency.dependencyKey,
        })),
      }),
      'persist_race_plan',
    );

    const row = rows(data)[0];
    if (row === undefined) {
      throw mapPostgrestError(
        { code: 'PGRST116', message: 'aucune version rendue' },
        'persist_race_plan',
      );
    }

    return { racePlanId: String(row['race_plan_id']), version: Number(row['version']) };
  },
}));

function toRacePlan(row: {
  id: string;
  participant_race_id: string;
  version: number;
  status: RacePlanRecord['status'];
  engine_version: string;
  initial_target_duration_seconds: number;
  target_duration_seconds: number;
  planned_finish_datetime: string | null;
  input_hash: string | null;
}): RacePlanRecord {
  return {
    id: row.id,
    participantRaceId: row.participant_race_id,
    version: row.version,
    status: row.status,
    engineVersion: row.engine_version,
    initialTargetDurationSeconds: row.initial_target_duration_seconds,
    targetDurationSeconds: row.target_duration_seconds,
    plannedFinishDatetime: row.planned_finish_datetime,
    inputHash: row.input_hash,
  };
}

/**
 * Bundle passé aux use cases Plan.
 *
 * La hiérarchie de course y figure parce que le départ effectif se résout en
 * remontant `participant_race → race` (§5.2), et la participation parce que la
 * propriété se vérifie avant toute autre question.
 */
export interface PlanRepositories {
  readonly racePlans: RacePlanRepository;
  readonly planCourse: PlanCourseRepository;
  readonly participantRaces: ParticipantRaceRepository;
  readonly races: RaceRepository;
  readonly editions: EditionRepository;
  readonly events: EventRepository;
}

export function createPlanRepositories(context: RepositoryContext): PlanRepositories {
  return {
    racePlans: racePlanRepository(context),
    planCourse: planCourseRepository(context),
    participantRaces: participantRaceRepository(context),
    races: raceRepository(context),
    editions: editionRepository(context),
    events: eventRepository(context),
  };
}
