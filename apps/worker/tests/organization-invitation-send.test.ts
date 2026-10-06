import { createHash } from 'node:crypto';

import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  drawInvitationToken,
  handleInvitationMessage,
  isInvitationMessage,
} from '../src/jobs/organization-invitation-send.js';
import type { InvitationSendClaim, QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Job d'envoi d'invitation d'équipe — migration 0033.
 *
 * Ce qui compte ici, c'est le jeton : tiré par le worker, seul son hash part
 * en base, il n'apparaît que dans le lien de l'email, jamais dans un journal.
 */

const INVITATION = '00000000-0000-4000-8000-000000000071';
const TOKEN = 'T'.repeat(43);
const HASH = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

const SENDABLE: InvitationSendClaim = {
  sendable: true,
  email: 'marie@trail.fr',
  role: 'editor',
  organizationName: 'Trail du Lac',
  inviterName: 'Jean Dupont',
  expiresAt: '2026-10-13T08:00:00.000Z',
  attempt: 2,
};

function message(payload: Record<string, unknown> = { invitationId: INVITATION }): QueueMessage {
  return { msgId: 1, readCount: 1, payload } as unknown as QueueMessage;
}

function setup(options: {
  claim?: InvitationSendClaim;
  email?: EmailProvider | null;
  failAttempts?: number;
}) {
  const sent: EmailMessage[] = [];
  const claims: { id: string; hash: string }[] = [];
  const completed: string[] = [];
  const failures: string[] = [];
  const logs: unknown[] = [];

  const provider: EmailProvider = {
    name: 'test',
    send: (msg) => {
      sent.push(msg);
      return Promise.resolve({ providerMessageId: 'm-1', acceptedAt: '2026-10-06T08:00:00Z' });
    },
  };

  const log = (...args: unknown[]) => {
    logs.push(args);
  };

  const ports = {
    email: options.email === undefined ? provider : options.email,
    appUrl: 'http://localhost:3001',
    invitations: {
      claim: (id: string, hash: string) => {
        claims.push({ id, hash });
        return Promise.resolve(options.claim ?? SENDABLE);
      },
      complete: (id: string) => {
        completed.push(id);
        return Promise.resolve();
      },
      fail: (id: string) => {
        failures.push(id);
        return Promise.resolve(options.failAttempts ?? 1);
      },
    },
    logger: { info: log, warn: log, error: log },
  } as unknown as WorkerPorts;

  return { ports, sent, claims, completed, failures, logs };
}

const draw = () => ({ token: TOKEN, hash: HASH });

describe('envoi d’une invitation', () => {
  it('ne confie que le hash à la base, et met le jeton dans le lien de l’email', async () => {
    const { ports, sent, claims, completed } = setup({});

    await expect(handleInvitationMessage(ports, message(), draw)).resolves.toEqual({
      kind: 'sent',
      invitationId: INVITATION,
    });

    expect(claims).toEqual([{ id: INVITATION, hash: HASH }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.textBody).toContain(`http://localhost:3001/invitation-equipe/${TOKEN}`);
    expect(completed).toEqual([INVITATION]);
  });

  it('la clé d’idempotence porte le numéro de tentative', async () => {
    const { ports, sent } = setup({});

    await handleInvitationMessage(ports, message(), draw);

    expect(sent[0]?.idempotencyKey).toBe(`org-invitation:${INVITATION}:2`);
  });

  it('aucun journal ne contient le jeton, son hash ni l’adresse', async () => {
    const { ports, logs } = setup({});

    await handleInvitationMessage(ports, message(), draw);

    const written = JSON.stringify(logs);
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(HASH);
    expect(written).not.toContain('marie@trail.fr');
  });

  it('une invitation qui n’est plus à envoyer : rien ne part', async () => {
    const { ports, sent, completed } = setup({
      claim: { ...SENDABLE, sendable: false, email: null, attempt: 0 },
    });

    await expect(handleInvitationMessage(ports, message(), draw)).resolves.toEqual({
      kind: 'already_done',
      invitationId: INVITATION,
    });
    expect(sent).toEqual([]);
    expect(completed).toEqual([]);
  });

  it('sans fournisseur : rien n’est réclamé, l’échec est noté, le job réessaiera', async () => {
    const { ports, claims, failures } = setup({ email: null });

    await expect(handleInvitationMessage(ports, message(), draw)).resolves.toMatchObject({
      kind: 'retry',
      code: 'EMAIL_NOT_CONFIGURED',
    });
    expect(claims).toEqual([]);
    expect(failures).toEqual([INVITATION]);
  });

  it('fournisseur en panne à la cinquième tentative : abandon visible', async () => {
    const failing: EmailProvider = { name: 'test', send: () => Promise.reject(new Error('503')) };
    const { ports, completed } = setup({ email: failing, failAttempts: 5 });

    await expect(handleInvitationMessage(ports, message(), draw)).resolves.toMatchObject({
      kind: 'abandoned',
    });
    expect(completed).toEqual([]);
  });

  it('une adresse inexploitable est abandonnée tout de suite', async () => {
    const { ports } = setup({ claim: { ...SENDABLE, email: 'pas-une-adresse' } });

    await expect(handleInvitationMessage(ports, message(), draw)).resolves.toMatchObject({
      kind: 'abandoned',
      code: 'RECIPIENT_INVALID',
    });
  });
});

describe('routage et jeton', () => {
  it('reconnaît un message d’invitation, et pas une notification', () => {
    expect(isInvitationMessage(message())).toBe(true);
    expect(isInvitationMessage(message({ deliveryId: 'd-1' }))).toBe(false);
  });

  it('tire un jeton de 43 caractères base64url, différent à chaque fois, avec son SHA-256', () => {
    const first = drawInvitationToken();
    const second = drawInvitationToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(createHash('sha256').update(first.token, 'utf8').digest('hex'));
  });
});
