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
 * formulaire ne fait qu'afficher son refus. Il l'affiche à deux endroits, et
 * la distinction compte : `fieldErrors` pose le refus contre le champ qui l'a
 * causé (06_DESIGN_SYSTEM §35), `error` garde ce qui vaut pour le formulaire
 * entier — un droit manquant, une contrainte de la base, un slug déjà pris.
 *
 * Le `name` de chaque `Input` est la clé de `fieldErrors` parce que c'est
 * aussi le nom du champ de la commande : le formulaire, l'action et le schéma
 * du domaine nomment la même chose de la même façon.
 */
export interface OrganizationOption {
  readonly id: string;
  readonly name: string;
}

/**
 * L'organisation gestionnaire se choisit dans une liste, elle ne se tape pas.
 *
 * Un champ texte attendait un UUID sous le libellé « Organisation
 * gestionnaire » : un nom saisi, ou le remplissage automatique du navigateur
 * — qui reconnaît un champ « organization » —, finissait en « UUID invalide ».
 * L'option vide vaut « Maintenu par PLUKA » ; `text()` la lit comme une
 * absence, et la commande porte `null` (§4.1).
 */
export function CreateEventForm({
  organizations,
}: {
  readonly organizations: readonly OrganizationOption[];
}) {
  const [state, action, pending] = useActionState(createEventAction, INITIAL);
  const organizationError = state.fieldErrors?.['organizationId'];

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '32rem' }}>
      <Input id="event-name" name="name" label="Nom" required error={state.fieldErrors?.['name']} />
      <Input
        id="event-slug"
        name="slug"
        label="Slug"
        required
        hint="Minuscules et tirets."
        error={state.fieldErrors?.['slug']}
      />
      <div className="pk-field">
        <label className="pk-field-label" htmlFor="event-organization">
          Organisation gestionnaire
        </label>
        <select
          id="event-organization"
          name="organizationId"
          className={organizationError === undefined ? 'pk-input' : 'pk-input pk-input-invalid'}
          defaultValue=""
          autoComplete="off"
          aria-invalid={organizationError === undefined ? undefined : true}
          aria-describedby={
            organizationError === undefined
              ? 'event-organization-hint'
              : 'event-organization-hint event-organization-error'
          }
        >
          <option value="">Maintenu par PLUKA</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
        <p id="event-organization-hint" className="pk-field-hint">
          {organizations.length === 0
            ? 'Aucune organisation enregistrée : l’événement sera maintenu par PLUKA.'
            : 'Sans organisation, l’événement est maintenu par PLUKA.'}
        </p>
        {organizationError === undefined ? null : (
          <p id="event-organization-error" className="pk-field-error">
            {organizationError}
          </p>
        )}
      </div>

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
