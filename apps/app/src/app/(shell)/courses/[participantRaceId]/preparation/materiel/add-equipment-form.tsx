'use client';

import { useActionState, useEffect, useRef } from 'react';

import {
  addPersonalEquipmentAction,
  type EquipmentActionState,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/materiel/actions';

const INITIAL: EquipmentActionState = {};

/** Ajout d'une pièce personnelle — prototype, « Ajouter un élément à mon matériel… ». */
export function AddEquipmentForm({ participantRaceId }: { readonly participantRaceId: string }) {
  const [state, add, pending] = useActionState(addPersonalEquipmentAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);

  // Une pièce ajoutée vide le champ ; un refus le laisse tel quel, à corriger.
  useEffect(() => {
    if (!pending && state.error === undefined) form.current?.reset();
  }, [pending, state]);

  return (
    <form ref={form} action={add} className="eq-add">
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <label htmlFor="eq-new" className="pk-visually-hidden">
        Ajouter un élément à mon matériel
      </label>
      <input
        id="eq-new"
        name="label"
        className="eq-add-input"
        placeholder="Ajouter un élément à mon matériel…"
        maxLength={120}
        required
        aria-describedby={state.error === undefined ? undefined : 'eq-add-error'}
      />
      <button type="submit" className="pk-btn pk-button-primary eq-add-button" disabled={pending}>
        + Ajouter
      </button>
      {state.error === undefined ? null : (
        <p id="eq-add-error" className="pk-field-error eq-add-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
