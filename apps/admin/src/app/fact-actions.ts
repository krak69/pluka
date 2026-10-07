'use server';

import { restoreRaceFact, retireRaceFact, reviseRaceFact } from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { actionFailure, factEditingContext } from '@/lib/admin';
import { checked, text } from '@/lib/form';
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
  redirect(`/courses/${raceId}/informations?fait=information-retiree`);
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
  redirect(`/courses/${raceId}/informations?fait=information-restauree`);
}
