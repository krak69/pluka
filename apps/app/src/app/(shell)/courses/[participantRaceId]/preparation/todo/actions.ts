'use server';

import {
  adoptTaskSuggestion,
  createTask,
  deleteTask,
  dismissTaskSuggestion,
  DomainError,
  EntitlementError,
  removeTaskSuggestion,
  restoreTaskSuggestions,
  setSuggestedTaskDone,
  setSuggestedTaskDueDay,
  setTaskDone,
  updateTask,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import { tasksContext } from '@/lib/preparation';
import { requireSession } from '@/lib/session';

/**
 * Gestes de l'onglet À faire. Le client n'envoie que la participation, la
 * tâche ou la clé de suggestion, et l'intention : le droit (Race Pass pour
 * ses propres tâches), la propriété et la suggestion elle-même se décident
 * dans le domaine, puis dans la base (0097).
 */

export interface TaskActionState {
  readonly error?: string;
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? '');
}

/** Un champ date vide veut dire « sans échéance ». */
function dueDayOf(form: FormData): string | null {
  const day = field(form, 'dueDay').trim();
  return day === '' ? null : day;
}

function pathOf(participantRaceId: string): string {
  return `/courses/${participantRaceId}/preparation/todo`;
}

/** Le motif d'un refus, dit au coureur ; le détail technique reste dans les journaux. */
function messageOf(error: unknown): string {
  if (error instanceof EntitlementError) {
    return 'Tes propres tâches font partie de la préparation complète, avec le Race Pass.';
  }
  if (error instanceof DomainError && error.code === 'validation') {
    return 'Donne un titre à ta tâche, et une date valide si tu en mets une.';
  }
  console.error('à faire : geste refusé', {
    code: error instanceof DomainError ? error.code : 'inconnu',
  });
  return 'Ce changement n’a pas pu être enregistré. Réessaie dans un instant.';
}

async function context(participantRaceId: string) {
  return tasksContext(await requireSession(pathOf(participantRaceId)));
}

async function run(form: FormData, gesture: (participantRaceId: string) => Promise<unknown>) {
  const participantRaceId = field(form, 'participantRaceId');
  await gesture(participantRaceId).catch((error: unknown) => {
    messageOf(error);
  });
  revalidatePath(pathOf(participantRaceId));
}

export async function adoptSuggestionAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    adoptTaskSuggestion(await context(participantRaceId), {
      participantRaceId,
      key: field(form, 'key'),
    }),
  );
}

export async function removeSuggestionAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    removeTaskSuggestion(await context(participantRaceId), {
      participantRaceId,
      key: field(form, 'key'),
    }),
  );
}

export async function setSuggestionDoneAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    setSuggestedTaskDone(await context(participantRaceId), {
      participantRaceId,
      key: field(form, 'key'),
      done: field(form, 'done') === 'true',
    }),
  );
}

export async function dismissSuggestionAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    dismissTaskSuggestion(await context(participantRaceId), {
      participantRaceId,
      key: field(form, 'key'),
    }),
  );
}

export async function restoreSuggestionsAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    restoreTaskSuggestions(await context(participantRaceId), { participantRaceId }),
  );
}

export async function setTaskDoneAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    setTaskDone(await context(participantRaceId), {
      participantRaceId,
      taskId: field(form, 'taskId'),
      done: field(form, 'done') === 'true',
    }),
  );
}

export async function deleteTaskAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    deleteTask(await context(participantRaceId), {
      participantRaceId,
      taskId: field(form, 'taskId'),
    }),
  );
}

export async function createTaskAction(
  _previous: TaskActionState,
  form: FormData,
): Promise<TaskActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  try {
    await createTask(await context(participantRaceId), {
      participantRaceId,
      title: field(form, 'title'),
      dueDay: dueDayOf(form),
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(pathOf(participantRaceId));
  return {};
}

/** Une tâche du coureur : titre et échéance. Une suggestion ajoutée : son échéance seule. */
export async function updateTaskAction(
  _previous: TaskActionState,
  form: FormData,
): Promise<TaskActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  const key = field(form, 'key');
  try {
    const tasks = await context(participantRaceId);
    await (key === ''
      ? updateTask(tasks, {
          participantRaceId,
          taskId: field(form, 'taskId'),
          title: field(form, 'title'),
          dueDay: dueDayOf(form),
        })
      : setSuggestedTaskDueDay(tasks, { participantRaceId, key, dueDay: dueDayOf(form) }));
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(pathOf(participantRaceId));
  return {};
}
