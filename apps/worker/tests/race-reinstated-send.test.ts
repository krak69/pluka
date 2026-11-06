import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import { handleNotificationMessage } from '../src/jobs/notification-send.js';
import type { NotificationClaim, QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Le job `email.send` choisit le gabarit d'après le message — 0067, 0068.
 *
 * Une annulation ou un rétablissement n'a ni titre ni modules : partir sur le
 * gabarit du changement officiel enverrait un message vide de sens.
 */

const DELIVERY_ID = '00000000-0000-4000-8000-000000000071';

const CLAIM: NotificationClaim = {
  deliveryId: DELIVERY_ID,
  alreadySent: false,
  attempts: 1,
  maxAttempts: 5,
  idempotencyKey: 'email.send:cle',
  recipientEmail: 'coureur@example.test',
  recipientFirstName: 'Camille',
  locale: 'fr-FR',
  eventName: 'Trail de Test',
  raceName: 'Grand Parcours',
  raceId: '00000000-0000-4000-8000-000000000072',
  changeTitle: null,
  severity: null,
  modules: [],
};

function setup() {
  const sent: EmailMessage[] = [];
  const completed: { templateVersion: string }[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm', acceptedAt: '2026-11-06T08:00:00Z' });
    },
  };
  const log = () => undefined;
  const ports = {
    email: provider,
    appUrl: 'https://app.pluka.test',
    notifications: {
      claim: () => Promise.resolve(CLAIM),
      complete: (_id: string, result: { templateVersion: string }) => {
        completed.push(result);
        return Promise.resolve();
      },
      fail: () => Promise.resolve('failed'),
    },
    logger: { info: log, warn: log, error: log },
  } as unknown as WorkerPorts;

  return { ports, sent, completed };
}

function message(kind: string): QueueMessage {
  return {
    msgId: 1,
    readCount: 1,
    payload: { deliveryId: DELIVERY_ID, idempotencyKey: 'email.send:cle', kind },
  } as unknown as QueueMessage;
}

describe('le statut d’une course', () => {
  it('une annulation part sur son propre gabarit', async () => {
    const { ports, sent, completed } = setup();

    const outcome = await handleNotificationMessage(ports, message('race_cancelled'));

    expect(outcome).toEqual({ kind: 'sent', deliveryId: DELIVERY_ID });
    expect(sent[0]?.subject).toBe('Épreuve annulée — Grand Parcours');
    expect(completed[0]?.templateVersion).toBe('race-cancelled-1.0.0');
  });

  it('un rétablissement part sur le sien', async () => {
    const { ports, sent, completed } = setup();

    const outcome = await handleNotificationMessage(ports, message('race_reinstated'));

    expect(outcome).toEqual({ kind: 'sent', deliveryId: DELIVERY_ID });
    expect(sent[0]?.subject).toBe('Annulation levée — Grand Parcours');
    expect(completed[0]?.templateVersion).toBe('race-reinstated-1.0.0');
  });

  it('un changement officiel garde le sien', async () => {
    const { ports, sent } = setup();

    await handleNotificationMessage(ports, message('race_change_impact'));

    expect(sent[0]?.subject).toBe('Mise à jour — Grand Parcours');
  });
});
