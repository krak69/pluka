import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadPublicEnv } from '../../src/index.js';
import { publicEnvFixture } from '../fixtures/env.js';

describe('loadPublicEnv', () => {
  it('lit les variables publiques attendues', () => {
    const env = loadPublicEnv(publicEnvFixture());

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-key-de-test');
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3001');
  });

  it('laisse le DSN Sentry navigateur facultatif', () => {
    expect(loadPublicEnv(publicEnvFixture()).NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();

    const withDsn = loadPublicEnv(
      publicEnvFixture({ NEXT_PUBLIC_SENTRY_DSN: 'https://exemple.test/42' }),
    );
    expect(withDsn.NEXT_PUBLIC_SENTRY_DSN).toBe('https://exemple.test/42');
  });

  it('ignore les variables hors schéma', () => {
    const env = loadPublicEnv(
      publicEnvFixture({ PATH: '/usr/bin', SUPABASE_SERVICE_ROLE_KEY: 'x' }),
    );

    expect(Object.keys(env).sort()).toEqual([
      'NEXT_PUBLIC_ADMIN_URL',
      'NEXT_PUBLIC_APP_URL',
      'NEXT_PUBLIC_SITE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
    ]);
  });

  it('refuse une variable requise absente', () => {
    const source = publicEnvFixture();
    const { NEXT_PUBLIC_SUPABASE_ANON_KEY: _omitted, ...withoutAnonKey } = source;

    expect(() => loadPublicEnv(withoutAnonKey)).toThrow(EnvValidationError);
    expect(() => loadPublicEnv(withoutAnonKey)).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('traite une variable vide comme absente', () => {
    expect(() => loadPublicEnv(publicEnvFixture({ NEXT_PUBLIC_SUPABASE_ANON_KEY: '   ' }))).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY : variable requise/,
    );
  });

  it.each(['ftp://exemple.test', 'file:///etc/passwd', 'pas-une-url'])(
    'refuse une URL non http(s) : %s',
    (value) => {
      expect(() => loadPublicEnv(publicEnvFixture({ NEXT_PUBLIC_SITE_URL: value }))).toThrow(
        /NEXT_PUBLIC_SITE_URL : URL http\(s\) attendue/,
      );
    },
  );

  it('signale toutes les variables fautives en une passe', () => {
    try {
      loadPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' });
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const keys = (error as EnvValidationError).issues.map((issue) => issue.key);
      expect(keys).toEqual([
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'NEXT_PUBLIC_SITE_URL',
        'NEXT_PUBLIC_APP_URL',
        'NEXT_PUBLIC_ADMIN_URL',
      ]);
    }
  });
});
