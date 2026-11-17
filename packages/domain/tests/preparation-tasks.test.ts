import type {
  BagRecord,
  BagRepository,
  PlanCourseRepository,
  PublishedFactRepository,
  PublishedRaceFactRecord,
  RacePlanRepository,
  RaceRepository,
  TaskRecord,
  TaskRepository,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  adoptTaskSuggestion,
  createTask,
  deleteTask,
  dismissTaskSuggestion,
  EntitlementError,
  getTasks,
  removeTaskSuggestion,
  restoreTaskSuggestions,
  setSuggestedTaskDone,
  setSuggestedTaskDueDay,
  setTaskDone,
  suggestTasks,
  updateTask,
  type TasksContext,
} from '../src/index.js';
import {
  createFakeEntitlementRepositories,
  entitlementBaseState,
  grantEntitlement,
  type EntitlementState,
} from './fixtures/entitlement-repositories.js';
import {
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
} from './fixtures/participation-repositories.js';

/**
 * Préparation · À faire — 00_PRODUCT_SPEC §14.5 ; 04_ENTITLEMENTS §45 ;
 * décisions produit du 2026-11-17 (suggestions tirées des données, sans
 * échéance, gratuites ; ses propres tâches avec le Race Pass).
 */

const NOW = new Date('2026-06-20T08:00:00.000Z');
/** Départ le 4 juillet à 6 h, heure de Chamonix. */
const START = '2026-07-04T04:00:00.000Z';
const BAG_START = '0b000000-0000-4000-8000-000000000001';
const BAG_DROP = '0b000000-0000-4000-8000-000000000002';

let entitlements: EntitlementState;
let own: string;
let foreign: string;
let sequence = 0;
let hasPlan: boolean;
let geometry: string | null;
let facts: PublishedRaceFactRecord[];
let bags: (Pick<BagRecord, 'id' | 'bagType' | 'name'> & { participantRaceId: string })[];
type StoredTask = TaskRecord & { readonly participantRaceId: string };
let tasks: StoredTask[];

function id(): string {
  sequence += 1;
  return `0c000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function mandatory(label: string): PublishedRaceFactRecord {
  return {
    factId: id(),
    raceId: PUBLIC_RACE,
    category: 'equipment',
    factKey: `equipment.${label}`,
    versionId: id(),
    versionNumber: 1,
    valueText: label,
    valueNumber: null,
    unit: null,
    valueJson: { requirement: 'mandatory' },
    trustLevel: 'official',
    publishedAt: '2026-01-01T00:00:00.000Z',
    source: null,
  };
}

/** Comme 0097 : une ligne par clé de suggestion ; la RLS borne au propriétaire. */
function fakeTasks(): TaskRepository {
  const patch = (participantRaceId: string, taskId: string, change: Partial<StoredTask>) => {
    tasks = tasks.map((task) =>
      task.id === taskId && task.participantRaceId === participantRaceId
        ? { ...task, ...change }
        : task,
    );
  };
  return {
    listTasks: async (participantRaceId) =>
      tasks.filter((task) => task.participantRaceId === participantRaceId),
    createTask: async (participantRaceId, task) => {
      tasks.push({
        id: id(),
        participantRaceId,
        title: task.title,
        dueAt: task.dueAt,
        completedAt: null,
        origin: 'personal',
        suggestionKey: null,
        dismissedAt: null,
        createdAt: NOW.toISOString(),
      });
    },
    updateTask: async (participantRaceId, taskId, task) => {
      patch(participantRaceId, taskId, { title: task.title, dueAt: task.dueAt });
    },
    setCompleted: async (participantRaceId, taskId, completedAt) => {
      patch(participantRaceId, taskId, { completedAt });
    },
    deleteTask: async (participantRaceId, taskId) => {
      tasks = tasks.filter(
        (task) => !(task.id === taskId && task.participantRaceId === participantRaceId),
      );
    },
    markSuggestion: async (participantRaceId, key, mark) => {
      const existing = tasks.find(
        (task) => task.participantRaceId === participantRaceId && task.suggestionKey === key,
      );
      const change = {
        title: mark.title,
        ...(mark.completedAt === undefined ? {} : { completedAt: mark.completedAt }),
        ...(mark.dismissedAt === undefined ? {} : { dismissedAt: mark.dismissedAt }),
        ...(mark.dueAt === undefined ? {} : { dueAt: mark.dueAt }),
      };
      if (existing !== undefined) {
        patch(participantRaceId, existing.id, change);
        return;
      }
      tasks.push({
        id: id(),
        participantRaceId,
        origin: 'pluka',
        suggestionKey: key,
        dueAt: null,
        completedAt: null,
        dismissedAt: null,
        createdAt: NOW.toISOString(),
        ...change,
      });
    },
    deleteSuggestion: async (participantRaceId, key) => {
      tasks = tasks.filter(
        (task) => !(task.participantRaceId === participantRaceId && task.suggestionKey === key),
      );
    },
    restoreSuggestions: async (participantRaceId) => {
      tasks = tasks.filter(
        (task) =>
          !(
            task.participantRaceId === participantRaceId &&
            task.suggestionKey !== null &&
            task.dismissedAt !== null
          ),
      );
    },
  };
}

function context(userId: string = RUNNER_A): TasksContext {
  return {
    repositories: {
      ...createFakeEntitlementRepositories(entitlements),
      tasks: fakeTasks(),
      bags: {
        listBags: async (participantRaceId: string) =>
          bags.filter((bag) => bag.participantRaceId === participantRaceId),
      } as unknown as BagRepository,
      racePlans: {
        findActive: async () => (hasPlan ? { id: 'plan' } : null),
      } as unknown as RacePlanRepository,
      planCourse: {
        findCurrentCourseGeometryId: async () => geometry,
      } as unknown as PlanCourseRepository,
      races: {
        findById: async (raceId: string) => ({
          id: raceId,
          timezone: 'Europe/Paris',
          startDatetime: START,
        }),
      } as unknown as RaceRepository,
      publishedFacts: {
        listPublishedByRace: async () => facts,
      } as unknown as PublishedFactRepository,
    },
    actor: { userId },
    now: () => NOW,
  };
}

function racePass(): void {
  grantEntitlement(entitlements, { kind: 'race_pass', userId: RUNNER_A, participantRaceId: own });
}

beforeEach(() => {
  const participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  foreign = seedParticipation(participation, { userId: RUNNER_B, raceId: PUBLIC_RACE }).id;
  entitlements = entitlementBaseState(participation);
  hasPlan = false;
  geometry = 'geometry';
  facts = [mandatory('Frontale')];
  bags = [];
  tasks = [];
});

describe('suggestTasks — fonction pure', () => {
  const all = {
    hasPlan: false,
    hasCourseTrace: true,
    hasMandatoryEquipment: true,
    bags: [
      { id: BAG_START, bagType: 'start' as const, name: 'Sac de départ' },
      { id: BAG_DROP, bagType: 'drop_bag' as const, name: 'Drop bag · Champex' },
    ],
  };

  it('suit une préparation : Plan, trace, matériel, puis les sacs', () => {
    expect(suggestTasks(all)).toEqual([
      { key: 'plan', title: 'Construire ton Plan' },
      { key: 'gpx', title: 'Charger la trace sur ta montre' },
      { key: 'mandatory_equipment', title: 'Rassembler le matériel obligatoire' },
      { key: `bag:${BAG_START}`, title: 'Préparer : Sac de départ' },
      { key: `bag:${BAG_DROP}`, title: 'Préparer et déposer : Drop bag · Champex' },
    ]);
  });

  it('ne suggère rien que la course ne justifie', () => {
    expect(
      suggestTasks({
        hasPlan: true,
        hasCourseTrace: false,
        hasMandatoryEquipment: false,
        bags: [],
      }),
    ).toEqual([]);
  });

  it('rend la même liste pour les mêmes données', () => {
    expect(suggestTasks(all)).toEqual(suggestTasks(all));
  });
});

describe('getTasks — lecture gratuite', () => {
  it('montre les suggestions à un coureur sans Race Pass', async () => {
    const overview = await getTasks(context(), { participantRaceId: own });

    expect(overview.suggestions.map((task) => task.key)).toEqual([
      'plan',
      'gpx',
      'mandatory_equipment',
    ]);
    expect(overview.canEdit).toBe(false);
    expect(overview.mine).toEqual([]);
    expect(overview.progress).toEqual({ done: 0, total: 0 });
  });

  it('ne suggère que le matériel obligatoire, pas le recommandé', async () => {
    facts = [{ ...mandatory('Bâtons'), valueJson: { requirement: 'recommended' } }];
    const overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.suggestions.map((task) => task.key)).not.toContain('mandatory_equipment');
  });

  it('retire « Construire ton Plan » une fois le Plan construit', async () => {
    hasPlan = true;
    const overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.suggestions.map((task) => task.key)).not.toContain('plan');
  });

  it('refuse de lire les tâches d’un autre coureur', async () => {
    await expect(getTasks(context(), { participantRaceId: foreign })).rejects.toBeDefined();
  });
});

describe('suggestions — ajouter, cocher, retirer, écarter, sans Race Pass', () => {
  it('ajoute une suggestion à « Mes tâches », sur une seule ligne', async () => {
    await adoptTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });
    await adoptTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });

    const overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.mine).toMatchObject([
      { suggestionKey: 'gpx', title: 'Charger la trace sur ta montre', dueDay: null, done: false },
    ]);
    expect(overview.suggestions.map((task) => task.key)).not.toContain('gpx');
    expect(tasks).toHaveLength(1);
  });

  it('coche puis décoche une suggestion ajoutée', async () => {
    await adoptTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });
    await setSuggestedTaskDone(context(), { participantRaceId: own, key: 'gpx', done: true });

    let overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.mine[0]?.done).toBe(true);
    expect(overview.progress).toEqual({ done: 1, total: 1 });
    expect(tasks[0]?.completedAt).toBe(NOW.toISOString());

    await setSuggestedTaskDone(context(), { participantRaceId: own, key: 'gpx', done: false });
    overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.mine[0]?.done).toBe(false);
  });

  it('date une suggestion ajoutée, sans Race Pass, sans toucher à son titre', async () => {
    await adoptTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });
    await setSuggestedTaskDueDay(context(), {
      participantRaceId: own,
      key: 'gpx',
      dueDay: '2026-07-01',
    });

    let [task] = (await getTasks(context(), { participantRaceId: own })).mine;
    expect(task).toMatchObject({
      title: 'Charger la trace sur ta montre',
      dueDay: '2026-07-01',
      daysLeft: 11,
    });

    await setSuggestedTaskDueDay(context(), { participantRaceId: own, key: 'gpx', dueDay: null });
    [task] = (await getTasks(context(), { participantRaceId: own })).mine;
    expect(task?.dueDay).toBeNull();
  });

  it('refuse de dater une suggestion qui n’est pas dans ses tâches', async () => {
    await expect(
      setSuggestedTaskDueDay(context(), {
        participantRaceId: own,
        key: 'gpx',
        dueDay: '2026-07-01',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(tasks).toEqual([]);
  });

  it('retire une suggestion de ses tâches : elle redevient une suggestion', async () => {
    await adoptTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });
    await removeTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });

    const overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.mine).toEqual([]);
    expect(overview.suggestions.map((task) => task.key)).toContain('gpx');
  });

  it('écarte une suggestion, puis la réaffiche', async () => {
    await dismissTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });

    let overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.suggestions.map((task) => task.key)).not.toContain('gpx');
    expect(overview.mine).toEqual([]);
    expect(overview.dismissedCount).toBe(1);

    await restoreTaskSuggestions(context(), { participantRaceId: own });
    overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.suggestions.map((task) => task.key)).toContain('gpx');
    expect(overview.dismissedCount).toBe(0);
  });

  it('« Réafficher » ne touche pas aux suggestions ajoutées', async () => {
    await adoptTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' });
    await dismissTaskSuggestion(context(), { participantRaceId: own, key: 'plan' });
    await restoreTaskSuggestions(context(), { participantRaceId: own });

    const overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.mine.map((task) => task.suggestionKey)).toEqual(['gpx']);
  });

  it('refuse une suggestion que la course n’appelle pas', async () => {
    geometry = null;
    await expect(
      adoptTaskSuggestion(context(), { participantRaceId: own, key: 'gpx' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      dismissTaskSuggestion(context(), { participantRaceId: own, key: `bag:${BAG_START}` }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(tasks).toEqual([]);
  });

  it('oublie une suggestion ajoutée dont le sac a été supprimé', async () => {
    bags = [{ id: BAG_START, bagType: 'start', name: 'Sac de départ', participantRaceId: own }];
    await adoptTaskSuggestion(context(), { participantRaceId: own, key: `bag:${BAG_START}` });
    bags = [];

    const overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.mine).toEqual([]);
    expect(overview.progress.total).toBe(0);
  });

  it('refuse d’ajouter la suggestion d’un autre coureur', async () => {
    await expect(
      adoptTaskSuggestion(context(), { participantRaceId: foreign, key: 'gpx' }),
    ).rejects.toBeDefined();
    await expect(
      removeTaskSuggestion(context(), { participantRaceId: foreign, key: 'gpx' }),
    ).rejects.toBeDefined();
    expect(tasks).toEqual([]);
  });
});

describe('ses propres tâches — Race Pass', () => {
  it('refuse de créer une tâche sans Race Pass', async () => {
    await expect(
      createTask(context(), { participantRaceId: own, title: 'Acheter des piles' }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(tasks).toEqual([]);
  });

  it('crée une tâche datée et la dit en jours avant le départ', async () => {
    racePass();
    await createTask(context(), {
      participantRaceId: own,
      title: '  Réserver le train  ',
      dueDay: '2026-06-24',
    });

    const [task] = (await getTasks(context(), { participantRaceId: own })).mine;
    expect(task).toMatchObject({
      title: 'Réserver le train',
      dueDay: '2026-06-24',
      daysLeft: 4,
      done: false,
    });
    // Minuit à Paris, en heure d'été.
    expect(tasks[0]?.dueAt).toBe('2026-06-23T22:00:00.000Z');
  });

  it('compte depuis aujourd’hui, pas depuis le départ : 0 aujourd’hui, négatif en retard', async () => {
    racePass();
    await createTask(context(), { participantRaceId: own, title: 'Hier', dueDay: '2026-06-19' });
    await createTask(context(), { participantRaceId: own, title: 'Ce jour', dueDay: '2026-06-20' });
    await createTask(context(), { participantRaceId: own, title: 'Départ', dueDay: '2026-07-04' });

    const mine = (await getTasks(context(), { participantRaceId: own })).mine;
    expect(mine.map((task) => [task.title, task.daysLeft])).toEqual([
      ['Hier', -1],
      ['Ce jour', 0],
      ['Départ', 14],
    ]);
  });

  it('range ce qui reste par échéance, puis ce qui est fait', async () => {
    racePass();
    await createTask(context(), { participantRaceId: own, title: 'Sans date' });
    await createTask(context(), { participantRaceId: own, title: 'Tard', dueDay: '2026-07-01' });
    await createTask(context(), { participantRaceId: own, title: 'Tôt', dueDay: '2026-06-25' });
    const late = tasks.find((task) => task.title === 'Tard');
    await setTaskDone(context(), { participantRaceId: own, taskId: late?.id, done: true });

    const mine = (await getTasks(context(), { participantRaceId: own })).mine;
    expect(mine.map((task) => task.title)).toEqual(['Tôt', 'Sans date', 'Tard']);
  });

  it('modifie, coche et supprime sa tâche', async () => {
    racePass();
    await createTask(context(), { participantRaceId: own, title: 'Piles' });
    const taskId = tasks[0]?.id;

    await updateTask(context(), {
      participantRaceId: own,
      taskId,
      title: 'Piles AAA',
      dueDay: '2026-06-27',
    });
    await setTaskDone(context(), { participantRaceId: own, taskId, done: true });
    expect(tasks[0]).toMatchObject({ title: 'Piles AAA', completedAt: NOW.toISOString() });

    await deleteTask(context(), { participantRaceId: own, taskId });
    expect(tasks).toEqual([]);
  });

  it('refuse un titre vide ou une date qui n’existe pas', async () => {
    racePass();
    await expect(
      createTask(context(), { participantRaceId: own, title: '   ' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      createTask(context(), { participantRaceId: own, title: 'Piles', dueDay: '2026-02-30' }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(tasks).toEqual([]);
  });

  it('ne modifie ni ne supprime une suggestion comme une tâche', async () => {
    racePass();
    await setSuggestedTaskDone(context(), { participantRaceId: own, key: 'gpx', done: true });
    const taskId = tasks[0]?.id;

    await expect(deleteTask(context(), { participantRaceId: own, taskId })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(tasks).toHaveLength(1);
  });

  it('garde la vue de ses tâches quand le Race Pass n’est plus là', async () => {
    tasks.push({
      id: id(),
      participantRaceId: own,
      title: 'Écrite avant',
      dueAt: null,
      completedAt: null,
      origin: 'personal',
      suggestionKey: null,
      dismissedAt: null,
      createdAt: NOW.toISOString(),
    });

    const overview = await getTasks(context(), { participantRaceId: own });
    expect(overview.mine.map((task) => task.title)).toEqual(['Écrite avant']);
    expect(overview.canEdit).toBe(false);
    await expect(
      setTaskDone(context(), { participantRaceId: own, taskId: tasks[0]?.id, done: true }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it('refuse d’écrire dans les tâches d’un autre coureur', async () => {
    racePass();
    await expect(
      createTask(context(), { participantRaceId: foreign, title: 'Intrus' }),
    ).rejects.toBeDefined();
    expect(tasks).toEqual([]);
  });
});
