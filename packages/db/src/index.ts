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
  raceWaypointRepository,
  type RaceWaypointInput,
  type RaceWaypointRepository,
  type SetRaceWaypointsResult,
} from './repositories/waypoints.js';
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
  CourseQualityWarningRecord,
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
  AdminAuditEntryRecord,
  AdminFactCandidateRecord,
  AdminJobRecord,
  AdminNutritionProductRecord,
  AdminOrganizationDetailRecord,
  AdminOrganizationRecord,
  OrganizationDependencyRecord,
  AdminPlatformCountersRecord,
  AdminReportDetailRecord,
  AdminReportRecord,
  AdminSourceRecord,
  AdminUserDetailRecord,
  AdminUserEntitlement,
  AdminUserParticipationRecord,
  AdminUserRecord,
  ParticipantRaceEntry,
  PublishedFactSource,
  PublishedRaceFactRecord,
  ParticipantRosterEntry,
  PlatformIdentityRecord,
  PublishedFactRecord,
  RaceGpxImportRecord,
  RaceRecord,
  RaceStatusTransitionRecord,
  TrailProfileRecord,
} from './repositories/records.js';
export {
  adminConsoleRepository,
  createAdminConsoleRepositories,
  type AdminConsoleRepositories,
  type AdminConsoleRepository,
} from './repositories/admin-console.js';
export {
  adminActionsRepository,
  createAdminActionsRepositories,
  type AdminActionsRepositories,
  type AdminActionsRepository,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from './repositories/admin-actions.js';
export {
  createNutritionCatalogueRepositories,
  nutritionCatalogueRepository,
  type NutritionCatalogueQuery,
  type NutritionCatalogueRepositories,
  type NutritionCatalogueRepository,
  type NutritionCatalogueRow,
  type NutritionCategory,
  type NutritionProductDetail,
  type NutritionProductInput,
  type NutritionStatus,
  type NutritionTexture,
} from './repositories/nutrition-catalogue.js';
export {
  createEventDiscoveryRepositories,
  editionDocumentStoragePath,
  eventDiscoveryRepository,
  type CreateEventInput,
  type EditionDocument,
  type EditionDocumentInput,
  type EditionDocumentState,
  type EditionDocumentsRecord,
  type EditionFileInput,
  type EventDiscoveryRecord,
  type EventDiscoveryRepositories,
  type EventDiscoveryRepository,
  type EventDiscoveryStatus,
} from './repositories/event-discovery.js';
export {
  createStaffTeamRepositories,
  staffTeamRepository,
  type StaffInvitationPreviewRecord,
  type StaffInvitationPreviewState,
  type StaffInvitationRecord,
  type StaffMemberRecord,
  type StaffRole,
  type StaffTeamRepositories,
  type StaffTeamRepository,
} from './repositories/staff-team.js';
export {
  createOrganizationTeamRepositories,
  organizationTeamRepository,
  type InvitationPreviewRecord,
  type InvitationPreviewState,
  type InviteMemberInput,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationRole,
  type OrganizationTeamRepositories,
  type OrganizationTeamRepository,
  type OwnMembershipRecord,
} from './repositories/organization-team.js';
export {
  eventSiteRepository,
  type EventSiteRepository,
  type SubmitEventSiteContactInput,
} from './repositories/event-site.js';
export {
  EVENT_SITE_ASSETS_BUCKET,
  eventSiteAssetStore,
  eventSiteEditingRepository,
  type EventSiteAssetStore,
  type EventSiteDocumentRecord,
  type EventSiteEditingRepository,
  type EventSiteEditionRecord,
  type EventSiteEventRecord,
  type EventSiteRaceRecord,
  type EventSiteRecord,
  type EventSiteFigureRecord,
  type EventSiteGalleryPhotoRecord,
  type EventSiteVideo,
  type EventSiteProgramItemInput,
  type EventSiteProgramItemRecord,
  type EventSiteLinks,
  type EventSiteSectionRecord,
  type SaveEventSiteInput,
} from './repositories/event-site-editing.js';
export {
  createRaceInformationRepositories,
  publishedFactRepository,
  type PublishedFactRepository,
  type RaceInformationRepositories,
} from './repositories/race-information.js';
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
export {
  createFactEditingRepositories,
  factEditingRepository,
  type EditableFactRecord,
  type FactEditingRepositories,
  type FactEditingRepository,
  type FactHistoryAction,
  type FactHistoryEntry,
  type AddEquipmentInput,
  type EquipmentRequirement,
  type ReviseEquipmentInput,
  type EditionEquipmentLine,
  type SaveEditionEquipmentInput,
  type ReviseFactInput,
} from './repositories/fact-editing.js';
export {
  participantImportRepository,
  type EditionParticipantRecord,
  type PartnerSaleStatus,
  type RegistrationDayRecord,
  type EditionParticipants,
  type ParticipantImportRepository,
  type ParticipantImportResult,
  type ParticipantImportView,
  type ParticipantWaveOption,
  type StartWaveRecord,
} from './repositories/participant-import.js';
export {
  referralCodeRepository,
  type EditionReferralCodeRecord,
  type ReferralCodeRepository,
  type ReferralRaceRecord,
  type ResolvedReferralCodeRecord,
} from './repositories/referral-codes.js';
export {
  createParticipantInvitationRepositories,
  participantInvitationRepository,
  type ParticipantInvitationPreviewRecord,
  type ParticipantInvitationPreviewState,
  type ParticipantInvitationRecord,
  type RaceAdoptionRecord,
  type ParticipantInvitationRepositories,
  type ParticipantInvitationRepository,
  type ParticipantInvitationStatus,
} from './repositories/participant-invitations.js';
export {
  createRepereRepositories,
  repereEstimateRepository,
  type RepereEstimateInput,
  type RepereEstimateRepository,
  type RepereOutcome,
  type RepereRepositories,
} from './repositories/repere.js';
export {
  createRepereCalibrationRepositories,
  repereCalibrationRepository,
  type RepereCalibrationPairInput,
  type RepereCalibrationPairRecord,
  type RepereCalibrationRepositories,
  type RepereCalibrationRepository,
  type RepereCalibrationSampleRecord,
} from './repositories/repere-calibration.js';
export {
  accountClosureRepository,
  createAccountClosureRepositories,
  type AccountClosureRepositories,
  type AccountClosureRepository,
  type AccountDeletionBlocker,
  type AccountDeletionOutcome,
} from './repositories/account-closure.js';
export {
  createStartChangeRepositories,
  startChangeRepository,
  type StartChangeRecord,
  type StartChangeRepositories,
  type StartChangeRepository,
} from './repositories/start-changes.js';
export {
  betaAccessRepository,
  createBetaAccessRepositories,
  type BetaAccessGrantOutcome,
  type BetaAccessRecord,
  type BetaAccessRepositories,
  type BetaAccessRepository,
  type BetaAccessStatus,
} from './repositories/beta-access.js';
