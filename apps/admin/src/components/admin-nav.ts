/**
 * Navigation de l'administration — `adminNav` du prototype.
 *
 * Les entrées du prototype, dans son ordre, moins « Journal » : il vit sous
 * Paramètres depuis le 2026-10-07 (décision produit). Deux précisions :
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

/** Rôle de l'équipe PLUKA (0035). `null` : pas encore lu, ou hors équipe. */
export type StaffRole = 'super_admin' | 'admin' | 'support';

/**
 * Ce que Support lit (0035, `private.staff_read_actions`). Le menu ne montre
 * que ces entrées à un support ; il ne protège rien — chaque page garde sa
 * propre garde, et une adresse tapée à la main reçoit le refus de la base.
 */
const SUPPORT_HREFS: ReadonlySet<string> = new Set([
  '/vue-d-ensemble',
  '/organisations',
  '/',
  '/utilisateurs',
  '/traitements',
]);

/**
 * « Paramètres », tout en bas du menu, séparé des sections de travail. Toute
 * l'équipe le voit, parce que le journal y vit ; ses onglets se filtrent par
 * rôle (`app/parametres/tabs.tsx`) — l'équipe PLUKA reste au super-admin.
 */
export const ADMIN_SETTINGS: AdminDestination = {
  href: '/parametres',
  label: 'Paramètres',
  icon: 'GearSix',
};

/** Les sections de travail visibles pour un rôle. Sans rôle connu : toutes, comme avant 0035. */
export function navFor(role: StaffRole | null): readonly AdminDestination[] {
  return role === 'support'
    ? ADMIN_NAV.filter((destination) => SUPPORT_HREFS.has(destination.href))
    : ADMIN_NAV;
}

export function showsSettings(role: StaffRole | null): boolean {
  return role !== null;
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

/**
 * Écrans en plein écran : un parcours qui demande toute l'attention — la
 * création d'un événement ou d'une organisation. La barre latérale reste ; le bandeau du haut
 * s'efface et l'écran porte sa propre sortie.
 */
const FOCUS_PATHS: readonly string[] = ['/evenements/nouveau', '/organisations/nouvelle'];

export function isFocusMode(pathname: string): boolean {
  return FOCUS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
