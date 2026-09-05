/**
 * Miroir TypeScript des tokens CSS — 06_DESIGN_SYSTEM.md §113.
 *
 * Le CSS reste la source appliquée au document ; ce module sert aux usages
 * qui ne peuvent pas lire une variable CSS — un `<meta name="theme-color">`,
 * un canvas, un SVG généré côté serveur, une dataviz.
 *
 * La duplication est réelle et assumée, donc surveillée : `tests/tokens.test.ts`
 * relit `tokens/*.css` et échoue si les deux divergent. Sans ce test, ce
 * fichier deviendrait une seconde vérité silencieuse.
 *
 * Aucune valeur n'est inventée ici. Une nouvelle couleur passe d'abord par le
 * Design System (§139).
 */

/** Palette de marque — §4.1. */
export const brandColors = {
  ink: '#0e1a17',
  forest: '#14342c',
  lichen: '#c6f24e',
  lichenDeep: '#a8d42f',
  lichenActive: '#96c022',
  dawn: '#ff6a3d',
  dawnInk: '#c4471f',
  glacier: '#9ae0d6',
  glacierBg: '#e8f4f1',
  limestone: '#f2f0e9',
  surface: '#ffffff',
  sand: '#e4e1d6',
  hairline: '#dcd8cb',
  granite: '#6f7a74',
} as const;

export const textColors = {
  text: '#0e1a17',
  secondary: '#4a5a54',
  muted: '#5a6660',
  onDark: '#f2f0e9',
} as const;

/**
 * Couleurs de signal de la Charte — §5.
 *
 * Elles ne remplacent jamais les couleurs de marque et ne concurrencent pas
 * le Lichen : elles ne servent que leur sémantique.
 */
export const signalColors = {
  success: '#3fbf7f',
  warning: '#f2b33d',
  error: '#e14434',
} as const;

/** Encre lisible pour le texte et l'iconographie fonctionnels — §5. */
export const functionalColors = {
  success: '#2f7a55',
  warning: '#b8791c',
  error: '#b23a2b',
  successBg: '#e6efe4',
  warningBg: '#f5ecd8',
  errorBg: '#f6e7e1',
} as const;

/** §134 — valeurs à revalider en contraste réel. */
export const focusColors = {
  light: '#14342c',
  dark: '#c6f24e',
} as const;

export const fontFamily = {
  heading: "'Archivo', system-ui, sans-serif",
  body: "'Hanken Grotesk', system-ui, sans-serif",
  mono: "'Martian Mono', ui-monospace, monospace",
} as const;

/** §17 — la direction est anguleuse : rien au-dessus de 3 px. */
export const radius = {
  sm: '2px',
  md: '2px',
  lg: '3px',
} as const;

/** §20 — convention d'implémentation V1, base 4 px. */
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
} as const;

/** §21 — conventions de code, pas des valeurs de la Charte. */
export const contentWidth = {
  wide: '1280px',
  main: '1120px',
  reading: '720px',
} as const;

/** §99 — court, fonctionnel, discret. */
export const motion = {
  interaction: '150ms',
  panel: '240ms',
  ease: 'cubic-bezier(0.2, 0, 0.2, 1)',
} as const;

/** §159 — nommer les plans limite les contextes arbitraires. */
export const zIndex = {
  base: 0,
  sticky: 20,
  dropdown: 40,
  overlay: 60,
  modal: 80,
  toast: 100,
} as const;
