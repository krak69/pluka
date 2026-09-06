import type {
  ParticipantRaceRecord,
  ParticipantRaceSettingsRecord,
  ParticipantRosterEntry,
  ParticipationRepositories,
} from '@pluka/db';

import { assertOrganizationRole, type Actor } from '../authorization/organization-role.js';
import { loadRaceScope, type RaceScope } from '../course/use-cases.js';
import { conflictError, invalidStateError, notFoundError } from '../errors.js';
import {
  claimParticipantRaceCommandSchema,
  createParticipantRaceCommandSchema,
  getParticipationForRaceQuerySchema,
  getParticipationQuerySchema,
  listRaceRosterQuerySchema,
  setParticipationStatusCommandSchema,
  setPreparationStateCommandSchema,
  setRaceGoalCommandSchema,
} from './commands.js';
import { checkRaceAttachment, type AttachmentVerdict } from './invariants.js';

/**
 * Use cases de participation — 02_DATA_MODEL §9, 01_ARCHITECTURE §7.
 *
 * Chaque commande valide son entrée, vérifie l'autorisation, applique les
 * invariants, puis écrit.
 *
 * Deux règles traversent tout le fichier :
 *
 * - les rôles et l'identité ne sont jamais reçus de l'appelant. `context.actor`
 *   ne porte qu'un `userId` ; l'appartenance et l'email de compte sont relus en
 *   base (03_PRIVACY_RLS §11, §178).
 * - l'organisation ne lit jamais l'objectif d'un coureur. Le seul use case
 *   B2B, `listRaceRoster`, ne touche pas `participant_race_settings` — §29 en
 *   fait une donnée strictement propriétaire, et §27 borne la lecture
 *   organisation à l'opérationnel.
 *
 * Aucune décision d'entitlement n'est prise ici non plus : se rattacher à une
 * course, choisir un objectif et déclarer son état de préparation
 * appartiennent au socle Free (00_PRODUCT_SPEC §6.1). Le jour où une
 * capacité premium s'y greffe, elle passera par le resolver dédié
 * (01_ARCHITECTURE §11), jamais par un booléen posé ici.
 */
export interface ParticipationContext {
  readonly repositories: ParticipationRepositories;
  readonly actor: Actor;
  /**
   * Horloge injectée (AGENTS §35).
   *
   * `joined_at` date un fait métier — le moment où le coureur a rejoint la
   * course. Le lire d'une horloge implicite rendrait le use case non
   * reproductible en test et non rejouable en cas de reprise.
   */
  readonly now: () => Date;
}

/**
 * Lecture minimale pour l'organisation : `viewer`.
 *
 * Aligné sur `races__select__org_member` et sur la policy
 * `participant_races__select__org_member` de la migration 0005. La RLS et le
 * use case appliquent la même règle sans se déléguer l'un à l'autre.
 */
const MIN_ROSTER_ROLE = 'viewer';

/** Une participation et ses préférences, telles que son propriétaire les voit. */
export interface ParticipationDetail {
  readonly participation: ParticipantRaceRecord;
  /**
   * Nulle tant que le coureur n'a rien réglé.
   *
   * L'absence est un état normal, pas une anomalie à réparer : les valeurs par
   * défaut vivent dans les colonnes, et SOURCES_EXTRACTION §46 s'appuie
   * dessus — une participation sans ligne de réglages reste notifiée.
   */
  readonly settings: ParticipantRaceSettingsRecord | null;
}

/**
 * Charge une participation dont l'acteur est propriétaire.
 *
 * L'échec est toujours `not_found`, jamais `forbidden` : répondre « interdit »
 * confirmerait l'existence de la participation d'un autre coureur à partir
 * d'un simple UUID (03_PRIVACY_RLS §120).
 */
async function loadOwnParticipation(
  context: ParticipationContext,
  participantRaceId: string,
  useCase: string,
): Promise<ParticipantRaceRecord> {
  const participation = await context.repositories.participantRaces.findById(participantRaceId);

  if (participation === null) throw notFoundError(useCase, 'participation');
  if (participation.userId !== context.actor.userId) {
    throw notFoundError(useCase, 'participation');
  }

  return participation;
}

async function loadDetail(
  context: ParticipationContext,
  participation: ParticipantRaceRecord,
): Promise<ParticipationDetail> {
  const settings = await context.repositories.participantRaceSettings.findByParticipantRace(
    participation.id,
  );

  return { participation, settings };
}

function attachmentRefusal(
  useCase: string,
  reason: Exclude<AttachmentVerdict, { ok: true }>['reason'],
): Error {
  if (reason === 'race_unreachable') return notFoundError(useCase, 'épreuve');

  if (reason === 'race_cancelled') {
    return invalidStateError(useCase, 'cette épreuve est annulée');
  }

  return invalidStateError(useCase, 'cette épreuve n’accepte pas de rattachement');
}

/**
 * Rattachement d'un coureur à une course — 01_ARCHITECTURE §7,
 * `createParticipantRace`.
 *
 * La commande ne porte que l'épreuve : le coureur est l'acteur de la session.
 *
 * Les snapshots de prénom / nom restent nuls. §9.1 les prévoit pour la couche
 * d'inscription d'un participant *importé*, qui peut exister « avant création
 * d'un compte » ; ici le compte existe, et recopier son nom créerait une
 * seconde copie à maintenir.
 */
export async function createParticipantRace(
  context: ParticipationContext,
  input: unknown,
): Promise<ParticipantRaceRecord> {
  const useCase = 'createParticipantRace';
  const command = createParticipantRaceCommandSchema.parse(input);

  const scope: RaceScope = await loadRaceScope(context.repositories, command.raceId, useCase);

  const verdict = checkRaceAttachment(scope.race, scope.edition, scope.event);
  if (!verdict.ok) throw attachmentRefusal(useCase, verdict.reason);

  // `ux_participant_race_user` porte déjà l'unicité ; la lire d'abord donne
  // une erreur métier plutôt qu'une violation de contrainte, et rend la
  // commande idempotente du point de vue de l'appelant.
  const existing = await context.repositories.participantRaces.findByRaceAndUser(
    command.raceId,
    context.actor.userId,
  );
  if (existing !== null) {
    throw conflictError(useCase, 'cette épreuve est déjà rattachée à ce coureur');
  }

  return context.repositories.participantRaces.insert({
    race_id: command.raceId,
    user_id: context.actor.userId,
    registration_source: 'direct',
    joined_at: context.now().toISOString(),
  });
}

/**
 * Réclamation d'une participation importée — 01_ARCHITECTURE §10.2.
 *
 * « Le rattachement doit vérifier que l'utilisateur authentifié est autorisé à
 * réclamer cette invitation. » L'autorisation vérifiée ici est la seule que le
 * modèle porte aujourd'hui : l'email d'invitation de la participation est
 * celui du compte connecté. Elle est comparée en base, dans le `where` de
 * l'écriture, ce qui la rend atomique et évite de faire circuler l'email
 * (03_PRIVACY_RLS §28).
 *
 * Le jeton d'invitation viendra avec `participant_invitations` au lot B2B ;
 * ce use case ne le remplace pas et n'en invente pas un.
 *
 * L'état de l'épreuve n'est pas consulté, et c'est délibéré — 02_DATA_MODEL
 * §9.4 : « la réclamation d'une invitation reste autorisée » sur une course
 * annulée. La participation existe déjà ; la bloquer laisserait une ligne
 * orpheline et priverait le coureur de l'accès à sa propre préparation.
 */
export async function claimParticipantRace(
  context: ParticipationContext,
  input: unknown,
): Promise<ParticipantRaceRecord> {
  const useCase = 'claimParticipantRace';
  const command = claimParticipantRaceCommandSchema.parse(input);

  const participation = await context.repositories.participantRaces.findById(
    command.participantRaceId,
  );
  if (participation === null) throw notFoundError(useCase, 'participation');

  // Réclamer deux fois n'est pas une erreur : un lien d'invitation rouvert
  // doit rendre la même participation, pas un échec.
  if (participation.userId === context.actor.userId) return participation;

  // Déjà réclamée par quelqu'un d'autre : silence, comme pour une
  // participation inexistante (§120).
  if (participation.userId !== null) throw notFoundError(useCase, 'participation');

  const email = await context.repositories.accounts.findAccountEmail(context.actor.userId);
  if (email === null) throw notFoundError(useCase, 'participation');

  const claimed = await context.repositories.participantRaces.claimForUser(
    participation.id,
    context.actor.userId,
    email,
    context.now().toISOString(),
  );

  // L'email ne correspond pas, ou la participation a été réclamée entre la
  // lecture et l'écriture. Les deux cas se répondent de la même façon.
  if (claimed === null) throw notFoundError(useCase, 'participation');

  return claimed;
}

/** Lecture d'une participation par son propriétaire, objectif compris. */
export async function getParticipation(
  context: ParticipationContext,
  input: unknown,
): Promise<ParticipationDetail> {
  const useCase = 'getParticipation';
  const query = getParticipationQuerySchema.parse(input);

  return loadDetail(context, await loadOwnParticipation(context, query.participantRaceId, useCase));
}

/**
 * Participation du coureur sur une épreuve donnée, ou son absence.
 *
 * Point d'entrée naturel depuis une page de course : l'application sait
 * l'épreuve, pas l'identifiant de participation. `null` signifie « pas
 * rattaché » — l'appelant en tire l'offre de rattachement.
 */
export async function getParticipationForRace(
  context: ParticipationContext,
  input: unknown,
): Promise<ParticipationDetail | null> {
  const query = getParticipationForRaceQuerySchema.parse(input);

  const participation = await context.repositories.participantRaces.findByRaceAndUser(
    query.raceId,
    context.actor.userId,
  );

  return participation === null ? null : loadDetail(context, participation);
}

/**
 * Objectif du coureur — 00_PRODUCT_SPEC §9.1.
 *
 * « Le coureur choisit l'objectif qu'il veut préparer, en HH:MM. L'objectif
 * reste la décision du coureur. » Rien ici ne le propose, ne l'ajuste ni ne le
 * borne selon un profil : la commande écrit la valeur reçue.
 *
 * Le statut de l'épreuve n'est pas consulté. §4.1 est explicite sur une course
 * annulée : « les données personnelles rattachées restent accessibles et
 * modifiables », et « aucune donnée personnelle n'est supprimée, dégradée ni
 * verrouillée par une annulation ».
 */
export async function setRaceGoal(
  context: ParticipationContext,
  input: unknown,
): Promise<ParticipantRaceSettingsRecord> {
  const useCase = 'setRaceGoal';
  const command = setRaceGoalCommandSchema.parse(input);

  await loadOwnParticipation(context, command.participantRaceId, useCase);

  return context.repositories.participantRaceSettings.upsertTargetDuration(
    command.participantRaceId,
    command.targetDurationSeconds,
  );
}

/**
 * Axe préparation — 02_DATA_MODEL §9.3.
 *
 * « Où en est le coureur dans sa préparation ? » Cette commande n'écrit que
 * cette colonne. Le devenir de la participation a la sienne, et rien ici ne
 * l'infère : un coureur `ready` peut finir en `dnf`, et le contraire d'un
 * `dnf` n'est pas un retour à `to_prepare`.
 *
 * Comme pour l'objectif, le statut de l'épreuve n'entre pas en ligne de
 * compte : une annulation ne verrouille aucune donnée personnelle (§4.1).
 */
export async function setPreparationState(
  context: ParticipationContext,
  input: unknown,
): Promise<ParticipantRaceRecord> {
  const useCase = 'setPreparationState';
  const command = setPreparationStateCommandSchema.parse(input);

  await loadOwnParticipation(context, command.participantRaceId, useCase);

  return context.repositories.participantRaces.updatePreparationState(
    command.participantRaceId,
    command.preparationState,
  );
}

/**
 * Axe participation — 02_DATA_MODEL §9.3.
 *
 * « Qu'est devenue sa participation ? » `finished`, `dns` et `dnf` sont des
 * faits de course, déclarés par le coureur et jamais déduits : ni de son état
 * de préparation, ni du passage de la date — §4.1 pose déjà la règle pour
 * l'épreuve elle-même, « `completed` n'est jamais déclenché par le passage de
 * la date ».
 *
 * Le retour à `active` est ouvert : §9.3 ne contraint l'ordre sur aucun des
 * deux axes, et un DNF saisi par erreur doit pouvoir être corrigé.
 */
export async function setParticipationStatus(
  context: ParticipationContext,
  input: unknown,
): Promise<ParticipantRaceRecord> {
  const useCase = 'setParticipationStatus';
  const command = setParticipationStatusCommandSchema.parse(input);

  await loadOwnParticipation(context, command.participantRaceId, useCase);

  return context.repositories.participantRaces.updateStatus(
    command.participantRaceId,
    command.status,
  );
}

/**
 * Liste d'inscrits d'une épreuve, vue par l'organisation gestionnaire —
 * 03_PRIVACY_RLS §26, §27.
 *
 * L'accès est opérationnel : inscrits, dossard, vague, activation. Le DTO
 * `ParticipantRosterEntry` s'arrête là — pas d'email (§28), pas d'objectif ni
 * d'état de préparation (§29), pas de `user_id`.
 *
 * L'organisation gestionnaire est remontée depuis l'épreuve, jamais reçue de
 * l'appelant : sans cela, un membre d'une organisation pourrait désigner la
 * course d'une autre.
 */
export async function listRaceRoster(
  context: ParticipationContext,
  input: unknown,
): Promise<readonly ParticipantRosterEntry[]> {
  const useCase = 'listRaceRoster';
  const query = listRaceRosterQuerySchema.parse(input);

  const scope = await loadRaceScope(context.repositories, query.raceId, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_ROSTER_ROLE,
    useCase,
  );

  return context.repositories.participantRaces.listRoster(query.raceId, query.limit);
}
