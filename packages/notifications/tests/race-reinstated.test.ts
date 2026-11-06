import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  RACE_CANCELLED_TEMPLATE_VERSION,
  RACE_REINSTATED_TEMPLATE_VERSION,
  isNotificationError,
  renderRaceCancelledNotice,
  renderRaceReinstatedNotice,
  sendRaceCancelledNotice,
  sendRaceReinstatedNotice,
  type RaceStatusNotice,
} from '../src/index.js';

/** L'annulation et sa levée — 00_PRODUCT_SPEC §4.1. */

const NOTICE: RaceStatusNotice = {
  recipientEmail: 'coureur@example.test',
  recipientFirstName: 'Camille',
  eventName: 'Trail des Tests',
  raceName: 'Grand Parcours',
  raceUrl: 'https://app.pluka.test/courses/abc',
};

function provider(sent: EmailMessage[], behaviour: 'ok' | 'throw' = 'ok'): EmailProvider {
  return {
    name: 'test',
    send(message) {
      if (behaviour === 'throw') return Promise.reject(new Error('coureur@example.test'));
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm1', acceptedAt: '2026-11-06T10:00:00Z' });
    },
  };
}

describe('l’avis d’annulation', () => {
  it('dit que l’épreuve est annulée, sans rien promettre', () => {
    const { subject, textBody } = renderRaceCancelledNotice(NOTICE);

    expect(subject).toBe('Épreuve annulée — Grand Parcours');
    expect(textBody).toContain('Bonjour Camille,');
    expect(textBody).toContain("L'organisation a annulé Grand Parcours (Trail des Tests).");
    expect(textBody).toContain("rien n'a été supprimé");
    expect(textBody).not.toMatch(/rembours|report/iu);
  });

  it('n’écrit qu’au coureur, sous sa propre version de gabarit', async () => {
    const sent: EmailMessage[] = [];

    const result = await sendRaceCancelledNotice(provider(sent), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    });

    expect(sent[0]?.to).toEqual([{ address: NOTICE.recipientEmail, name: 'Camille' }]);
    expect(sent[0]?.subject).toBe('Épreuve annulée — Grand Parcours');
    expect(result.templateVersion).toBe(RACE_CANCELLED_TEMPLATE_VERSION);
  });
});

describe('l’avis de rétablissement', () => {
  it('dit que l’annulation est levée et que rien n’a bougé', () => {
    const { subject, textBody } = renderRaceReinstatedNotice(NOTICE);

    expect(subject).toBe('Annulation levée — Grand Parcours');
    expect(textBody).toContain('Bonjour Camille,');
    expect(textBody).toContain('Grand Parcours (Trail des Tests)');
    expect(textBody).toContain("rien n'a été modifié");
    expect(textBody).toContain(NOTICE.raceUrl);
  });

  it('salue sans prénom quand il n’y en a pas', () => {
    const { textBody } = renderRaceReinstatedNotice({ ...NOTICE, recipientFirstName: null });

    expect(textBody.startsWith('Bonjour,')).toBe(true);
  });

  it('n’écrit qu’au coureur, avec la clé d’idempotence', async () => {
    const sent: EmailMessage[] = [];

    const result = await sendRaceReinstatedNotice(provider(sent), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([{ address: NOTICE.recipientEmail, name: 'Camille' }]);
    expect(sent[0]?.idempotencyKey).toBe('cle');
    expect(result.templateVersion).toBe(RACE_REINSTATED_TEMPLATE_VERSION);
  });

  it('refuse une adresse inexploitable, définitivement', async () => {
    const failure = await sendRaceReinstatedNotice(provider([]), {
      notice: { ...NOTICE, recipientEmail: 'pas-une-adresse' },
      idempotencyKey: 'cle',
    }).catch((error: unknown) => error);

    expect(isNotificationError(failure) && failure.permanent).toBe(true);
  });

  it('une panne du fournisseur se retente et ne laisse pas fuir l’adresse', async () => {
    const failure = await sendRaceReinstatedNotice(provider([], 'throw'), {
      notice: NOTICE,
      idempotencyKey: 'cle',
    }).catch((error: unknown) => error);

    expect(isNotificationError(failure) && failure.permanent).toBe(false);
    expect(String(failure)).not.toContain(NOTICE.recipientEmail);
  });
});
