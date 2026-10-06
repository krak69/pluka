'use client';

import { Input } from '@pluka/ui';
import { useActionState, useId } from 'react';

import {
  changeTeamMemberRoleAction,
  inviteTeamMemberAction,
  removeTeamMemberAction,
  revokeTeamInvitationAction,
  type TeamActionState,
} from '@/app/team-actions';
import { TEAM_ROLES } from '@/lib/team-roles';

const INITIAL: TeamActionState = {};

/**
 * Formulaires de l'équipe, côté organisateur — migration 0033.
 *
 * Client Components pour une seule raison : `useActionState` rend le refus de
 * la base à côté du geste qui l'a provoqué. Aucune règle ici — dernier
 * propriétaire, droit de gérer, format d'adresse : tout est tranché plus bas.
 */

export function InviteTeamMemberForm({ organizationId }: { readonly organizationId: string }) {
  const [state, action, pending] = useActionState(inviteTeamMemberAction, INITIAL);

  return (
    <form action={action} className="or-form">
      <input type="hidden" name="organizationId" value={organizationId} />

      <Input
        id="team-invite-email"
        name="email"
        type="email"
        label="Adresse email"
        required
        autoComplete="off"
        error={state.fieldErrors?.['email']}
      />

      <div className="pk-field">
        <label className="pk-field-label" htmlFor="team-invite-role">
          Rôle
        </label>
        <select
          id="team-invite-role"
          name="role"
          className="pk-input"
          defaultValue="viewer"
          aria-describedby="team-invite-role-hint"
        >
          {TEAM_ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        <p id="team-invite-role-hint" className="pk-field-hint">
          {TEAM_ROLES.map((role) => `${role.label} : ${role.description}`).join(' ')}
        </p>
      </div>

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

export function TeamMemberRoleForm({
  organizationId,
  userId,
  memberName,
  role,
}: {
  readonly organizationId: string;
  readonly userId: string;
  readonly memberName: string;
  readonly role: string;
}) {
  const [state, action, pending] = useActionState(changeTeamMemberRoleAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="or-inline-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="userId" value={userId} />

      <label className="or-visually-hidden" htmlFor={`${id}-role`}>
        Rôle de {memberName}
      </label>
      <select id={`${id}-role`} name="role" className="pk-input" defaultValue={role}>
        {TEAM_ROLES.map((option) => (
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

/** Retrait confirmé par une case, revérifiée par le domaine. */
export function RemoveTeamMemberForm({
  organizationId,
  userId,
  memberName,
}: {
  readonly organizationId: string;
  readonly userId: string;
  readonly memberName: string;
}) {
  const [state, action, pending] = useActionState(removeTeamMemberAction, INITIAL);
  const id = useId();
  const confirmError = state.fieldErrors?.['confirmed'];

  return (
    <form action={action} className="or-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="userId" value={userId} />

      <label className="or-confirm" htmlFor={`${id}-confirm`}>
        <input
          id={`${id}-confirm`}
          type="checkbox"
          name="confirmed"
          aria-invalid={confirmError === undefined ? undefined : true}
        />
        <span>Je confirme retirer {memberName} : ses accès cessent immédiatement</span>
      </label>
      {confirmError === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {confirmError}
        </p>
      )}

      <div>
        <button type="submit" className="pk-btn pk-button-destructive" disabled={pending}>
          Retirer de l’équipe
        </button>
      </div>

      {state.error === undefined || confirmError !== undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RevokeTeamInvitationForm({
  organizationId,
  invitationId,
}: {
  readonly organizationId: string;
  readonly invitationId: string;
}) {
  const [state, action, pending] = useActionState(revokeTeamInvitationAction, INITIAL);

  return (
    <form action={action} className="or-inline-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
        Révoquer
      </button>
      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
