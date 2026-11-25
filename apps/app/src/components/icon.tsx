import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsLeftRightIcon,
  BackpackIcon,
  BasketIcon,
  BookOpenTextIcon,
  BooksIcon,
  CalendarDotsIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  ChartLineUpIcon,
  ChatsCircleIcon,
  CheckIcon,
  CloudFogIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  DropIcon,
  EyeIcon,
  EyeSlashIcon,
  ForkKnifeIcon,
  GlobeSimpleIcon,
  HouseIcon,
  ListBulletsIcon,
  ListChecksIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  MoonIcon,
  MountainsIcon,
  PathIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SnowflakeIcon,
  SparkleIcon,
  SunIcon,
  ThermometerSimpleIcon,
  TrashIcon,
  TShirtIcon,
  UserIcon,
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
  ArrowsLeftRight: ArrowsLeftRightIcon,
  Backpack: BackpackIcon,
  Basket: BasketIcon,
  BookOpenText: BookOpenTextIcon,
  Books: BooksIcon,
  CalendarDots: CalendarDotsIcon,
  CaretDown: CaretDownIcon,
  CaretRight: CaretRightIcon,
  CaretUpDown: CaretUpDownIcon,
  ChartLineUp: ChartLineUpIcon,
  ChatsCircle: ChatsCircleIcon,
  Check: CheckIcon,
  Cloud: CloudIcon,
  CloudFog: CloudFogIcon,
  CloudLightning: CloudLightningIcon,
  CloudRain: CloudRainIcon,
  CloudSnow: CloudSnowIcon,
  CloudSun: CloudSunIcon,
  Drop: DropIcon,
  Eye: EyeIcon,
  EyeSlash: EyeSlashIcon,
  ForkKnife: ForkKnifeIcon,
  GlobeSimple: GlobeSimpleIcon,
  House: HouseIcon,
  ListBullets: ListBulletsIcon,
  ListChecks: ListChecksIcon,
  LockSimple: LockSimpleIcon,
  MagnifyingGlass: MagnifyingGlassIcon,
  Minus: MinusIcon,
  Moon: MoonIcon,
  Mountains: MountainsIcon,
  Path: PathIcon,
  PencilSimple: PencilSimpleIcon,
  Plus: PlusIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
  Snowflake: SnowflakeIcon,
  Sparkle: SparkleIcon,
  Sun: SunIcon,
  ThermometerSimple: ThermometerSimpleIcon,
  Trash: TrashIcon,
  TShirt: TShirtIcon,
  User: UserIcon,
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
