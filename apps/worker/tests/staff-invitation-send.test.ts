import { createHash } from 'node:crypto';

import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  handleStaffInvitationMessage,
  isStaffInvitationMessage,
} from '../src/jobs/staff-invitation-send.js';
import type { QueueMessage, StaffInvitationSendClaim, WorkerPorts } from '../src/ports.js';

/** Job d'envoi d'invitation à l'équipe PLUKA — migration 0036. */

const INVITATION = '00000000-0000-4000-8000-000000000081';
const TOKEN = 'S'.repeat(43);
const HASH = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

function setup(claim: StaffInvitationSendClaim) {
  const sent: EmailMessage[] = [];
  const claims: string[] = [];
  const logs: unknown[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm', acceptedAt: '2026-10-07T08:00:00Z' });
    },
  };
  const log = (...args: unknown[]) => void logs.push(args);

  const ports = {
    email: provider,
    adminUrl: 'http://localhost:3002',
    staffInvitations: {
      claim: (_id: string, hash: string) => {
        claims.push(hash);
        return Promise.resolve(claim);
      },
      complete: () => Promise.resolve(),
      fail: () => Promise.resolve(1),
    },
    logger: { info: log, warn: log, error: log },
  } as unknown as WorkerPorts;

  return { ports, sent, claims, logs };
}

const message = {
  msgId: 1,
  readCount: 1,
  payload: { staffInvitationId: INVITATION },
} as QueueMessage;
const draw = () => ({ token: TOKEN, hash: HASH });

describe('envoi d’une invitation à l’équipe PLUKA', () => {
  it('lien vers la console, hash seul en base, ni jeton ni adresse au journal', async () => {
    const { ports, sent, claims, logs } = setup({
      sendable: true,
      email: 'anne@pluka.fr',
      staffRole: 'support',
      inviterName: null,
      expiresAt: '2026-10-14T08:00:00.000Z',
      attempt: 1,
    });

    await expect(handleStaffInvitationMessage(ports, message, draw)).resolves.toEqual({
      kind: 'sent',
      invitationId: INVITATION,
    });
    expect(claims).toEqual([HASH]);
    expect(sent[0]?.textBody).toContain(`http://localhost:3002/invitation-equipe/${TOKEN}`);
    expect(sent[0]?.idempotencyKey).toBe(`staff-invitation:${INVITATION}:1`);

    const written = JSON.stringify(logs);
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain('anne@pluka.fr');
  });

  it('rien à envoyer : rien ne part', async () => {
    const { ports, sent } = setup({
      sendable: false,
      email: null,
      staffRole: null,
      inviterName: null,
      expiresAt: null,
      attempt: 0,
    });

    await expect(handleStaffInvitationMessage(ports, message, draw)).resolves.toMatchObject({
      kind: 'already_done',
    });
    expect(sent).toEqual([]);
  });

  it('se distingue des invitations d’organisation et des notifications', () => {
    expect(isStaffInvitationMessage(message)).toBe(true);
    expect(
      isStaffInvitationMessage({ msgId: 2, readCount: 1, payload: { invitationId: 'x' } }),
    ).toBe(false);
  });
});
