import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BackpackIcon,
  BookOpenTextIcon,
  BooksIcon,
  CalendarDotsIcon,
  ChartLineUpIcon,
  CaretDownIcon,
  CaretUpDownIcon,
  CheckIcon,
  ChatsCircleIcon,
  CloudFogIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  GlobeSimpleIcon,
  HouseIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  MoonIcon,
  MountainsIcon,
  PathIcon,
  PencilSimpleIcon,
  PlusIcon,
  SnowflakeIcon,
  SparkleIcon,
  SunIcon,
  ThermometerSimpleIcon,
  TShirtIcon,
  TrashIcon,
  UserListIcon,
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
  ArrowLeft: ArrowLeftIcon,
  ArrowRight: ArrowRightIcon,
  Backpack: BackpackIcon,
  BookOpenText: BookOpenTextIcon,
  Books: BooksIcon,
  CalendarDots: CalendarDotsIcon,
  ChartLineUp: ChartLineUpIcon,
  CaretDown: CaretDownIcon,
  CaretUpDown: CaretUpDownIcon,
  Check: CheckIcon,
  ChatsCircle: ChatsCircleIcon,
  Cloud: CloudIcon,
  CloudFog: CloudFogIcon,
  CloudLightning: CloudLightningIcon,
  CloudRain: CloudRainIcon,
  CloudSnow: CloudSnowIcon,
  CloudSun: CloudSunIcon,
  GlobeSimple: GlobeSimpleIcon,
  House: HouseIcon,
  ListChecks: ListChecksIcon,
  MagnifyingGlass: MagnifyingGlassIcon,
  Minus: MinusIcon,
  Moon: MoonIcon,
  Mountains: MountainsIcon,
  Path: PathIcon,
  PencilSimple: PencilSimpleIcon,
  Plus: PlusIcon,
  Snowflake: SnowflakeIcon,
  Sparkle: SparkleIcon,
  Sun: SunIcon,
  ThermometerSimple: ThermometerSimpleIcon,
  Trash: TrashIcon,
  TShirt: TShirtIcon,
  UserList: UserListIcon,
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
