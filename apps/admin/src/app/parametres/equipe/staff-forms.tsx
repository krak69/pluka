'use client';

import { Input } from '@pluka/ui';
import { useActionState, useId } from 'react';

import type { ActionState } from '@/app/actions';
import { changeStaffRoleAction, inviteStaffAction } from '@/app/staff-actions';

import { STAFF_ROLE_OPTIONS } from './staff-roles';

const INITIAL: ActionState = {};

/**
 * Formulaires de l'équipe PLUKA — mêmes formes que ceux de l'équipe d'une
 * organisation : aucune règle ici, la base garde et le domaine valide.
 */

export function InviteStaffForm() {
  const [state, action, pending] = useActionState(inviteStaffAction, INITIAL);
  const roleError = state.fieldErrors?.['staffRole'];

  return (
    <form action={action} className="ad-team-invite">
      <Input
        id="staff-invite-email"
        name="email"
        type="email"
        label="Adresse email"
        required
        autoComplete="off"
        placeholder="prenom@pluka.fr"
        error={state.fieldErrors?.['email']}
      />

      <fieldset
        className="ad-role-choices"
        aria-invalid={roleError === undefined ? undefined : true}
      >
        <legend className="pk-field-label">Rôle</legend>
        {STAFF_ROLE_OPTIONS.map((role) => (
          <label key={role.value} className="ad-role-choice">
            <input
              type="radio"
              name="staffRole"
              value={role.value}
              defaultChecked={role.value === 'support'}
            />
            <span className="ad-role-choice-text">
              <span className="ad-role-choice-label">{role.label}</span>
              <span className="ad-role-choice-description">{role.description}</span>
            </span>
          </label>
        ))}
        {roleError === undefined ? null : <p className="pk-field-error">{roleError}</p>}
      </fieldset>

      <div>
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          Envoyer l’invitation
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

export function StaffRoleForm({
  userId,
  memberName,
  staffRole,
}: {
  readonly userId: string;
  readonly memberName: string;
  readonly staffRole: string;
}) {
  const [state, action, pending] = useActionState(changeStaffRoleAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="ad-team-role">
      <input type="hidden" name="userId" value={userId} />
      <label className="ad-visually-hidden" htmlFor={`${id}-role`}>
        Rôle de {memberName}
      </label>
      <select id={`${id}-role`} name="staffRole" className="pk-input" defaultValue={staffRole}>
        {STAFF_ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
        Changer
      </button>
      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
