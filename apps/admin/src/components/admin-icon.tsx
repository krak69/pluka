import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  BuildingsIcon,
  CalendarDotsIcon,
  CheckIcon,
  CheckCircleIcon,
  CheckSquareOffsetIcon,
  ClockCounterClockwiseIcon,
  FilePdfIcon,
  FilesIcon,
  FlagIcon,
  GearSixIcon,
  GlobeIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  PackageIcon,
  PlusIcon,
  SignOutIcon,
  SneakerMoveIcon,
  SquaresFourIcon,
  TrayIcon,
  UploadSimpleIcon,
  UserListIcon,
  UsersThreeIcon,
  WarningDiamondIcon,
  XCircleIcon,
} from '@phosphor-icons/react/ssr';

/**
 * Icônes de la console — celles de l'`adminNav` du prototype.
 *
 * Même famille et même entrée que `apps/app` et `apps/www` : Phosphor
 * `regular`, via `/ssr`. §3353 interdit de mélanger les familles d'icônes.
 *
 * §1869 : une icône n'est jamais la seule information d'une destination. Elles
 * sont toutes décoratives, et `NavItem` les marque `aria-hidden`.
 */

const ICONS = {
  ArrowRight: ArrowRightIcon,
  ArrowsClockwise: ArrowsClockwiseIcon,
  Buildings: BuildingsIcon,
  CalendarDots: CalendarDotsIcon,
  Check: CheckIcon,
  CheckCircle: CheckCircleIcon,
  CheckSquareOffset: CheckSquareOffsetIcon,
  ClockCounterClockwise: ClockCounterClockwiseIcon,
  FilePdf: FilePdfIcon,
  Files: FilesIcon,
  Flag: FlagIcon,
  GearSix: GearSixIcon,
  Globe: GlobeIcon,
  MagicWand: MagicWandIcon,
  MagnifyingGlass: MagnifyingGlassIcon,
  MapTrifold: MapTrifoldIcon,
  Package: PackageIcon,
  Plus: PlusIcon,
  SignOut: SignOutIcon,
  SneakerMove: SneakerMoveIcon,
  SquaresFour: SquaresFourIcon,
  Tray: TrayIcon,
  UploadSimple: UploadSimpleIcon,
  UserList: UserListIcon,
  UsersThree: UsersThreeIcon,
  WarningDiamond: WarningDiamondIcon,
  XCircle: XCircleIcon,
} as const satisfies Readonly<Record<string, PhosphorIcon>>;

export type AdminIconName = keyof typeof ICONS;

export function AdminIcon({
  name,
  size = 18,
}: {
  readonly name: AdminIconName;
  readonly size?: number | undefined;
}) {
  const Component = ICONS[name];

  return <Component size={size} />;
}
