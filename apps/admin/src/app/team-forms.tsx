'use client';

import { Input } from '@pluka/ui';
import { useActionState, useId } from 'react';

import type { ActionState } from '@/app/actions';
import { changeMemberRoleAction, inviteMemberAction } from '@/app/team-actions';

const INITIAL: ActionState = {};

export interface RoleOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

/**
 * Inviter une adresse avec un rôle. Aucune règle ici : le domaine valide, la
 * base garde, et le refus revient contre le champ qui l'a causé.
 *
 * Le rôle se choisit parmi quatre options décrites (`fieldset` de radios) :
 * la description est ce qui permet de choisir, elle doit se lire à côté de
 * l'option, pas dans un paragraphe sous une liste déroulante.
 */
export function InviteMemberForm({
  organizationId,
  roles,
  defaultRole = 'viewer',
}: {
  readonly organizationId: string;
  readonly roles: readonly RoleOption[];
  readonly defaultRole?: string;
}) {
  const [state, action, pending] = useActionState(inviteMemberAction, INITIAL);
  const roleError = state.fieldErrors?.['role'];
  const id = useId();

  return (
    <form action={action} className="ad-team-invite">
      <input type="hidden" name="organizationId" value={organizationId} />

      <Input
        id="team-invite-email"
        name="email"
        type="email"
        label="Adresse email"
        required
        autoComplete="off"
        placeholder="prenom@organisation.fr"
        error={state.fieldErrors?.['email']}
      />

      <fieldset
        className="ad-role-choices"
        aria-invalid={roleError === undefined ? undefined : true}
        aria-describedby={roleError === undefined ? undefined : `${id}-role-error`}
      >
        <legend className="pk-field-label">Rôle</legend>
        {roles.map((role) => (
          <label key={role.value} className="ad-role-choice">
            <input
              type="radio"
              name="role"
              value={role.value}
              defaultChecked={role.value === defaultRole}
            />
            <span className="ad-role-choice-text">
              <span className="ad-role-choice-label">{role.label}</span>
              <span className="ad-role-choice-description">{role.description}</span>
            </span>
          </label>
        ))}
        {roleError === undefined ? null : (
          <p id={`${id}-role-error`} className="pk-field-error">
            {roleError}
          </p>
        )}
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

/** Changer le rôle d'un membre : une liste et un bouton, le refus à côté. */
export function MemberRoleForm({
  organizationId,
  userId,
  memberName,
  role,
  roles,
}: {
  readonly organizationId: string;
  readonly userId: string;
  readonly memberName: string;
  readonly role: string;
  readonly roles: readonly RoleOption[];
}) {
  const [state, action, pending] = useActionState(changeMemberRoleAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="ad-team-role">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="userId" value={userId} />

      <label className="ad-visually-hidden" htmlFor={`${id}-role`}>
        Rôle de {memberName}
      </label>
      <select id={`${id}-role`} name="role" className="pk-input" defaultValue={role}>
        {roles.map((option) => (
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
