'use client';

import { useActionState } from 'react';

import {
  revealEmergencyContactAction,
  type EmergencyRevealState,
} from '@/app/org-emergency-actions';

const INITIAL: EmergencyRevealState = {};

/**
 * « Contact d'urgence » sur la ligne d'un participant qui l'a partagé (0101).
 * Rien ne s'affiche sans un geste ; ce geste est journalisé.
 */
export function EmergencyContactReveal({
  participantRaceId,
}: {
  readonly participantRaceId: string;
}) {
  const [state, reveal, pending] = useActionState(revealEmergencyContactAction, INITIAL);

  if (state.contact !== undefined) {
    return (
      <span className="pa-emergency" role="status">
        <span className="pa-emergency-label">Contact d’urgence</span>
        <span>
          {state.contact.name}
          {state.contact.relationship === null ? '' : ` · ${state.contact.relationship}`}
        </span>
        <a href={`tel:${state.contact.phone.replace(/[^0-9+]/gu, '')}`}>{state.contact.phone}</a>
        <span className="or-row-meta">Consultation enregistrée.</span>
      </span>
    );
  }

  return (
    <form action={reveal} className="pa-emergency-form">
      <input type="hidden" name="participantRaceId" value={participantRaceId} />
      <button
        type="submit"
        className="pk-btn pk-button-ghost pa-emergency-button"
        disabled={pending}
      >
        Contact d’urgence
      </button>
      {state.error === undefined ? null : (
        <span className="pk-field-error" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
