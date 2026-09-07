/**
 * `@pluka/domain` — use cases applicatifs et invariants métier.
 *
 * Le domaine dépend des repositories (`@pluka/db`) et des contrats, jamais
 * l'inverse, et ne connaît ni Next.js ni provider externe
 * (01_ARCHITECTURE §4.5, §5).
 *
 * Périmètre : Event / Edition / Race et leur cycle de vie (00_PRODUCT_SPEC
 * §4.1), la revue et la publication de facts, le rattachement d'un coureur à
 * une course (02_DATA_MODEL §9), son Profil trailer (§4.2), son onboarding
 * (00_PRODUCT_SPEC §7), ses droits commerciaux (04_ENTITLEMENTS) et son Plan de
 * course (PLAN_ENGINE §63). Aucune UI, aucun job asynchrone, aucune IA.
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
  changeEditionStatusCommandSchema,
  changeEventStatusCommandSchema,
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
  type ChangeEditionStatusCommand,
  type ChangeEventStatusCommand,
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
  AUTHORED_WAYPOINT_TYPES,
  checkWaypointChain,
  getRaceWaypoints,
  getRaceWaypointsQuerySchema,
  setRaceWaypoints,
  setRaceWaypointsCommandSchema,
  type AuthoredWaypointType,
  type GetRaceWaypointsQuery,
  type RaceWaypointCommandEntry,
  type RaceWaypointView,
  type SetRaceWaypointsCommand,
  type WaypointChainVerdict,
} from './course/waypoints.js';

export {
  courseQuality,
  divergenceRatio,
  getRaceGpxImport,
  getRaceGpxImportQuerySchema,
  importRaceGpx,
  importRaceGpxCommandSchema,
  importStage,
  MAX_GPX_BYTES,
  type CourseQualityFinding,
  type GetRaceGpxImportQuery,
  type GpxImportContext,
  type ImportRaceGpxCommand,
  type RaceGpxImport,
  type RaceGpxImportReceipt,
  type RaceGpxImportStage,
} from './course/gpx.js';

export {
  belongsToEdition,
  belongsToEvent,
  checkEditionPublication,
  checkRacePublication,
  checkRaceSchedule,
  isEditionReadable,
  isEventReadable,
  isRacePubliclyReadable,
  isValidSlug,
  type EditionPublicationVerdict,
  type PublicationVerdict,
  type RaceSchedule,
  type ScheduleVerdict,
} from './course/invariants.js';

export {
  allowedEditionTransitions,
  allowedEventTransitions,
  allowedRaceTransitions,
  canStillBeCancelled,
  EDITION_TRANSITIONS,
  EVENT_TRANSITIONS,
  findEditionTransition,
  findEventTransition,
  findRaceTransition,
  isPubliclyReadableStatus,
  isUnarchiving,
  RACE_TRANSITIONS,
  type EditionStatus,
  type EditionTransition,
  type EventStatus,
  type EventTransition,
  type RaceStatus,
  type RaceTransition,
  type StatusTransition,
  type TransitionAuthority,
} from './course/lifecycle.js';

export {
  changeEditionStatus,
  changeEventStatus,
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
  parseCommand,
  validationError,
  type DomainErrorCode,
  type DomainErrorParams,
} from './errors.js';

export {
  CAPABILITIES,
  requiresParticipantRaceScope,
  type Capability,
} from './entitlements/capabilities.js';
export {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
  entitlementErrorCode,
  type EntitlementErrorCode,
} from './entitlements/errors.js';
export {
  can,
  LINKED_OUTING_QUOTA,
  linkedOutingUsageKey,
  QUOTA_CAPABILITY,
  resolveEntitlementContext,
  type ActiveGrant,
  type DecisionReason,
  type EntitlementContext,
  type EntitlementDecision,
  type ResolveContextInput,
  type UnavailableGrant,
  type UnavailableReason,
} from './entitlements/resolver.js';
export {
  ACCESS_TIERS,
  capabilitiesForRaceScopedBeta,
  capabilitiesForTier,
  capabilitiesMissingFromPlus,
  isBroaderTier,
  TIERS_BY_PRIORITY,
  type AccessTier,
} from './entitlements/tiers.js';
export {
  authorizeCapability,
  authorizeCapabilityCommandSchema,
  consumeLinkedOutingQuota,
  consumeLinkedOutingQuotaCommandSchema,
  resolveEntitlements,
  resolveEntitlementsQuerySchema,
  type AuthorizeCapabilityCommand,
  type ConsumeLinkedOutingQuotaCommand,
  type EntitlementServiceContext,
  type ResolveEntitlementsQuery,
} from './entitlements/use-cases.js';

export {
  computeOnboarding,
  resolveOnboardingFlow,
  type OnboardingBlocker,
  type OnboardingSnapshot,
  type OnboardingState,
  type OnboardingStepState,
  type OnboardingStepStatus,
} from './onboarding/progress.js';
export {
  ONBOARDING_FLOWS,
  ONBOARDING_STEPS,
  ORGANIZER_REGISTRATION_SOURCES,
  stepsForFlow,
  type OnboardingFlow,
  type OnboardingStep,
} from './onboarding/steps.js';
export {
  getOnboardingState,
  getOnboardingStateQuerySchema,
  type GetOnboardingStateQuery,
  type OnboardingContext,
} from './onboarding/use-cases.js';

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
  changePlanTargetCommandSchema,
  generateRacePlanCommandSchema,
  getActivePlanQuerySchema,
  listPlanVersionsQuerySchema,
  lockPlanWaypointCommandSchema,
  preserveCurrentPlanCommandSchema,
  previewPlanQuerySchema,
  rebalancePlanToTargetCommandSchema,
  removePlanSegmentOverrideCommandSchema,
  resetPlanScopeCommandSchema,
  unlockPlanWaypointCommandSchema,
  updatePlanSegmentDurationCommandSchema,
  updatePlanStopCommandSchema,
  type ChangePlanTargetCommand,
  type GenerateRacePlanCommand,
  type GetActivePlanQuery,
  type ListPlanVersionsQuery,
  type LockPlanWaypointCommand,
  type PreserveCurrentPlanCommand,
  type PreviewPlanQuery,
  type RebalancePlanToTargetCommand,
  type RemovePlanSegmentOverrideCommand,
  type ResetPlanScopeCommand,
  type UnlockPlanWaypointCommand,
  type UpdatePlanSegmentDurationCommand,
  type UpdatePlanStopCommand,
} from './plan/commands.js';
export {
  getPlanOverview,
  type PlanCutoffView,
  type PlanOverview,
  type PlanPointView,
  type PlanProfileSample,
} from './plan/overview.js';
export {
  buildSnapshot,
  loadConstraints,
  loadPlanScope,
  resolveStartAt,
  type BuildSnapshotOptions,
  type PlanConstraints,
  type PlanScope,
} from './plan/snapshot.js';
export {
  authorizePlanRead,
  changePlanTarget,
  generateRacePlan,
  getActivePlan,
  listPlanVersions,
  lockPlanWaypoint,
  preserveCurrentPlan,
  previewPlan,
  rebalancePlanToTarget,
  removePlanSegmentOverride,
  resetPlanScope,
  unlockPlanWaypoint,
  updatePlanSegmentDuration,
  updatePlanStop,
  type ActivePlanView,
  type PlanCommandResult,
  type PlanContext,
} from './plan/use-cases.js';

export {
  getTrailProfileQuerySchema,
  MAX_PROFILE_INTEGER,
  updateTrailProfileCommandSchema,
  type GetTrailProfileQuery,
  type UpdateTrailProfileCommand,
} from './profile/commands.js';
export {
  checkTrailProfile,
  hasPaceSignal,
  hasPartialRepresentativeEffort,
  hasRepresentativeEffort,
  type ProfileVerdict,
  type TrailProfileShape,
} from './profile/invariants.js';
export {
  getTrailProfile,
  updateTrailProfile,
  type ProfileContext,
  type SavedTrailProfile,
  type TrailProfileView,
} from './profile/use-cases.js';

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
