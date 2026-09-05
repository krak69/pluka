/**
 * `@pluka/domain` — use cases applicatifs et invariants métier.
 *
 * Le domaine dépend des repositories (`@pluka/db`) et des contrats, jamais
 * l'inverse, et ne connaît ni Next.js ni provider externe
 * (01_ARCHITECTURE §4.5, §5).
 *
 * Périmètre de ce lot : Event / Edition / Race, dont le cycle de vie de
 * 00_PRODUCT_SPEC §4.1. Aucune UI, aucun job asynchrone, aucune IA.
 */

export {
  assertOrganizationRole,
  assertPlatformAdmin,
  hasOrganizationRole,
  ORGANIZATION_ROLE_RANK,
  resolveAuthority,
  type Actor,
  type Authority,
  type OrganizationRole,
} from './authorization/organization-role.js';

export {
  getEditionAdministration,
  getEventAdministration,
  getRaceAdministration,
  listEventsForAdministration,
  type EditionAdministration,
  type EventAdministration,
  type RaceAdministration,
} from './course/administration.js';

export {
  changeRaceStatusCommandSchema,
  createEditionCommandSchema,
  createEventCommandSchema,
  createRaceCommandSchema,
  getEditionAdministrationQuerySchema,
  getEventAdministrationQuerySchema,
  getRaceAdministrationQuerySchema,
  getRaceOverviewQuerySchema,
  listEventsForAdministrationQuerySchema,
  listRaceStatusHistoryQuerySchema,
  publishRaceCommandSchema,
  setRaceVisibilityCommandSchema,
  updateRaceCommandSchema,
  type ChangeRaceStatusCommand,
  type CreateEditionCommand,
  type CreateEventCommand,
  type CreateRaceCommand,
  type GetEditionAdministrationQuery,
  type GetEventAdministrationQuery,
  type GetRaceAdministrationQuery,
  type GetRaceOverviewQuery,
  type ListEventsForAdministrationQuery,
  type ListRaceStatusHistoryQuery,
  type PublishRaceCommand,
  type SetRaceVisibilityCommand,
  type UpdateRaceCommand,
} from './course/commands.js';

export {
  belongsToEdition,
  belongsToEvent,
  checkRacePublication,
  checkRaceSchedule,
  isEditionReadable,
  isEventReadable,
  isRacePubliclyReadable,
  isValidSlug,
  type PublicationVerdict,
  type RaceSchedule,
  type ScheduleVerdict,
} from './course/invariants.js';

export {
  allowedRaceTransitions,
  canStillBeCancelled,
  findRaceTransition,
  isPubliclyReadableStatus,
  isUnarchiving,
  RACE_TRANSITIONS,
  type RaceStatus,
  type RaceTransition,
  type TransitionAuthority,
} from './course/lifecycle.js';

export {
  changeRaceStatus,
  createEdition,
  createEvent,
  createRace,
  getRaceOverview,
  listRaceStatusHistory,
  publishRace,
  setRaceVisibility,
  updateRace,
  type CourseContext,
  type RaceOverview,
  type RaceScope,
} from './course/use-cases.js';

export {
  conflictError,
  DOMAIN_ERROR_CODES,
  DomainError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  validationError,
  type DomainErrorCode,
  type DomainErrorParams,
} from './errors.js';
