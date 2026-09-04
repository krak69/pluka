import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadServerEnv } from '../../src/index.js';
import { serverEnvFixture } from '../fixtures/env.js';

describe('loadServerEnv', () => {
  it('regroupe la configuration serveur par domaine', () => {
    const env = loadServerEnv(serverEnvFixture());

    expect(env.public.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.supabase.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-de-test');
    expect(env.database.DATABASE_URL).toContain('postgresql://');
    expect(env.observability.SENTRY_DSN).toBeUndefined();
    expect(env.flags).toEqual({
      repere_pluka: false,
      race_intelligence: false,
      community: false,
      advanced_offline: false,
    });
  });

  it('accepte une configuration sans aucun provider externe', () => {
    const env = loadServerEnv(serverEnvFixture());

    expect(env.providers.WEATHER_PROVIDER).toBeUndefined();
    expect(env.providers.AI_PROVIDER).toBeUndefined();
    expect(env.providers.BILLING_PROVIDER).toBeUndefined();
  });

  it('lit un provider complètement configuré', () => {
    const env = loadServerEnv(
      serverEnvFixture({ WEATHER_PROVIDER: 'provider-de-test', WEATHER_API_KEY: 'cle-de-test' }),
    );

    expect(env.providers.WEATHER_PROVIDER).toBe('provider-de-test');
    expect(env.providers.WEATHER_API_KEY).toBe('cle-de-test');
  });

  it('refuse un provider nommé sans ses identifiants', () => {
    expect(() => loadServerEnv(serverEnvFixture({ WEATHER_PROVIDER: 'provider-de-test' }))).toThrow(
      /WEATHER_API_KEY : requis dès que WEATHER_PROVIDER est défini/,
    );
  });

  it('exige le secret de webhook dès qu’un provider de paiement est défini', () => {
    try {
      loadServerEnv(
        serverEnvFixture({ BILLING_PROVIDER: 'provider-de-test', BILLING_API_KEY: 'cle-de-test' }),
      );
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.map((issue) => issue.key)).toEqual([
        'BILLING_WEBHOOK_SECRET',
      ]);
    }
  });

  it('exige une URL PostgreSQL pour DATABASE_URL', () => {
    expect(() =>
      loadServerEnv(serverEnvFixture({ DATABASE_URL: 'http://127.0.0.1:5432' })),
    ).toThrow(/DATABASE_URL : URL postgres\(ql\):\/\/ attendue/);
  });

  it('collecte les problèmes de plusieurs groupes avant de lever', () => {
    try {
      loadServerEnv(
        serverEnvFixture({
          SUPABASE_SERVICE_ROLE_KEY: '',
          DATABASE_URL: 'redis://127.0.0.1:6379',
          FLAG_COMMUNITY: 'peut-être',
        }),
      );
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.map((issue) => issue.key).sort()).toEqual([
        'DATABASE_URL',
        'FLAG_COMMUNITY',
        'SUPABASE_SERVICE_ROLE_KEY',
      ]);
    }
  });

  it('ne divulgue jamais la valeur reçue dans le message d’erreur', () => {
    const secret = 'valeur-qui-ne-doit-pas-fuiter';

    try {
      loadServerEnv(serverEnvFixture({ DATABASE_URL: secret }));
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const failure = error as EnvValidationError;
      expect(failure.message).not.toContain(secret);
      for (const issue of failure.issues) {
        expect(issue.message).not.toContain(secret);
      }
    }
  });
});
