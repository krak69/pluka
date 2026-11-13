'use server';

import {
  addToMyEquipment,
  DomainError,
  EntitlementError,
  removeFromMyEquipment,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import { libraryContext } from '@/lib/library';
import { requireSession } from '@/lib/session';

/**
 * Gestes de « Mon matériel ». Plusieurs pièces se saisissent une par ligne ;
 * le domaine nettoie (vides, doublons) et décide du droit (PLUKA+).
 */

export interface LibraryActionState {
  readonly error?: string;
  readonly saved?: boolean;
}

const PATH = '/bibliotheque/materiel';

function messageOf(error: unknown): string {
  if (error instanceof EntitlementError) {
    return 'Ta bibliothèque de matériel fait partie de PLUKA+.';
  }
  if (error instanceof DomainError && error.code === 'validation') {
    return 'Saisis au moins une pièce, une par ligne (120 caractères au plus chacune).';
  }
  console.error('bibliothèque de matériel : geste refusé', {
    code: error instanceof DomainError ? error.code : 'inconnu',
  });
  return 'Ce changement n’a pas pu être enregistré. Réessaie dans un instant.';
}

export async function addToMyEquipmentAction(
  _previous: LibraryActionState,
  form: FormData,
): Promise<LibraryActionState> {
  const session = await requireSession(PATH);
  try {
    await addToMyEquipment(libraryContext(session), {
      labels: String(form.get('labels') ?? '').split(/\r?\n/u),
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(PATH);
  return { saved: true };
}

export async function removeFromMyEquipmentAction(form: FormData): Promise<void> {
  const session = await requireSession(PATH);
  await removeFromMyEquipment(libraryContext(session), {
    itemId: String(form.get('itemId') ?? ''),
  }).catch((error: unknown) => {
    messageOf(error);
  });
  revalidatePath(PATH);
}
