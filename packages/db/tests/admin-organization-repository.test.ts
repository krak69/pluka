import { describe, expect, it } from 'vitest';

import { adminActionsRepository, adminConsoleRepository, type PlukaClient } from '../src/index.js';

/** Fiche et édition d'une organisation — migration 0031. */

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

describe('fiche d’organisation', () => {
  it('traduit la ligne en camelCase, site web compris', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          organization_id: 'o-1',
          name: 'Org A',
          slug: 'org-a',
          status: 'prospect',
          contact_email: null,
          website_url: 'https://org-a.test',
          created_at: '2026-10-01T08:00:00+00:00',
          updated_at: '2026-10-02T08:00:00+00:00',
        },
      ],
      error: null,
    });

    await expect(adminConsoleRepository({ client }).getOrganization('o-1')).resolves.toEqual({
      organizationId: 'o-1',
      name: 'Org A',
      slug: 'org-a',
      status: 'prospect',
      contactEmail: null,
      websiteUrl: 'https://org-a.test',
      createdAt: '2026-10-01T08:00:00+00:00',
      updatedAt: '2026-10-02T08:00:00+00:00',
    });
    expect(calls[0]).toEqual({
      name: 'admin_get_organization',
      args: { p_organization_id: 'o-1' },
    });
  });

  it('rend null pour une organisation inexistante', async () => {
    const { client } = fakeClient({ data: [], error: null });

    await expect(adminConsoleRepository({ client }).getOrganization('o-x')).resolves.toBeNull();
  });
});

describe('édition d’organisation', () => {
  it('passe les quatre champs éditables, jamais le slug, et rend le nombre de changements', async () => {
    const { client, calls } = fakeClient({ data: 2, error: null });

    await expect(
      adminActionsRepository({ client }).updateOrganization({
        organizationId: 'o-1',
        name: 'Org A',
        contactEmail: null,
        websiteUrl: null,
        status: 'active',
      }),
    ).resolves.toBe(2);
    expect(calls[0]).toEqual({
      name: 'admin_update_organization',
      args: {
        p_organization_id: 'o-1',
        p_name: 'Org A',
        p_contact_email: null,
        p_website_url: null,
        p_status: 'active',
      },
    });
  });
});

describe('suppression d’organisation', () => {
  it('nomme la fonction de 0032 et ne passe que l’identifiant', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });

    await adminActionsRepository({ client }).deleteOrganization('o-1');
    expect(calls[0]).toEqual({
      name: 'admin_delete_organization',
      args: { p_organization_id: 'o-1' },
    });
  });

  it('traduit des données encore liées (55000) en invalid_state', async () => {
    const { client } = fakeClient({ data: null, error: { code: '55000', message: 'liee' } });

    const failure = await adminActionsRepository({ client })
      .deleteOrganization('o-1')
      .catch((error: unknown) => error);

    expect((failure as { code: string }).code).toBe('invalid_state');
  });
});
