import {
  ORGANIZATION_ROLES,
  changeOrganizationMemberRoleCommandSchema,
  inviteOrganizationMemberCommandSchema,
  removeOrganizationMemberCommandSchema,
} from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  InviteTeamMemberForm,
  RemoveTeamMemberForm,
  TeamMemberRoleForm,
} from '@/components/team-forms';
import { TEAM_ROLES, teamRoleLabel } from '@/lib/team-roles';

/**
 * Équipe côté organisateur — 05_ROUTES_FLOWS §6.1, migration 0033.
 *
 * Les formulaires postent exactement les champs des commandes du domaine, et
 * proposent les rôles du domaine, ni plus ni moins.
 */

const ORGANIZATION = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = 'bbbbbbbb-0000-4000-8000-000000000001';

function fieldNames(markup: string): readonly string[] {
  return [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)]
    .map((match) => match[1] as string)
    .sort();
}

describe('rôles', () => {
  it('sont ceux du domaine, dans le même ordre, chacun nommé', () => {
    expect(TEAM_ROLES.map((role) => role.value)).toEqual([...ORGANIZATION_ROLES]);
    for (const role of ORGANIZATION_ROLES) expect(teamRoleLabel(role)).not.toBe(role);
  });
});

describe('formulaires d’équipe', () => {
  it('inviter poste les champs de la commande', () => {
    const markup = renderToStaticMarkup(<InviteTeamMemberForm organizationId={ORGANIZATION} />);

    expect(fieldNames(markup)).toEqual(
      Object.keys(inviteOrganizationMemberCommandSchema.shape).sort(),
    );
    expect(markup).toMatch(/<option value="viewer" selected/);
  });

  it('changer de rôle poste les champs de la commande, avec une étiquette', () => {
    const markup = renderToStaticMarkup(
      <TeamMemberRoleForm
        organizationId={ORGANIZATION}
        userId={USER}
        memberName="Marie"
        role="admin"
      />,
    );

    expect(fieldNames(markup)).toEqual(
      Object.keys(changeOrganizationMemberRoleCommandSchema.shape).sort(),
    );
    expect(markup).toContain('Rôle de Marie');
  });

  it('retirer poste les champs de la commande, case de confirmation comprise', () => {
    const markup = renderToStaticMarkup(
      <RemoveTeamMemberForm organizationId={ORGANIZATION} userId={USER} memberName="Marie" />,
    );

    expect(fieldNames(markup)).toEqual(
      Object.keys(removeOrganizationMemberCommandSchema.shape).sort(),
    );
    expect(markup).toMatch(/type="checkbox"[^>]*name="confirmed"/);
  });
});
