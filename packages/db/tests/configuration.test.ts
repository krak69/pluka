import { describe, expect, it } from 'vitest';

import { assertSupabaseUrl, classifySupabaseKey, DbError } from '../src/index.js';

/** Fabrique un JWT de forme réaliste — signature factice, jamais vérifiée ici. */
function jwtWithRole(role: string): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.signature-factice`;
}

describe('classifySupabaseKey', () => {
  it('reconnaît le format publiable', () => {
    expect(classifySupabaseKey('sb_publishable_abc')).toBe('publishable');
  });

  it('reconnaît le format secret', () => {
    expect(classifySupabaseKey('sb_secret_abc')).toBe('secret');
  });

  it('reconnaît un JWT anon', () => {
    expect(classifySupabaseKey(jwtWithRole('anon'))).toBe('publishable');
  });

  it('reconnaît un JWT service_role', () => {
    expect(classifySupabaseKey(jwtWithRole('service_role'))).toBe('secret');
  });

  it('rend unknown sur une chaîne vide', () => {
    expect(classifySupabaseKey('')).toBe('unknown');
    expect(classifySupabaseKey('   ')).toBe('unknown');
  });

  it('rend unknown plutôt que de deviner', () => {
    // Une clé de forme inconnue n'est pas une preuve. Refuser le démarrage sur
    // une supposition casserait un déploiement légitime (AGENTS §38).
    expect(classifySupabaseKey('une-cle-maison')).toBe('unknown');
    expect(classifySupabaseKey(jwtWithRole('authenticated'))).toBe('unknown');
  });

  it('ne casse pas sur un JWT illisible', () => {
    expect(classifySupabaseKey('a.b.c')).toBe('unknown');
    expect(classifySupabaseKey('pas.un.jwt.du.tout')).toBe('unknown');
  });

  it('tolère les espaces autour de la clé', () => {
    expect(classifySupabaseKey('  sb_secret_abc  ')).toBe('secret');
  });
});

describe('assertSupabaseUrl', () => {
  it('accepte http et https', () => {
    expect(assertSupabaseUrl('http://127.0.0.1:54321', 'op')).toBe('http://127.0.0.1:54321');
    expect(assertSupabaseUrl('https://projet.supabase.co', 'op')).toBe(
      'https://projet.supabase.co',
    );
  });

  it('normalise la barre oblique finale', () => {
    // Deux configurations qui ne diffèrent que par elle doivent produire le
    // même client.
    expect(assertSupabaseUrl('https://projet.supabase.co/', 'op')).toBe(
      'https://projet.supabase.co',
    );
  });

  it('refuse une URL non analysable', () => {
    expect(() => assertSupabaseUrl('pas-une-url', 'op')).toThrow(DbError);
  });

  it('refuse un protocole autre que http(s)', () => {
    // Chaque requête emporte le jeton d'accès : une base mal formée
    // l'enverrait ailleurs (01_ARCHITECTURE §32.1).
    for (const url of ['ftp://projet.supabase.co', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(() => assertSupabaseUrl(url, 'op')).toThrow(/refusé|invalide/);
    }
  });

  it('rend une erreur de configuration nommant l’opération', () => {
    try {
      assertSupabaseUrl('ftp://x.test', 'createServerClient');
      expect.unreachable('une DbError était attendue');
    } catch (error) {
      expect((error as DbError).code).toBe('invalid_configuration');
      expect((error as DbError).operation).toBe('createServerClient');
    }
  });

  it('ne recopie jamais la valeur fautive dans le message', () => {
    // Une URL peut porter un identifiant de projet : elle reste hors du
    // message d'erreur, qui peut finir dans un log partagé.
    try {
      assertSupabaseUrl('ftp://projet-secret.supabase.co', 'op');
      expect.unreachable('une DbError était attendue');
    } catch (error) {
      expect((error as Error).message).not.toContain('projet-secret');
    }
  });
});
