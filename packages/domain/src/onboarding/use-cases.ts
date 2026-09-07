import { z } from 'zod';
import type { ParticipationRepositories, ProfileRepositories } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { loadRaceScope } from '../course/use-cases.js';
import { notFoundError, parseCommand } from '../errors.js';
import { checkRaceAttachment } from '../participation/invariants.js';
import { computeOnboarding, type OnboardingSnapshot, type OnboardingState } from './progress.js';

/**
 * Use case d'onboarding — 00_PRODUCT_SPEC §7.
 *
 * Il n'y en a qu'un, et il ne fait que lire. Les étapes du parcours sont
 * écrites par les commandes qui existent déjà — `updateTrailProfile`,
 * `createParticipantRace`, `claimParticipantRace`, `setRaceGoal`. Les envelopper
 * dans des commandes « d'onboarding » créerait des doublons dont la seule
 * différence serait le nom, et donnerait deux façons d'écrire la même donnée.
 *
 * L'onboarding est donc une lecture de ce que le coureur a déjà fait, pas une
 * machine à états parallèle. C'est ce qui rend la reprise gratuite : il n'y a
 * aucun curseur à sauvegarder, donc aucun curseur à perdre.
 */
export interface OnboardingContext {
  readonly repositories: ParticipationRepositories & ProfileRepositories;
  readonly actor: Actor;
}

/**
 * L'onboarding se lit toujours sur une course.
 *
 * §7 fait partir les trois parcours d'une course — choisie, reprise ou reçue
 * par invitation. Un « avancement » hors course n'aurait pas de sens : ni le
 * rattachement ni l'objectif n'existent sans elle.
 */
export const getOnboardingStateQuerySchema = z.object({ raceId: z.uuid() }).strict();
export type GetOnboardingStateQuery = z.infer<typeof getOnboardingStateQuerySchema>;

/**
 * Avancement du coureur de la session sur une course.
 *
 * Aucun `userId` n'est accepté : l'onboarding lu est celui de l'acteur
 * (03_PRIVACY_RLS §11). Le profil trailer traversé ici reste strictement
 * personnel — il est lu par son propriétaire, et rien de ce qui est rendu ne
 * sort du périmètre du coureur (§13).
 *
 * Une épreuve que le coureur ne peut pas atteindre répond « introuvable »
 * plutôt qu'« interdit », comme partout ailleurs : le contraire confirmerait
 * son existence à partir d'un simple UUID (§120). Une participation existante
 * l'emporte sur ce test — §4.1 protège l'accès du coureur à sa préparation quel
 * que soit le devenir de la course.
 */
export async function getOnboardingState(
  context: OnboardingContext,
  input: unknown,
): Promise<OnboardingState> {
  const useCase = 'getOnboardingState';
  const query = parseCommand(getOnboardingStateQuerySchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, query.raceId, useCase);

  const participation = await context.repositories.participantRaces.findByRaceAndUser(
    query.raceId,
    context.actor.userId,
  );

  const attachment = checkRaceAttachment(scope.race, scope.edition, scope.event);
  if (participation === null && !attachment.ok && attachment.reason === 'race_unreachable') {
    throw notFoundError(useCase, 'épreuve');
  }

  const [profile, settings] = await Promise.all([
    context.repositories.trailProfiles.findByUser(context.actor.userId),
    participation === null
      ? Promise.resolve(null)
      : context.repositories.participantRaceSettings.findByParticipantRace(participation.id),
  ]);

  const snapshot: OnboardingSnapshot = {
    profile,
    participation,
    targetDurationSeconds: settings?.targetDurationSeconds ?? null,
    attachment,
  };

  return computeOnboarding(snapshot);
}
