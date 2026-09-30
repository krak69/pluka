import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  BookOpenTextIcon,
  BooksIcon,
  CalendarDotsIcon,
  CaretUpDownIcon,
  ChatsCircleIcon,
  HouseIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  MountainsIcon,
  PathIcon,
  SparkleIcon,
  UsersThreeIcon,
  XIcon,
} from '@phosphor-icons/react/ssr';

/**
 * Icônes du shell coureur.
 *
 * Même famille et même entrée que `apps/www` : Phosphor en style `regular`, via
 * `/ssr` pour rester compatible Server Components. §3353 interdit de mélanger
 * trois familles d'icônes ; il n'y en a qu'une dans tout le produit.
 *
 * §1869 : une icône n'est jamais la seule information d'une destination. Elles
 * sont toutes décoratives ici, et `NavItem` les marque `aria-hidden`.
 */

const ICONS = {
  BookOpenText: BookOpenTextIcon,
  Books: BooksIcon,
  CalendarDots: CalendarDotsIcon,
  CaretUpDown: CaretUpDownIcon,
  ChatsCircle: ChatsCircleIcon,
  House: HouseIcon,
  ListChecks: ListChecksIcon,
  MagnifyingGlass: MagnifyingGlassIcon,
  Mountains: MountainsIcon,
  Path: PathIcon,
  Sparkle: SparkleIcon,
  UsersThree: UsersThreeIcon,
  X: XIcon,
} as const satisfies Readonly<Record<string, PhosphorIcon>>;

export type IconName = keyof typeof ICONS;

/** §40 : 20 px en ligne de texte, 24 px en navigation. */
export function Icon({
  name,
  size = 20,
}: {
  readonly name: IconName;
  readonly size?: number | undefined;
}) {
  const Component = ICONS[name];

  return <Component size={size} />;
}
