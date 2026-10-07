import { getMyStaffRole } from '@pluka/domain';
import { redirect } from 'next/navigation';

import { staffTeamContext } from '@/lib/admin';
import { requireSession } from '@/lib/session';

import { firstSettingsTab } from './tabs';

/**
 * `/parametres` regroupe ses sous-onglets : il redirige vers le premier que
 * le rôle peut ouvrir (§1.6) — l'équipe pour un super-admin, le journal sinon.
 */
export default async function SettingsIndexPage() {
  const session = await requireSession('/parametres');
  redirect(firstSettingsTab(await getMyStaffRole(staffTeamContext(session))));
}
