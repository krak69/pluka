import { DbError, type OrganizationTeamRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  OTHER_EMAIL_REASON,
  acceptOrganizationInvitation,
  changeOrganizationMemberRole,
  getMyOrganization,
  hashInvitationToken,
  inviteOrganizationMember,
  previewOrganizationInvitation,
  removeOrganizationMember,
  type OrganizationTeamContext,
} from '../src/index.js';

/**
 * Équipe d'une organisation — migration 0033.
 *
 * La garde vit dans les fonctions SQL ; la suite pgTAP 22 la prouve. Ici :
 * validation à la frontière, confirmation du retrait, hachage du jeton, et
 * traduction des refus en messages qui disent quoi faire.
 */

const ORGANIZATION = '00000000-0000-4000-8000-000000000051';
const USER = '00000000-0000-4000-8000-000000000061';
// 32 octets en base64url : la forme exacte du jeton tiré par le worker.
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

function contextWith(overrides: Partial<OrganizationTeamRepository> = {}) {
  const calls: string[] = [];
  const refuse = (name: string) => () => {
    calls.push(name);
    return Promise.reject(new Error(`${name} non prévu`));
  };

  const organizationTeam: OrganizationTeamRepository = {
    listOwnMemberships: refuse('listOwnMemberships'),
    listMembers: refuse('listMembers'),
    listInvitations: refuse('listInvitations'),
    invite: refuse('invite'),
    revokeInvitation: refuse('revokeInvitation'),
    changeRole: refuse('changeRole'),
    removeMember: refuse('removeMember'),
    previewInvitation: refuse('previewInvitation'),
    acceptInvitation: refuse('acceptInvitation'),
    ...overrides,
  };

  const context: OrganizationTeamContext = {
    repositories: { organizationTeam },
    actor: { userId: 'u-1' },
  };

  return { context, calls };
}

function dbRefusal(code: DbError['code']) {
  return () => Promise.reject(new DbError({ code, operation: 'org_x', message: 'refus' }));
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe('inviter', () => {
  it('normalise l’adresse et transmet le rôle', async () => {
    const received: unknown[] = [];
    const { context } = contextWith({
      invite: (input) => {
        received.push(input);
        return Promise.resolve('i-1');
      },
    });

    await expect(
      inviteOrganizationMember(context, {
        organizationId: ORGANIZATION,
        email: '  Marie@Trail.FR ',
        role: 'editor',
      }),
    ).resolves.toEqual({ invitationId: 'i-1' });
    expect(received).toEqual([
      { organizationId: ORGANIZATION, email: 'marie@trail.fr', role: 'editor' },
    ]);
  });

  it('refuse un rôle hors des quatre de la base', async () => {
    const { context, calls } = contextWith();

    const error = await failure(
      inviteOrganizationMember(context, {
        organizationId: ORGANIZATION,
        email: 'marie@trail.fr',
        role: 'superadmin',
      }),
    );

    expect(error.details['role']).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('rend « déjà membre » contre le champ email', async () => {
    const { context } = contextWith({ invite: dbRefusal('conflict') });

    const error = await failure(
      inviteOrganizationMember(context, {
        organizationId: ORGANIZATION,
        email: 'marie@trail.fr',
        role: 'viewer',
      }),
    );

    expect(error.code).toBe('validation');
    expect(error.details['email']).toContain('déjà');
  });

  it('un acteur sans droit reçoit un refus sans détail', async () => {
    const { context } = contextWith({ invite: dbRefusal('permission_denied') });

    const error = await failure(
      inviteOrganizationMember(context, {
        organizationId: ORGANIZATION,
        email: 'marie@trail.fr',
        role: 'viewer',
      }),
    );

    expect(error.code).toBe('forbidden');
    expect(error.details).toEqual({});
  });
});

describe('rôles et retrait', () => {
  it('le dernier propriétaire : le refus dit quoi faire', async () => {
    const { context } = contextWith({ changeRole: dbRefusal('invalid_state') });

    const error = await failure(
      changeOrganizationMemberRole(context, {
        organizationId: ORGANIZATION,
        userId: USER,
        role: 'viewer',
      }),
    );

    expect(error.code).toBe('invalid_state');
    expect(error.message).toContain('propriétaire');
  });

  for (const confirmed of [undefined, false, 'on']) {
    it(`retirer sans confirmation (${String(confirmed)}) n’atteint pas la base`, async () => {
      const { context, calls } = contextWith();

      const error = await failure(
        removeOrganizationMember(context, {
          organizationId: ORGANIZATION,
          userId: USER,
          confirmed,
        }),
      );

      expect(error.details['confirmed']).toBeDefined();
      expect(calls).toEqual([]);
    });
  }
});

describe('lien d’invitation', () => {
  it('ne transmet que le SHA-256 du jeton, jamais le jeton', async () => {
    const received: string[] = [];
    const { context } = contextWith({
      acceptInvitation: (hash) => {
        received.push(hash);
        return Promise.resolve(ORGANIZATION);
      },
    });

    await acceptOrganizationInvitation(context, { token: TOKEN });

    expect(received).toEqual([hashInvitationToken(TOKEN)]);
    expect(received[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(received[0]).not.toContain(TOKEN);
  });

  it('un jeton mal formé est un lien inconnu, sans appel à la base', async () => {
    const { context, calls } = contextWith();

    await expect(previewOrganizationInvitation(context, { token: 'trop-court' })).resolves.toEqual({
      state: 'unknown',
      organizationName: null,
      role: null,
    });
    expect(calls).toEqual([]);
  });

  it('une autre adresse que celle invitée : refus qui le dit, sans la citer', async () => {
    const { context } = contextWith({ acceptInvitation: dbRefusal('permission_denied') });

    const error = await failure(acceptOrganizationInvitation(context, { token: TOKEN }));

    expect(error.code).toBe('forbidden');
    expect(error.details).toEqual({ reason: OTHER_EMAIL_REASON });
  });

  it('une invitation close ou expirée invite à en demander une nouvelle', async () => {
    const { context } = contextWith({ acceptInvitation: dbRefusal('invalid_state') });

    const error = await failure(acceptOrganizationInvitation(context, { token: TOKEN }));

    expect(error.code).toBe('invalid_state');
    expect(error.message).toContain('nouvelle');
  });
});

describe('mes organisations', () => {
  const MINE = {
    organizationId: ORGANIZATION,
    organizationName: 'Trail du Lac',
    role: 'viewer',
  } as const;

  it('lit les appartenances de l’acteur, et de lui seul', async () => {
    const asked: string[] = [];
    const { context } = contextWith({
      listOwnMemberships: (userId) => {
        asked.push(userId);
        return Promise.resolve([MINE]);
      },
    });

    await expect(getMyOrganization(context, { organizationId: ORGANIZATION })).resolves.toEqual(
      MINE,
    );
    expect(asked).toEqual(['u-1']);
  });

  it('une organisation dont il n’est pas membre est introuvable, pas interdite', async () => {
    const { context } = contextWith({ listOwnMemberships: () => Promise.resolve([MINE]) });

    const error = await failure(
      getMyOrganization(context, { organizationId: '00000000-0000-4000-8000-0000000000ff' }),
    );

    expect(error.code).toBe('not_found');
  });
});
