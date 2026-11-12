import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  handleParticipantInvitationMessage,
  isParticipantInvitationMessage,
} from '../src/jobs/participant-invitation-send.js';
import type { ParticipantInvitationSendClaim, QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Job d'envoi d'une invitation de participant — migration 0069.
 *
 * Le jeton tiré part en base haché et dans l'email en clair, jamais ailleurs ;
 * une invitation qui n'est plus à envoyer s'arrête sans écrire.
 */

const INVITATION_ID = '00000000-0000-4000-8000-000000000081';

const CLAIM: ParticipantInvitationSendClaim = {
  sendable: true,
  email: 'camille@example.com',
  firstName: 'Camille',
  eventName: 'Les 9 clochers',
  raceName: 'Les 5 clochers',
  organizationName: 'Trail Club',
  raceStart: '2027-05-16T06:30:00Z',
  raceTimezone: 'Europe/Paris',
  included: false,
  prepaid: false,
  attempt: 2,
};

function setup(claim: ParticipantInvitationSendClaim, options: { failSend?: boolean } = {}) {
  const sent: EmailMessage[] = [];
  const hashes: string[] = [];
  const completed: string[] = [];
  const failed: string[] = [];
  const logs: unknown[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: (message) => {
      if (options.failSend === true) return Promise.reject(new Error('panne'));
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm', acceptedAt: '2026-11-09T08:00:00Z' });
    },
  };
  const log = (...args: unknown[]) => void logs.push(args);

  const ports = {
    email: provider,
    appUrl: 'https://app.pluka.test',
    siteUrl: 'https://pluka.test',
    participantInvitations: {
      claim: (_id: string, hash: string) => {
        hashes.push(hash);
        return Promise.resolve(claim);
      },
      complete: (id: string) => {
        completed.push(id);
        return Promise.resolve();
      },
      fail: (id: string) => {
        failed.push(id);
        return Promise.resolve(1);
      },
    },
    logger: { info: log, warn: log, error: log },
  } as unknown as WorkerPorts;

  return { ports, sent, hashes, completed, failed, logs };
}

const message = {
  msgId: 7,
  readCount: 1,
  payload: { participantInvitationId: INVITATION_ID },
} as unknown as QueueMessage;

const draw = () => ({ token: 'jeton-en-clair', hash: 'hash-du-jeton' });

describe('l’envoi d’une invitation de participant', () => {
  it('reconnaît son message parmi ceux de la file email', () => {
    expect(isParticipantInvitationMessage(message)).toBe(true);
    expect(
      isParticipantInvitationMessage({
        ...message,
        payload: { invitationId: 'x' },
      } as QueueMessage),
    ).toBe(false);
  });

  it('met le jeton dans le lien, son hash en base, et clôt l’envoi', async () => {
    const { ports, sent, hashes, completed, logs } = setup(CLAIM);

    const outcome = await handleParticipantInvitationMessage(ports, message, draw);

    expect(outcome).toEqual({ kind: 'sent', invitationId: INVITATION_ID });
    expect(hashes).toEqual(['hash-du-jeton']);
    expect(sent[0]?.textBody).toContain('https://app.pluka.test/invitation/jeton-en-clair');
    expect(sent[0]?.textBody).toContain('https://app.pluka.test/invitation/jeton-en-clair?refus=1');
    expect(sent[0]?.textBody).toContain('https://pluka.test/confidentialite');
    expect(sent[0]?.idempotencyKey).toBe(`participant-invitation:${INVITATION_ID}:2`);
    expect(completed).toEqual([INVITATION_ID]);
    // Le journal ne porte ni l'adresse ni le jeton.
    expect(JSON.stringify(logs)).not.toMatch(/camille@example\.com|jeton-en-clair/u);
  });

  it('une invitation qui n’est plus à envoyer s’arrête sans écrire', async () => {
    const { ports, sent, completed } = setup({ ...CLAIM, sendable: false });

    const outcome = await handleParticipantInvitationMessage(ports, message, draw);

    expect(outcome).toEqual({ kind: 'already_done', invitationId: INVITATION_ID });
    expect(sent).toHaveLength(0);
    expect(completed).toHaveLength(0);
  });

  it('une panne du fournisseur se retente et note l’échec', async () => {
    const { ports, failed } = setup(CLAIM, { failSend: true });

    const outcome = await handleParticipantInvitationMessage(ports, message, draw);

    expect(outcome.kind).toBe('retry');
    expect(failed).toEqual([INVITATION_ID]);
  });
});
