import { describe, expect, it } from 'vitest';

import { DbError } from '../src/index.js';
import { buildBrowserClientOptions, createBrowserClient } from '../src/browser/index.js';
import {
  buildServerClientOptions,
  createServerClient,
  createServiceRoleClient,
} from '../src/server/index.js';

const URL = 'http://127.0.0.1:54321';
const PUBLISHABLE = 'sb_publishable_de-test';
const SECRET = 'sb_secret_de-test';

describe('options serveur', () => {
  it('ne persiste ni ne rafraîchit la session', () => {
    // Un état de session partagé entre deux requêtes ferait fuir la session
    // d'un utilisateur vers un autre.
    const options = buildServerClientOptions();

    expect(options.auth?.persistSession).toBe(false);
    expect(options.auth?.autoRefreshToken).toBe(false);
    expect(options.auth?.detectSessionInUrl).toBe(false);
  });

  it('fige le schéma sur public', () => {
    // Le schéma `private` reste hors de portée, y compris avec une clé de
    // service (02_DATA_MODEL §25).
    expect(buildServerClientOptions().db?.schema).toBe('public');
  });

  it('porte le jeton d’accès quand il est fourni', () => {
    const headers = buildServerClientOptions('jeton-de-test').global?.headers as
      Record<string, string> | undefined;

    expect(headers?.Authorization).toBe('Bearer jeton-de-test');
  });

  it('n’invente pas d’en-tête en l’absence de jeton', () => {
    // Sans jeton, le client agit en `anon` : ajouter un Authorization vide
    // produirait un refus opaque au lieu d'une lecture publique.
    expect(buildServerClientOptions().global?.headers).toEqual({});
  });
});

describe('options navigateur', () => {
  it('persiste et rafraîchit la session', () => {
    const options = buildBrowserClientOptions();

    expect(options.auth?.persistSession).toBe(true);
    expect(options.auth?.autoRefreshToken).toBe(true);
  });

  it('laisse l’échange du code au serveur', () => {
    // Le jeton ne doit pas transiter par l'URL du navigateur
    // (01_ARCHITECTURE §10).
    expect(buildBrowserClientOptions().auth?.detectSessionInUrl).toBe(false);
  });

  it('fige le schéma sur public', () => {
    expect(buildBrowserClientOptions().db?.schema).toBe('public');
  });
});

describe('createServerClient', () => {
  it('construit un client sous la session de l’utilisateur', () => {
    const client = createServerClient({
      url: URL,
      publishableKey: PUBLISHABLE,
      accessToken: 'jeton',
    });

    expect(client.from).toBeTypeOf('function');
  });

  it('refuse une clé secrète présentée comme publiable', () => {
    // Le nom du paramètre est un contrat : une clé secrète passée ici
    // contournerait la RLS sans que l'appelant l'ait décidé.
    expect(() => createServerClient({ url: URL, publishableKey: SECRET })).toThrow(DbError);
    expect(() => createServerClient({ url: URL, publishableKey: SECRET })).toThrow(/contournerait/);
  });

  it('refuse une URL invalide', () => {
    expect(() => createServerClient({ url: 'ftp://x.test', publishableKey: PUBLISHABLE })).toThrow(
      DbError,
    );
  });
});

describe('createServiceRoleClient', () => {
  it('construit un client de service', () => {
    expect(createServiceRoleClient({ url: URL, secretKey: SECRET }).from).toBeTypeOf('function');
  });

  it('refuse une clé publiable présentée comme clé de service', () => {
    // Sinon l'appelant croirait contourner la RLS et travaillerait en `anon`,
    // avec des résultats vides pris pour des absences.
    expect(() => createServiceRoleClient({ url: URL, secretKey: PUBLISHABLE })).toThrow(DbError);
  });

  it('accepte une clé de forme inconnue, faute de preuve', () => {
    expect(createServiceRoleClient({ url: URL, secretKey: 'cle-maison' }).from).toBeTypeOf(
      'function',
    );
  });
});

describe('createBrowserClient', () => {
  it('construit un client soumis à la RLS', () => {
    expect(createBrowserClient({ url: URL, publishableKey: PUBLISHABLE }).from).toBeTypeOf(
      'function',
    );
  });

  it('refuse une clé prouvée secrète', () => {
    // Dernière barrière avant un bundle qui embarquerait `service_role`
    // (03_PRIVACY_RLS §8).
    expect(() => createBrowserClient({ url: URL, publishableKey: SECRET })).toThrow(DbError);
  });

  it('refuse aussi un JWT service_role', () => {
    const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ role: 'service_role' }),
    ).toString('base64url')}.sig`;

    expect(() => createBrowserClient({ url: URL, publishableKey: jwt })).toThrow(DbError);
  });

  it('laisse passer une clé de forme inconnue', () => {
    // Refuser sur une supposition casserait un déploiement légitime : la
    // preuve, c'est `sb_secret_*` ou `role: service_role`.
    expect(createBrowserClient({ url: URL, publishableKey: 'cle-maison' }).from).toBeTypeOf(
      'function',
    );
  });

  it('refuse une URL invalide', () => {
    expect(() => createBrowserClient({ url: 'pas-une-url', publishableKey: PUBLISHABLE })).toThrow(
      DbError,
    );
  });
});
