import {
  STAFF_ROLES,
  changeStaffRoleCommandSchema,
  inviteStaffMemberCommandSchema,
} from '@pluka/domain';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InviteStaffForm, StaffRoleForm } from '@/app/parametres/equipe/staff-forms';
import { STAFF_ROLE_OPTIONS, staffRoleLabel } from '@/app/parametres/equipe/staff-roles';

/** Équipe PLUKA — formulaires contre les commandes du domaine et l'enum de 0035. */

const MIGRATION = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../supabase/migrations/0035_platform_staff_roles.sql',
  ),
  'utf8',
);

function fieldNames(markup: string): readonly string[] {
  return [
    ...new Set(
      [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ].sort();
}

describe('rôles de l’équipe PLUKA', () => {
  it('sont les trois de la base, dans l’ordre du domaine, chacun nommé et décrit', () => {
    const values = [
      ...(/create type public\.staff_role as enum \(([^)]+)\)/.exec(MIGRATION)?.[1] ?? '').matchAll(
        /'([^']+)'/g,
      ),
    ].map((match) => match[1] as string);

    expect(STAFF_ROLE_OPTIONS.map((option) => option.value)).toEqual(values);
    expect([...STAFF_ROLES]).toEqual(values);
    for (const option of STAFF_ROLE_OPTIONS) {
      expect(staffRoleLabel(option.value)).not.toBe(option.value);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

describe('formulaires de l’équipe PLUKA', () => {
  it('inviter poste les champs de la commande, Support par défaut', () => {
    const markup = renderToStaticMarkup(<InviteStaffForm />);

    expect(fieldNames(markup)).toEqual(Object.keys(inviteStaffMemberCommandSchema.shape).sort());
    expect(markup).toMatch(
      /<input[^>]*type="radio"[^>]*checked=""[^>]*value="support"|<input[^>]*type="radio"[^>]*value="support"[^>]*checked=""/,
    );
  });

  it('changer de rôle poste les champs de la commande, avec une étiquette', () => {
    const markup = renderToStaticMarkup(
      <StaffRoleForm
        userId="bbbbbbbb-0000-4000-8000-000000000001"
        memberName="Anne"
        staffRole="admin"
      />,
    );

    expect(fieldNames(markup)).toEqual(Object.keys(changeStaffRoleCommandSchema.shape).sort());
    expect(markup).toContain('Rôle de Anne');
    expect(markup).toMatch(/<option value="admin" selected/);
  });
});
