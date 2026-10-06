import { createOrganizationCommandSchema } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CreateOrganizationForm } from '@/app/create-organization-form';
import { createOrganizationCommand } from '@/lib/form';

/**
 * Même chaîne que `create-event-form.test.tsx` : le balisage rendu, les champs
 * qu'il postera, la commande que l'action en tire, et le verdict du schéma.
 */

const MARKUP = renderToStaticMarkup(<CreateOrganizationForm />);

function fieldNames(markup: string): readonly string[] {
  return [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

function submitted(values: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  for (const field of fieldNames(MARKUP)) form.set(field, values[field] ?? '');
  return form;
}

describe('formulaire de création d’organisation', () => {
  it('ne poste que des champs que la commande connaît', () => {
    const known = Object.keys(createOrganizationCommandSchema.shape);

    expect([...fieldNames(MARKUP)].sort()).toEqual([...known].sort());
  });

  it('ne laisse choisir ni statut ni identité d’acteur', () => {
    expect(MARKUP).not.toMatch(/name="status"/);
    expect(MARKUP).not.toContain('userId');
  });

  it('rend `null` les champs facultatifs laissés vides', () => {
    const command = createOrganizationCommand(
      submitted({ name: 'Trail du Lac', slug: 'trail-du-lac' }),
    );

    expect(command).toEqual({
      name: 'Trail du Lac',
      slug: 'trail-du-lac',
      contactEmail: null,
      websiteUrl: null,
    });
    expect(createOrganizationCommandSchema.safeParse(command).success).toBe(true);
  });

  it('transmet l’email et le site saisis, que le domaine accepte', () => {
    const command = createOrganizationCommand(
      submitted({
        name: 'Trail du Lac',
        slug: 'trail-du-lac',
        contactEmail: 'contact@trail-du-lac.fr',
        websiteUrl: 'https://trail-du-lac.fr',
      }),
    );

    expect(createOrganizationCommandSchema.safeParse(command).success).toBe(true);
  });
});
