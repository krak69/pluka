import { DbError, type ParticipantInvitationRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  OTHER_EMAIL_REASON,
  acceptParticipantInvitation,
  hashInvitationToken,
  previewParticipantInvitation,
  sendParticipantInvitations,
  type ParticipantInvitationContext,
} from '../src/index.js';

/**
 * Invitations des participants — migration 0069.
 *
 * Les gardes sont en base (pgTAP 47). Ici : la forme des entrées, le hachage
 * du jeton venu de l'URL, et la traduction des refus.
 */

const TOKEN = 'A'.repeat(43);
const EDITION = '00000000-0000-4000-8000-000000000012';

function contextWith(overrides: Partial<ParticipantInvitationRepository>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string, result: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(result);
    };

  const repository: ParticipantInvitationRepository = {
    send: record('send', 3) as ParticipantInvitationRepository['send'],
    list: record('list', []) as ParticipantInvitationRepository['list'],
    editionIncluded: record(
      'editionIncluded',
      false,
    ) as ParticipantInvitationRepository['editionIncluded'],
    setEditionIncluded: record(
      'setEditionIncluded',
      undefined,
    ) as ParticipantInvitationRepository['setEditionIncluded'],
    preview: record('preview', { state: 'valid' }) as ParticipantInvitationRepository['preview'],
    accept: record('accept', 'participation') as ParticipantInvitationRepository['accept'],
    decline: record('decline', 'declined') as ParticipantInvitationRepository['decline'],
    listOptouts: record('listOptouts', []) as ParticipantInvitationRepository['listOptouts'],
    adoption: record('adoption', []) as ParticipantInvitationRepository['adoption'],
    ...overrides,
  };
  const context: ParticipantInvitationContext = {
    repositories: { participantInvitations: repository },
    actor: { userId: 'u' },
  };

  return { context, calls };
}

describe('envoyer', () => {
  it('sans liste, invite tous ceux qui peuvent l’être', async () => {
    const { context, calls } = contextWith({});

    await expect(sendParticipantInvitations(context, { editionId: EDITION })).resolves.toBe(3);
    expect(calls[0]).toEqual({ method: 'send', args: [EDITION, null] });
  });

  it('refuse une édition mal formée avant tout appel', async () => {
    const { context, calls } = contextWith({});

    await expect(sendParticipantInvitations(context, { editionId: 'x' })).rejects.toMatchObject({
      code: 'validation',
    });
    expect(calls).toHaveLength(0);
  });

  it('traduit le refus de la base', async () => {
    const { context } = contextWith({
      send: () =>
        Promise.reject(
          new DbError({ code: 'permission_denied', operation: 'send', message: 'refus' }),
        ),
    });

    await expect(sendParticipantInvitations(context, { editionId: EDITION })).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
  });
});

describe('le lien', () => {
  it('ne transmet que le hash du jeton', async () => {
    const { context, calls } = contextWith({});

    await previewParticipantInvitation(context, { token: TOKEN });
    await acceptParticipantInvitation(context, { token: TOKEN });

    expect(calls.map((call) => call.args[0])).toEqual([
      hashInvitationToken(TOKEN),
      hashInvitationToken(TOKEN),
    ]);
  });

  it('un jeton mal formé est un lien inconnu, sans appel', async () => {
    const { context, calls } = contextWith({});

    await expect(previewParticipantInvitation(context, { token: 'court' })).resolves.toMatchObject({
      state: 'unknown',
    });
    expect(calls).toHaveLength(0);
  });

  it('une autre adresse est un refus nommé, sans citer l’adresse (§117)', async () => {
    const { context } = contextWith({
      accept: () =>
        Promise.reject(
          new DbError({ code: 'permission_denied', operation: 'accept', message: 'refus' }),
        ),
    });

    const error = await acceptParticipantInvitation(context, { token: TOKEN }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).details['reason']).toBe(OTHER_EMAIL_REASON);
  });

  it('une invitation close dit quoi faire', async () => {
    const { context } = contextWith({
      accept: () =>
        Promise.reject(
          new DbError({ code: 'invalid_state', operation: 'accept', message: 'close' }),
        ),
    });

    await expect(acceptParticipantInvitation(context, { token: TOKEN })).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });
});
