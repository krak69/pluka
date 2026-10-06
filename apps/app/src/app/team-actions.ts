'use server';

import {
  DomainError,
  OTHER_EMAIL_REASON,
  acceptOrganizationInvitation,
  changeOrganizationMemberRole,
  inviteOrganizationMember,
  removeOrganizationMember,
  revokeOrganizationInvitation,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';

/**
 * Équipe d'une organisation, côté organisateur — migration 0033,
 * 05_ROUTES_FLOWS §6.1.
 *
 * Mêmes use cases que la console d'administration : la base décide qui gère
 * l'équipe (le propriétaire ici), le domaine valide et hache. Ces actions ne
 * transmettent qu'une intention et un acteur.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TeamActionState {
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

function text(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Message affichable d'un refus. Le préfixe technique de `DomainError`
 * (« [useCase] code : ») saute ; un refus d'accès ne dit pas plus que la
 * règle, et une erreur non traduite reste générique, journalisée sans contenu.
 */
function failure(error: unknown): TeamActionState {
  if (error instanceof DomainError) {
    if (error.code === 'forbidden') {
      return { error: 'Seul un propriétaire de l’organisation gère son équipe.' };
    }

    const message = error.message.replace(/^\[[^\]]+\]\s*\w+\s*:\s*/, '');

    if (error.code === 'validation' && Object.keys(error.details).length > 0) {
      return { error: 'Les informations saisies sont invalides.', fieldErrors: error.details };
    }

    return { error: message.charAt(0).toUpperCase() + message.slice(1) + '.' };
  }

  console.error('équipe : erreur non traduite', {
    name: error instanceof Error ? error.name : 'inconnu',
  });
  return { error: 'Une erreur est survenue. Réessayez dans un instant.' };
}

/** La page Équipe de l'organisation, l'identifiant n'étant accepté que sous forme d'UUID. */
function teamPath(organizationId: string): string {
  return UUID.test(organizationId) ? `/org/${organizationId}/parametres/equipe` : '/org';
}

function done(organizationId: string, notice: string): never {
  const path = teamPath(organizationId);
  revalidatePath(path);
  redirect(`${path}?fait=${notice}`);
}

async function contextFor(organizationId: string) {
  return sessionTeamContext(await requireSession(teamPath(organizationId)));
}

export async function inviteTeamMemberAction(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  const organizationId = text(form, 'organizationId') ?? '';

  try {
    await inviteOrganizationMember(await contextFor(organizationId), {
      organizationId,
      email: text(form, 'email'),
      role: text(form, 'role'),
    });
  } catch (error) {
    return failure(error);
  }

  done(organizationId, 'invitation-envoyee');
}

export async function revokeTeamInvitationAction(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  const organizationId = text(form, 'organizationId') ?? '';

  try {
    await revokeOrganizationInvitation(await contextFor(organizationId), {
      invitationId: text(form, 'invitationId'),
    });
  } catch (error) {
    return failure(error);
  }

  done(organizationId, 'invitation-revoquee');
}

export async function changeTeamMemberRoleAction(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  const organizationId = text(form, 'organizationId') ?? '';
  let changed: boolean;

  try {
    ({ changed } = await changeOrganizationMemberRole(await contextFor(organizationId), {
      organizationId,
      userId: text(form, 'userId'),
      role: text(form, 'role'),
    }));
  } catch (error) {
    return failure(error);
  }

  done(organizationId, changed ? 'role-modifie' : 'role-inchange');
}

export async function removeTeamMemberAction(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  const organizationId = text(form, 'organizationId') ?? '';

  try {
    await removeOrganizationMember(await contextFor(organizationId), {
      organizationId,
      userId: text(form, 'userId'),
      confirmed: form.get('confirmed') === 'on',
    });
  } catch (error) {
    return failure(error);
  }

  done(organizationId, 'membre-retire');
}

/**
 * Accepter une invitation d'équipe.
 *
 * Le jeton revient du formulaire de la page d'invitation. Il n'est ni
 * journalisé ni recopié : seul son hash part en base, calculé par le domaine.
 * L'issue revient à la page sous `?etat=`, jamais sous forme de message libre.
 */
export async function acceptTeamInvitationAction(form: FormData): Promise<void> {
  const raw = form.get('token');
  const token = typeof raw === 'string' && TOKEN.test(raw) ? raw : null;

  if (token === null) redirect('/');

  const page = `/invitation-equipe/${token}`;
  const context = sessionTeamContext(await requireSession(page));

  let state: string;

  try {
    await acceptOrganizationInvitation(context, { token });
    state = 'rejoint';
  } catch (error) {
    if (error instanceof DomainError && error.details['reason'] === OTHER_EMAIL_REASON) {
      state = 'autre-adresse';
    } else if (error instanceof DomainError) {
      state = 'impossible';
    } else {
      console.error('acceptation d’invitation : erreur non traduite', {
        name: error instanceof Error ? error.name : 'inconnu',
      });
      state = 'erreur';
    }
  }

  redirect(`${page}?etat=${state}`);
}
