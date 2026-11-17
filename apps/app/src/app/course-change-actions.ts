'use server';

import { DomainError, updatePlanToCurrentCourse } from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/app/actions';
import { planContext, planErrorMessage } from '@/lib/plan';
import { requireSession } from '@/lib/session';

/**
 * « Le parcours a changé » — PLAN_ENGINE §39, décisions du 2026-11-17.
 *
 * Un seul geste, ouvert à tous : mettre le Plan à jour sur le parcours actuel.
 * Rien ne se recalcule sans le coureur (AGENTS §15).
 */
export async function updatePlanToCurrentCourseAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const value = form.get('participantRaceId');
  const participantRaceId = typeof value === 'string' ? value : '';
  const session = await requireSession(`/courses/${participantRaceId}/plan`);

  try {
    const outcome = await updatePlanToCurrentCourse(planContext(session), {
      participantRaceId,
    }).catch((error: unknown) => {
      // Déjà à jour (un autre onglet, un double clic) : rien à faire.
      if (error instanceof DomainError && error.code === 'invalid_state') return null;
      throw error;
    });
    if (outcome !== null && outcome.result.conflicts.length > 0) {
      return { error: outcome.result.conflicts.map((issue) => issue.message).join(' · ') };
    }
  } catch (error) {
    return { error: planErrorMessage(error) };
  }

  revalidatePath(`/courses/${participantRaceId}/plan`);
  return {};
}
