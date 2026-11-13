'use server';

import {
  addPersonalEquipment,
  addPersonalEquipmentFromLibrary,
  DomainError,
  EntitlementError,
  removePersonalEquipment,
  setOfficialEquipmentReady,
  setPersonalEquipmentReady,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import { preparationContext } from '@/lib/preparation';
import { requireSession } from '@/lib/session';

/**
 * Gestes de la checklist de matériel. Le client n'envoie que la participation,
 * la pièce et l'état voulu : le droit se décide dans le domaine (04 §45).
 */

export interface EquipmentActionState {
  readonly error?: string;
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? '');
}

function pathOf(participantRaceId: string): string {
  return `/courses/${participantRaceId}/preparation/materiel`;
}

/** Le motif d'un refus, dit au coureur ; le détail technique reste dans les journaux. */
function messageOf(error: unknown): string {
  if (error instanceof EntitlementError) {
    return 'Le matériel personnel fait partie de la préparation complète, avec le Race Pass.';
  }
  if (error instanceof DomainError && error.code === 'validation') {
    return 'Donne un nom à cette pièce (120 caractères au plus).';
  }
  console.error('checklist de matériel : geste refusé', {
    code: error instanceof DomainError ? error.code : 'inconnu',
  });
  return 'Ce changement n’a pas pu être enregistré. Réessaie dans un instant.';
}

export async function setOfficialEquipmentAction(form: FormData): Promise<void> {
  const participantRaceId = field(form, 'participantRaceId');
  const session = await requireSession(pathOf(participantRaceId));
  await setOfficialEquipmentReady(preparationContext(session), {
    participantRaceId,
    raceFactId: field(form, 'raceFactId'),
    ready: field(form, 'ready') === 'true',
  }).catch((error: unknown) => {
    messageOf(error);
  });
  revalidatePath(pathOf(participantRaceId));
}

export async function setPersonalEquipmentAction(form: FormData): Promise<void> {
  const participantRaceId = field(form, 'participantRaceId');
  const session = await requireSession(pathOf(participantRaceId));
  await setPersonalEquipmentReady(preparationContext(session), {
    participantRaceId,
    equipmentId: field(form, 'equipmentId'),
    ready: field(form, 'ready') === 'true',
  }).catch((error: unknown) => {
    messageOf(error);
  });
  revalidatePath(pathOf(participantRaceId));
}

export async function removePersonalEquipmentAction(form: FormData): Promise<void> {
  const participantRaceId = field(form, 'participantRaceId');
  const session = await requireSession(pathOf(participantRaceId));
  await removePersonalEquipment(preparationContext(session), {
    participantRaceId,
    equipmentId: field(form, 'equipmentId'),
  }).catch((error: unknown) => {
    messageOf(error);
  });
  revalidatePath(pathOf(participantRaceId));
}

export async function addPersonalEquipmentAction(
  _previous: EquipmentActionState,
  form: FormData,
): Promise<EquipmentActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  const session = await requireSession(pathOf(participantRaceId));
  try {
    await addPersonalEquipment(preparationContext(session), {
      participantRaceId,
      label: field(form, 'label'),
      // Case absente (sans PLUKA+) ou décochée : rien ne rejoint la bibliothèque.
      saveToLibrary: form.get('saveToLibrary') === 'on',
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(pathOf(participantRaceId));
  return {};
}

/** Ajoute d'un clic une ou plusieurs pièces de « Mon matériel » à la course. */
export async function addFromLibraryAction(form: FormData): Promise<void> {
  const participantRaceId = field(form, 'participantRaceId');
  const session = await requireSession(pathOf(participantRaceId));
  await addPersonalEquipmentFromLibrary(preparationContext(session), {
    participantRaceId,
    itemIds: form.getAll('itemId').map(String),
  }).catch((error: unknown) => {
    messageOf(error);
  });
  revalidatePath(pathOf(participantRaceId));
}
