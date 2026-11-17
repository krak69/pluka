import type { BagView } from './bags.js';
import type { MyTaskView } from './tasks.js';

/**
 * « À faire maintenant », sur l'Accueil coureur (00_PRODUCT_SPEC §10).
 *
 * Décisions produit du 2026-11-17 : un ordre fixe, sans étiquette de priorité
 * — chaque ligne dit sa raison ; « Mes tâches » seules, jamais les suggestions
 * non ajoutées ; l'Accueil en montre cinq, l'onglet Préparation le reste.
 *
 * L'ordre : les tâches en retard ou du jour, le matériel obligatoire manquant,
 * les sacs pas prêts, les tâches datées à venir, puis celles sans date.
 */
export type NextAction =
  | {
      readonly kind: 'task';
      readonly id: string;
      readonly title: string;
      readonly dueDay: string | null;
      readonly daysLeft: number | null;
    }
  | { readonly kind: 'mandatory_equipment'; readonly missing: number; readonly total: number }
  | {
      readonly kind: 'bag';
      readonly id: string;
      readonly name: string;
      readonly checked: number;
      readonly total: number;
    };

export interface NextActionsInput {
  /** La jauge du matériel obligatoire ; nulle quand la checklist n'a pu être lue. */
  readonly mandatory: { readonly ready: number; readonly total: number } | null;
  readonly bags: readonly BagView[];
  readonly tasks: readonly MyTaskView[];
}

function taskAction(task: MyTaskView): NextAction {
  return {
    kind: 'task',
    id: task.id,
    title: task.title,
    dueDay: task.dueDay,
    daysLeft: task.daysLeft,
  };
}

/** Pure : toutes les actions ouvertes, dans l'ordre ; l'écran choisit combien il en montre. */
export function nextActions(input: NextActionsInput): readonly NextAction[] {
  const open = input.tasks.filter((task) => !task.done);
  const dated = open
    .filter((task): task is MyTaskView & { daysLeft: number } => task.daysLeft !== null)
    // Tri stable : à échéance égale, l'ordre de « Mes tâches » est gardé.
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const due = dated.filter((task) => task.daysLeft <= 0);
  const upcoming = dated.filter((task) => task.daysLeft > 0);
  const undated = open.filter((task) => task.daysLeft === null);

  const actions: NextAction[] = due.map(taskAction);

  const mandatory = input.mandatory;
  if (mandatory !== null && mandatory.ready < mandatory.total) {
    actions.push({
      kind: 'mandatory_equipment',
      missing: mandatory.total - mandatory.ready,
      total: mandatory.total,
    });
  }

  for (const bag of input.bags) {
    if (bag.ready) continue;
    actions.push({
      kind: 'bag',
      id: bag.id,
      name: bag.name,
      checked: bag.checkedCount,
      total: bag.items.length,
    });
  }

  actions.push(...upcoming.map(taskAction), ...undated.map(taskAction));
  return actions;
}
