import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  handleAccountNoticeMessage,
  isAccountNoticeMessage,
} from '../src/jobs/account-notice-send.js';
import type { AccountNoticeClaim, QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Avertissement avant la suppression d'un compte inactif — migration 0079.
 *
 * Il part au coureur avec la date, le lien de connexion et celui de l'export ;
 * tant qu'il n'est pas parti, la base n'efface rien.
 */

const USER_ID = '00000000-0000-4000-8000-000000000071';

const CLAIM: AccountNoticeClaim = {
  sendable: true,
  recipientEmail: 'coureur@test.pluka',
  firstName: 'Camille',
  purgeAfter: '2029-12-10T03:17:00Z',
  attempt: 1,
};

function setup(claim: AccountNoticeClaim, options: { failSend?: boolean; noEmail?: boolean } = {}) {
  const sent: EmailMessage[] = [];
  const completed: string[] = [];
  const failed: { id: string; abandon: boolean }[] = [];
  const logs: unknown[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: (message) => {
      if (options.failSend === true) return Promise.reject(new Error('panne'));
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm', acceptedAt: '2029-11-10T08:00:00Z' });
    },
  };
  const log = (...args: unknown[]) => void logs.push(args);

  const ports = {
    email: options.noEmail === true ? null : provider,
    appUrl: 'https://app.pluka.test',
    siteUrl: 'https://pluka.test',
    accountNotices: {
      claim: () => Promise.resolve(claim),
      complete: (id: string) => {
        completed.push(id);
        return Promise.resolve();
      },
      fail: (id: string, _error: string, abandon: boolean) => {
        failed.push({ id, abandon });
        return Promise.resolve();
      },
    },
    logger: { info: log, warn: log, error: log },
  } as unknown as WorkerPorts;

  return { ports, sent, completed, failed, logs };
}

const message = {
  msgId: 1,
  readCount: 1,
  payload: { accountNoticeUserId: USER_ID },
} as QueueMessage;

describe('l’avertissement de compte inactif', () => {
  it('se reconnaît parmi les messages de la file e-mail', () => {
    expect(isAccountNoticeMessage(message)).toBe(true);
    expect(isAccountNoticeMessage({ ...message, payload: { contactMessageId: 'x' } })).toBe(false);
  });

  it('part au coureur avec ses liens, puis l’échéance est fixée', async () => {
    const { ports, sent, completed, logs } = setup(CLAIM);

    await expect(handleAccountNoticeMessage(ports, message)).resolves.toEqual({
      kind: 'sent',
      userId: USER_ID,
    });
    expect(sent[0]?.to).toEqual([{ address: 'coureur@test.pluka', name: 'Camille' }]);
    expect(sent[0]?.textBody).toContain('https://app.pluka.test/connexion');
    expect(sent[0]?.textBody).toContain('https://app.pluka.test/profil/donnees');
    expect(sent[0]?.textBody).toContain('https://pluka.test/confidentialite');
    expect(completed).toEqual([USER_ID]);
    expect(JSON.stringify(logs)).not.toContain('coureur@test.pluka');
  });

  it('ne fait rien quand la demande a été annulée ou l’avertissement déjà parti', async () => {
    const { ports, sent, completed } = setup({ ...CLAIM, sendable: false });

    await expect(handleAccountNoticeMessage(ports, message)).resolves.toEqual({
      kind: 'already_done',
      userId: USER_ID,
    });
    expect(sent).toEqual([]);
    expect(completed).toEqual([]);
  });

  it('réessaie quand le fournisseur tombe, sans rien valider', async () => {
    const { ports, completed, failed } = setup(CLAIM, { failSend: true });

    const outcome = await handleAccountNoticeMessage(ports, message);
    expect(outcome.kind).toBe('retry');
    expect(completed).toEqual([]);
    expect(failed).toEqual([{ id: USER_ID, abandon: false }]);
  });

  it('abandonne après la dernière tentative : le compte n’est alors jamais effacé', async () => {
    const { ports, failed } = setup({ ...CLAIM, attempt: 5 }, { failSend: true });

    await expect(handleAccountNoticeMessage(ports, message)).resolves.toMatchObject({
      kind: 'abandoned',
    });
    expect(failed).toEqual([{ id: USER_ID, abandon: true }]);
  });
});
