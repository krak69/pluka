import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  PARTICIPANT_INVITATION_TEMPLATE_VERSION,
  isNotificationError,
  renderParticipantInvitation,
  sendParticipantInvitation,
  type ParticipantInvitationNotice,
} from '../src/index.js';

/** L'invitation d'un participant — 00_PRODUCT_SPEC §29.2, migration 0069. */

const NOTICE: ParticipantInvitationNotice = {
  recipientEmail: 'camille@example.com',
  recipientFirstName: 'Camille',
  eventName: 'Les 9 clochers',
  raceName: 'Les 5 clochers',
  organizationName: 'Trail Club',
  raceStart: '2027-05-16T06:30:00Z',
  raceTimezone: 'Europe/Paris',
  included: true,
  prepaid: false,
  acceptUrl: 'https://app.pluka.test/invitation/jeton',
  declineUrl: 'https://app.pluka.test/invitation/jeton?refus=1',
  privacyUrl: 'https://pluka.test/confidentialite',
};

function provider(sent: EmailMessage[], behaviour: 'ok' | 'throw' = 'ok'): EmailProvider {
  return {
    name: 'test',
    send(message) {
      if (behaviour === 'throw') return Promise.reject(new Error('camille@example.com'));
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm1', acceptedAt: '2026-11-09T10:00:00Z' });
    },
  };
}

describe('l’invitation d’un participant', () => {
  it('dit qui invite, pour quelle course, et avec quelle adresse se connecter', () => {
    const { subject, textBody } = renderParticipantInvitation(NOTICE);

    expect(subject).toBe('Les 9 clochers : prépare Les 5 clochers avec PLUKA');
    expect(textBody).toContain('Bonjour Camille,');
    expect(textBody).toContain("Trail Club t'invite à préparer Les 5 clochers (Les 9 clochers)");
    expect(textBody).toContain(NOTICE.acceptUrl);
    expect(textBody).toContain('le 16 mai 2027');
    expect(textBody).toContain('(camille@example.com)');
  });

  it('dit d’où vient l’adresse et comment ne plus être contacté', () => {
    const { textBody } = renderParticipantInvitation(NOTICE);

    expect(textBody).toContain("Trail Club t'a inscrit à Les 5 clochers et a transmis ton adresse à PLUKA");
    expect(textBody).toContain(`Tu ne souhaites pas être contacté : ${NOTICE.declineUrl}`);
    expect(textBody).toContain(`Tes données et tes droits : ${NOTICE.privacyUrl}`);
  });

  it('ne promet l’accès offert que s’il l’est', () => {
    expect(renderParticipantInvitation(NOTICE).textBody).toContain('offert par l');
    expect(renderParticipantInvitation({ ...NOTICE, included: false }).textBody).not.toContain(
      'offert',
    );
  });

  it('dit l’option PLUKA déjà réglée, sans aucun prix (canal B, E48)', () => {
    const { textBody } = renderParticipantInvitation({ ...NOTICE, included: false, prepaid: true });

    expect(textBody).toContain('Ta Prépa PLUKA, prise avec ton inscription, est déjà réglée');
    expect(textBody).not.toContain('offert');
    expect(textBody).not.toMatch(/€|\d+,\d{2}/u);
  });

  it('nomme l’événement quand aucune organisation n’invite', () => {
    const { textBody } = renderParticipantInvitation({ ...NOTICE, organizationName: null });

    expect(textBody).toContain("Les 9 clochers t'invite");
  });

  it('n’écrit qu’au participant, avec la clé d’idempotence', async () => {
    const sent: EmailMessage[] = [];

    const result = await sendParticipantInvitation(provider(sent), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([{ address: NOTICE.recipientEmail, name: 'Camille' }]);
    expect(sent[0]?.idempotencyKey).toBe('cle');
    expect(result.templateVersion).toBe(PARTICIPANT_INVITATION_TEMPLATE_VERSION);
  });

  it('un refus définitif du fournisseur ne se retente pas, et garde son statut', async () => {
    const rejecting: EmailProvider = {
      name: 'test',
      send: () =>
        Promise.reject(
          Object.assign(new Error('EMAIL_HTTP_ERROR : réponse 403 du fournisseur email'), {
            kind: 'permanent',
          }),
        ),
    };

    const failure = await sendParticipantInvitation(rejecting, {
      notice: NOTICE,
      idempotencyKey: 'cle',
    }).catch((error: unknown) => error);

    expect(isNotificationError(failure) && failure.code).toBe('PROVIDER_REJECTED');
    expect(isNotificationError(failure) && failure.permanent).toBe(true);
    expect(String(failure)).toContain('réponse 403');
  });

  it('refuse une adresse inexploitable, et une panne se retente sans fuite', async () => {
    const invalid = await sendParticipantInvitation(provider([]), {
      notice: { ...NOTICE, recipientEmail: 'pas-une-adresse' },
      idempotencyKey: 'cle',
    }).catch((error: unknown) => error);
    const down = await sendParticipantInvitation(provider([], 'throw'), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    }).catch((error: unknown) => error);

    expect(isNotificationError(invalid) && invalid.permanent).toBe(true);
    expect(isNotificationError(down) && down.permanent).toBe(false);
    expect(String(down)).not.toContain(NOTICE.recipientEmail);
  });
});
