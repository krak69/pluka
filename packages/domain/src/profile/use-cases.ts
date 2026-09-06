import type { ProfileRepositories, TrailProfileRecord } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { validationError } from '../errors.js';
import { getTrailProfileQuerySchema, updateTrailProfileCommandSchema } from './commands.js';
import { checkTrailProfile, hasPaceSignal, type ProfileVerdict } from './invariants.js';

/**
 * Use cases du Profil trailer — 00_PRODUCT_SPEC §8, 02_DATA_MODEL §4.2.
 *
 * Le profil est la donnée la plus simple du lot, et sa règle d'accès tient en
 * une phrase : il n'appartient qu'à son propriétaire. 03_PRIVACY_RLS §13 ne
 * laisse aucune marge — « ORGANIZATION : aucun » — et le confirme même pour
 * l'avenir : « le profil trailer ne doit pas être exposé à l'organisation,
 * même si Race Intelligence utilise éventuellement un autre signal ».
 *
 * Cette règle n'est pas appliquée par une vérification, mais par une absence :
 * aucune commande ne nomme un utilisateur. Le profil lu et le profil écrit
 * sont toujours ceux de `context.actor`. Il n'y a donc rien à autoriser, et
 * surtout rien à oublier d'autoriser — le seul rôle relu en base serait un
 * rôle sans emploi ici.
 *
 * Aucune décision d'entitlement non plus : le Profil trailer est un gate Core
 * (ACCEPTANCE_CRITERIA §5, « Obligatoire »), pas une capacité premium.
 */
export interface ProfileContext {
  readonly repositories: ProfileRepositories;
  readonly actor: Actor;
  /**
   * Horloge injectée (AGENTS §35).
   *
   * Deux usages, tous deux métier : dater la complétion du profil, et refuser
   * un effort représentatif situé dans le futur.
   */
  readonly now: () => Date;
}

/**
 * Le profil de la session, avec ce dont l'onboarding a besoin pour décider.
 *
 * §7.2 : « Si le profil existe déjà : Course → confirmer / ajuster profil →
 * Objectif → Plan. Éviter de reposer systématiquement toutes les questions. »
 * D'où deux informations distinctes — le profil existe-t-il, et porte-t-il
 * assez pour passer à la suite.
 */
export interface TrailProfileView {
  /** `null` pour un compte qui n'a encore rien renseigné. */
  readonly profile: TrailProfileRecord | null;
  /**
   * Complétude recalculée sur l'état courant, et non lue dans
   * `profileCompletedAt`.
   *
   * Les deux ne disent pas la même chose : l'horodatage date le moment où le
   * profil a été complet pour la première fois — un fait passé, qui reste vrai
   * — tandis que `complete` décrit l'état d'aujourd'hui. C'est celui-ci qui
   * détermine s'il faut reposer une question.
   */
  readonly complete: boolean;
}

/**
 * Résultat d'une écriture.
 *
 * Le profil n'y est jamais nul : la commande vient de l'écrire. Un type
 * distinct plutôt qu'un `TrailProfileView` obligerait chaque appelant à
 * retester une absence qui ne peut pas se produire.
 */
export interface SavedTrailProfile {
  readonly profile: TrailProfileRecord;
  readonly complete: boolean;
}

/** Profil vide, base de fusion pour un compte sans ligne en base. */
const EMPTY_PROFILE = {
  representativeEffortLabel: null,
  representativeEffortDate: null,
  representativeDistanceKm: null,
  representativeElevationGainM: null,
  representativeDurationSeconds: null,
  fallbackTrailPaceSecondsPerKm: null,
  weeklyDistanceKm: null,
  weeklyElevationGainM: null,
  climbComfort: null,
  descentComfort: null,
  longDistanceExperience: null,
} as const;

type ProfileFields = { -readonly [K in keyof typeof EMPTY_PROFILE]: TrailProfileRecord[K] };

/**
 * Applique un champ de patch.
 *
 * `undefined` conserve la valeur existante, `null` l'efface. La distinction
 * n'est pas cosmétique : sans elle, « je n'ai pas répondu à cette question »
 * et « je retire ma réponse » seraient le même geste, et confirmer un profil
 * écran par écran effacerait ce qui n'est pas à l'écran.
 */
function patched<T>(incoming: T | null | undefined, current: T | null): T | null {
  return incoming === undefined ? current : incoming;
}

function refusal(useCase: string, reason: Exclude<ProfileVerdict, { ok: true }>['reason']): Error {
  if (reason === 'partial_effort') {
    return validationError(
      useCase,
      'un effort représentatif demande distance, D+ et durée — sinon, renseigner l’allure de repli',
      { raison: reason },
    );
  }

  return validationError(useCase, 'un effort représentatif ne peut pas être daté dans le futur', {
    raison: reason,
  });
}

export async function getTrailProfile(
  context: ProfileContext,
  input: unknown = {},
): Promise<TrailProfileView> {
  getTrailProfileQuerySchema.parse(input);

  const profile = await context.repositories.trailProfiles.findByUser(context.actor.userId);

  return { profile, complete: profile !== null && hasPaceSignal(profile) };
}

/**
 * Mise à jour du Profil trailer — `updateTrailProfile` de 01_ARCHITECTURE §7.
 *
 * Crée le profil si le compte n'en a pas : §8 le fait remplir dans le flow
 * d'onboarding, et distinguer « créer » de « modifier » n'apporterait qu'un
 * aller-retour à l'appelant, qui devrait d'abord demander lequel des deux il
 * est en train de faire.
 *
 * Les invariants portent sur l'état résultant, pas sur le patch — même
 * principe que `updateRace` : ne corriger que la durée d'un effort doit rester
 * cohérent avec la distance déjà en base.
 *
 * Un profil incomplet est accepté. §7.2 suppose qu'on puisse le reprendre plus
 * tard, ce qui suppose de pouvoir l'enregistrer avant la fin ; et §8 vise deux
 * écrans, pas un formulaire tout ou rien. Le use case dit donc si le profil est
 * complet, il ne l'exige pas.
 */
export async function updateTrailProfile(
  context: ProfileContext,
  input: unknown,
): Promise<SavedTrailProfile> {
  const useCase = 'updateTrailProfile';
  const command = updateTrailProfileCommandSchema.parse(input);

  const existing = await context.repositories.trailProfiles.findByUser(context.actor.userId);
  const current: ProfileFields = existing ?? { ...EMPTY_PROFILE };

  const merged: ProfileFields = {
    representativeEffortLabel: patched(
      command.representativeEffortLabel,
      current.representativeEffortLabel,
    ),
    representativeEffortDate: patched(
      command.representativeEffortDate,
      current.representativeEffortDate,
    ),
    representativeDistanceKm: patched(
      command.representativeDistanceKm,
      current.representativeDistanceKm,
    ),
    representativeElevationGainM: patched(
      command.representativeElevationGainM,
      current.representativeElevationGainM,
    ),
    representativeDurationSeconds: patched(
      command.representativeDurationSeconds,
      current.representativeDurationSeconds,
    ),
    fallbackTrailPaceSecondsPerKm: patched(
      command.fallbackTrailPaceSecondsPerKm,
      current.fallbackTrailPaceSecondsPerKm,
    ),
    weeklyDistanceKm: patched(command.weeklyDistanceKm, current.weeklyDistanceKm),
    weeklyElevationGainM: patched(command.weeklyElevationGainM, current.weeklyElevationGainM),
    climbComfort: patched(command.climbComfort, current.climbComfort),
    descentComfort: patched(command.descentComfort, current.descentComfort),
    longDistanceExperience: patched(command.longDistanceExperience, current.longDistanceExperience),
  };

  const verdict = checkTrailProfile(merged, context.now());
  if (!verdict.ok) throw refusal(useCase, verdict.reason);

  const complete = hasPaceSignal(merged);

  const profile = await context.repositories.trailProfiles.upsert(context.actor.userId, {
    representative_effort_label: merged.representativeEffortLabel,
    representative_effort_date: merged.representativeEffortDate,
    representative_distance_km: merged.representativeDistanceKm,
    representative_elevation_gain_m: merged.representativeElevationGainM,
    representative_duration_seconds: merged.representativeDurationSeconds,
    fallback_trail_pace_seconds_per_km: merged.fallbackTrailPaceSecondsPerKm,
    weekly_distance_km: merged.weeklyDistanceKm,
    weekly_elevation_gain_m: merged.weeklyElevationGainM,
    climb_comfort: merged.climbComfort,
    descent_comfort: merged.descentComfort,
    long_distance_experience: merged.longDistanceExperience,
    // L'horodatage date la première complétion et ne bouge plus. Le remettre à
    // jour à chaque édition en ferait un doublon d'`updated_at` ; l'effacer
    // quand un profil redevient incomplet effacerait un fait qui a eu lieu.
    profile_completed_at:
      existing?.profileCompletedAt ?? (complete ? context.now().toISOString() : null),
  });

  return { profile, complete };
}
