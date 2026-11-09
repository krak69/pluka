'use client';

import { Button, Input } from '@pluka/ui';
import { useActionState, useEffect, useRef } from 'react';

import {
  addCalibrationPairAction,
  removeCalibrationPairAction,
  type CalibrationActionState,
} from '@/app/repere-actions';

const INITIAL: CalibrationActionState = {};

/** Une sortie, puis une course faite ensuite : le couple qui calibre le Repère. */
export function CalibrationPairForm() {
  const [state, action, pending] = useActionState(addCalibrationPairAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};

  // Un couple enregistré vide le formulaire, pour en saisir un autre.
  useEffect(() => {
    if (state.done === true) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="rp-form">
      <h2 className="pk-h2">Ajouter un couple</h2>

      <fieldset className="rp-pair-fieldset">
        <legend className="pk-label">La sortie de référence</legend>
        <Input id="cal-ref-distance" name="referenceDistance" label="Distance (km)" inputMode="decimal" required />
        <Input id="cal-ref-elevation" name="referenceElevation" label="D+ (m)" inputMode="numeric" required />
        <Input
          id="cal-ref-duration"
          name="referenceDuration"
          label="Temps"
          hint="H:MM, arrêts compris."
          placeholder="2:30"
          required
        />
        <Input
          id="cal-ref-date"
          name="referenceDate"
          type="date"
          label="Date"
          required
          error={errors['referenceDate']}
        />
      </fieldset>

      <fieldset className="rp-pair-fieldset">
        <legend className="pk-label">La course courue ensuite</legend>
        <Input id="cal-course-distance" name="courseDistance" label="Distance (km)" inputMode="decimal" required />
        <Input id="cal-course-elevation" name="courseElevation" label="D+ (m)" inputMode="numeric" required />
        <Input
          id="cal-course-duration"
          name="courseDuration"
          label="Temps à l’arrivée"
          hint="H:MM, arrêts compris."
          placeholder="5:40"
          required
        />
        <Input
          id="cal-course-date"
          name="courseDate"
          type="date"
          label="Date"
          required
          error={errors['courseDate']}
        />
      </fieldset>

      <div className="rp-form-actions">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Ajouter ce couple'}
        </Button>
      </div>

      {state.done === true ? (
        <p className="pk-body" role="status">
          Couple ajouté. Merci, tu peux en ajouter un autre.
        </p>
      ) : null}
      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RemovePairForm({ pairId }: { readonly pairId: string }) {
  const [state, action, pending] = useActionState(removeCalibrationPairAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="pairId" value={pairId} />
      <button type="submit" className="pk-btn pk-button-ghost" disabled={pending}>
        Supprimer
      </button>
      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
