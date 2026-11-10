import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  START_CHANGED_TEMPLATE_VERSION,
  renderStartChangedNotice,
  sendStartChangedNotice,
  type StartChangedNotice,
} from '../src/index.js';

/** « Ton heure de départ change » — migration 0082. */

const NOTICE: StartChangedNotice = {
  recipientEmail: 'coureur@example.test',
  recipientFirstName: 'Camille',
  eventName: 'Trail des Tests',
  raceName: '80K',
  timezone: 'Europe/Paris',
  previousWaveName: null,
  newWaveName: 'Élite',
  previousStartAt: '2026-06-20T04:00:00Z',
  newStartAt: '2026-06-20T04:30:00Z',
  hasPlan: true,
  planUrl: 'https://app.pluka.test/courses/abc/plan',
};

function provider(sent: EmailMessage[]): EmailProvider {
  return {
    name: 'test',
    send(message) {
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm1', acceptedAt: '2026-11-10T10:00:00Z' });
    },
  };
}

describe('le changement d’heure de départ', () => {
  it('dit l’avant et l’après, à l’heure de l’épreuve', () => {
    const { subject, textBody } = renderStartChangedNotice(NOTICE);

    expect(subject).toBe('Ton heure de départ change — 80K');
    expect(textBody).toContain('a changé ta vague de départ pour 80K');
    expect(textBody).toContain("Avant : départ de l'épreuve, le 20 juin à 06 h 00.");
    expect(textBody).toContain('Désormais : vague Élite, le 20 juin à 06 h 30.');
    expect(textBody).toContain('Rien ne change sans toi.');
    expect(textBody).toContain('https://app.pluka.test/courses/abc/plan');
  });

  it('parle de l’heure de la vague quand la vague ne change pas', () => {
    const { textBody } = renderStartChangedNotice({
      ...NOTICE,
      previousWaveName: 'Élite',
      hasPlan: false,
    });

    expect(textBody).toContain("a changé l'heure de départ de ta vague");
    expect(textBody).toContain('Ton Plan partira de cette nouvelle heure.');
  });

  it('n’écrit qu’au coureur, sous sa version de gabarit', async () => {
    const sent: EmailMessage[] = [];
    const result = await sendStartChangedNotice(provider(sent), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    });

    expect(sent[0]?.to).toEqual([{ address: NOTICE.recipientEmail, name: 'Camille' }]);
    expect(result.templateVersion).toBe(START_CHANGED_TEMPLATE_VERSION);
  });
});
