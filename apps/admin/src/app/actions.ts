'use server';

import {
  changeRaceStatus,
  createEdition,
  createEvent,
  createRace,
  updateRace,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { courseContext, domainErrorMessage } from '@/lib/admin';
import { publicEnv } from '@/lib/env';
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

/** Champs texte d'un formulaire : `FormData` rend `File | string | null`. */
function text(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalNumber(form: FormData, field: string): number | null | undefined {
  const value = text(form, field);
  if (value === undefined) return undefined;

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export interface ActionState {
  readonly error?: string;
}

export async function createEventAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = courseContext(await requireSession('/'));

  try {
    const organizationId = text(form, 'organizationId');

    await createEvent(context, {
      // Champ vide : événement maintenu par PLUKA, sans organisation
      // gestionnaire (§4.1, 02_DATA_MODEL §3.1).
      organizationId: organizationId ?? null,
      name: text(form, 'name'),
      slug: text(form, 'slug'),
    });
  } catch (error) {
    return { error: domainErrorMessage(error) };
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
    return { error: domainErrorMessage(error) };
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
    return { error: domainErrorMessage(error) };
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
    return { error: domainErrorMessage(error) };
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
    return { error: domainErrorMessage(error) };
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
