import { DbError, type StaffTeamRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  STAFF_OTHER_EMAIL_REASON,
  acceptStaffInvitation,
  changeStaffRole,
  getMyStaffRole,
  hashInvitationToken,
  inviteStaffMember,
  previewStaffInvitation,
  removeStaffMember,
  type StaffTeamContext,
} from '../src/index.js';

/**
 * Équipe PLUKA — migrations 0035, 0036. La garde super-admin est dans la base
 * (pgTAP 25) ; ici, la validation, la confirmation, le hachage et les refus.
 */

const USER = '00000000-0000-4000-8000-000000000061';
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

function contextWith(overrides: Partial<StaffTeamRepository> = {}) {
  const calls: string[] = [];
  const refuse = (name: string) => () => {
    calls.push(name);
    return Promise.reject(new Error(`${name} non prévu`));
  };

  const staffTeam: StaffTeamRepository = {
    myStaffRole: refuse('myStaffRole'),
    listMembers: refuse('listMembers'),
    listInvitations: refuse('listInvitations'),
    invite: refuse('invite'),
    revokeInvitation: refuse('revokeInvitation'),
    changeRole: refuse('changeRole'),
    remove: refuse('remove'),
    previewInvitation: refuse('previewInvitation'),
    acceptInvitation: refuse('acceptInvitation'),
    ...overrides,
  };

  const context: StaffTeamContext = { repositories: { staffTeam }, actor: { userId: 'u-1' } };
  return { context, calls };
}

const refusal = (code: DbError['code']) => () =>
  Promise.reject(new DbError({ code, operation: 'staff_x', message: 'refus' }));

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe('équipe PLUKA', () => {
  it('le rôle de la session sert le menu ; une erreur rend un menu réduit, pas une panne', async () => {
    expect(
      await getMyStaffRole(contextWith({ myStaffRole: () => Promise.resolve('support') }).context),
    ).toBe('support');
    expect(
      await getMyStaffRole(contextWith({ myStaffRole: refusal('unavailable') }).context),
    ).toBeNull();
  });

  it('invite une adresse normalisée avec un rôle, et refuse un rôle inconnu', async () => {
    const received: unknown[] = [];
    const { context } = contextWith({
      invite: (email, role) => {
        received.push([email, role]);
        return Promise.resolve('i-1');
      },
    });

    await inviteStaffMember(context, { email: ' Anne@Pluka.FR ', staffRole: 'support' });
    expect(received).toEqual([['anne@pluka.fr', 'support']]);

    const error = await failure(inviteStaffMember(context, { email: 'a@b.fr', staffRole: 'root' }));
    expect(error.details['staffRole']).toBeDefined();
  });

  it('« déjà dans l’équipe » revient contre le champ email', async () => {
    const error = await failure(
      inviteStaffMember(contextWith({ invite: refusal('conflict') }).context, {
        email: 'a@b.fr',
        staffRole: 'admin',
      }),
    );
    expect(error.details['email']).toContain('déjà');
  });

  it('le dernier super-admin : le refus dit quoi faire', async () => {
    const error = await failure(
      changeStaffRole(contextWith({ changeRole: refusal('invalid_state') }).context, {
        userId: USER,
        staffRole: 'admin',
      }),
    );
    expect(error.message).toContain('super-admin');
  });

  it('retirer sans confirmation n’atteint pas la base', async () => {
    const { context, calls } = contextWith();
    const error = await failure(removeStaffMember(context, { userId: USER, confirmed: false }));
    expect(error.details['confirmed']).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('le lien : seul le hash part en base ; une autre adresse est refusée sans la citer', async () => {
    const received: string[] = [];
    const ok = contextWith({
      acceptInvitation: (hash) => {
        received.push(hash);
        return Promise.resolve('admin');
      },
    });
    await expect(acceptStaffInvitation(ok.context, { token: TOKEN })).resolves.toEqual({
      staffRole: 'admin',
    });
    expect(received).toEqual([hashInvitationToken(TOKEN)]);

    const error = await failure(
      acceptStaffInvitation(
        contextWith({ acceptInvitation: refusal('permission_denied') }).context,
        {
          token: TOKEN,
        },
      ),
    );
    expect(error.details).toEqual({ reason: STAFF_OTHER_EMAIL_REASON });
  });

  it('un jeton mal formé est un lien inconnu, sans appel', async () => {
    const { context, calls } = contextWith();
    await expect(previewStaffInvitation(context, { token: 'x' })).resolves.toEqual({
      state: 'unknown',
      staffRole: null,
    });
    expect(calls).toEqual([]);
  });
});
