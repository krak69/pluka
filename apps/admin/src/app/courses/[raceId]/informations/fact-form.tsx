'use client';

import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';
import { reviseFactAction } from '@/app/fact-actions';

/**
 * Corriger une information publiée — migration 0043.
 *
 * Prérempli de la version courante ; chaque part de la valeur se modifie.
 * Enregistrer publie la version suivante. Aucune règle ici : le domaine
 * valide, la base garde l'autorité et refuse une correction qui ne change
 * rien.
 */

const INITIAL: ActionState = {};

export interface FactFormValues {
  readonly raceId: string;
  readonly factId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly trustLevel: string;
}

export function FactForm({ fact }: { readonly fact: FactFormValues }) {
  const [state, action, pending] = useActionState(reviseFactAction, INITIAL);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="ad-org-panel" aria-labelledby="fact-edit-title">
      <h2 id="fact-edit-title" className="ad-org-panel-title">
        Corriger
      </h2>
      <input type="hidden" name="raceId" value={fact.raceId} />
      <input type="hidden" name="factId" value={fact.factId} />

      <div className="pk-field">
        <label className="pk-field-label" htmlFor="fact-text">
          Texte
        </label>
        <textarea
          id="fact-text"
          name="valueText"
          className="pk-input"
          rows={3}
          defaultValue={fact.valueText ?? ''}
          aria-invalid={errors['valueText'] === undefined ? undefined : true}
          aria-describedby={errors['valueText'] === undefined ? undefined : 'fact-text-error'}
        />
        {errors['valueText'] === undefined ? null : (
          <p id="fact-text-error" className="pk-field-error">
            {errors['valueText']}
          </p>
        )}
      </div>

      <div className="ad-form-grid">
        <Input
          id="fact-number"
          name="valueNumber"
          label="Nombre"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={fact.valueNumber === null ? '' : String(fact.valueNumber)}
          error={errors['valueNumber']}
        />
        <Input
          id="fact-unit"
          name="unit"
          label="Unité"
          autoComplete="off"
          defaultValue={fact.unit ?? ''}
          error={errors['unit']}
        />
        <div className="pk-field">
          <label className="pk-field-label" htmlFor="fact-trust">
            Niveau de confiance
          </label>
          <select
            id="fact-trust"
            name="trustLevel"
            className="pk-input"
            defaultValue={fact.trustLevel === 'official' ? 'official' : 'pluka_validated'}
          >
            <option value="pluka_validated">Validée PLUKA</option>
            <option value="official">Officielle — au nom de l’organisation</option>
          </select>
        </div>
      </div>

      <Input
        id="fact-note"
        name="note"
        label="Motif de la correction (facultatif)"
        autoComplete="off"
        hint="Inscrit à l’historique de l’information."
        error={errors['note']}
      />

      <div className="ad-form-actions">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Publier la correction'}
        </button>
      </div>

      {state.error === undefined || state.fieldErrors !== undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
