'use server';

import {
  DomainError,
  STAFF_OTHER_EMAIL_REASON,
  acceptStaffInvitation,
  changeStaffRole,
  inviteStaffMember,
  removeStaffMember,
  revokeStaffInvitation,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { actionFailure, staffTeamContext } from '@/lib/admin';
import { checked, text } from '@/lib/form';
import { requireSession } from '@/lib/session';

/**
 * Équipe PLUKA — migrations 0035, 0036.
 *
 * Même contrat que `console-actions.ts` : une intention, un acteur, un use
 * case. La garde super-admin, le dernier super-admin et l'audit sont en base.
 * Chaque succès revient à la page avec `?fait=`.
 */

const TEAM = '/parametres/equipe';

async function context() {
  return staffTeamContext(await requireSession(TEAM));
}

function done(notice: string): never {
  revalidatePath(TEAM);
  redirect(`${TEAM}?fait=${notice}`);
}

export async function inviteStaffAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await inviteStaffMember(await context(), {
      email: text(form, 'email'),
      staffRole: text(form, 'staffRole'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  done('invitation-envoyee');
}

export async function revokeStaffInvitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await revokeStaffInvitation(await context(), { invitationId: text(form, 'invitationId') });
  } catch (error) {
    return actionFailure(error);
  }

  done('invitation-revoquee');
}

export async function changeStaffRoleAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let changed: boolean;

  try {
    ({ changed } = await changeStaffRole(await context(), {
      userId: text(form, 'userId'),
      staffRole: text(form, 'staffRole'),
    }));
  } catch (error) {
    return actionFailure(error);
  }

  done(changed ? 'role-modifie' : 'role-inchange');
}

export async function removeStaffAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await removeStaffMember(await context(), {
      userId: text(form, 'userId'),
      confirmed: checked(form, 'confirmed'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  done('acces-admin-retire');
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Accepter une invitation à l'équipe PLUKA. Le jeton revient du formulaire de
 * la page d'invitation ; seul son hash part en base. L'issue revient à la page
 * sous `?etat=`.
 */
export async function acceptStaffInvitationAction(form: FormData): Promise<void> {
  const raw = form.get('token');
  const token = typeof raw === 'string' && TOKEN.test(raw) ? raw : null;
  if (token === null) redirect('/connexion');

  const page = `/invitation-equipe/${token}`;
  const session = await requireSession(page);

  let state: string;

  try {
    await acceptStaffInvitation(staffTeamContext(session), { token });
    state = 'rejoint';
  } catch (error) {
    if (error instanceof DomainError && error.details['reason'] === STAFF_OTHER_EMAIL_REASON) {
      state = 'autre-adresse';
    } else if (error instanceof DomainError) {
      state = 'impossible';
    } else {
      console.error('acceptation d’invitation PLUKA : erreur non traduite', {
        name: error instanceof Error ? error.name : 'inconnu',
      });
      state = 'erreur';
    }
  }

  redirect(`${page}?etat=${state}`);
}
