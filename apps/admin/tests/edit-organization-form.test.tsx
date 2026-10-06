import { updateOrganizationCommandSchema } from '@pluka/domain';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EditOrganizationForm } from '@/app/edit-organization-form';
import { statusLabel } from '@/components/admin-status';
import { updateOrganizationCommand } from '@/lib/form';

/** Même chaîne que les formulaires de création : balisage, champs postés, commande, schéma. */

const ORGANIZATION = {
  organizationId: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Org A',
  slug: 'org-a',
  status: 'prospect',
  contactEmail: 'contact@org-a.test',
  websiteUrl: null,
} as const;

const MARKUP = renderToStaticMarkup(<EditOrganizationForm organization={ORGANIZATION} />);

const SCHEMA = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../supabase/migrations/0001_initial_schema.sql',
  ),
  'utf8',
);

function fieldNames(markup: string): readonly string[] {
  return [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

/** Ce que le navigateur posterait sans retouche : la valeur pré-remplie de chaque champ. */
function untouched(): FormData {
  const form = new FormData();

  for (const match of MARKUP.matchAll(/<input\b[^>]*>/g)) {
    const tag = match[0];
    const name = /\bname="([^"]+)"/.exec(tag)?.[1];
    if (name !== undefined) form.set(name, /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '');
  }

  const select = /<select\b[^>]*\bname="status"[^>]*>([\s\S]*?)<\/select>/.exec(MARKUP)?.[1] ?? '';
  const chosen = /<option\b[^>]*\bvalue="([^"]*)"[^>]*\bselected/.exec(select)?.[1] ?? '';
  form.set('status', chosen);

  return form;
}

describe('formulaire d’édition d’organisation', () => {
  it('poste exactement les champs de la commande, sans slug', () => {
    expect([...fieldNames(MARKUP)].sort()).toEqual(
      Object.keys(updateOrganizationCommandSchema.shape).sort(),
    );
    expect(MARKUP).not.toMatch(/name="slug"/);
    expect(MARKUP).toContain('org-a');
  });

  it('propose les quatre statuts de la base, sous leur libellé de console', () => {
    const values = [
      ...(
        /create type public\.organization_status as enum \(([^)]+)\)/.exec(SCHEMA)?.[1] ?? ''
      ).matchAll(/'([^']+)'/g),
    ].map((match) => match[1] as string);
    const options = [...MARKUP.matchAll(/<option\b[^>]*\bvalue="([^"]+)"[^>]*>([^<]+)</g)].map(
      (match) => [match[1], match[2]],
    );

    expect(options.map(([value]) => value).sort()).toEqual([...values].sort());
    for (const [value, label] of options) {
      expect(label).toBe(statusLabel('organization', value as string));
    }
  });

  it('renvoie la fiche telle quelle quand rien n’est touché, et le domaine l’accepte', () => {
    const command = updateOrganizationCommand(untouched());

    expect(command).toEqual({
      organizationId: ORGANIZATION.organizationId,
      name: 'Org A',
      contactEmail: 'contact@org-a.test',
      websiteUrl: null,
      status: 'prospect',
    });
    expect(updateOrganizationCommandSchema.safeParse(command).success).toBe(true);
  });
});
