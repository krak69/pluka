import { DbError, type BetaAccessRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  grantBetaAccess,
  revokeBetaAccess,
  splitEmails,
  type BetaAccessContext,
} from '../src/index.js';

/**
 * Accès bêta — 04_ENTITLEMENTS §14 · migration 0073. La garde et l'écriture
 * sont en base (pgTAP 50) ; ici, la liste, la date et la traduction des refus.
 */

const NOW = new Date('2026-11-09T10:00:00Z');

function contextWith(overrides: Partial<BetaAccessRepository> = {}) {
  const calls: unknown[][] = [];
  const repository: BetaAccessRepository = {
    list: () => Promise.resolve([]),
    grant: (...args) => {
      calls.push(args);
      return Promise.resolve({ granted: 2, extended: 0, reserved: 1, invalid: 0 });
    },
    revoke: () => Promise.resolve(),
    cancelReservation: () => Promise.resolve(),
    ...overrides,
  };
  const context: BetaAccessContext = {
    repositories: { betaAccess: repository },
    actor: { userId: 'admin' },
    now: () => NOW,
  };
  return { context, calls };
}

describe('splitEmails', () => {
  it('découpe sur les virgules, points-virgules et retours, sans doublon', () => {
    expect(splitEmails('A@x.fr, b@x.fr;\n a@x.fr  c@x.fr')).toEqual(['a@x.fr', 'b@x.fr', 'c@x.fr']);
  });
});

describe('grantBetaAccess', () => {
  it('transmet la liste et la fin du dernier jour, heure de Paris', async () => {
    const { context, calls } = contextWith();

    await expect(
      grantBetaAccess(context, { emails: 'a@x.fr\nb@x.fr', endsOn: '2027-02-28', reason: 'Test' }),
    ).resolves.toEqual({ granted: 2, extended: 0, reserved: 1, invalid: 0 });
    expect(calls[0]).toEqual([['a@x.fr', 'b@x.fr'], '2027-02-28T22:59:59.000Z', 'Test']);
  });

  it('refuse une date de fin passée (§14), sans appel', async () => {
    const { context, calls } = contextWith();

    await expect(
      grantBetaAccess(context, { emails: 'a@x.fr', endsOn: '2026-11-01' }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(calls).toHaveLength(0);
  });

  it('refuse une liste vide', async () => {
    const { context } = contextWith();

    await expect(
      grantBetaAccess(context, { emails: ' ,\n', endsOn: '2027-01-01' }),
    ).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('traduit le refus de la base', async () => {
    const { context } = contextWith({
      grant: () =>
        Promise.reject(
          new DbError({ code: 'permission_denied', operation: 'grant', message: 'x' }),
        ),
    });

    await expect(
      grantBetaAccess(context, { emails: 'a@x.fr', endsOn: '2027-01-01' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('revokeBetaAccess', () => {
  it('un accès déjà clos le dit', async () => {
    const { context } = contextWith({
      revoke: () =>
        Promise.reject(new DbError({ code: 'invalid_state', operation: 'revoke', message: 'x' })),
    });

    await expect(
      revokeBetaAccess(context, { grantId: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });
});
