'use server';

import { DomainError, acknowledgeStartChanges, shiftPlanToOfficialStart } from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/app/actions';
import { planContext, planErrorMessage } from '@/lib/plan';
import { requireSession } from '@/lib/session';
import { startChangeContext } from '@/lib/start-changes';

/**
 * L'alerte « ton heure de départ a changé » — migration 0082.
 *
 * Deux gestes, et le coureur choisit (AGENTS §15) : décaler son Plan sur la
 * nouvelle heure en gardant ses durées, ou refermer l'alerte. Le décalage est
 * ouvert à tous, Free compris (décision du 2026-11-10) : l'heure vient de
 * l'organisation, pas du coureur.
 */

function participantRaceIdOf(form: FormData): string {
  const value = form.get('participantRaceId');
  return typeof value === 'string' ? value : '';
}

export async function shiftPlanToNewStartAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = participantRaceIdOf(form);
  const session = await requireSession(`/courses/${participantRaceId}/plan`);

  try {
    const outcome = await shiftPlanToOfficialStart(planContext(session), {
      participantRaceId,
    }).catch((error: unknown) => {
      // Déjà à l'heure (un autre onglet, un double clic) : il ne reste qu'à refermer.
      if (error instanceof DomainError && error.code === 'invalid_state') return null;
      throw error;
    });
    if (outcome !== null && outcome.result.conflicts.length > 0) {
      return { error: outcome.result.conflicts.map((issue) => issue.message).join(' · ') };
    }
    await acknowledgeStartChanges(startChangeContext(session), { participantRaceId });
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  revalidatePath(`/courses/${participantRaceId}/plan`);
  return {};
}

export async function acknowledgeStartChangesAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const participantRaceId = participantRaceIdOf(form);
  const session = await requireSession(`/courses/${participantRaceId}/plan`);

  try {
    await acknowledgeStartChanges(startChangeContext(session), { participantRaceId });
  } catch {
    return { error: 'L’alerte n’a pas pu être refermée. Réessaie dans un instant.' };
  }

  revalidatePath(`/courses/${participantRaceId}/plan`);
  return {};
}
