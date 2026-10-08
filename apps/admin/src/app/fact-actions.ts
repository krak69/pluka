'use server';

import {
  addRaceEquipment,
  DomainError,
  restoreRaceFact,
  retireRaceFact,
  reviseRaceEquipment,
  reviseRaceFact,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { actionFailure, factEditingContext } from '@/lib/admin';
import { checked, text, texts } from '@/lib/form';
import { requireSession } from '@/lib/session';

/**
 * Corriger, retirer, restaurer une information publiée — migration 0043.
 *
 * Même contrat que les autres actions : lire, passer l'intention, rendre le
 * refus. L'autorité, le journal et le signal d'impact sont en base.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function raceOf(form: FormData): string | null {
  const raceId = text(form, 'raceId');
  return raceId !== undefined && UUID.test(raceId) ? raceId : null;
}

function revalidateRace(raceId: string): void {
  revalidatePath(`/courses/${raceId}/informations`);
  revalidatePath(`/courses/${raceId}`);
  // La fiche événement compte le matériel dans « Préparation ».
  revalidatePath('/evenements/[eventId]', 'page');
}

/**
 * Où revenir après un geste : la liste des informations par défaut, la fiche
 * épreuve et son panneau Matériel quand le geste en part. Une valeur connue,
 * jamais une adresse postée.
 */
function landing(form: FormData, raceId: string, notice: string): string {
  return text(form, 'back') === 'materiel'
    ? `/courses/${raceId}?fait=${notice}#materiel`
    : `/courses/${raceId}/informations?fait=${notice}`;
}

export async function reviseFactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const raceId = raceOf(form);
  const factId = text(form, 'factId') ?? '';
  if (raceId === null) return { error: 'Épreuve introuvable.' };

  const rawNumber = text(form, 'valueNumber');

  try {
    await reviseRaceFact(
      factEditingContext(await requireSession(`/courses/${raceId}/informations/${factId}`)),
      {
        factId,
        valueText: text(form, 'valueText') ?? null,
        valueNumber: rawNumber === undefined ? null : Number(rawNumber.replace(',', '.')),
        unit: text(form, 'unit') ?? null,
        trustLevel: text(form, 'trustLevel'),
        note: text(form, 'note') ?? null,
      },
    );
  } catch (error) {
    return actionFailure(error);
  }

  revalidateRace(raceId);
  redirect(`/courses/${raceId}/informations?fait=information-modifiee`);
}

/** Retirer demande la case de confirmation : c'est le geste « supprimer ». */
export async function retireFactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const raceId = raceOf(form);
  if (raceId === null) return { error: 'Épreuve introuvable.' };
  if (!checked(form, 'confirmed')) {
    return {
      error: 'Coche la case pour confirmer.',
      fieldErrors: { confirmed: 'Coche la case pour confirmer le retrait.' },
    };
  }

  try {
    await retireRaceFact(
      factEditingContext(await requireSession(`/courses/${raceId}/informations`)),
      {
        factId: text(form, 'factId') ?? '',
        note: text(form, 'note') ?? null,
      },
    );
  } catch (error) {
    return actionFailure(error);
  }

  revalidateRace(raceId);
  redirect(landing(form, raceId, 'information-retiree'));
}

export async function restoreFactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const raceId = raceOf(form);
  if (raceId === null) return { error: 'Épreuve introuvable.' };

  try {
    await restoreRaceFact(
      factEditingContext(await requireSession(`/courses/${raceId}/informations`)),
      {
        factId: text(form, 'factId') ?? '',
        note: null,
      },
    );
  } catch (error) {
    return actionFailure(error);
  }

  revalidateRace(raceId);
  redirect(landing(form, raceId, 'information-restauree'));
}

/**
 * Matériel — migration 0045. Les épreuves visées arrivent en cases cochées
 * (`raceIds`) ; la base vérifie qu'elles sont de la même édition et que
 * l'acteur a autorité sur chacune.
 */
/** Un refus de niveau de confiance dit quoi choisir, plutôt que « action non autorisée ». */
function equipmentFailure(error: unknown): ActionState {
  if (error instanceof DomainError && error.code === 'forbidden') {
    if (error.details['reason'] === 'OFFICIAL_AUTHORIZATION_REQUIRED') {
      return {
        error:
          'Le niveau « Officielle » est réservé à un éditeur de l’organisation de cette course. En tant qu’admin PLUKA, publie en « Validée PLUKA ».',
      };
    }
    if (error.details['reason'] === 'PLUKA_VALIDATION_REQUIRED') {
      return {
        error:
          '« Validée PLUKA » est réservée à l’équipe PLUKA. En tant qu’éditeur de l’organisation, publie en « Officielle ».',
      };
    }
  }
  return actionFailure(error);
}

function equipmentFields(form: FormData) {
  return {
    label: text(form, 'label') ?? '',
    requirement: text(form, 'requirement'),
    condition: text(form, 'condition') ?? null,
    detail: text(form, 'detail') ?? null,
    trustLevel: text(form, 'trustLevel'),
    note: text(form, 'note') ?? null,
  };
}

export async function addEquipmentAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const raceId = raceOf(form);
  if (raceId === null) return { error: 'Épreuve introuvable.' };

  try {
    await addRaceEquipment(factEditingContext(await requireSession(`/courses/${raceId}`)), {
      raceIds: texts(form, 'raceIds').filter((id) => id !== ''),
      ...equipmentFields(form),
    });
  } catch (error) {
    return equipmentFailure(error);
  }

  revalidateRace(raceId);
  redirect(`/courses/${raceId}?fait=materiel-ajoute#materiel`);
}

export async function reviseEquipmentAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const raceId = raceOf(form);
  if (raceId === null) return { error: 'Épreuve introuvable.' };

  try {
    await reviseRaceEquipment(factEditingContext(await requireSession(`/courses/${raceId}`)), {
      factId: text(form, 'factId') ?? '',
      ...equipmentFields(form),
    });
  } catch (error) {
    return equipmentFailure(error);
  }

  revalidateRace(raceId);
  redirect(`/courses/${raceId}?fait=materiel-modifie#materiel`);
}
