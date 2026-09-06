/**
 * `@pluka/domain` — use cases applicatifs et invariants métier.
 *
 * Le domaine dépend des repositories (`@pluka/db`) et des contrats, jamais
 * l'inverse, et ne connaît ni Next.js ni provider externe
 * (01_ARCHITECTURE §4.5, §5).
 *
 * Périmètre : Event / Edition / Race et leur cycle de vie (00_PRODUCT_SPEC
 * §4.1), la revue et la publication de facts, et le rattachement d'un coureur
 * à une course (02_DATA_MODEL §9). Aucune UI, aucun job asynchrone, aucune IA.
 */

export {
  assertOrganizationRole,
  assertPlatformAdmin,
  hasOrganizationRole,
  ORGANIZATION_ROLE_RANK,
  resolveAuthority,
  type Actor,
  type Authority,
  type AuthorizationRepositories,
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
  loadRaceScope,
  publishRace,
  setRaceVisibility,
  updateRace,
  type CourseContext,
  type RaceOverview,
  type RaceScope,
  type RaceScopeRepositories,
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

export {
  claimParticipantRaceCommandSchema,
  createParticipantRaceCommandSchema,
  getParticipationForRaceQuerySchema,
  getParticipationQuerySchema,
  listRaceRosterQuerySchema,
  MAX_TARGET_DURATION_SECONDS,
  setParticipationStatusCommandSchema,
  setPreparationStateCommandSchema,
  setRaceGoalCommandSchema,
  type ClaimParticipantRaceCommand,
  type CreateParticipantRaceCommand,
  type GetParticipationForRaceQuery,
  type GetParticipationQuery,
  type ListRaceRosterQuery,
  type SetParticipationStatusCommand,
  type SetPreparationStateCommand,
  type SetRaceGoalCommand,
} from './participation/commands.js';
export {
  checkRaceAttachment,
  isRaceReachableByRunner,
  type AttachmentVerdict,
} from './participation/invariants.js';
export {
  PREPARATION_STATES,
  RUNNER_PARTICIPATION_STATUSES,
  type ParticipationStatus,
  type PreparationState,
  type RunnerParticipationStatus,
} from './participation/lifecycle.js';
export {
  claimParticipantRace,
  createParticipantRace,
  getParticipation,
  getParticipationForRace,
  listRaceRoster,
  setParticipationStatus,
  setPreparationState,
  setRaceGoal,
  type ParticipationContext,
  type ParticipationDetail,
} from './participation/use-cases.js';

export {
  decideFactCandidateCommandSchema,
  listCandidatesForReviewQuerySchema,
  publishFactCommandSchema,
  PUBLISHABLE_TRUST_LEVELS,
  REVIEW_DECISIONS,
  type DecideFactCandidateCommand,
  type ListCandidatesForReviewQuery,
  type PublishableTrustLevel,
  type PublishFactCommand,
  type ReviewDecision,
} from './facts/commands.js';
export {
  canReviewFacts,
  MIN_PUBLISH_ROLE,
  refusalForTrustLevel,
  resolvePublicationAuthority,
  type PublicationAuthority,
  type TrustLevelRefusal,
} from './facts/trust.js';
export {
  decideFactCandidate,
  listCandidatesForReview,
  publishFactCandidate,
  type FactReviewContext,
} from './facts/use-cases.js';
