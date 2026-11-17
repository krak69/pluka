'use client';

import type { PlanCourseChange } from '@pluka/domain';
import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';
import { updatePlanToCurrentCourseAction } from '@/app/course-change-actions';

const INITIAL: ActionState = {};

function km(value: number): string {
  return `km ${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
}

/** Une ligne par nature de changement, dans l'ordre où le coureur les lit. */
function lines(change: PlanCourseChange): string[] {
  const named = change.removed.filter((name): name is string => name !== null);
  const unnamed = change.removed.length - named.length;

  return [
    ...change.added.map((name) => `Nouveau point : ${name}`),
    ...named.map((name) => `Point retiré : ${name}`),
    ...(unnamed === 0
      ? []
      : [unnamed === 1 ? 'Un point a été retiré' : `${String(unnamed)} points ont été retirés`]),
    ...change.moved.map((move) => `${move.name} : ${km(move.fromKm)} → ${km(move.toKm)}`),
    ...(change.cutoffsChanged ? ['Les barrières horaires ont changé'] : []),
  ];
}

/**
 * « Le parcours a changé » — PLAN_ENGINE §39.
 *
 * Le Plan reste sur l'ancien parcours tant que le coureur ne le met pas à jour.
 * Rien à refermer : l'alerte tombe d'elle-même quand le Plan suit le parcours.
 * Aube marque l'action qui l'attend, comme l'alerte de départ.
 */
export function CourseChangeAlert({
  participantRaceId,
  change,
}: {
  readonly participantRaceId: string;
  readonly change: PlanCourseChange;
}) {
  const [state, update, updating] = useActionState(updatePlanToCurrentCourseAction, INITIAL);

  return (
    <section className="rp-start-alert" role="status" aria-labelledby="course-alert-title">
      <h2 id="course-alert-title" className="pk-label">
        Le parcours a changé
      </h2>
      <ul className="rp-course-alert-list">
        {lines(change).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="rp-hint">
        Ton Plan est encore calculé sur l’ancien parcours. Le mettre à jour garde ton objectif, tes
        arrêts et tes heures verrouillées ; les durées que tu avais imposées aux sections sont
        recalculées.
      </p>
      <form action={update} className="rp-start-alert-actions">
        <input type="hidden" name="participantRaceId" value={participantRaceId} />
        <button type="submit" className="pk-btn pk-button-primary" disabled={updating}>
          {updating ? 'Mise à jour…' : 'Mettre à jour mon Plan'}
        </button>
      </form>
      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
