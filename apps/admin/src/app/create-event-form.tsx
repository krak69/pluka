'use client';

import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import { createEventAction, type ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/**
 * Client Component, et seulement pour ça : `useActionState` restitue le
 * message d'erreur du domaine sans recharger la page ni le faire transiter
 * par l'URL (01_ARCHITECTURE §6.2 — le client est réservé aux interactions
 * qui le nécessitent).
 *
 * Aucune règle métier ici : la validation appartient au use case, et ce
 * formulaire ne fait qu'afficher son refus.
 */
export function CreateEventForm() {
  const [state, action, pending] = useActionState(createEventAction, INITIAL);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <Input id="event-name" name="name" label="Nom" required />
      <Input id="event-slug" name="slug" label="Slug" required hint="Minuscules et tirets." />
      <Input
        id="event-organization"
        name="organizationId"
        label="Organisation gestionnaire"
        hint="Laisser vide pour un événement maintenu par PLUKA."
      />

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Créer l’événement
        </button>
      </div>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
