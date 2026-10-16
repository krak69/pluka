import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  handleEventSiteContactMessage,
  isEventSiteContactMessage,
} from '../src/jobs/event-site-contact-send.js';
import type { EventSiteContactClaim, QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Job d'envoi d'un message du formulaire de contact — migration 0052.
 *
 * Le message part à l'organisation, réponse au coureur ; il est effacé une
 * fois parti ou abandonné ; le journal ne porte que son identifiant.
 */

const MESSAGE_ID = '00000000-0000-4000-8000-000000000091';

const CLAIM: EventSiteContactClaim = {
  sendable: true,
  recipientEmail: 'courses@trail.test',
  eventName: 'Trail de Test',
  raceName: null,
  senderName: 'Alex',
  senderEmail: 'alex@test.pluka',
  body: 'Une question très personnelle.',
  attempt: 1,
};

function setup(claim: EventSiteContactClaim, options: { failSend?: boolean; noEmail?: boolean } = {}) {
  const sent: EmailMessage[] = [];
  const completed: string[] = [];
  const failed: { id: string; abandon: boolean }[] = [];
  const logs: unknown[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: (message) => {
      if (options.failSend === true) return Promise.reject(new Error('panne'));
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm', acceptedAt: '2026-10-16T08:00:00Z' });
    },
  };
  const log = (...args: unknown[]) => void logs.push(args);

  const ports = {
    email: options.noEmail === true ? null : provider,
    siteContacts: {
      claim: () => Promise.resolve(claim),
      complete: (id: string) => {
        completed.push(id);
        return Promise.resolve();
      },
      fail: (id: string, _error: string, abandon: boolean) => {
        failed.push({ id, abandon });
        return Promise.resolve(claim.attempt);
      },
    },
    logger: { info: log, warn: log, error: log },
  } as unknown as WorkerPorts;

  return { ports, sent, completed, failed, logs };
}

const message = { msgId: 1, readCount: 1, payload: { contactMessageId: MESSAGE_ID } } as QueueMessage;

describe('le message d’un coureur', () => {
  it('se reconnaît parmi les messages de la file e-mail', () => {
    expect(isEventSiteContactMessage(message)).toBe(true);
    expect(isEventSiteContactMessage({ ...message, payload: { invitationId: 'x' } })).toBe(false);
  });

  it('part à l’organisation, réponse au coureur, puis il est effacé', async () => {
    const { ports, sent, completed, logs } = setup(CLAIM);

    await expect(handleEventSiteContactMessage(ports, message)).resolves.toEqual({
      kind: 'sent',
      messageId: MESSAGE_ID,
    });
    expect(sent[0]?.to).toEqual([{ address: 'courses@trail.test' }]);
    expect(sent[0]?.replyTo?.address).toBe('alex@test.pluka');
    expect(completed).toEqual([MESSAGE_ID]);

    // Ni le contenu, ni les adresses au journal.
    const written = JSON.stringify(logs);
    expect(written).not.toContain('très personnelle');
    expect(written).not.toContain('alex@test.pluka');
    expect(written).not.toContain('courses@trail.test');
  });

  it('déjà parti : rien ne repart', async () => {
    const { ports, sent } = setup({ ...CLAIM, sendable: false });

    await expect(handleEventSiteContactMessage(ports, message)).resolves.toMatchObject({
      kind: 'already_done',
    });
    expect(sent).toEqual([]);
  });

  it('fournisseur en panne : retenté, le contenu reste le temps de la relance', async () => {
    const { ports, failed } = setup(CLAIM, { failSend: true });

    await expect(handleEventSiteContactMessage(ports, message)).resolves.toMatchObject({
      kind: 'retry',
    });
    expect(failed).toEqual([{ id: MESSAGE_ID, abandon: false }]);
  });

  it('au cinquième échec : abandonné, et le contenu effacé', async () => {
    const { ports, failed } = setup({ ...CLAIM, attempt: 5 }, { failSend: true });

    await expect(handleEventSiteContactMessage(ports, message)).resolves.toMatchObject({
      kind: 'abandoned',
    });
    expect(failed).toEqual([{ id: MESSAGE_ID, abandon: true }]);
  });

  it('pas de fournisseur configuré : retenté plus tard', async () => {
    const { ports, sent } = setup(CLAIM, { noEmail: true });

    await expect(handleEventSiteContactMessage(ports, message)).resolves.toMatchObject({
      kind: 'retry',
    });
    expect(sent).toEqual([]);
  });
});
