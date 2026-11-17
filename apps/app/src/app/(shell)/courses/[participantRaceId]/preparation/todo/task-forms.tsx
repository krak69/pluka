'use client';

import type { MyTaskView } from '@pluka/domain';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import {
  createTaskAction,
  deleteTaskAction,
  removeSuggestionAction,
  setSuggestionDoneAction,
  setTaskDoneAction,
  updateTaskAction,
  type TaskActionState,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/todo/actions';
import { Icon } from '@/components/icon';

const INITIAL: TaskActionState = {};

function ErrorLine({ id, state }: { readonly id: string; readonly state: TaskActionState }) {
  return state.error === undefined ? null : (
    <p id={id} className="pk-field-error td-error" role="alert">
      {state.error}
    </p>
  );
}

/** « Ajouter une tâche… » — prototype, en tête de l'onglet, avec une échéance facultative. */
export function AddTaskForm({ participantRaceId }: { readonly participantRaceId: string }) {
  const [state, add, pending] = useActionState(createTaskAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const describedBy = state.error === undefined ? undefined : `${id}-error`;

  // Une tâche ajoutée vide le champ ; un refus le laisse tel quel, à corriger.
  useEffect(() => {
    if (!pending && state.error === undefined) form.current?.reset();
  }, [pending, state]);

  return (
    <form ref={form} action={add} className="td-add">
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <label htmlFor={`${id}-title`} className="pk-visually-hidden">
        Nouvelle tâche
      </label>
      <input
        id={`${id}-title`}
        name="title"
        className="eq-add-input td-add-title"
        placeholder="Ajouter une tâche…"
        maxLength={120}
        required
        autoComplete="off"
        aria-describedby={describedBy}
      />
      <label htmlFor={`${id}-due`} className="pk-visually-hidden">
        Échéance (facultative)
      </label>
      <input
        id={`${id}-due`}
        name="dueDay"
        type="date"
        className="eq-add-input td-due"
        title="Échéance (facultative)"
        aria-describedby={describedBy}
      />
      <button type="submit" className="pk-btn pk-button-primary td-add-button" disabled={pending}>
        <Icon name="Plus" size={16} /> Ajouter
      </button>
      <ErrorLine id={`${id}-error`} state={state} />
    </form>
  );
}

/**
 * Le délai, compté depuis aujourd'hui (décision produit du 2026-11-17). Pas de
 * « J-x » : dans PLUKA, « J » est le jour de la course.
 */
function delay(days: number): string {
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  if (days > 1) return `dans ${String(days)} jours`;
  return days === -1 ? 'en retard d’1 jour' : `en retard de ${String(-days)} jours`;
}

/** « jeu. 19 nov. » — l'année seulement quand elle diffère de celle d'aujourd'hui. */
function calendarDay(day: string, daysLeft: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  const today = new Date(date.getTime() - daysLeft * 86_400_000);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getUTCFullYear() === today.getUTCFullYear() ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date);
}

function Check({ on }: { readonly on: boolean }) {
  return (
    <span className={on ? 'eq-box eq-box-on' : 'eq-box'} aria-hidden="true">
      {on ? <Icon name="Check" size={14} /> : null}
    </span>
  );
}

function EditTaskForm({
  participantRaceId,
  task,
  onDone,
}: {
  readonly participantRaceId: string;
  readonly task: MyTaskView;
  readonly onDone: () => void;
}) {
  const [state, update, pending] = useActionState(updateTaskAction, INITIAL);
  const answered = useRef(state);
  const id = useId();
  const describedBy = state.error === undefined ? undefined : `${id}-error`;

  // Chaque réponse est un nouvel objet : enregistrée sans refus, la ligne
  // reprend sa forme normale.
  useEffect(() => {
    if (state === answered.current) return;
    answered.current = state;
    if (state.error === undefined) onDone();
  }, [state, onDone]);

  return (
    <form action={update} className="td-edit">
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="key" value={task.suggestionKey ?? ''} />
      {/* Une suggestion garde le titre de PLUKA : seule sa date se choisit. */}
      {task.suggestionKey === null ? (
        <>
          <label htmlFor={`${id}-title`} className="pk-visually-hidden">
            Titre de la tâche
          </label>
          <input
            id={`${id}-title`}
            name="title"
            className="eq-add-input td-add-title"
            defaultValue={task.title}
            maxLength={120}
            required
            autoComplete="off"
            autoFocus
            aria-describedby={describedBy}
          />
        </>
      ) : (
        <span className="td-edit-title">{task.title}</span>
      )}
      <label htmlFor={`${id}-due`} className="pk-visually-hidden">
        Échéance de « {task.title} » (facultative)
      </label>
      <input
        id={`${id}-due`}
        name="dueDay"
        type="date"
        className="eq-add-input td-due"
        defaultValue={task.dueDay ?? ''}
        autoFocus={task.suggestionKey !== null}
        aria-describedby={describedBy}
      />
      <button type="submit" className="pk-btn pk-button-secondary td-row-button" disabled={pending}>
        Enregistrer
      </button>
      <button type="button" className="pk-btn pk-button-ghost td-row-button" onClick={onDone}>
        Annuler
      </button>
      <ErrorLine id={`${id}-error`} state={state} />
    </form>
  );
}

/**
 * Une ligne de « Mes tâches ». Une suggestion ajoutée se coche, se date et se
 * retire sans Race Pass ; une tâche du coureur se coche, se modifie et se
 * supprime avec. Les cases sont de vrais boutons de formulaire (`aria-pressed`).
 */
export function TaskRow({
  task,
  participantRaceId,
  canEdit,
}: {
  readonly task: MyTaskView;
  readonly participantRaceId: string;
  readonly canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const isSuggestion = task.suggestionKey !== null;
  const canToggle = isSuggestion || canEdit;

  if (editing) {
    return (
      <li className="td-row">
        <EditTaskForm
          participantRaceId={participantRaceId}
          task={task}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const label = (
    <span className={task.done ? 'eq-label eq-label-done' : 'eq-label'}>{task.title}</span>
  );

  return (
    <li className="td-row">
      {canToggle ? (
        <form
          action={isSuggestion ? setSuggestionDoneAction : setTaskDoneAction}
          className="eq-toggle td-grow"
        >
          <input type="hidden" name="participantRaceId" value={participantRaceId} />
          {isSuggestion ? (
            <input type="hidden" name="key" value={task.suggestionKey ?? ''} />
          ) : (
            <input type="hidden" name="taskId" value={task.id} />
          )}
          <input type="hidden" name="done" value={task.done ? 'false' : 'true'} />
          <button type="submit" className="eq-check td-check" aria-pressed={task.done}>
            <Check on={task.done} />
            {label}
          </button>
        </form>
      ) : (
        <span className="eq-check td-check td-grow">
          <Check on={task.done} />
          {label}
        </span>
      )}

      {task.dueDay === null || task.daysLeft === null ? null : (
        <span className="td-due-text">
          {calendarDay(task.dueDay, task.daysLeft)}
          {/* Une tâche faite n'est plus « en retard » : sa date suffit. */}
          {task.done ? null : (
            <span className={task.daysLeft < 0 ? 'td-late' : undefined}>
              {' · '}
              {delay(task.daysLeft)}
            </span>
          )}
        </span>
      )}

      {isSuggestion || canEdit ? (
        <button
          type="button"
          className="td-icon"
          aria-label={
            isSuggestion
              ? `Choisir l’échéance : ${task.title}`
              : `Modifier la tâche : ${task.title}`
          }
          onClick={() => setEditing(true)}
        >
          <Icon name="PencilSimple" size={16} />
        </button>
      ) : null}

      {isSuggestion || canEdit ? (
        <form action={isSuggestion ? removeSuggestionAction : deleteTaskAction}>
          <input type="hidden" name="participantRaceId" value={participantRaceId} />
          {isSuggestion ? (
            <input type="hidden" name="key" value={task.suggestionKey ?? ''} />
          ) : (
            <input type="hidden" name="taskId" value={task.id} />
          )}
          <button
            type="submit"
            className="td-icon td-icon-danger"
            aria-label={
              isSuggestion
                ? `Retirer de mes tâches : ${task.title}`
                : `Supprimer la tâche : ${task.title}`
            }
          >
            <Icon name="Trash" size={16} />
          </button>
        </form>
      ) : null}
    </li>
  );
}
