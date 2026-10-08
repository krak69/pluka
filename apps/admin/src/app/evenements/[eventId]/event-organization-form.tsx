'use client';

import { useActionState, useId, useState } from 'react';

import type { ActionState } from '@/app/actions';
import { changeEventOrganizationAction } from '@/app/console-actions';

const INITIAL: ActionState = {};

export interface OrganizationOption {
  readonly id: string;
  readonly name: string;
}

/**
 * Changer l'organisation qui gère l'événement — migration 0044.
 *
 * Rendu pour le seul super-admin : pour les autres, la fiche dit qui peut le
 * faire. La base refuserait de toute façon — ce formulaire n'est pas la garde.
 *
 * Le geste déplace l'accès organisateur d'un bloc ; la phrase qui précède la
 * case le dit avant le clic, et dit aussi ce qui ne bouge pas. Le bouton ne
 * s'active qu'une fois une autre organisation choisie : soumettre la même
 * serait un aller-retour pour rien.
 */
export function EventOrganizationForm({
  eventId,
  currentOrganizationId,
  organizations,
}: {
  readonly eventId: string;
  readonly currentOrganizationId: string | null;
  readonly organizations: readonly OrganizationOption[];
}) {
  const [state, action, pending] = useActionState(changeEventOrganizationAction, INITIAL);
  const current = currentOrganizationId ?? '';
  const [choice, setChoice] = useState(current);
  const id = useId();
  const confirmError = state.fieldErrors?.['confirmed'];
  const error = confirmError === undefined ? state.error : undefined;
  const target =
    choice === ''
      ? 'PLUKA (sans organisation)'
      : (organizations.find((organization) => organization.id === choice)?.name ?? '');

  return (
    <form action={action} className="ad-event-form">
      <input type="hidden" name="eventId" value={eventId} />

      <div className="pk-field">
        <label htmlFor={`${id}-organization`} className="pk-field-label">
          Organisation gestionnaire
        </label>
        <select
          id={`${id}-organization`}
          name="organizationId"
          className="pk-input"
          value={choice}
          onChange={(change) => setChoice(change.target.value)}
        >
          <option value="">Aucune — maintenu par PLUKA</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </div>

      {choice === current ? null : (
        <>
          <ul className="ad-event-effects" aria-label="Effets du changement">
            <li>
              <strong>{target}</strong> gère l’événement : son équipe voit ses épreuves et leurs
              inscrits, et peut publier des informations « Officielle ».
            </li>
            <li>
              {current === ''
                ? 'Aucune organisation ne perd d’accès.'
                : 'L’organisation actuelle perd ces accès immédiatement.'}
            </li>
            <li>
              Ne bougent pas : les imports de participants déjà faits, la provenance des
              informations publiées, les droits des coureurs.
            </li>
          </ul>

          <label className="ad-confirm" htmlFor={`${id}-confirm`}>
            <input
              id={`${id}-confirm`}
              type="checkbox"
              name="confirmed"
              aria-invalid={confirmError === undefined ? undefined : true}
              aria-describedby={confirmError === undefined ? undefined : `${id}-confirm-error`}
            />
            <span>Je confirme confier cet événement à {target}</span>
          </label>
          {confirmError === undefined ? null : (
            <p id={`${id}-confirm-error`} className="pk-field-error">
              {confirmError}
            </p>
          )}
        </>
      )}

      <div className="ad-form-actions">
        <button
          type="submit"
          className="pk-btn pk-button-secondary"
          disabled={pending || choice === current}
        >
          {pending ? 'Changement…' : 'Changer l’organisation'}
        </button>
      </div>

      {error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
