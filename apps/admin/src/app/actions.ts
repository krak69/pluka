'use server';

import {
  changeRaceStatus,
  createEdition,
  createEvent,
  createRace,
  decideFactCandidate,
  publishFactCandidate,
  updateRace,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { actionFailure, courseContext, factReviewContext } from '@/lib/admin';
import { publicEnv } from '@/lib/env';
import { createEventCommand, optionalNumber, text } from '@/lib/form';
import { safeReturnTo } from '@/lib/return-to';
import { requireSession } from '@/lib/session';
import { createAuthClient } from '@/lib/supabase/auth';

/**
 * Mutations de l'administration.
 *
 * Toutes passent par un use case de `@pluka/domain`. Aucune ne construit de
 * requête : cette application ne connaît ni table, ni colonne, ni statut
 * autorisé — elle transmet une intention et un acteur.
 *
 * Conséquence directe : les autorisations de §4.1 ne sont pas réimplémentées
 * ici. `changeRaceStatus` sait seul qu'une annulation demande le rang `admin`
 * et qu'un `completed` est réservé à `pluka_admin`. Un écran qui se
 * tromperait de bouton obtiendrait un refus, pas un contournement.
 */

/**
 * Réponse d'une Server Action de formulaire.
 *
 * `fieldErrors` est indexé par le `name` de l'`Input` — c'est-à-dire par le
 * champ de la commande, puisque les deux portent le même nom. Un refus de
 * validation se lit donc contre le champ fautif, et non en une phrase unique
 * au bas de l'écran (06_DESIGN_SYSTEM §35).
 */
export interface ActionState {
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export async function createEventAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = courseContext(await requireSession('/'));

  try {
    await createEvent(context, createEventCommand(form));
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/');
  redirect('/');
}

export async function createEditionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = courseContext(await requireSession('/'));
  const eventId = text(form, 'eventId');

  try {
    await createEdition(context, {
      eventId,
      year: optionalNumber(form, 'year'),
      slug: text(form, 'slug'),
      startDate: text(form, 'startDate'),
      endDate: text(form, 'endDate') ?? null,
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(`/evenements/${eventId}`);
  redirect(`/evenements/${eventId}`);
}

export async function createRaceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = courseContext(await requireSession('/'));
  const eventId = text(form, 'eventId');

  try {
    await createRace(context, {
      editionId: text(form, 'editionId'),
      name: text(form, 'name'),
      slug: text(form, 'slug'),
      distanceKm: optionalNumber(form, 'distanceKm'),
      elevationGainM: optionalNumber(form, 'elevationGainM') ?? null,
      elevationLossM: optionalNumber(form, 'elevationLossM') ?? null,
      startDatetime: text(form, 'startDatetime'),
      cutoffDatetime: text(form, 'cutoffDatetime') ?? null,
      timezone: text(form, 'timezone'),
      startLocationName: text(form, 'startLocationName') ?? null,
      finishLocationName: text(form, 'finishLocationName') ?? null,
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(`/evenements/${eventId}`);
  redirect(`/evenements/${eventId}`);
}

export async function updateRaceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = courseContext(await requireSession('/'));
  const raceId = text(form, 'raceId');

  try {
    await updateRace(context, {
      raceId,
      name: text(form, 'name'),
      distanceKm: optionalNumber(form, 'distanceKm'),
      elevationGainM: optionalNumber(form, 'elevationGainM'),
      elevationLossM: optionalNumber(form, 'elevationLossM'),
      startDatetime: text(form, 'startDatetime'),
      cutoffDatetime: text(form, 'cutoffDatetime') ?? null,
      timezone: text(form, 'timezone'),
      startLocationName: text(form, 'startLocationName') ?? null,
      finishLocationName: text(form, 'finishLocationName') ?? null,
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(`/courses/${raceId}`);
  return {};
}

/**
 * Transition de statut — §4.1.
 *
 * L'action ne vérifie rien elle-même : elle nomme la cible et laisse
 * `changeRaceStatus` refuser une transition illégale (`invalid_state`) ou une
 * autorité insuffisante (`forbidden`).
 */
export async function changeRaceStatusAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = courseContext(await requireSession('/'));
  const raceId = text(form, 'raceId');

  try {
    await changeRaceStatus(context, { raceId, status: text(form, 'status') });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(`/courses/${raceId}`);
  return {};
}

export async function signOutAction(): Promise<void> {
  const auth = await createAuthClient();
  await auth.auth.signOut();

  redirect('/connexion?etat=deconnecte');
}

/** Demande de lien de connexion. Même formulation que l'adresse existe ou non. */
export async function requestSignInLinkAction(form: FormData): Promise<void> {
  const email = text(form, 'email');
  if (email === undefined) redirect('/connexion?etat=email-invalide');

  const returnTo = safeReturnTo(text(form, 'returnTo'));
  const auth = await createAuthClient();

  const { error } = await auth.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_ADMIN_URL}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
    },
  });

  if (error !== null) {
    console.error('auth.signInWithOtp a échoué', { code: error.code, status: error.status });
    redirect('/connexion?etat=envoi-impossible');
  }

  redirect(`/connexion?etat=lien-envoye&returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * Décisions de revue — SOURCES_EXTRACTION §31.
 *
 * Les trois actions passent par un use case de publication. Aucune ne teste
 * un rôle : §32 — « seule une organisation autorisée peut conférer le niveau
 * Officielle » — est appliqué par `publishFactCandidate` et réappliqué par la
 * base. Un écran qui proposerait le mauvais bouton obtient un refus lisible,
 * jamais un contournement.
 *
 * Le niveau de confiance vient du formulaire parce que c'est une décision du
 * réviseur, pas une déduction de l'écran. Ce qu'il a le droit de conférer,
 * c'est le domaine qui le sait.
 */
function trustLevel(form: FormData): 'official' | 'pluka_validated' | undefined {
  const value = text(form, 'trustLevel');

  // Le champ n'est pas validé ici : `publishFactCandidate` a un schéma strict,
  // et lui laisser refuser évite une seconde liste de valeurs autorisées qui
  // divergerait de la première.
  return value as 'official' | 'pluka_validated' | undefined;
}

export async function publishCandidateAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = factReviewContext(await requireSession('/'));
  const raceId = text(form, 'raceId') ?? '';

  try {
    await publishFactCandidate(context, {
      candidateId: text(form, 'candidateId') ?? '',
      trustLevel: trustLevel(form),
      // Corriger avant de publier reste une correction : §31 la fait auditer,
      // et c'est la base qui en tire `edit_and_publish`.
      valueText: text(form, 'valueText') ?? null,
      note: text(form, 'note') ?? null,
      // §38 : publier par-dessus une valeur contradictoire demande de le dire.
      // La case est décochée par défaut ; sans elle, le domaine refuse.
      resolveConflict: form.get('resolveConflict') === 'on',
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(`/courses/${raceId}/revue`);
  return {};
}

export async function decideCandidateAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = factReviewContext(await requireSession('/'));
  const raceId = text(form, 'raceId') ?? '';

  try {
    await decideFactCandidate(context, {
      candidateId: text(form, 'candidateId') ?? '',
      decision: text(form, 'decision'),
      note: text(form, 'note') ?? null,
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(`/courses/${raceId}/revue`);
  return {};
}
