/**
 * Rôles d'organisation — `organization_member_role`, 0001. Libellés et
 * descriptions de l'`orgTeam` du prototype, dans l'ordre d'autorité.
 *
 * Module sans dépendance serveur : les formulaires client l'importent.
 */
export const TEAM_ROLES = [
  {
    value: 'owner',
    label: 'Propriétaire',
    description: 'Gère tout, y compris l’organisation et l’équipe.',
  },
  {
    value: 'admin',
    label: 'Administrateur',
    description: 'Gère l’événement, les sources et les participants.',
  },
  {
    value: 'editor',
    label: 'Éditeur',
    description: 'Modifie les contenus et valide les informations.',
  },
  { value: 'viewer', label: 'Lecture seule', description: 'Consulte sans modifier.' },
] as const;

export function teamRoleLabel(role: string): string {
  return TEAM_ROLES.find((option) => option.value === role)?.label ?? role;
}
