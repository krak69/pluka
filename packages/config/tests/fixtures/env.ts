import type { EnvSource } from '../../src/index.js';

/**
 * Environnements de test.
 *
 * Valeurs fictives, isolées de la logique du paquet (AGENTS §48). Aucune ne doit
 * ressembler à un identifiant réel.
 */

export function publicEnvFixture(overrides: EnvSource = {}): EnvSource {
  return {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-de-test',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
    NEXT_PUBLIC_ADMIN_URL: 'http://localhost:3002',
    ...overrides,
  };
}

/**
 * Environnement du worker.
 *
 * Aucune variable `NEXT_PUBLIC_*` : c'est le sujet du contrat, pas un oubli.
 */
export function workerEnvFixture(overrides: EnvSource = {}): EnvSource {
  return {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-test',
    APP_URL: 'http://localhost:3001',
    ...overrides,
  };
}

export function serverEnvFixture(overrides: EnvSource = {}): EnvSource {
  return {
    ...publicEnvFixture(),
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-test',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ...overrides,
  };
}
