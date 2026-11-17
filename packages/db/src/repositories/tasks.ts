import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';
import { bagRepository, type BagRepository } from './bags.js';
import { raceRepository, type RaceRepository } from './course.js';
import {
  planCourseRepository,
  racePlanRepository,
  type PlanCourseRepository,
  type RacePlanRepository,
} from './plan.js';

/*
 * Préparation · À faire — migrations 0001, 0097.
 *
 * Sous la session du coureur : la RLS (0005) borne chaque tâche au
 * propriétaire de la participation. Le droit commercial (Race Pass pour ses
 * propres tâches) se décide dans le domaine.
 *
 * Aucune lecture `select *` (AGENTS §80) : les colonnes sont nommées.
 */

export type TaskOrigin = 'personal' | 'pluka' | 'official_change' | 'nutrition' | 'conditions';

export interface TaskRecord {
  readonly id: string;
  readonly title: string;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly origin: TaskOrigin;
  /** La suggestion PLUKA que cette ligne retient ; nulle pour une tâche du coureur. */
  readonly suggestionKey: string | null;
  readonly dismissedAt: string | null;
  readonly createdAt: string;
}

export interface NewTask {
  readonly title: string;
  readonly dueAt: string | null;
}

/** Ce qu'on retient d'une suggestion : cochée, écartée, ou les deux. */
export interface SuggestionMark {
  readonly title: string;
  readonly completedAt?: string | null;
  readonly dismissedAt?: string | null;
  readonly dueAt?: string | null;
}

export interface TaskRepository {
  listTasks(participantRaceId: string): Promise<readonly TaskRecord[]>;
  createTask(participantRaceId: string, task: NewTask): Promise<void>;
  updateTask(participantRaceId: string, taskId: string, task: NewTask): Promise<void>;
  setCompleted(
    participantRaceId: string,
    taskId: string,
    completedAt: string | null,
  ): Promise<void>;
  deleteTask(participantRaceId: string, taskId: string): Promise<void>;
  /**
   * Écrit l'état d'une suggestion. Une seule ligne par clé (0097) : l'ajouter
   * deux fois, puis la cocher, met à jour la même ligne.
   */
  markSuggestion(participantRaceId: string, key: string, mark: SuggestionMark): Promise<void>;
  /** Efface la ligne d'une suggestion : elle redevient une suggestion. */
  deleteSuggestion(participantRaceId: string, key: string): Promise<void>;
  /** « Réafficher » : efface les lignes des suggestions écartées. */
  restoreSuggestions(participantRaceId: string): Promise<void>;
}

const COLUMNS =
  'id, title, due_at, completed_at, origin, suggestion_key, dismissed_at, created_at' as const;

type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  completed_at: string | null;
  origin: TaskOrigin;
  suggestion_key: string | null;
  dismissed_at: string | null;
  created_at: string;
};

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    origin: row.origin,
    suggestionKey: row.suggestion_key,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
  };
}

export const taskRepository = defineRepository<TaskRepository>((context) => ({
  async listTasks(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('tasks')
        .select(COLUMNS)
        .eq('participant_race_id', participantRaceId)
        .order('created_at', { ascending: true }),
      'tasks.list',
    );

    return ((rows ?? []) as TaskRow[]).map(toTask);
  },

  async createTask(participantRaceId, task) {
    unwrapMaybe(
      await context.client.from('tasks').insert({
        participant_race_id: participantRaceId,
        title: task.title,
        due_at: task.dueAt,
        origin: 'personal',
      }),
      'tasks.create',
    );
  },

  async updateTask(participantRaceId, taskId, task) {
    unwrapMaybe(
      await context.client
        .from('tasks')
        .update({ title: task.title, due_at: task.dueAt })
        .eq('id', taskId)
        .eq('participant_race_id', participantRaceId)
        .is('suggestion_key', null),
      'tasks.update',
    );
  },

  async setCompleted(participantRaceId, taskId, completedAt) {
    unwrapMaybe(
      await context.client
        .from('tasks')
        .update({ completed_at: completedAt })
        .eq('id', taskId)
        .eq('participant_race_id', participantRaceId),
      'tasks.setCompleted',
    );
  },

  async deleteTask(participantRaceId, taskId) {
    unwrapMaybe(
      await context.client
        .from('tasks')
        .delete()
        .eq('id', taskId)
        .eq('participant_race_id', participantRaceId)
        .is('suggestion_key', null),
      'tasks.delete',
    );
  },

  async markSuggestion(participantRaceId, key, mark) {
    unwrapMaybe(
      await context.client.from('tasks').upsert(
        {
          participant_race_id: participantRaceId,
          suggestion_key: key,
          origin: 'pluka' as const,
          title: mark.title,
          ...(mark.completedAt === undefined ? {} : { completed_at: mark.completedAt }),
          ...(mark.dismissedAt === undefined ? {} : { dismissed_at: mark.dismissedAt }),
          ...(mark.dueAt === undefined ? {} : { due_at: mark.dueAt }),
        },
        { onConflict: 'participant_race_id,suggestion_key' },
      ),
      'tasks.markSuggestion',
    );
  },

  async deleteSuggestion(participantRaceId, key) {
    unwrapMaybe(
      await context.client
        .from('tasks')
        .delete()
        .eq('participant_race_id', participantRaceId)
        .eq('suggestion_key', key),
      'tasks.deleteSuggestion',
    );
  },

  async restoreSuggestions(participantRaceId) {
    unwrapMaybe(
      await context.client
        .from('tasks')
        .delete()
        .eq('participant_race_id', participantRaceId)
        .not('suggestion_key', 'is', null)
        .not('dismissed_at', 'is', null),
      'tasks.restoreSuggestions',
    );
  },
}));

export interface TaskRepositories {
  readonly tasks: TaskRepository;
  /** Un rappel par sac créé. */
  readonly bags: BagRepository;
  /** « Construire ton Plan », tant qu'aucun Plan n'existe. */
  readonly racePlans: RacePlanRepository;
  /** « Charger la trace », quand la course a une trace. */
  readonly planCourse: PlanCourseRepository;
  /** Le départ et le fuseau de la course : l'échéance se dit en « J-10 ». */
  readonly races: RaceRepository;
}

export function createTaskRepositories(context: RepositoryContext): TaskRepositories {
  return {
    tasks: taskRepository(context),
    bags: bagRepository(context),
    racePlans: racePlanRepository(context),
    planCourse: planCourseRepository(context),
    races: raceRepository(context),
  };
}
