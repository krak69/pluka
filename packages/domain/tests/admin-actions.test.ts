import { DbError, type AdminActionsRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  archiveNutritionProduct,
  createOrganization,
  deleteOrganization,
  dismissReport,
  updateOrganization,
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

function contextWith(answer: () => Promise<number | string | void>): Recorded {
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
    createOrganization: async (input) => {
      calls.push(`createOrganization:${input.slug}`);
      return answer() as Promise<never>;
    },
    deleteOrganization: record('deleteOrganization'),
    updateOrganization: async (input) => {
      calls.push(`updateOrganization:${input.organizationId}:${input.status}`);
      return answer() as Promise<never>;
    },
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

describe('créer une organisation — migration 0030', () => {
  const ORGANIZATION = '00000000-0000-4000-8000-000000000051';

  it('transmet la saisie nettoyée et rend l’identifiant créé', async () => {
    const { context, calls } = contextWith(() => Promise.resolve(ORGANIZATION));

    await expect(
      createOrganization(context, { name: '  Trail du Lac ', slug: 'trail-du-lac' }),
    ).resolves.toEqual({ organizationId: ORGANIZATION });
    expect(calls).toEqual(['createOrganization:trail-du-lac']);
  });

  it('refuse un slug, un email ou un site invalide avant la base', async () => {
    const { context, calls } = contextWith(() => Promise.resolve(ORGANIZATION));

    const error = await failure(
      createOrganization(context, {
        name: 'Trail du Lac',
        slug: 'Trail du Lac',
        contactEmail: 'pas-un-email',
        websiteUrl: 'javascript:alert(1)',
      }),
    );

    expect(error.code).toBe('validation');
    expect(Object.keys(error.details).sort()).toEqual(['contactEmail', 'slug', 'websiteUrl']);
    expect(calls).toEqual([]);
  });

  it('refuse un champ que la commande ne connaît pas, comme un statut', async () => {
    const { context, calls } = contextWith(() => Promise.resolve(ORGANIZATION));

    const error = await failure(
      createOrganization(context, { name: 'Trail du Lac', slug: 'trail-du-lac', status: 'active' }),
    );

    expect(error.code).toBe('validation');
    expect(calls).toEqual([]);
  });

  it('rend un slug déjà pris contre le champ slug', async () => {
    const { context } = refusedWith('conflict');

    const error = await failure(
      createOrganization(context, { name: 'Trail du Lac', slug: 'trail-du-lac' }),
    );

    expect(error.code).toBe('validation');
    expect(error.details).toEqual({ slug: 'ce slug d’organisation est déjà utilisé' });
  });

  it('un non-administrateur reçoit un refus sans détail', async () => {
    const { context } = refusedWith('permission_denied');

    const error = await failure(
      createOrganization(context, { name: 'Trail du Lac', slug: 'trail-du-lac' }),
    );

    expect(error.code).toBe('forbidden');
    expect(error.details).toEqual({});
  });
});

describe('éditer une organisation — migration 0031', () => {
  const ORGANIZATION = '00000000-0000-4000-8000-000000000051';
  const EDIT = {
    organizationId: ORGANIZATION,
    name: 'Trail du Lac',
    contactEmail: null,
    websiteUrl: 'https://trail-du-lac.fr',
    status: 'prospect',
  } as const;

  it('transmet la saisie et rend le nombre de champs modifiés', async () => {
    const { context, calls } = contextWith(() => Promise.resolve(2));

    await expect(updateOrganization(context, EDIT)).resolves.toEqual({ changedFields: 2 });
    expect(calls).toEqual([`updateOrganization:${ORGANIZATION}:prospect`]);
  });

  it('refuse un slug : il ne change pas après la création', async () => {
    const { context, calls } = contextWith(() => Promise.resolve(1));

    const error = await failure(updateOrganization(context, { ...EDIT, slug: 'autre-slug' }));

    expect(error.code).toBe('validation');
    expect(calls).toEqual([]);
  });

  it('refuse un statut que la base ne connaît pas', async () => {
    const { context, calls } = contextWith(() => Promise.resolve(1));

    const error = await failure(updateOrganization(context, { ...EDIT, status: 'pilot' }));

    expect(error.details['status']).toBeDefined();
    expect(calls).toEqual([]);
  });

  it('traduit une organisation introuvable et un refus d’accès', async () => {
    expect((await failure(updateOrganization(refusedWith('not_found').context, EDIT))).code).toBe(
      'not_found',
    );
    expect(
      (await failure(updateOrganization(refusedWith('permission_denied').context, EDIT))).code,
    ).toBe('forbidden');
  });
});

describe('supprimer une organisation — migration 0032', () => {
  const ORGANIZATION = '00000000-0000-4000-8000-000000000051';

  it('transmet l’identifiant une fois confirmé', async () => {
    const { context, calls } = contextWith(() => Promise.resolve());

    await deleteOrganization(context, { organizationId: ORGANIZATION, confirmed: true });
    expect(calls).toEqual([`deleteOrganization:${ORGANIZATION}`]);
  });

  for (const confirmed of [undefined, false, 'on']) {
    it(`sans confirmation (${String(confirmed)}), n’atteint jamais la base`, async () => {
      const { context, calls } = contextWith(() => Promise.resolve());

      const error = await failure(
        deleteOrganization(context, { organizationId: ORGANIZATION, confirmed }),
      );

      expect(error.details['confirmed']).toBeDefined();
      expect(calls).toEqual([]);
    });
  }

  it('une organisation qui porte des données renvoie vers « Terminé »', async () => {
    const error = await failure(
      deleteOrganization(refusedWith('invalid_state').context, {
        organizationId: ORGANIZATION,
        confirmed: true,
      }),
    );

    expect(error.code).toBe('invalid_state');
    expect(error.message).toContain('Terminé');
  });
});
