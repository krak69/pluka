import { describe, expect, it } from 'vitest';

import { entitlementRepository, type PlukaClient } from '../src/index.js';

/**
 * Repository des droits commerciaux.
 *
 * L'assertion centrale de ce fichier est une **absence**. 01_ARCHITECTURE §5,
 * règle 5 : « `db` ne décide jamais d'un entitlement. » Un `where status =
 * 'active'` glissé dans une de ces requêtes serait exactement cette décision —
 * et il coûterait à 04_ENTITLEMENTS §18 trois de ses motifs de refus, puisque le
 * resolver ne verrait plus la différence entre un droit expiré, révoqué, ou
 * jamais acheté.
 *
 * Les tests vérifient donc autant ce que la requête filtre que ce qu'elle ne
 * filtre pas.
 */

interface Recorder {
  readonly client: PlukaClient;
  readonly calls: string[];
}

function fakeClient(result: unknown, count = 0): Recorder {
  const calls: string[] = [];
  const answer = Promise.resolve({ data: result, error: null, count });

  const builder: Record<string, unknown> = {
    select: (columns: string, options?: unknown) => {
      calls.push(
        options === undefined
          ? `select:${columns}`
          : `select:${columns}:${JSON.stringify(options)}`,
      );
      return builder;
    },
    upsert: (values: unknown, options: unknown) => {
      calls.push(`upsert:${JSON.stringify(values)}:${JSON.stringify(options)}`);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      calls.push(`eq:${column}=${String(value)}`);
      return builder;
    },
    order: (column: string) => {
      calls.push(`order:${column}`);
      return builder;
    },
    maybeSingle: () => answer,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      answer.then(resolve, reject),
  };

  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
    },
  } as unknown as PlukaClient;

  return { client, calls };
}

const ENTITLEMENT_ROW = {
  id: 'ent-1',
  kind: 'race_pass',
  source: 'checkout',
  status: 'active',
  scope_type: 'participant_race',
  user_id: 'user-1',
  participant_race_id: 'pr-1',
  organization_id: null,
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: null,
  revoked_at: null,
};

const BETA_ROW = {
  id: 'beta-1',
  user_id: 'user-1',
  scope_type: 'global',
  participant_race_id: null,
  status: 'active',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2026-06-01T00:00:00Z',
  revoked_at: null,
};

/** Colonnes sur lesquelles une décision se prendrait si la requête les filtrait. */
const DECIDING_COLUMNS = ['status', 'starts_at', 'ends_at', 'revoked_at'];

function filters(calls: readonly string[]): readonly string[] {
  return calls.filter((call) => call.startsWith('eq:'));
}

describe('lecture des droits', () => {
  it('rend toutes les lignes de l’utilisateur, sans trancher (§5 règle 5)', async () => {
    const { client, calls } = fakeClient([ENTITLEMENT_ROW]);

    await entitlementRepository({ client }).listByUser('user-1');

    expect(calls[0]).toBe('from:entitlements');
    expect(filters(calls)).toEqual(['eq:user_id=user-1']);

    for (const column of DECIDING_COLUMNS) {
      expect(
        filters(calls).join('|'),
        `la requête filtre sur ${column} : c'est une décision, elle appartient au domaine`,
      ).not.toContain(`eq:${column}`);
    }
  });

  it('projette de quoi expliquer un refus (§18)', async () => {
    // Sans `status`, `ends_at` et `revoked_at` dans la projection, le resolver
    // ne pourrait distinguer ni `expired`, ni `revoked`.
    const { client, calls } = fakeClient([ENTITLEMENT_ROW]);

    await entitlementRepository({ client }).listByUser('user-1');

    const projection = calls.find((call) => call.startsWith('select:')) as string;
    for (const column of DECIDING_COLUMNS) {
      expect(projection).toContain(column);
    }
  });

  it('traduit la ligne en DTO camelCase', async () => {
    const { client } = fakeClient([ENTITLEMENT_ROW]);

    await expect(entitlementRepository({ client }).listByUser('user-1')).resolves.toEqual([
      {
        id: 'ent-1',
        kind: 'race_pass',
        source: 'checkout',
        status: 'active',
        scopeType: 'participant_race',
        userId: 'user-1',
        participantRaceId: 'pr-1',
        organizationId: null,
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: null,
        revokedAt: null,
      },
    ]);
  });

  it('lit les accès testeur dans leur table dédiée (§14)', async () => {
    const { client, calls } = fakeClient([BETA_ROW]);

    const grants = await entitlementRepository({ client }).listBetaGrantsByUser('user-1');

    expect(calls[0]).toBe('from:beta_access_grants');
    expect(filters(calls)).toEqual(['eq:user_id=user-1']);
    expect(grants[0]).toMatchObject({ id: 'beta-1', scopeType: 'global', userId: 'user-1' });
  });

  it('ne filtre pas davantage les grants bêta que les droits commerciaux', async () => {
    const { client, calls } = fakeClient([BETA_ROW]);

    await entitlementRepository({ client }).listBetaGrantsByUser('user-1');

    expect(filters(calls).join('|')).not.toContain('status');
  });
});

describe('ledger de quota (§33, §34)', () => {
  it('compte les consommations du scope, sans en juger', async () => {
    const { client, calls } = fakeClient(null, 2);

    const count = await entitlementRepository({ client }).countUsage(
      'user-1',
      'outing.create_linked',
      'pr-1',
    );

    expect(count).toBe(2);
    expect(calls[0]).toBe('from:entitlement_usage');
    expect(filters(calls)).toEqual([
      'eq:user_id=user-1',
      'eq:capability=outing.create_linked',
      'eq:participant_race_id=pr-1',
    ]);
  });

  it('ne rapatrie aucune ligne pour compter', async () => {
    const { client, calls } = fakeClient(null, 7);

    await entitlementRepository({ client }).countUsage('user-1', 'outing.create_linked', 'pr-1');

    expect(calls).toContain('select:id:{"count":"exact","head":true}');
  });

  it('rend 0 plutôt que null quand le ledger est vide', async () => {
    const { client } = fakeClient(null, 0);

    await expect(
      entitlementRepository({ client }).countUsage('user-1', 'outing.create_linked', 'pr-1'),
    ).resolves.toBe(0);
  });

  it('laisse la contrainte d’unicité porter l’idempotence', async () => {
    // `on conflict do nothing` : pas de lecture préalable, donc pas de fenêtre
    // entre le contrôle et l'écriture.
    const { client, calls } = fakeClient({ id: 'usage-1' });

    const consumed = await entitlementRepository({ client }).recordUsage({
      userId: 'user-1',
      entitlementId: 'ent-1',
      capability: 'outing.create_linked',
      participantRaceId: 'pr-1',
      outingId: 'out-1',
      usageKey: 'linked-outing:out-1',
    });

    expect(consumed).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.startsWith('upsert:') &&
          call.includes('"usage_key":"linked-outing:out-1"') &&
          call.includes('"onConflict":"user_id,capability,usage_key"') &&
          call.includes('"ignoreDuplicates":true'),
      ),
    ).toBe(true);
  });

  it('dit qu’un rejeu n’a rien consommé', async () => {
    // `ignoreDuplicates` ne rend aucune ligne quand le conflit est ignoré.
    const { client } = fakeClient(null);

    await expect(
      entitlementRepository({ client }).recordUsage({
        userId: 'user-1',
        entitlementId: 'ent-1',
        capability: 'outing.create_linked',
        participantRaceId: 'pr-1',
        outingId: 'out-1',
        usageKey: 'linked-outing:out-1',
      }),
    ).resolves.toBe(false);
  });
});
