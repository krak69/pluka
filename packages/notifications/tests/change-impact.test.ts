import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EmailMessage, EmailProvider, EmailSendResult } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_TEMPLATE_VERSION,
  isNotificationError,
  listModules,
  renderChangeImpactNotice,
  sendChangeImpactNotice,
  type ChangeImpactNotice,
} from '../src/index.js';

/**
 * Notification du coureur — §46, et 00_PRODUCT_SPEC §37.
 *
 * Ce qui est vérifié ici tient en trois points : le message dit ce qu'il faut
 * sans promettre ce qui n'a pas eu lieu, il ne peut porter la donnée de
 * personne d'autre, et une panne du fournisseur remonte au lieu de disparaître.
 *
 * Le fournisseur est simulé — le paquet est pur, et c'est justement ce qui
 * permet de lire le message envoyé au caractère près.
 */

const NOTICE: ChangeImpactNotice = {
  recipientEmail: 'coureur@example.test',
  recipientFirstName: 'Camille',
  eventName: 'Trail des Tests',
  raceName: 'Grand Parcours',
  changeTitle: 'cutoff/iffigenalp/arrival',
  severity: 'critical',
  modules: ['plan', 'conditions'],
  raceUrl: 'https://app.pluka.test/courses/abc',
};

function recordingProvider(sent: EmailMessage[], behaviour: 'ok' | 'throw' = 'ok'): EmailProvider {
  return {
    name: 'fournisseur-simule',
    send(message: EmailMessage): Promise<EmailSendResult> {
      sent.push(message);

      if (behaviour === 'throw') {
        return Promise.reject(new Error('smtp: connexion refusée vers coureur@example.test'));
      }

      return Promise.resolve({
        providerMessageId: 'msg-1',
        acceptedAt: '2026-03-01T08:00:00.000Z',
      });
    },
  };
}

// ============================================================
// §46 — informer, sans rien décider
// ============================================================

describe('contenu du message', () => {
  const rendered = renderChangeImpactNotice(NOTICE);

  it('nomme la course et l’élément qui a changé', () => {
    expect(rendered.subject).toContain('Grand Parcours');
    expect(rendered.textBody).toContain('Trail des Tests');
    expect(rendered.textBody).toContain('cutoff/iffigenalp/arrival');
  });

  it('dit que rien n’a été modifié à la place du coureur — §46', () => {
    // « Le recalcul se fait selon le workflow produit. » Annoncer « ton Plan a
    // été mis à jour » serait faux, et §46 place la décision chez le coureur.
    expect(rendered.textBody).toContain("Rien n'a été modifié à ta place");
    expect(rendered.textBody).not.toContain('mis à jour ton Plan');
    expect(rendered.textBody).not.toContain('recalculé');
  });

  it('énumère les modules concernés en français', () => {
    expect(rendered.textBody).toContain('ton Plan et tes Conditions');
  });

  it('adapte le ton à la sévérité, pas le fond', () => {
    expect(renderChangeImpactNotice(NOTICE).subject).toContain('Changement important');
    expect(renderChangeImpactNotice({ ...NOTICE, severity: 'info' }).subject).toContain(
      'Mise à jour',
    );
  });

  it('salue sans prénom quand il n’y en a pas', () => {
    const anonymous = renderChangeImpactNotice({ ...NOTICE, recipientFirstName: null });

    expect(anonymous.textBody.startsWith('Bonjour,')).toBe(true);
  });

  it('donne le lien vers la course', () => {
    expect(rendered.textBody).toContain('https://app.pluka.test/courses/abc');
  });
});

describe('énumération des modules', () => {
  it('ordonne toujours de la même façon', () => {
    // Deux notifications portant les mêmes modules doivent produire le même
    // texte, quel que soit l'ordre dans lequel la base les a rendus.
    expect(listModules(['conditions', 'plan'])).toBe(listModules(['plan', 'conditions']));
  });

  it('écarte les doublons', () => {
    expect(listModules(['plan', 'plan'])).toBe('ton Plan');
  });

  it('sépare le dernier par « et »', () => {
    expect(listModules(['plan', 'preparation', 'conditions'])).toBe(
      'ton Plan, ta préparation et tes Conditions',
    );
  });

  it('reste lisible si la liste est vide', () => {
    expect(listModules([])).toBe('ta préparation');
  });
});

// ============================================================
// §37 — rien d'un autre coureur, rien pour l'organisation
// ============================================================

describe('confidentialité', () => {
  it('n’écrit qu’à un destinataire, sans copie', async () => {
    // §37 : l'organisation ne doit pas apprendre qu'un coureur nommé revoit sa
    // préparation. Recevoir copie de cet email le lui apprendrait.
    const sent: EmailMessage[] = [];

    await sendChangeImpactNotice(recordingProvider(sent), {
      notice: NOTICE,
      idempotencyKey: 'race_change_impact:1:2',
    });

    expect(sent[0]?.to).toHaveLength(1);
    expect(sent[0]?.to[0]?.address).toBe('coureur@example.test');
    expect(sent[0]?.replyTo).toBeUndefined();
  });

  it('ne contient aucune adresse autre que celle du destinataire', async () => {
    const sent: EmailMessage[] = [];

    await sendChangeImpactNotice(recordingProvider(sent), {
      notice: NOTICE,
      idempotencyKey: 'race_change_impact:1:2',
    });

    const addresses = (sent[0]?.textBody ?? '').match(/[\w.+-]+@[\w.-]+/g) ?? [];

    expect(addresses).toEqual([]);
  });

  it('n’expose aucun champ où la donnée d’un tiers pourrait entrer', () => {
    // La garantie est structurelle : le gabarit ne prend que le destinataire
    // et de l'information de course. Un champ de texte libre la relâcherait.
    const fields = Object.keys(NOTICE).sort();

    expect(fields).toEqual([
      'changeTitle',
      'eventName',
      'modules',
      'raceName',
      'raceUrl',
      'recipientEmail',
      'recipientFirstName',
      'severity',
    ]);
  });
});

// ============================================================
// §22.1, §35 — idempotence et dégradation
// ============================================================

describe('envoi', () => {
  it('transmet la clé d’idempotence au fournisseur — §22.1', async () => {
    // Elle ferme la fenêtre entre « le fournisseur a accepté » et « la base le
    // sait » : si le worker meurt entre les deux, le rejeu ne double pas
    // l'email.
    const sent: EmailMessage[] = [];

    await sendChangeImpactNotice(recordingProvider(sent), {
      notice: NOTICE,
      idempotencyKey: 'race_change_impact:chg-1:part-1',
    });

    expect(sent[0]?.idempotencyKey).toBe('race_change_impact:chg-1:part-1');
  });

  it('rend de quoi tracer l’envoi', async () => {
    const result = await sendChangeImpactNotice(recordingProvider([]), {
      notice: NOTICE,
      idempotencyKey: 'k',
    });

    expect(result).toEqual({
      provider: 'fournisseur-simule',
      providerMessageId: 'msg-1',
      acceptedAt: '2026-03-01T08:00:00.000Z',
      templateVersion: NOTIFICATION_TEMPLATE_VERSION,
    });
  });

  it('remonte une panne du fournisseur comme transitoire — §35', async () => {
    // « Email indisponible → l'invitation reste persistée et le job est
    // retenté. » L'échec doit donc être réessayable, pas définitif.
    const error = await sendChangeImpactNotice(recordingProvider([], 'throw'), {
      notice: NOTICE,
      idempotencyKey: 'k',
    }).catch((thrown: unknown) => thrown);

    expect(isNotificationError(error) && error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(isNotificationError(error) && error.permanent).toBe(false);
  });

  it('ne laisse pas fuir l’adresse dans le message d’erreur', async () => {
    // §130 de 03_PRIVACY_RLS : une erreur finit dans les logs. Le message du
    // fournisseur peut contenir l'adresse ; on n'en garde que le nom.
    const error = await sendChangeImpactNotice(recordingProvider([], 'throw'), {
      notice: NOTICE,
      idempotencyKey: 'k',
    }).catch((thrown: unknown) => thrown);

    expect(String((error as Error).message)).not.toContain('coureur@example.test');
  });

  it('refuse définitivement une adresse inexploitable', async () => {
    // Elle ne deviendra pas valide au prochain essai : la réessayer cinq fois
    // serait du gaspillage.
    const sent: EmailMessage[] = [];

    const error = await sendChangeImpactNotice(recordingProvider(sent), {
      notice: { ...NOTICE, recipientEmail: 'pas-une-adresse' },
      idempotencyKey: 'k',
    }).catch((thrown: unknown) => thrown);

    expect(isNotificationError(error) && error.code).toBe('RECIPIENT_INVALID');
    expect(isNotificationError(error) && error.permanent).toBe(true);
    // Et rien n'a été soumis au fournisseur.
    expect(sent).toEqual([]);
  });
});

// ============================================================
// Frontières du paquet
// ============================================================

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sources(directory: string = SRC): readonly { path: string; text: string }[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) return sources(path);
    if (!path.endsWith('.ts')) return [];

    return [{ path: path.slice(SRC.length + 1), text: readFileSync(path, 'utf8') }];
  });
}

/** Le corps du fichier, commentaires retirés : une mention en prose ne compte pas. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('frontières du paquet', () => {
  const files = sources();

  it('ne définit aucune interface de fournisseur', () => {
    // §4.5 : `EmailProvider` appartient à `packages/contracts`. En définir une
    // ici rouvrirait la porte que cette frontière ferme.
    const offenders = files.filter(({ text }) =>
      /(?:export\s+)?(?:interface|type)\s+\w*(?:Email|AI|Weather|Billing)?Provider\b/.test(
        code(text),
      ),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('importe EmailProvider de packages/contracts', () => {
    const importing = files.filter(({ text }) => /\bEmailProvider\b/.test(code(text)));

    expect(importing.length).toBeGreaterThan(0);

    for (const file of importing) {
      expect(code(file.text)).toMatch(
        /import type \{[^}]*EmailProvider[^}]*\} from '@pluka\/contracts'/,
      );
    }
  });

  it('ne connaît le nom d’aucun fournisseur', () => {
    const vendors = /\b(resend|sendgrid|postmark|mailgun|ses|brevo|mailjet|sparkpost)\b/i;
    const offenders = files.filter(({ text }) => vendors.test(code(text)));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('ne fait ni réseau, ni base', () => {
    const forbidden = /from '(?:next|@supabase|node:https?|undici)|\bfetch\s*\(|createClient\s*\(/;
    const offenders = files.filter(({ text }) => forbidden.test(code(text)));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});
