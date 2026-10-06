'use client';

import type { AdminOrganizationDetailRecord } from '@pluka/db';
import { Input } from '@pluka/ui';
import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';
import { updateOrganizationAction } from '@/app/console-actions';

const INITIAL: ActionState = {};

/**
 * Libellés du prototype, dans l'ordre de vie d'une organisation. Recopiés de
 * `admin-status.tsx` plutôt qu'importés : ce module est serveur, et le
 * formulaire est client.
 */
const STATUS_OPTIONS = [
  { value: 'prospect', label: 'Pilote' },
  { value: 'active', label: 'Actif' },
  { value: 'suspended', label: 'Suspendu' },
  { value: 'archived', label: 'Terminé' },
] as const;

/**
 * Même contrat que `CreateOrganizationForm`. Le slug n'y figure pas : il ne
 * se modifie pas (migration 0031), et la fiche l'affiche au-dessus du
 * formulaire — un champ désactivé laisserait croire le contraire.
 */
export function EditOrganizationForm({
  organization,
}: {
  readonly organization: Pick<
    AdminOrganizationDetailRecord,
    'organizationId' | 'name' | 'slug' | 'status' | 'contactEmail' | 'websiteUrl'
  >;
}) {
  const [state, action, pending] = useActionState(updateOrganizationAction, INITIAL);
  const statusError = state.fieldErrors?.['status'];

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <input type="hidden" name="organizationId" value={organization.organizationId} />

      <Input
        id="organization-name"
        name="name"
        label="Nom"
        required
        autoComplete="off"
        defaultValue={organization.name}
        error={state.fieldErrors?.['name']}
      />

      <Input
        id="organization-contact-email"
        name="contactEmail"
        type="email"
        label="Email de contact (facultatif)"
        autoComplete="off"
        defaultValue={organization.contactEmail ?? ''}
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
        defaultValue={organization.websiteUrl ?? ''}
        error={state.fieldErrors?.['websiteUrl']}
      />

      <div className="pk-field">
        <label className="pk-field-label" htmlFor="organization-status">
          Statut
        </label>
        <select
          id="organization-status"
          name="status"
          className={statusError === undefined ? 'pk-input' : 'pk-input pk-input-invalid'}
          defaultValue={organization.status}
          aria-invalid={statusError === undefined ? undefined : true}
          aria-describedby={
            statusError === undefined
              ? 'organization-status-hint'
              : 'organization-status-hint organization-status-error'
          }
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p id="organization-status-hint" className="pk-field-hint">
          Seule une organisation « Actif » est visible publiquement. Le statut ne retire aucun accès
          à ses membres.
        </p>
        {statusError === undefined ? null : (
          <p id="organization-status-error" className="pk-field-error">
            {statusError}
          </p>
        )}
      </div>

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Enregistrer
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
