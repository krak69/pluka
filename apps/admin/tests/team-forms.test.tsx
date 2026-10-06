import {
  ORGANIZATION_ROLES,
  changeOrganizationMemberRoleCommandSchema,
  inviteOrganizationMemberCommandSchema,
} from '@pluka/domain';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InviteMemberForm, MemberRoleForm } from '@/app/team-forms';
import { ORGANIZATION_ROLE_OPTIONS, organizationRoleLabel } from '@/components/admin-status';

/**
 * Équipe d'une organisation — migration 0033.
 *
 * Les formulaires postent-ils exactement les champs des commandes du domaine,
 * et les rôles proposés sont-ils ceux de la base, ni plus ni moins ?
 */

const ORGANIZATION = 'aaaaaaaa-0000-4000-8000-000000000001';

const SCHEMA = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../supabase/migrations/0001_initial_schema.sql',
  ),
  'utf8',
);

/** Champs postés, une fois chacun : un groupe de radios n'en poste qu'un. */
function fieldNames(markup: string): readonly string[] {
  return [
    ...new Set(
      [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ].sort();
}

function radioValues(markup: string): readonly string[] {
  return [...markup.matchAll(/<input\b[^>]*type="radio"[^>]*value="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

/** La radio cochée — React écrit `checked` avant ou après `value` selon le cas. */
function checkedRadio(markup: string): string | undefined {
  const tag = [...markup.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)]
    .map((match) => match[0])
    .find((candidate) => /\bchecked\b/.test(candidate));

  return tag === undefined ? undefined : /\bvalue="([^"]+)"/.exec(tag)?.[1];
}

describe('rôles d’organisation', () => {
  it('sont les quatre de la base, dans le même ordre que le domaine', () => {
    const values = [
      ...(
        /create type public\.organization_member_role as enum \(([^)]+)\)/.exec(SCHEMA)?.[1] ?? ''
      ).matchAll(/'([^']+)'/g),
    ].map((match) => match[1] as string);

    expect(ORGANIZATION_ROLE_OPTIONS.map((option) => option.value)).toEqual(values);
    expect([...ORGANIZATION_ROLES]).toEqual(values);
  });

  it('ont chacun un libellé et une description', () => {
    for (const option of ORGANIZATION_ROLE_OPTIONS) {
      expect(organizationRoleLabel(option.value)).not.toBe(option.value);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

describe('formulaires d’équipe', () => {
  it('l’invitation poste les champs de la commande, et Lecture seule par défaut', () => {
    const markup = renderToStaticMarkup(
      <InviteMemberForm organizationId={ORGANIZATION} roles={ORGANIZATION_ROLE_OPTIONS} />,
    );

    expect(fieldNames(markup)).toEqual(
      Object.keys(inviteOrganizationMemberCommandSchema.shape).sort(),
    );
    expect(radioValues(markup)).toEqual([...ORGANIZATION_ROLES]);
    expect(checkedRadio(markup)).toBe('viewer');
    // La description se lit à côté de chaque option, pas dans un paragraphe à part.
    for (const option of ORGANIZATION_ROLE_OPTIONS) expect(markup).toContain(option.description);
  });

  it('sans propriétaire, l’invitation propose Propriétaire par défaut', () => {
    const markup = renderToStaticMarkup(
      <InviteMemberForm
        organizationId={ORGANIZATION}
        roles={ORGANIZATION_ROLE_OPTIONS}
        defaultRole="owner"
      />,
    );

    expect(checkedRadio(markup)).toBe('owner');
  });

  it('le changement de rôle poste les champs de la commande, rôle courant présélectionné', () => {
    const markup = renderToStaticMarkup(
      <MemberRoleForm
        organizationId={ORGANIZATION}
        userId="bbbbbbbb-0000-4000-8000-000000000001"
        memberName="Marie Favre"
        role="editor"
        roles={ORGANIZATION_ROLE_OPTIONS}
      />,
    );

    expect(fieldNames(markup)).toEqual(
      Object.keys(changeOrganizationMemberRoleCommandSchema.shape).sort(),
    );
    expect(markup).toMatch(/<option value="editor" selected/);
    // Le select a une étiquette, même invisible : un lecteur d'écran sait de qui on parle.
    expect(markup).toContain('Rôle de Marie Favre');
  });
});
