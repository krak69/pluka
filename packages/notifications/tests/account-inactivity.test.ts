import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_INACTIVITY_TEMPLATE_VERSION,
  isNotificationError,
  renderAccountInactivityNotice,
  sendAccountInactivityNotice,
  type AccountInactivityNotice,
} from '../src/index.js';

/** L'avertissement avant suppression d'un compte inactif — migration 0079. */

const NOTICE: AccountInactivityNotice = {
  recipientEmail: 'coureur@example.test',
  recipientFirstName: 'Camille',
  purgeAfter: '2029-12-10T03:17:00Z',
  signInUrl: 'https://app.pluka.test/connexion',
  exportUrl: 'https://app.pluka.test/profil/donnees',
  privacyUrl: 'https://pluka.test/confidentialite',
};

function provider(sent: EmailMessage[], behaviour: 'ok' | 'throw' = 'ok'): EmailProvider {
  return {
    name: 'test',
    send(message) {
      if (behaviour === 'throw') return Promise.reject(new Error('coureur@example.test'));
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm1', acceptedAt: '2029-11-10T10:00:00Z' });
    },
  };
}

describe('l’avertissement de compte inactif', () => {
  it('donne la date, comment garder le compte et comment récupérer ses données', () => {
    const { subject, textBody } = renderAccountInactivityNotice(NOTICE);

    expect(subject).toBe('Ton compte PLUKA sera supprimé le 10 décembre 2029');
    expect(textBody).toContain('Bonjour Camille,');
    expect(textBody).toContain('https://app.pluka.test/connexion');
    expect(textBody).toContain('https://app.pluka.test/profil/donnees');
    expect(textBody).toContain('https://pluka.test/confidentialite');
  });

  it('n’écrit qu’au coureur, sous sa propre version de gabarit', async () => {
    const sent: EmailMessage[] = [];
    const result = await sendAccountInactivityNotice(provider(sent), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    });

    expect(sent[0]?.to).toEqual([{ address: NOTICE.recipientEmail, name: 'Camille' }]);
    expect(sent[0]?.idempotencyKey).toBe('cle');
    expect(result.templateVersion).toBe(ACCOUNT_INACTIVITY_TEMPLATE_VERSION);
  });

  it('refuse une adresse inexploitable, et ne laisse pas fuir l’adresse en panne', async () => {
    await expect(
      sendAccountInactivityNotice(provider([]), {
        notice: { ...NOTICE, recipientEmail: 'pas-une-adresse' },
        idempotencyKey: 'cle',
      }),
    ).rejects.toSatisfy(isNotificationError);

    const failure = await sendAccountInactivityNotice(provider([], 'throw'), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    }).catch((error: unknown) => error);
    expect(String((failure as Error).message)).not.toContain('coureur@example.test');
  });
});
