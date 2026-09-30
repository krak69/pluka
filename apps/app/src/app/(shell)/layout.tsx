import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { listMyRaces } from '@/lib/participations';
import { requireSession } from '@/lib/session';

/**
 * Layout du shell coureur — 06_DESIGN_SYSTEM.md §69, §70.
 *
 * Server Component : il valide la session et lit les courses du coureur, puis
 * confie le chrome à `AppShell`. Le groupe de routes `(shell)` existe pour que
 * `/connexion` reste hors de ce layout : une page de connexion enveloppée d'une
 * navigation authentifiée n'a pas de sens, et un enfant ne peut pas retirer le
 * layout de son parent.
 *
 * La garde est ici plutôt que dans chaque page : toute route du groupe est
 * authentifiée, et l'oubli d'une garde sur une page serait une faille. Le
 * `returnTo` est la racine du shell ; chaque page qui a besoin du sien précis
 * le redemande.
 */
export default async function ShellLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireSession('/');
  const races = await listMyRaces(session);

  return <AppShell races={races}>{children}</AppShell>;
}
