import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BackpackIcon,
  BookOpenTextIcon,
  BooksIcon,
  ChartLineIcon,
  ChatCircleIcon,
  ChatsCircleIcon,
  ChatTeardropTextIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockCountdownIcon,
  EnvelopeIcon,
  FilePdfIcon,
  FlagCheckeredIcon,
  FlagIcon,
  FlaskIcon,
  GlobeIcon,
  ListChecksIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  MinusCircleIcon,
  MountainsIcon,
  NoteIcon,
  PathIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  TableIcon,
  UsersThreeIcon,
  WarningIcon,
} from '@phosphor-icons/react/ssr';

/**
 * Registre d'icônes des pages d'atterrissage.
 *
 * 06_DESIGN_SYSTEM.md §145 autorise « une bibliothèque d'icônes externe […] si
 * son trait peut être normalisé », à condition de ne pas mélanger trois
 * familles (§3353). Le prototype emploie Phosphor en style `regular` : la même
 * famille est reprise, par le paquet React plutôt que par la feuille CDN du
 * prototype, qui imposerait une requête runtime vers unpkg.
 *
 * L'import passe par l'entrée `ssr` : elle rend des composants compatibles
 * Server Components, sans `"use client"` et sans contexte. La page reste
 * entièrement statique. Les noms suffixés `…Icon` sont les noms courants du
 * paquet ; les alias sans suffixe sont marqués dépréciés.
 *
 * Le registre n'existe que pour laisser les modules de `content/` en données
 * pures : ils nomment une icône, ils n'importent pas de composant.
 */

const ICONS = {
  ArrowDown: ArrowDownIcon,
  ArrowRight: ArrowRightIcon,
  ArrowUpRight: ArrowUpRightIcon,
  Backpack: BackpackIcon,
  BookOpenText: BookOpenTextIcon,
  Books: BooksIcon,
  ChartLine: ChartLineIcon,
  ChatCircle: ChatCircleIcon,
  ChatTeardropText: ChatTeardropTextIcon,
  ChatsCircle: ChatsCircleIcon,
  Check: CheckIcon,
  CheckCircle: CheckCircleIcon,
  ClockCountdown: ClockCountdownIcon,
  Envelope: EnvelopeIcon,
  FilePdf: FilePdfIcon,
  Flag: FlagIcon,
  FlagCheckered: FlagCheckeredIcon,
  Flask: FlaskIcon,
  Globe: GlobeIcon,
  ListChecks: ListChecksIcon,
  LockSimple: LockSimpleIcon,
  MagnifyingGlass: MagnifyingGlassIcon,
  MapTrifold: MapTrifoldIcon,
  MinusCircle: MinusCircleIcon,
  Mountains: MountainsIcon,
  Note: NoteIcon,
  Path: PathIcon,
  SealCheck: SealCheckIcon,
  ShieldCheck: ShieldCheckIcon,
  Table: TableIcon,
  UsersThree: UsersThreeIcon,
  Warning: WarningIcon,
} as const satisfies Readonly<Record<string, PhosphorIcon>>;

export type IconName = keyof typeof ICONS;

/**
 * §40 fixe les tailles de référence : 20 px en ligne de texte, 24 px en
 * navigation, 32 px en tête de section. Le prototype marketing descend à 13 px
 * sur certains connecteurs ; `size` reste donc explicite à l'appel.
 *
 * `className` est passé seulement s'il est défini : `exactOptionalPropertyTypes`
 * refuse un `undefined` explicite sur une prop optionnelle.
 */
export function Icon({
  name,
  size = 20,
  className,
}: {
  readonly name: IconName;
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}) {
  const Component = ICONS[name];

  return className === undefined ? (
    <Component size={size} />
  ) : (
    <Component size={size} className={className} />
  );
}
