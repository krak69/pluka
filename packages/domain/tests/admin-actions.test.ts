import { DbError, type AdminActionsRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  archiveNutritionProduct,
  dismissReport,
  hideReportedContent,
  retryAdminJob,
  validateNutritionProduct,
  type AdminActionsContext,
} from '../src/index.js';

/**
 * Écritures de la console d'administration — migration 0029.
 *
 * La garde vit dans la fonction SQL ; la suite pgTAP 18 la prouve. Ce fichier
 * vérifie les trois choses que le domaine ajoute :
 *
 * 1. l'entrée est validée avant tout appel ;
 * 2. un geste destructeur sans confirmation n'atteint jamais la base ;
 * 3. les refus de la base deviennent des erreurs de domaine typées.
 */

const REPORT = '00000000-0000-4000-8000-000000000031';
const JOB = '00000000-0000-4000-8000-000000000041';
const PRODUCT = '00000000-0000-4000-8000-000000000011';

interface Recorded {
  readonly context: AdminActionsContext;
  readonly calls: string[];
}

function contextWith(answer: () => Promise<number | void>): Recorded {
  const calls: string[] = [];

  const record =
    (name: string) =>
    (id: string): Promise<never> => {
      calls.push(`${name}:${id}`);
      return answer() as Promise<never>;
    };

  const adminActions: AdminActionsRepository = {
    hideReportedContent: record('hide'),
    dismissReport: record('dismiss'),
    retryJob: record('retry'),
    validateNutritionProduct: record('validate'),
    archiveNutritionProduct: record('archive'),
  };

  return {
    context: { repositories: { adminActions }, actor: { userId: 'admin-1' } },
    calls,
  };
}

function refusedWith(code: DbError['code']): Recorded {
  return contextWith(() =>
    Promise.reject(new DbError({ code, operation: 'admin_x', message: 'refus' })),
  );
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe('gestes réussis', () => {
  it('masquer rend le nombre de signalements clos', async () => {
    const { context, calls } = contextWith(() => Promise.resolve(3));

    await expect(
      hideReportedContent(context, { reportId: REPORT, confirmed: true }),
    ).resolves.toEqual({ closedReports: 3 });
    expect(calls).toEqual([`hide:${REPORT}`]);
  });

  it('relancer rend le numéro de relance', async () => {
    const { context } = contextWith(() => Promise.resolve(2));

    await expect(retryAdminJob(context, { jobId: JOB })).resolves.toEqual({ retry: 2 });
  });

  it('classer, valider et archiver transmettent l’identifiant', async () => {
    const { context, calls } = contextWith(() => Promise.resolve());

    await dismissReport(context, { reportId: REPORT });
    await validateNutritionProduct(context, { productId: PRODUCT });
    await archiveNutritionProduct(context, { productId: PRODUCT, confirmed: true });

    expect(calls).toEqual([`dismiss:${REPORT}`, `validate:${PRODUCT}`, `archive:${PRODUCT}`]);
  });
});

describe('confirmation explicite', () => {
  // Une requête forgée sans la case ne doit pas atteindre la base : la
  // confirmation n'est pas qu'un état d'écran.
  const destructive = [
    [
      'masquer',
      (context: AdminActionsContext, confirmed: unknown) =>
        hideReportedContent(context, { reportId: REPORT, confirmed }),
    ],
    [
      'archiver',
      (context: AdminActionsContext, confirmed: unknown) =>
        archiveNutritionProduct(context, { productId: PRODUCT, confirmed }),
    ],
  ] as const;

  for (const [label, act] of destructive) {
    for (const confirmed of [undefined, false, 'on']) {
      it(`${label} sans confirmation (${String(confirmed)}) est refusé avant la base`, async () => {
        const { context, calls } = contextWith(() => Promise.resolve(1));

        const error = await failure(act(context, confirmed));

        expect(error.code).toBe('validation');
        expect(error.details['confirmed']).toBeDefined();
        expect(calls).toEqual([]);
      });
    }
  }
});

describe('validation de l’entrée', () => {
  it('refuse un identifiant qui n’est pas un uuid, sans appeler la base', async () => {
    const { context, calls } = contextWith(() => Promise.resolve());

    const error = await failure(retryAdminJob(context, { jobId: 'job-1' }));

    expect(error.code).toBe('validation');
    expect(error.details['jobId']).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('refuse un champ inattendu — un client ne passe pas son propre acteur', async () => {
    const { context, calls } = contextWith(() => Promise.resolve());

    const error = await failure(
      dismissReport(context, { reportId: REPORT, actorUserId: 'someone-else' }),
    );

    expect(error.code).toBe('validation');
    expect(calls).toEqual([]);
  });
});

describe('traduction des refus de la base', () => {
  const cases = [
    ['permission_denied', 'forbidden'],
    ['not_found', 'not_found'],
    ['invalid_state', 'invalid_state'],
  ] as const;

  for (const [dbCode, domainCode] of cases) {
    it(`${dbCode} devient ${domainCode}`, async () => {
      const { context } = refusedWith(dbCode);

      const error = await failure(dismissReport(context, { reportId: REPORT }));

      expect(error.code).toBe(domainCode);
      expect(error.useCase).toBe('dismissReport');
    });
  }

  it('un refus d’accès ne dit rien de l’objet visé', async () => {
    const { context } = refusedWith('permission_denied');

    const error = await failure(retryAdminJob(context, { jobId: JOB }));

    expect(error.details).toEqual({});
    expect(error.message).not.toContain(JOB);
  });

  it('une panne de la base reste une panne, pas un refus', async () => {
    const { context } = refusedWith('unavailable');

    const error = await validateNutritionProduct(context, { productId: PRODUCT }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).code).toBe('unavailable');
  });
});
