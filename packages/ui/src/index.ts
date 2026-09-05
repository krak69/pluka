/**
 * `@pluka/ui` — Design System PLUKA : tokens et primitives.
 *
 * Feuille de styles à importer une fois par application :
 *
 * ```ts
 * import '@pluka/ui/styles.css';
 * ```
 *
 * Ce paquet ne contient que des primitives et aucune règle métier
 * (06_DESIGN_SYSTEM.md §111). Les composants de domaine — `AltitudeProfile`,
 * `PlanWaypointRow`, `NutritionWaypoint`, `ConditionPoint`, `OrganizerBrief` —
 * vivent avec leur domaine.
 *
 * §110 liste une quarantaine de composants et précise que « tous ne doivent
 * pas être codés avant besoin réel » : ce lot livre les primitives dont le
 * document fixe précisément la forme.
 */

export { Badge, type BadgeProps, type BadgeTone } from './components/Badge.js';
export { Button, type ButtonProps, type ButtonVariant } from './components/Button.js';
export { DataValue, type DataValueProps } from './components/DataValue.js';
export { Divider, type DividerProps } from './components/Divider.js';
export { IconButton, type IconButtonProps } from './components/IconButton.js';
export { Input, type InputProps } from './components/Input.js';
export { Link, type LinkProps } from './components/Link.js';
export { MicroLabel, type MicroLabelProps } from './components/MicroLabel.js';
export { SourceDrawer, type SourceDrawerProps } from './components/SourceDrawer.js';
export { SourceLink, type SourceLinkProps } from './components/SourceLink.js';
export { StatusBadge, type StatusBadgeProps, type StatusTone } from './components/StatusBadge.js';
export {
  TRUST_LEVEL_LABELS,
  TrustBadge,
  type TrustBadgeProps,
  type TrustLevel,
} from './components/TrustBadge.js';

export {
  brandColors,
  contentWidth,
  focusColors,
  fontFamily,
  functionalColors,
  motion,
  radius,
  signalColors,
  spacing,
  textColors,
  zIndex,
} from './tokens/tokens.js';
