import { NavTabs } from '@pluka/ui';

import type { StaffRole } from '@/components/admin-nav';
import { AdminPageHeader } from '@/components/admin-page';

/**
 * En-tête de Paramètres (0035).
 *
 * Un sous-onglet par famille de réglages, chacun une route (§1.2 de
 * `05_ROUTES_FLOWS.md`). La liste s'allonge au fil des lots : un réglage
 * nouveau prend un onglet ici, jamais une entrée de plus dans le menu
 * principal.
 *
 * Chaque onglet dit qui le voit. Ce filtre compose l'en-tête, il n'ouvre
 * rien : chaque page garde sa propre garde, et la base tranche.
 */
const TABS = [
  { href: '/parametres/equipe', label: 'Équipe PLUKA', superAdminOnly: true },
  { href: '/parametres/journal', label: 'Journal', superAdminOnly: false },
] as const;

export type SettingsTab = (typeof TABS)[number]['href'];

/** Le premier onglet que ce rôle peut ouvrir — la cible de `/parametres`. */
export function firstSettingsTab(role: StaffRole | null): SettingsTab {
  return role === 'super_admin' ? '/parametres/equipe' : '/parametres/journal';
}

export function SettingsHeader({
  current,
  staffRole,
}: {
  readonly current: SettingsTab;
  readonly staffRole: StaffRole | null;
}) {
  const tabs = TABS.filter((tab) => !tab.superAdminOnly || staffRole === 'super_admin');

  return (
    <>
      <AdminPageHeader
        title="Paramètres"
        lede="Réglages généraux de PLUKA, équipe d’administration et journal. Chaque modification est inscrite au journal."
      />

      <NavTabs
        className="ad-subtabs"
        label="Sections des paramètres"
        tabs={tabs.map((tab) => ({
          href: tab.href,
          label: tab.label,
          current: tab.href === current,
        }))}
      />
    </>
  );
}
