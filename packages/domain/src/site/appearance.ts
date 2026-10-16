/**
 * L'identité d'un site — EVENT_SITE §4.
 *
 * Logo, couverture, une couleur d'accent, une police de titres. Le reste —
 * états, provenance, blocs fonctionnels — garde la grammaire PLUKA
 * (06_DESIGN_SYSTEM §96).
 */

/** Les polices de titres proposées. Même liste que la contrainte de `event_sites.heading_font` (0049). */
export const SITE_HEADING_FONTS = [
  'archivo',
  'barlow-condensed',
  'oswald',
  'bebas-neue',
  'space-grotesk',
  'montserrat',
  'fraunces',
  'playfair-display',
] as const;

export type SiteHeadingFont = (typeof SITE_HEADING_FONTS)[number];

export const DEFAULT_HEADING_FONT: SiteHeadingFont = 'archivo';

/** Sans accent choisi, le site prend Forêt : l'identité PLUKA la plus sobre. */
export const DEFAULT_SITE_ACCENT = '#14342c';

const INK = '#0e1a17';
const WHITE = '#ffffff';

/** Seuil WCAG 2.2 AA pour un texte courant (1.4.3). */
export const AA_CONTRAST = 4.5;

/** Seuil WCAG 2.2 AA pour un élément d'interface non textuel (1.4.11). */
export const AA_NON_TEXT_CONTRAST = 3;

/** Le fond des sites : Calcaire. L'accent y trace filets et repères. */
export const SITE_BACKGROUND = '#f2f0e9';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) throw new RangeError(`couleur invalide : ${hex}`);

  const [r, g, b] = [match[1], match[2], match[3]].map((part) =>
    channel(Number.parseInt(part ?? '0', 16)),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs `#rrggbb`. */
export function contrastRatio(left: string, right: string): number {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** La couleur du texte posé sur l'accent : blanc ou Ardoise, celle qui contraste le plus. */
export function accentInk(accent: string): string {
  return contrastRatio(accent, WHITE) >= contrastRatio(accent, INK) ? WHITE : INK;
}

/** Pourquoi un accent est refusé. */
export type AccentContrastIssue =
  /** Le texte des boutons, posé sur l'accent, ne se lit pas assez. */
  | { readonly kind: 'text_on_accent'; readonly ratio: number }
  /** L'accent ne se détache pas assez du fond Calcaire. */
  | { readonly kind: 'accent_on_background'; readonly ratio: number };

const round = (ratio: number) => Math.floor(ratio * 100) / 100;

/**
 * Un accent est accepté si le texte posé dessus reste lisible (AA, 4,5:1) et
 * s'il se détache du fond (3:1). Rend la première raison du refus, avec le
 * contraste obtenu, pour que l'écran le dise ; `null` s'il est accepté.
 */
export function accentContrastIssue(accent: string): AccentContrastIssue | null {
  const onAccent = contrastRatio(accent, accentInk(accent));
  if (onAccent < AA_CONTRAST) return { kind: 'text_on_accent', ratio: round(onAccent) };

  const onBackground = contrastRatio(accent, SITE_BACKGROUND);
  if (onBackground < AA_NON_TEXT_CONTRAST) {
    return { kind: 'accent_on_background', ratio: round(onBackground) };
  }

  return null;
}
