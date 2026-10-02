import { describe, expect, it } from 'vitest';

import { DbError, adminActionsRepository, type PlukaClient } from '../src/index.js';

/**
 * Repository des écritures d'administration — migration 0029.
 *
 * La couche données ne décide rien : elle nomme la fonction, passe
 * l'identifiant et traduit la réponse. Ce que ce fichier vérifie, c'est la
 * traduction — en particulier des trois refus que le domaine distingue.
 */

function fakeClient(answer: { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(answer);
    },
  } as unknown as PlukaClient;

  return { client, calls };
}

describe('adminActionsRepository', () => {
  it('nomme chaque fonction de 0029 et ne passe que l’identifiant', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    const repository = adminActionsRepository({ client });

    await repository.dismissReport('r-1');
    await repository.validateNutritionProduct('p-1');
    await repository.archiveNutritionProduct('p-2');

    expect(calls).toEqual([
      { name: 'admin_dismiss_report', args: { p_report_id: 'r-1' } },
      { name: 'admin_validate_nutrition_product', args: { p_product_id: 'p-1' } },
      { name: 'admin_archive_nutrition_product', args: { p_product_id: 'p-2' } },
    ]);
  });

  it('rend le nombre de signalements clos par un masquage', async () => {
    const { client, calls } = fakeClient({ data: 3, error: null });

    await expect(adminActionsRepository({ client }).hideReportedContent('r-1')).resolves.toBe(3);
    expect(calls[0]).toEqual({ name: 'admin_hide_reported_content', args: { p_report_id: 'r-1' } });
  });

  it('rend le numéro de relance', async () => {
    const { client, calls } = fakeClient({ data: 2, error: null });

    await expect(adminActionsRepository({ client }).retryJob('j-1')).resolves.toBe(2);
    expect(calls[0]).toEqual({ name: 'admin_retry_job', args: { p_job_id: 'j-1' } });
  });

  const refusals = [
    ['42501', 'permission_denied'],
    ['P0002', 'not_found'],
    ['55000', 'invalid_state'],
  ] as const;

  for (const [sqlState, expected] of refusals) {
    it(`traduit ${sqlState} en ${expected}`, async () => {
      const { client } = fakeClient({ data: null, error: { code: sqlState, message: 'refus' } });

      const failure = await adminActionsRepository({ client })
        .retryJob('j-1')
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(DbError);
      expect((failure as DbError).code).toBe(expected);
    });
  }

  it('refuse une réponse qui n’est pas un entier', async () => {
    const { client } = fakeClient({ data: [{ unexpected: true }], error: null });

    await expect(adminActionsRepository({ client }).hideReportedContent('r-1')).rejects.toThrow(
      DbError,
    );
  });
});
