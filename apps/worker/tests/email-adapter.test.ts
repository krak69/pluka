import type { EmailMessage } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import { createEmail, createResendProvider } from '../src/email/index.js';
import { isUndeliverableAddress } from '../src/email/resend.js';

/**
 * L'adapter email concret, hors du paquet pur.
 *
 * `packages/notifications` reçoit un `EmailProvider` et ne sait rien de ce
 * qu'il y a derrière — 01_ARCHITECTURE §4.5 et §28. Tout ce qui concerne un
 * fournisseur nommé se vérifie donc ici.
 *
 * Le transport est injecté : le contrat s'exerce entièrement — en-têtes,
 * expéditeur, absence de copie — sans appeler le fournisseur ni détenir de clé.
 */

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function stub(reply: unknown, status = 200): { fetch: typeof globalThis.fetch; sent: Sent[] } {
  const sent: Sent[] = [];

  const fetchStub = ((url: string, init: RequestInit): Promise<Response> => {
    sent.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });

    return Promise.resolve(
      new Response(JSON.stringify(reply), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fetchStub, sent };
}

const MESSAGE: EmailMessage = {
  to: [{ address: 'coureur@trail.fr', name: 'Camille' }],
  subject: 'Changement important — Grand Parcours',
  textBody: 'Bonjour Camille,',
  idempotencyKey: 'race_change_impact:chg-1:part-1',
};

describe('adapter email', () => {
  it('envoie au bon point d’entrée, avec la clé du fournisseur', async () => {
    const { fetch, sent } = stub({ id: 'msg-1' });

    await createResendProvider({ apiKey: 'k', from: 'PLUKA <no-reply@pluka.test>', fetch }).send(
      MESSAGE,
    );

    expect(sent[0]?.url).toContain('api.resend.com');
    expect(sent[0]?.headers.authorization).toBe('Bearer k');
    // §22.1 : la clé du contrat devient celle du fournisseur, qui dédoublonne
    // si le worker meurt entre l'envoi et l'écriture en base.
    expect(sent[0]?.headers['idempotency-key']).toBe('race_change_impact:chg-1:part-1');
  });

  it('prend l’expéditeur de la configuration, jamais du message', async () => {
    // Le contrat le dit : l'expéditeur n'appartient pas au message. C'est ce
    // qui empêche un gabarit d'usurper une adresse.
    const { fetch, sent } = stub({ id: 'msg-1' });

    await createResendProvider({ apiKey: 'k', from: 'PLUKA <no-reply@pluka.test>', fetch }).send(
      MESSAGE,
    );

    expect(sent[0]?.body.from).toBe('PLUKA <no-reply@pluka.test>');
  });

  it('n’envoie ni copie ni copie cachée', async () => {
    // §37 : l'organisation ne reçoit rien.
    const { fetch, sent } = stub({ id: 'msg-1' });

    await createResendProvider({ apiKey: 'k', from: 'a@b.test', fetch }).send(MESSAGE);

    expect(sent[0]?.body.to).toEqual(['Camille <coureur@trail.fr>']);
    expect(sent[0]?.body.cc).toBeUndefined();
    expect(sent[0]?.body.bcc).toBeUndefined();
  });

  it('rend l’identifiant du fournisseur', async () => {
    const { fetch } = stub({ id: 'msg-42' });

    const result = await createResendProvider({ apiKey: 'k', from: 'a@b.test', fetch }).send(
      MESSAGE,
    );

    expect(result.providerMessageId).toBe('msg-42');
    expect(Date.parse(result.acceptedAt)).not.toBeNaN();
  });

  it('distingue une panne passagère d’une requête fautive', async () => {
    // Réessayer cinq fois un 422 est du gaspillage ; un 503 mérite ses
    // tentatives (01_ARCHITECTURE §22.1, §35).
    const server = stub({ error: 'oops' }, 503);
    const client = stub({ error: 'adresse refusée' }, 422);

    const first = await createResendProvider({ apiKey: 'k', from: 'a@b.test', fetch: server.fetch })
      .send(MESSAGE)
      .catch((error: unknown) => error);

    const second = await createResendProvider({
      apiKey: 'k',
      from: 'a@b.test',
      fetch: client.fetch,
    })
      .send(MESSAGE)
      .catch((error: unknown) => error);

    expect((first as { kind: string }).kind).toBe('transient');
    expect((second as { kind: string }).kind).toBe('permanent');
  });

  it('n’expose pas la clé dans le corps de la requête', async () => {
    const { fetch, sent } = stub({ id: 'msg-1' });

    await createResendProvider({ apiKey: 'secret-abc', from: 'a@b.test', fetch }).send(MESSAGE);

    expect(JSON.stringify(sent[0]?.body)).not.toContain('secret-abc');
  });

  it('refuse définitivement un domaine réservé, sans appeler le fournisseur', async () => {
    // Un rebond par adresse de démonstration dégraderait la réputation du
    // domaine d'expédition ; ces domaines ne reçoivent jamais de courrier.
    for (const address of [
      'coureur@example.com',
      'coureur@mail.example.org',
      'coureur@example.test',
      'coureur@nulle-part.invalid',
      'coureur@machine.localhost',
    ]) {
      const { fetch, sent } = stub({ id: 'msg-1' });

      const error = await createResendProvider({ apiKey: 'k', from: 'a@b.test', fetch })
        .send({ ...MESSAGE, to: [{ address }] })
        .catch((thrown: unknown) => thrown);

      expect((error as { kind: string }).kind, address).toBe('permanent');
      expect((error as { code: string }).code, address).toBe('EMAIL_RECIPIENT_RESERVED');
      expect(sent, address).toEqual([]);
    }
  });

  it('laisse passer un domaine qui ressemble seulement à un domaine réservé', async () => {
    for (const address of ['coureur@example.fr', 'coureur@testeur.com', 'test@pluka.run']) {
      expect(isUndeliverableAddress(address), address).toBe(false);
    }
  });
});

describe('choix du fournisseur', () => {
  it('ne configure rien quand rien n’est nommé', () => {
    // §28 : « se désactiver proprement, pas fabriquer une valeur ». §35 décrit
    // la suite : la livraison reste persistée et le job est retenté.
    expect(createEmail({})).toBeNull();
  });

  it('exige la clé et l’expéditeur avec le fournisseur', () => {
    expect(createEmail({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'k' })).toBeNull();
    expect(createEmail({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.test' })).toBeNull();
  });

  it('construit l’adapter quand tout est là', () => {
    const provider = createEmail({
      EMAIL_PROVIDER: 'resend',
      EMAIL_API_KEY: 'k',
      EMAIL_FROM: 'a@b.test',
    });

    expect(provider?.name).toBe('resend');
  });

  it('ignore un fournisseur sans adapter', () => {
    expect(
      createEmail({ EMAIL_PROVIDER: 'inconnu', EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@b.test' }),
    ).toBeNull();
  });
});
