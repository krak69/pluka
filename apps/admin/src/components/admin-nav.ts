/**
 * Navigation de l'administration — `adminNav` du prototype.
 *
 * Les dix entrées du prototype, dans son ordre. Deux précisions :
 *
 * - « Événements » est l'index de l'application, à `/`. Le prototype ouvre sur
 *   « Vue d'ensemble », mais la liste des événements y était déjà et la
 *   déplacer casserait les liens existants ; la vue d'ensemble prend donc sa
 *   propre adresse. C'est le cas ouvert §12.5 de `05_ROUTES_FLOWS.md`.
 * - `/courses/[raceId]` n'apparaît pas ici. C'est délibéré : l'administration
 *   d'une épreuve se rejoint par Événements → événement → épreuve, pas par une
 *   onzième entrée. `adminNav` ne change pas.
 */

import type { AdminIconName } from '@/components/admin-icon';

export interface AdminDestination {
  readonly href: string;
  readonly label: string;
  /** L'icône du prototype — décorative, le libellé reste l'information. */
  readonly icon: AdminIconName;
}

export const ADMIN_NAV: readonly AdminDestination[] = [
  { href: '/vue-d-ensemble', label: 'Vue d’ensemble', icon: 'SquaresFour' },
  { href: '/validation', label: 'Validation', icon: 'CheckSquareOffset' },
  { href: '/organisations', label: 'Organisations', icon: 'Buildings' },
  { href: '/', label: 'Événements', icon: 'CalendarDots' },
  { href: '/sources', label: 'Sources', icon: 'Files' },
  { href: '/produits', label: 'Produits nutrition', icon: 'Package' },
  { href: '/signalements', label: 'Signalements', icon: 'Flag' },
  { href: '/utilisateurs', label: 'Utilisateurs', icon: 'UserList' },
  { href: '/traitements', label: 'Imports et traitements', icon: 'ArrowsClockwise' },
  { href: '/journal', label: 'Journal', icon: 'ClockCounterClockwise' },
];

/**
 * Destination active.
 *
 * `/` ne matche qu'exactement : sans cette exception, « Événements » serait
 * actif partout. Les autres acceptent leurs sous-chemins, pour qu'une fiche
 * allume l'onglet dont elle vient.
 */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/evenements');

  return pathname === href || pathname.startsWith(`${href}/`);
}
