import { describe, expect, it } from 'vitest';

import { loadWorkerEnv, publicEnvSchema } from '../../src/index.js';
import { workerEnvFixture } from '../fixtures/env.js';

/**
 * Contrat d'environnement du worker — 01_ARCHITECTURE §4.4, §38.
 *
 * Le worker validait le contrat public, et refusait donc de démarrer sans
 * `NEXT_PUBLIC_ADMIN_URL` — une URL d'écran d'administration dont un processus
 * de file n'a aucun usage. Ces tests fixent ce qu'il lui faut, et surtout ce
 * dont il n'a que faire.
 */

describe('loadWorkerEnv', () => {
  it('lit les trois variables dont le worker se sert', () => {
    const env = loadWorkerEnv(workerEnvFixture());

    expect(env.SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-de-test');
    expect(env.APP_URL).toBe('http://localhost:3001');
  });

  it('n’exige aucune variable du navigateur', () => {
    // Le cœur du sujet : un environnement sans la moindre `NEXT_PUBLIC_*`
    // suffit à démarrer le worker.
    const bare = workerEnvFixture();

    expect(Object.keys(bare).some((key) => key.startsWith('NEXT_PUBLIC_'))).toBe(false);
    expect(() => loadWorkerEnv(bare)).not.toThrow();
  });

  it('ignore les variables du navigateur quand elles traînent', () => {
    // Un `.env` partagé en porte toujours. Elles ne doivent ni gêner, ni
    // servir de source de vérité.
    const env = loadWorkerEnv(
      workerEnvFixture({
        NEXT_PUBLIC_SUPABASE_URL: 'http://autre-hote:54321',
        NEXT_PUBLIC_APP_URL: 'http://autre-hote:3001',
      }),
    );

    expect(env.SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.APP_URL).toBe('http://localhost:3001');
  });

  it('refuse une URL Supabase absente', () => {
    const { SUPABASE_URL: _absent, ...sans } = workerEnvFixture();

    expect(() => loadWorkerEnv(sans)).toThrow(/SUPABASE_URL/);
  });

  it('refuse un démarrage sans clé de service', () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _absent, ...sans } = workerEnvFixture();

    expect(() => loadWorkerEnv(sans)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('refuse une base de liens absente plutôt que d’en inventer une', () => {
    // AGENTS §38 : le worker écrit des courriels. Un lien vers localhost parti
    // en production ne se voit pas — il faut échouer au démarrage.
    const { APP_URL: _absent, ...sans } = workerEnvFixture();

    expect(() => loadWorkerEnv(sans)).toThrow(/APP_URL/);
  });

  it('refuse une base de liens qui n’est pas une URL', () => {
    expect(() => loadWorkerEnv(workerEnvFixture({ APP_URL: 'localhost:3001' }))).toThrow(/APP_URL/);
  });

  it('ne partage aucune clé avec le contrat public', () => {
    // Les deux contrats sont disjoints : c'est ce qui rend impossible de
    // refaire l'erreur d'imposer l'un à une surface qui relève de l'autre.
    const workerKeys = Object.keys(workerEnvFixture());
    const publicKeys = Object.keys(publicEnvSchema.shape);

    expect(workerKeys.filter((key) => publicKeys.includes(key))).toEqual([]);
  });
});
