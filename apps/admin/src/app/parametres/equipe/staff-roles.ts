/**
 * Rôles de l'équipe PLUKA — `staff_role`, 0035. Du plus large au plus étroit.
 * Module sans dépendance serveur : les formulaires client l'importent.
 */
export const STAFF_ROLE_OPTIONS = [
  {
    value: 'super_admin',
    label: 'Super-admin',
    description: 'Toute la console, les paramètres et l’équipe PLUKA.',
  },
  { value: 'admin', label: 'Admin', description: 'Toute la console, sauf les paramètres.' },
  {
    value: 'support',
    label: 'Support',
    description:
      'Lecture seule : vue d’ensemble, événements, organisations, utilisateurs, traitements, journal.',
  },
] as const;

export function staffRoleLabel(role: string): string {
  return STAFF_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}
