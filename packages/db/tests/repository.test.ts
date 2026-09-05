import { describe, expect, it } from 'vitest';

import {
  defineRepository,
  selectColumns,
  unwrapMaybe,
  type PlukaClient,
  type RepositoryContext,
} from '../src/index.js';

/**
 * Structure des repositories.
 *
 * Aucun repository métier n'est fourni par ce paquet : chacun arrive avec le
 * lot qui définit ses requêtes et ses tests d'intégration. Ce fichier vérifie
 * la structure — l'injection du client et la forme d'une implémentation — pas
 * une requête particulière.
 */

/** Client minimal : seul le chemin `from().select().eq().maybeSingle()` est simulé. */
function fakeClient(row: unknown): { client: PlukaClient; calls: string[] } {
  const calls: string[] = [];

  const builder = {
    select(columns: string) {
      calls.push(`select:${columns}`);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.push(`eq:${column}=${String(value)}`);
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: row, error: null });
    },
  };

  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      return builder;
    },
  } as unknown as PlukaClient;

  return { client, calls };
}

interface EventNameRepository {
  findName(eventId: string): Promise<string | null>;
}

const eventNameRepository = defineRepository<EventNameRepository>((context) => ({
  async findName(eventId) {
    const row = unwrapMaybe(
      await context.client
        .from('events')
        .select(selectColumns('events', ['id', 'name']))
        .eq('id', eventId)
        .maybeSingle(),
      'events.findName',
    );

    return row === null ? null : row.name;
  },
}));

describe('defineRepository', () => {
  it('rend une fabrique qui reçoit son contexte', () => {
    const { client } = fakeClient(null);
    const context: RepositoryContext = { client };

    expect(eventNameRepository(context).findName).toBeTypeOf('function');
  });

  it('n’ouvre jamais son propre client', () => {
    // Le client est injecté : c'est l'appelant qui décide s'il agit sous la
    // session de l'utilisateur ou avec une clé de service.
    const { client, calls } = fakeClient({ id: 'e1', name: 'Trail de Test' });

    expect(calls).toEqual([]);
    expect(eventNameRepository({ client })).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('exécute la requête attendue, projection nommée comprise', async () => {
    const { client, calls } = fakeClient({ id: 'e1', name: 'Trail de Test' });

    await expect(eventNameRepository({ client }).findName('e1')).resolves.toBe('Trail de Test');
    expect(calls).toEqual(['from:events', 'select:id,name', 'eq:id=e1']);
  });

  it('traduit une absence en null plutôt qu’en erreur', async () => {
    const { client } = fakeClient(null);

    await expect(eventNameRepository({ client }).findName('inconnu')).resolves.toBeNull();
  });

  it('accepte un requestId pour les logs structurés', () => {
    const { client } = fakeClient(null);
    const context: RepositoryContext = { client, requestId: 'req-1' };

    expect(context.requestId).toBe('req-1');
  });
});
