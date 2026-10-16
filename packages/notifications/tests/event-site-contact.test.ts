import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import { NotificationError, renderEventSiteContact, sendEventSiteContact } from '../src/index.js';

/**
 * Le message d'un coureur à l'organisation, depuis le site — EVENT_SITE §6.
 *
 * Répondre répond au coureur ; ce qu'il a écrit arrive tel quel ; un nom saisi
 * par un visiteur n'ouvre aucun en-tête de plus.
 */

const NOTICE = {
  recipientEmail: 'courses@trail.test',
  eventName: 'Trail de Test',
  raceName: '80K',
  senderName: 'Alex Martin',
  senderEmail: 'alex@test.pluka',
  body: 'Bonjour,\nle retrait des dossards ouvre à quelle heure ?',
};

function provider(sent: EmailMessage[]): EmailProvider {
  return {
    name: 'fake',
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm-1', acceptedAt: '2026-10-16T10:00:00Z' });
    },
  } as EmailProvider;
}

describe('le message', () => {
  it('dit qui écrit, pour quelle épreuve, et garde le texte tel quel', () => {
    const rendered = renderEventSiteContact(NOTICE);

    expect(rendered.subject).toBe('Message de Alex Martin · 80K — Trail de Test');
    expect(rendered.textBody).toContain('le retrait des dossards ouvre à quelle heure ?');
    expect(rendered.textBody).toContain('la réponse part à alex@test.pluka');
    expect(rendered.textBody).toContain('sans le conserver');
  });

  it('ne laisse aucun saut de ligne entrer dans l’objet', () => {
    const rendered = renderEventSiteContact({
      ...NOTICE,
      senderName: 'Alex\r\nBcc: tous@exemple.test',
    });

    expect(rendered.subject).not.toMatch(/[\r\n]/u);
  });
});

describe('l’envoi', () => {
  it('part à l’organisation, réponse au coureur', async () => {
    const sent: EmailMessage[] = [];
    await sendEventSiteContact(provider(sent), { idempotencyKey: 'contact:1', notice: NOTICE });

    expect(sent[0]?.to).toEqual([{ address: 'courses@trail.test' }]);
    expect(sent[0]?.replyTo).toEqual({ address: 'alex@test.pluka', name: 'Alex Martin' });
    expect(sent[0]?.idempotencyKey).toBe('contact:1');
  });

  it('nettoie le nom avant de l’écrire dans `Reply-To`', async () => {
    const sent: EmailMessage[] = [];
    await sendEventSiteContact(provider(sent), {
      idempotencyKey: 'contact:2',
      notice: { ...NOTICE, senderName: 'Alex "le boss" <x@y>\r\nBcc: z@w' },
    });

    expect(sent[0]?.replyTo?.name).not.toMatch(/[\r\n"<>]/u);
  });

  it('refuse un destinataire inexploitable, sans rien envoyer', async () => {
    const sent: EmailMessage[] = [];
    await expect(
      sendEventSiteContact(provider(sent), {
        idempotencyKey: 'contact:3',
        notice: { ...NOTICE, recipientEmail: 'pas-une-adresse' },
      }),
    ).rejects.toBeInstanceOf(NotificationError);
    expect(sent).toEqual([]);
  });
});
