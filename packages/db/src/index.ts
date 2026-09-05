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
  eventRepository,
  identityRepository,
  raceRepository,
  raceStatusTransitionRepository,
  type CourseRepositories,
  type EditionRepository,
  type EventRepository,
  type IdentityRepository,
  type RaceRepository,
  type RaceStatusTransitionRepository,
} from './repositories/course.js';
export type {
  EditionRecord,
  EventRecord,
  MembershipRecord,
  PlatformIdentityRecord,
  RaceRecord,
  RaceStatusTransitionRecord,
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
