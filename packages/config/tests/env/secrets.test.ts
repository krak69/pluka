import { describe, expect, it } from 'vitest';

import {
  assertNoLeakedServerSecrets,
  EnvValidationError,
  findLeakedServerSecrets,
  PUBLIC_ENV_PREFIX,
  SERVER_ONLY_ENV_KEYS,
} from '../../src/index.js';
import { serverEnvFixture } from '../fixtures/env.js';

describe('secrets serveur', () => {
  it('aucune variable réservée au serveur ne porte le préfixe public', () => {
    for (const key of SERVER_ONLY_ENV_KEYS) {
      expect(key.startsWith(PUBLIC_ENV_PREFIX)).toBe(false);
    }
  });

  it('ne signale rien sur une configuration saine', () => {
    expect(findLeakedServerSecrets(serverEnvFixture())).toEqual([]);
    expect(() => assertNoLeakedServerSecrets(serverEnvFixture())).not.toThrow();
  });

  it('détecte une clé service_role recopiée dans une variable publique', () => {
    const source = serverEnvFixture({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'service-role-de-test' });

    expect(findLeakedServerSecrets(source)).toEqual([
      { publicKey: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', secretKey: 'SUPABASE_SERVICE_ROLE_KEY' },
    ]);
  });

  it('détecte une variable publique ad hoc portant un secret', () => {
    const source = serverEnvFixture({
      WEATHER_PROVIDER: 'provider-de-test',
      WEATHER_API_KEY: 'cle-meteo-de-test',
      NEXT_PUBLIC_WEATHER_KEY: 'cle-meteo-de-test',
    });

    expect(findLeakedServerSecrets(source)).toEqual([
      { publicKey: 'NEXT_PUBLIC_WEATHER_KEY', secretKey: 'WEATHER_API_KEY' },
    ]);
  });

  it('ignore les variables vides des deux côtés', () => {
    const source = serverEnvFixture({ AI_API_KEY: '', NEXT_PUBLIC_VIDE: '' });

    expect(findLeakedServerSecrets(source)).toEqual([]);
  });

  it('lève sans divulguer la valeur fuitée', () => {
    const source = serverEnvFixture({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'service-role-de-test' });

    try {
      assertNoLeakedServerSecrets(source);
      expect.unreachable('la fuite aurait dû être signalée');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const failure = error as EnvValidationError;
      expect(failure.message).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
      expect(failure.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(failure.message).not.toContain('service-role-de-test');
    }
  });
});
