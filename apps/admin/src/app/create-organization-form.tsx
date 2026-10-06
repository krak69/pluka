'use client';

import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';
import { createOrganizationAction } from '@/app/console-actions';

const INITIAL: ActionState = {};

/**
 * Même contrat que `CreateEventForm` : aucune règle ici, le schéma de
 * `createOrganization` valide et ce formulaire affiche son refus — contre le
 * champ quand il en nomme un, en tête sinon.
 *
 * Le statut ne se choisit pas : la ligne prend le défaut de la colonne
 * (migration 0030). L'indication le dit, pour qu'il ne soit pas une surprise.
 */
export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, INITIAL);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <Input
        id="organization-name"
        name="name"
        label="Nom"
        required
        autoComplete="off"
        error={state.fieldErrors?.['name']}
      />
      <Input
        id="organization-slug"
        name="slug"
        label="Slug"
        required
        autoComplete="off"
        hint="Minuscules et tirets."
        error={state.fieldErrors?.['slug']}
      />
      <Input
        id="organization-contact-email"
        name="contactEmail"
        type="email"
        label="Email de contact (facultatif)"
        autoComplete="off"
        hint="Une adresse de l’organisation, pas celle d’une personne."
        error={state.fieldErrors?.['contactEmail']}
      />
      <Input
        id="organization-website"
        name="websiteUrl"
        type="url"
        label="Site web (facultatif)"
        autoComplete="off"
        placeholder="https://"
        error={state.fieldErrors?.['websiteUrl']}
      />

      <p className="pk-field-hint">L’organisation est créée au statut « Actif », sans membre.</p>

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Créer l’organisation
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
