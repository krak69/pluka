import { describe, expect, it } from 'vitest';

import { nextActions, type BagView, type MyTaskView } from '../src/index.js';

function task(id: string, daysLeft: number | null, done = false): MyTaskView {
  return {
    id,
    suggestionKey: null,
    title: `Tâche ${id}`,
    dueDay: daysLeft === null ? null : '2026-11-20',
    daysLeft,
    done,
  };
}

function bag(id: string, checked: number, total: number): BagView {
  return {
    id,
    bagType: 'start',
    name: `Sac ${id}`,
    point: null,
    pointIssue: null,
    items: Array.from({ length: total }, (_, index) => ({
      id: `${id}-${String(index)}`,
      label: `Pièce ${String(index)}`,
      quantity: 1,
      checked: index < checked,
    })),
    checkedCount: checked,
    ready: total > 0 && checked === total,
    picks: [],
  };
}

function order(actions: ReturnType<typeof nextActions>): string[] {
  return actions.map((action) =>
    action.kind === 'mandatory_equipment' ? 'equipment' : `${action.kind}:${action.id}`,
  );
}

describe('nextActions — « À faire maintenant » (décision du 2026-11-17)', () => {
  it('range : en retard et du jour, matériel obligatoire, sacs, à venir, sans date', () => {
    const actions = nextActions({
      mandatory: { ready: 6, total: 9 },
      bags: [bag('depart', 2, 5)],
      tasks: [task('sans-date', null), task('demain', 1), task('jour', 0), task('retard', -2)],
    });

    expect(order(actions)).toEqual([
      'task:retard',
      'task:jour',
      'equipment',
      'bag:depart',
      'task:demain',
      'task:sans-date',
    ]);
    expect(actions[2]).toEqual({ kind: 'mandatory_equipment', missing: 3, total: 9 });
    expect(actions[3]).toEqual({
      kind: 'bag',
      id: 'depart',
      name: 'Sac depart',
      checked: 2,
      total: 5,
    });
  });

  it('écarte ce qui est fait : tâches cochées, matériel complet, sacs prêts', () => {
    const actions = nextActions({
      mandatory: { ready: 9, total: 9 },
      bags: [bag('pret', 3, 3)],
      tasks: [task('faite', -1, true), task('faite-aussi', null, true)],
    });

    expect(actions).toEqual([]);
  });

  it('un sac vide reste à préparer : il n’est pas prêt', () => {
    expect(order(nextActions({ mandatory: null, bags: [bag('vide', 0, 0)], tasks: [] }))).toEqual([
      'bag:vide',
    ]);
  });

  it('sans matériel obligatoire publié, ni checklist lue : pas de ligne matériel', () => {
    expect(nextActions({ mandatory: { ready: 0, total: 0 }, bags: [], tasks: [] })).toEqual([]);
    expect(nextActions({ mandatory: null, bags: [], tasks: [] })).toEqual([]);
  });

  it('à échéance égale, garde l’ordre de « Mes tâches »', () => {
    const actions = nextActions({
      mandatory: null,
      bags: [],
      tasks: [task('b', 3), task('a', 3), task('c', 2)],
    });

    expect(order(actions)).toEqual(['task:c', 'task:b', 'task:a']);
  });
});
