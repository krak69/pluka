'use client';

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { ActionState } from '@/app/actions';
import {
  addAssistantAction,
  updateAssistantAction,
} from '@/app/(shell)/courses/[participantRaceId]/assistance/actions';

const INITIAL: ActionState = {};

type Action = (previous: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Un geste de l'écran Assistance : la participation part toujours, le refus
 * revient à côté du formulaire. `resetOnSuccess` vide un champ d'ajout une
 * fois la ligne enregistrée ; un refus le laisse tel quel, à corriger.
 */
export function ActionForm({
  action,
  participantRaceId,
  className,
  resetOnSuccess = false,
  children,
}: {
  readonly action: Action;
  readonly participantRaceId: string;
  readonly className?: string;
  readonly resetOnSuccess?: boolean;
  readonly children: ReactNode;
}) {
  const [state, run, pending] = useActionState(action, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const answered = useRef(state);
  const id = useId();

  useEffect(() => {
    if (state === answered.current) return;
    answered.current = state;
    if (resetOnSuccess && state.error === undefined) form.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={form}
      action={run}
      className={className}
      aria-busy={pending}
      aria-describedby={state.error === undefined ? undefined : `${id}-error`}
    >
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      {children}
      {state.error === undefined ? null : (
        <p id={`${id}-error`} className="pk-field-error as-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

function PersonFields({
  initial,
}: {
  readonly initial?: { firstName: string; lastName: string | null; phone: string | null };
}) {
  const id = useId();
  return (
    <div className="as-person-fields">
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-first`}>
          Prénom
        </label>
        <input
          id={`${id}-first`}
          name="firstName"
          className="pk-input"
          required
          maxLength={60}
          autoComplete="off"
          defaultValue={initial?.firstName ?? ''}
        />
      </div>
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-last`}>
          Nom <span className="as-optional">(facultatif)</span>
        </label>
        <input
          id={`${id}-last`}
          name="lastName"
          className="pk-input"
          maxLength={60}
          autoComplete="off"
          defaultValue={initial?.lastName ?? ''}
        />
      </div>
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-phone`}>
          Téléphone <span className="as-optional">(facultatif)</span>
        </label>
        <input
          id={`${id}-phone`}
          name="phone"
          type="tel"
          className="pk-input"
          maxLength={30}
          autoComplete="off"
          defaultValue={initial?.phone ?? ''}
        />
      </div>
    </div>
  );
}

/** « Ajouter une personne » — la seule action Lichen de l'écran (AGENTS §43). */
export function AddPersonForm({ participantRaceId }: { readonly participantRaceId: string }) {
  return (
    <ActionForm
      action={addAssistantAction}
      participantRaceId={participantRaceId}
      className="as-add-person"
      resetOnSuccess
    >
      <PersonFields />
      <button type="submit" className="pk-btn pk-button-primary">
        Ajouter cette personne
      </button>
    </ActionForm>
  );
}

/** Le nom et le téléphone d'une personne, modifiables sur place. */
export function PersonHeader({
  participantRaceId,
  person,
  canEdit,
}: {
  readonly participantRaceId: string;
  readonly person: { id: string; firstName: string; lastName: string | null; phone: string | null };
  readonly canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ');

  if (editing) {
    return (
      <EditPerson
        participantRaceId={participantRaceId}
        person={person}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <header className="as-person-head">
      <div>
        <h2 className="as-person-name">{name}</h2>
        {person.phone === null ? null : (
          <a className="as-person-phone" href={`tel:${person.phone.replace(/[^0-9+]/gu, '')}`}>
            {person.phone}
          </a>
        )}
      </div>
      {canEdit ? (
        <button
          type="button"
          className="pk-btn pk-button-ghost"
          aria-label={`Modifier ${name}`}
          onClick={() => setEditing(true)}
        >
          Modifier
        </button>
      ) : null}
    </header>
  );
}

function EditPerson({
  participantRaceId,
  person,
  onDone,
}: {
  readonly participantRaceId: string;
  readonly person: { id: string; firstName: string; lastName: string | null; phone: string | null };
  readonly onDone: () => void;
}) {
  const [state, update, pending] = useActionState(updateAssistantAction, INITIAL);
  const answered = useRef(state);

  // Enregistrée sans refus, la fiche reprend sa forme normale.
  useEffect(() => {
    if (state === answered.current) return;
    answered.current = state;
    if (state.error === undefined) onDone();
  }, [state, onDone]);

  return (
    <form action={update} className="as-person-edit" aria-busy={pending}>
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <input type="hidden" name="assistantId" value={person.id} />
      <PersonFields initial={person} />
      <div className="as-row-actions">
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          Enregistrer
        </button>
        <button type="button" className="pk-btn pk-button-ghost" onClick={onDone}>
          Annuler
        </button>
      </div>
      {state.error === undefined ? null : (
        <p className="pk-field-error as-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
