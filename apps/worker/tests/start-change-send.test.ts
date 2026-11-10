import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import { handleStartChangeMessage, isStartChangeMessage } from '../src/jobs/start-change-send.js';
import type { QueueMessage, StartChangeClaim, WorkerPorts } from '../src/ports.js';

/** Changement d'heure de départ — migration 0082. */

const CHANGE_ID = '00000000-0000-4000-8000-000000000082';

const CLAIM: StartChangeClaim = {
  sendable: true,
  recipientEmail: 'coureur@test.pluka',
  firstName: 'Camille',
  eventName: 'Trail des Tests',
  raceName: '80K',
  timezone: 'Europe/Paris',
  participantRaceId: '00000000-0000-4000-8000-000000000031',
  previousWaveName: null,
  newWaveName: 'Élite',
  previousStartAt: '2026-06-20T04:00:00Z',
  newStartAt: '2026-06-20T04:30:00Z',
  hasPlan: true,
  attempt: 1,
};

function setup(claim: StartChangeClaim, options: { failSend?: boolean } = {}) {
  const sent: EmailMessage[] = [];
  const completed: string[] = [];
  const failed: { id: string; abandon: boolean }[] = [];
  const logs: unknown[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: (message) => {
      if (options.failSend === true) return Promise.reject(new Error('panne'));
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm', acceptedAt: '2026-11-10T08:00:00Z' });
    },
  };
  const log = (...args: unknown[]) => void logs.push(args);

  const ports = {
    email: provider,
    appUrl: 'https://app.pluka.test',
    startChanges: {
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
  payload: { startChangeId: CHANGE_ID },
} as QueueMessage;

describe('le changement d’heure de départ', () => {
  it('se reconnaît parmi les messages de la file e-mail', () => {
    expect(isStartChangeMessage(message)).toBe(true);
    expect(isStartChangeMessage({ ...message, payload: { deliveryId: 'x' } })).toBe(false);
  });

  it('part au coureur avec le lien de son Plan', async () => {
    const { ports, sent, completed, logs } = setup(CLAIM);

    await expect(handleStartChangeMessage(ports, message)).resolves.toEqual({
      kind: 'sent',
      changeId: CHANGE_ID,
    });
    expect(sent[0]?.to).toEqual([{ address: 'coureur@test.pluka', name: 'Camille' }]);
    expect(sent[0]?.textBody).toContain(
      'https://app.pluka.test/courses/00000000-0000-4000-8000-000000000031/plan',
    );
    expect(completed).toEqual([CHANGE_ID]);
    expect(JSON.stringify(logs)).not.toContain('coureur@test.pluka');
  });

  it('ne renvoie rien quand l’e-mail est déjà parti', async () => {
    const { ports, sent } = setup({ ...CLAIM, sendable: false });

    await expect(handleStartChangeMessage(ports, message)).resolves.toMatchObject({
      kind: 'already_done',
    });
    expect(sent).toEqual([]);
  });

  it('réessaie quand le fournisseur tombe, et abandonne après la dernière tentative', async () => {
    const first = setup(CLAIM, { failSend: true });
    await expect(handleStartChangeMessage(first.ports, message)).resolves.toMatchObject({
      kind: 'retry',
    });

    const last = setup({ ...CLAIM, attempt: 5 }, { failSend: true });
    await expect(handleStartChangeMessage(last.ports, message)).resolves.toMatchObject({
      kind: 'abandoned',
    });
    expect(last.failed).toEqual([{ id: CHANGE_ID, abandon: true }]);
  });
});
