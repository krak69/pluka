'use client';

import { useActionState, useEffect, useRef } from 'react';

import {
  addToMyEquipmentAction,
  type LibraryActionState,
} from '@/app/(shell)/bibliotheque/materiel/actions';

const INITIAL: LibraryActionState = {};

/** Ajouter à « Mon matériel » — une ou plusieurs pièces, une par ligne. */
export function AddToLibraryForm() {
  const [state, add, pending] = useActionState(addToMyEquipmentAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.saved === true) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={add} className="lb-form">
      <label htmlFor="lb-labels" className="pk-label">
        Ajouter du matériel, une pièce par ligne
      </label>
      <textarea
        id="lb-labels"
        name="labels"
        className="lb-input lb-textarea"
        placeholder={'Lunettes catégorie 3\nBatterie externe + câble\nBâtons pliants'}
        rows={4}
        required
        aria-describedby={state.error === undefined ? undefined : 'lb-labels-error'}
      />
      {state.error === undefined ? null : (
        <p id="lb-labels-error" className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
        Ajouter à mon matériel
      </button>
    </form>
  );
}
