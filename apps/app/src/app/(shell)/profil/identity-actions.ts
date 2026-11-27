'use server';

import { DomainError, removeMyAvatar, updateMyIdentity, uploadMyAvatar } from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import { identityContext } from '@/lib/identity';
import { underRateLimit } from '@/lib/rate-limit';
import { requireSession } from '@/lib/session';

/**
 * Identité et photo de profil — 0115, 03_PRIVACY_RLS §54.1.
 *
 * Le domaine valide et ordonne les gestes ; la base vérifie que la ligne et la
 * photo sont celles du compte. Une photo publiée revalide aussi la
 * Communauté, où elle remplace l'illustration.
 */

export interface IdentityFormState {
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /** La saisie refusée, rendue au formulaire (React 19 le vide après chaque action). */
  readonly values?: Readonly<Record<string, string>>;
  readonly saved?: boolean;
}

const PATH = '/profil';
const HOUR = 60 * 60 * 1000;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function failure(error: unknown, action: string, fallback: string): IdentityFormState {
  if (error instanceof DomainError && error.code === 'validation') {
    return Object.keys(error.details).length > 0
      ? { error: 'Vérifie les champs signalés.', fieldErrors: error.details }
      : { error: fallback };
  }
  console.error(`profil : ${action} refusé`, {
    code: error instanceof DomainError ? error.code : 'inconnu',
  });
  return { error: fallback };
}

function refresh(): void {
  revalidatePath(PATH);
  revalidatePath('/communaute', 'layout');
}

export async function updateIdentityAction(
  _previous: IdentityFormState,
  form: FormData,
): Promise<IdentityFormState> {
  const session = await requireSession(PATH);
  const values = {
    firstName: text(form, 'firstName'),
    lastName: text(form, 'lastName'),
    sex: text(form, 'sex'),
    avatarIllustration: text(form, 'avatarIllustration'),
  };

  try {
    await updateMyIdentity(identityContext(session), values);
  } catch (error) {
    return {
      ...failure(error, 'identité', 'Ton identité n’a pas pu être enregistrée. Réessaie.'),
      values,
    };
  }

  refresh();
  return { saved: true };
}

export async function uploadAvatarAction(
  _previous: IdentityFormState,
  form: FormData,
): Promise<IdentityFormState> {
  const session = await requireSession(PATH);
  // Chaque photo est décodée et réencodée : on en freine la rafale.
  if (!underRateLimit(`avatar:${session.userId}`, 20, HOUR)) {
    return { error: 'Trop de photos en peu de temps. Réessaie dans quelques minutes.' };
  }

  const file = form.get('photo');
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();

  try {
    await uploadMyAvatar(identityContext(session), { bytes });
  } catch (error) {
    const state = failure(error, 'photo', 'La photo n’a pas pu être enregistrée. Réessaie.');
    return {
      error: state.fieldErrors?.photo ?? state.error ?? 'La photo n’a pas pu être enregistrée.',
    };
  }

  refresh();
  return { saved: true };
}

export async function removeAvatarAction(
  _previous: IdentityFormState,
  _form: FormData,
): Promise<IdentityFormState> {
  const session = await requireSession(PATH);

  try {
    await removeMyAvatar(identityContext(session));
  } catch (error) {
    return failure(error, 'retrait de photo', 'La photo n’a pas pu être retirée. Réessaie.');
  }

  refresh();
  return { saved: true };
}
