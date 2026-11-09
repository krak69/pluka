'use server';

import { cancelBetaReservation, grantBetaAccess, revokeBetaAccess } from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/app/actions';
import { actionFailure, betaAccessContext } from '@/lib/admin';
import { requireSession } from '@/lib/session';

/**
 * Accès bêta — migration 0073. La base garde le geste au `pluka_admin` et
 * l'inscrit au journal ; l'action ne fait que transmettre l'intention.
 */

const PAGE = '/utilisateurs/beta';

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function plural(value: number, one: string, many: string): string {
  return `${String(value)} ${value > 1 ? many : one}`;
}

export async function grantBetaAccessAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const outcome = await grantBetaAccess(betaAccessContext(await requireSession(PAGE)), {
      emails: text(form, 'emails'),
      endsOn: text(form, 'endsOn'),
      reason: text(form, 'reason'),
    });
    revalidatePath(PAGE);

    const parts = [
      ...(outcome.granted === 0 ? [] : [plural(outcome.granted, 'accès ouvert', 'accès ouverts')]),
      ...(outcome.extended === 0
        ? []
        : [plural(outcome.extended, 'accès prolongé', 'accès prolongés')]),
      ...(outcome.reserved === 0
        ? []
        : [
            plural(
              outcome.reserved,
              'adresse réservée, ouverte à la création du compte',
              'adresses réservées, ouvertes à la création du compte',
            ),
          ]),
      ...(outcome.invalid === 0
        ? []
        : [plural(outcome.invalid, 'adresse illisible ignorée', 'adresses illisibles ignorées')]),
    ];
    return { done: parts.length === 0 ? 'Aucune adresse à traiter.' : `${parts.join(', ')}.` };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function revokeBetaAccessAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await revokeBetaAccess(betaAccessContext(await requireSession(PAGE)), {
      grantId: text(form, 'grantId'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(PAGE);
  return {};
}

export async function cancelBetaReservationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await cancelBetaReservation(betaAccessContext(await requireSession(PAGE)), {
      email: text(form, 'email'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(PAGE);
  return {};
}
