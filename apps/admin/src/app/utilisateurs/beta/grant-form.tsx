'use client';

import { useActionState, useId } from 'react';

import type { ActionState } from '@/app/actions';
import { grantBetaAccessAction } from '@/app/beta-actions';

const INITIAL: ActionState = {};

/** Ouvrir l'accès bêta à une liste d'adresses, jusqu'à une date (§14). */
export function GrantBetaForm({ defaultEndsOn }: { readonly defaultEndsOn: string }) {
  const [state, action, pending] = useActionState(grantBetaAccessAction, INITIAL);
  const id = useId();
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="ad-form">
      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-emails`}>
          Adresses des testeurs
        </label>
        <textarea
          id={`${id}-emails`}
          name="emails"
          className="pk-input"
          rows={4}
          placeholder={'camille@exemple.fr\ndana@exemple.fr'}
          aria-describedby={`${id}-emails-hint`}
          required
        />
        <p id={`${id}-emails-hint`} className="pk-field-hint">
          Une par ligne, ou séparées par des virgules. Une adresse sans compte est réservée :
          l’accès s’ouvre quand la personne crée son compte avec elle.
        </p>
        {errors['emails'] === undefined ? null : (
          <p className="pk-field-error" role="alert">
            {errors['emails']}
          </p>
        )}
      </div>

      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-ends`}>
          Dernier jour d’accès
        </label>
        <input
          id={`${id}-ends`}
          name="endsOn"
          type="date"
          className="pk-input"
          defaultValue={defaultEndsOn}
          required
        />
        {errors['endsOn'] === undefined ? null : (
          <p className="pk-field-error" role="alert">
            {errors['endsOn']}
          </p>
        )}
      </div>

      <div className="pk-field">
        <label className="pk-field-label" htmlFor={`${id}-reason`}>
          Raison (facultatif)
        </label>
        <input
          id={`${id}-reason`}
          name="reason"
          className="pk-input"
          maxLength={200}
          placeholder="Bêta de novembre"
        />
      </div>

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Ouverture…' : 'Ouvrir l’accès bêta'}
        </button>
      </div>

      {state.done === undefined ? null : (
        <p className="pk-body" role="status">
          {state.done}
        </p>
      )}
      {state.error === undefined || state.fieldErrors !== undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
