import type { IconName } from '@/components/icon';

/**
 * Destinations du shell coureur — `06_DESIGN_SYSTEM.md` §66, §67 et
 * `05_ROUTES_FLOWS.md` §5.
 *
 * Deux groupes, et deux seulement. §66 fixe la navigation annuelle, §67 la
 * navigation de la course. §67 est explicite sur ce qu'il ne faut pas y
 * ajouter : « Ne pas ajouter Météo, Nutrition comme cinquième / sixième onglet
 * principal uniquement parce que les fonctionnalités existent. » Nutrition est
 * une couche du Plan, Conditions une sous-expérience du Plan — toutes deux ont
 * une route (§5.2 de 05_ROUTES_FLOWS), aucune n'a d'entrée de navigation.
 */

export interface GlobalDestination {
  readonly href: string;
  readonly label: string;
  /** Libellé court de la barre mobile, quand il diffère. */
  readonly shortLabel?: string;
  readonly icon: IconName;
}

/** §66 — navigation annuelle, dans l'ordre du Design System. */
export const GLOBAL_NAV: readonly GlobalDestination[] = [
  { href: '/', label: 'Accueil', icon: 'House' },
  { href: '/saison', label: 'Ma saison', shortLabel: 'Saison', icon: 'CalendarDots' },
  { href: '/sorties', label: 'Mes sorties', shortLabel: 'Sorties', icon: 'Mountains' },
  { href: '/bibliotheque', label: 'Ma bibliothèque', shortLabel: 'Biblio', icon: 'Books' },
  { href: '/communaute', label: 'Communauté', shortLabel: 'Communauté', icon: 'ChatsCircle' },
];

export interface RaceDestination {
  /** Segment ajouté après `/courses/<participantRaceId>`. */
  readonly segment: string;
  readonly label: string;
  readonly shortLabel?: string;
  readonly icon: IconName;
}

/** §67 — navigation course. Quatre entrées, validées, et pas une de plus. */
export const RACE_NAV: readonly RaceDestination[] = [
  { segment: 'plan', label: 'Plan', icon: 'Path' },
  { segment: 'preparation', label: 'Préparation', shortLabel: 'Prépa', icon: 'ListChecks' },
  { segment: 'assistance', label: 'Assistance', icon: 'UsersThree' },
  { segment: 'course', label: 'La course', shortLabel: 'Course', icon: 'BookOpenText' },
];

export function raceHref(participantRaceId: string, segment: string): string {
  return `/courses/${participantRaceId}/${segment}`;
}

/**
 * La participation dont l'URL parle, s'il y en a une.
 *
 * Un layout ne reçoit pas les paramètres de ses enfants : le shell lit donc le
 * chemin. C'est la seule information dont il a besoin, et elle est déjà là.
 */
export function participantRaceIdFromPath(pathname: string): string | null {
  return /^\/courses\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/** Vrai quand le chemin appartient à la zone course, et non à la zone globale. */
export function isRaceZone(pathname: string): boolean {
  return pathname.startsWith('/courses/');
}

/**
 * Destination active.
 *
 * `/` ne matche qu'exactement : sans cette exception, l'accueil serait actif
 * sur toutes les pages. Ailleurs, le préfixe suffit et rend l'onglet parent
 * actif sur ses sous-onglets — `/bibliotheque/sacs` allume Ma bibliothèque.
 */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';

  return pathname === href || pathname.startsWith(`${href}/`);
}
