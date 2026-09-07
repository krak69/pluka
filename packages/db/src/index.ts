/**
 * `@pluka/db` — accès aux données PLUKA.
 *
 * Ce point d'entrée est neutre : types générés, erreurs, helpers de lecture et
 * structure des repositories. Il ne construit aucun client, et n'est donc ni
 * serveur ni navigateur. La création d'un client passe par `@pluka/db/server`
 * ou `@pluka/db/browser`.
 *
 * Ce paquet ne porte aucun comportement produit : il ne décide ni d'un
 * entitlement, ni d'un quota, ni d'une règle de publication
 * (01_ARCHITECTURE §4.5, §5 règle 5).
 */

export { selectColumns, type JoinColumns } from './columns.js';
export {
  DB_ERROR_CODES,
  DbError,
  mapPostgrestError,
  type DbErrorCode,
  type DbErrorParams,
  type PostgrestLikeError,
} from './errors.js';
export { classifySupabaseKey, type SupabaseKeyKind } from './keys.js';
export {
  createCourseRepositories,
  editionRepository,
  editionStatusTransitionRepository,
  eventRepository,
  eventStatusTransitionRepository,
  identityRepository,
  raceRepository,
  raceStatusTransitionRepository,
  type CourseRepositories,
  type EditionRepository,
  type EditionStatusTransitionRepository,
  type EventRepository,
  type EventStatusTransitionRepository,
  type IdentityRepository,
  type RaceRepository,
  type RaceStatusTransitionRepository,
} from './repositories/course.js';
export {
  createGpxRepositories,
  RACE_SOURCES_BUCKET,
  raceGpxRepository,
  raceGpxStoragePath,
  type EnqueueRaceGpxInput,
  type GpxRepositories,
  type RaceGpxRepository,
  type UploadRaceGpxInput,
} from './repositories/gpx.js';
export {
  createFactRepositories,
  factReviewRepository,
  type FactRepositories,
  type FactReviewRepository,
  type PublishFactInput,
} from './repositories/facts.js';
export {
  createEntitlementRepositories,
  entitlementRepository,
  type EntitlementRepositories,
  type EntitlementRepository,
  type RecordUsageInput,
} from './repositories/entitlements.js';
export {
  accountRepository,
  createParticipationRepositories,
  participantRaceRepository,
  participantRaceSettingsRepository,
  type AccountRepository,
  type ParticipantRaceRepository,
  type ParticipantRaceSettingsRepository,
  type ParticipationRepositories,
} from './repositories/participation.js';
export {
  createPlanRepositories,
  planCourseRepository,
  racePlanRepository,
  type CourseMicroSegmentRecord,
  type PersistedPlan,
  type PersistPlanInput,
  type PlanCourseRepository,
  type PlanCutoffStatusRecord,
  type PlanFactDependency,
  type PlanRepositories,
  type PlanSegmentRecord,
  type PlanWaypointRecord,
  type RaceCutoffRecord,
  type RacePlanRecord,
  type RacePlanRepository,
  type RaceSegmentRecord,
  type RaceWaypointRecord,
} from './repositories/plan.js';
export {
  createProfileRepositories,
  trailProfileRepository,
  type ProfileRepositories,
  type TrailProfileRepository,
} from './repositories/profile.js';
export type {
  BetaAccessGrantRecord,
  EditionRecord,
  EditionStatusTransitionRecord,
  EventRecord,
  EventStatusTransitionRecord,
  FactCandidateReviewRecord,
  FactCandidateScopeRecord,
  FactCandidateStatus,
  FactPublicationActRecord,
  EntitlementRecord,
  FactReviewAction,
  MembershipRecord,
  ParticipantRaceRecord,
  ParticipantRaceSettingsRecord,
  ParticipantRosterEntry,
  PlatformIdentityRecord,
  PublishedFactRecord,
  RaceGpxImportRecord,
  RaceRecord,
  RaceStatusTransitionRecord,
  TrailProfileRecord,
} from './repositories/records.js';
export { defineRepository, type RepositoryContext, type RepositoryFactory } from './repository.js';
export {
  unwrap,
  unwrapMaybe,
  type PostgrestLikeFailure,
  type PostgrestLikeResult,
  type PostgrestLikeSuccess,
  type SuccessData,
} from './results.js';
export type {
  ColumnName,
  Database,
  Enum,
  EnumName,
  InsertRow,
  Json,
  PlukaClient,
  PublicSchema,
  Row,
  TableName,
  Tables,
  UpdateRow,
} from './types.js';
export { assertSupabaseUrl } from './url.js';
