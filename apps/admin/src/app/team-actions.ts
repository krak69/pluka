'use server';

import {
  changeOrganizationMemberRole,
  inviteOrganizationMember,
  removeOrganizationMember,
  revokeOrganizationInvitation,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { actionFailure, organizationTeamContext } from '@/lib/admin';
import { checked, text } from '@/lib/form';
import { requireSession } from '@/lib/session';

/**
 * Équipe d'une organisation, depuis la console — migration 0033.
 *
 * Même contrat que `console-actions.ts` : une intention, un acteur, un use
 * case. La garde (pluka_admin ou owner), le dernier owner et l'audit sont dans
 * la base. Chaque succès revient à la fiche avec `?fait=`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La fiche vers laquelle revenir. L'identifiant vient du formulaire : il n'est
 * accepté que sous forme d'UUID, pour qu'aucune valeur postée ne fabrique une
 * redirection ailleurs.
 */
function fichePath(organizationId: string): string {
  return UUID.test(organizationId) ? `/organisations/${organizationId}` : '/organisations';
}

async function contextFor(organizationId: string) {
  return organizationTeamContext(await requireSession(fichePath(organizationId)));
}

function done(organizationId: string, notice: string): never {
  const path = fichePath(organizationId);
  revalidatePath(path);
  revalidatePath('/organisations');
  redirect(`${path}?fait=${notice}`);
}

export async function inviteMemberAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const organizationId = text(form, 'organizationId') ?? '';
  const context = await contextFor(organizationId);

  try {
    await inviteOrganizationMember(context, {
      organizationId,
      email: text(form, 'email'),
      role: text(form, 'role'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  done(organizationId, 'invitation-envoyee');
}

export async function revokeInvitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const organizationId = text(form, 'organizationId') ?? '';
  const context = await contextFor(organizationId);

  try {
    await revokeOrganizationInvitation(context, { invitationId: text(form, 'invitationId') });
  } catch (error) {
    return actionFailure(error);
  }

  done(organizationId, 'invitation-revoquee');
}

export async function changeMemberRoleAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const organizationId = text(form, 'organizationId') ?? '';
  const context = await contextFor(organizationId);

  let changed: boolean;

  try {
    ({ changed } = await changeOrganizationMemberRole(context, {
      organizationId,
      userId: text(form, 'userId'),
      role: text(form, 'role'),
    }));
  } catch (error) {
    return actionFailure(error);
  }

  done(organizationId, changed ? 'role-modifie' : 'role-inchange');
}

export async function removeMemberAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const organizationId = text(form, 'organizationId') ?? '';
  const context = await contextFor(organizationId);

  try {
    await removeOrganizationMember(context, {
      organizationId,
      userId: text(form, 'userId'),
      confirmed: checked(form, 'confirmed'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  done(organizationId, 'membre-retire');
}
