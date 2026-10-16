import type { SiteHeadingFont } from '@pluka/domain';
import {
  Barlow_Condensed,
  Bebas_Neue,
  Fraunces,
  Montserrat,
  Oswald,
  Playfair_Display,
  Space_Grotesk,
} from 'next/font/google';

/**
 * Les polices de titres des sites — EVENT_SITE §4.1.
 *
 * Servies par PLUKA : `next/font` les télécharge au build, et le navigateur
 * ne contacte aucun service tiers. Aucune n'est préchargée : chaque site n'en
 * utilise qu'une, et le navigateur ne télécharge que celle-là. Archivo, la
 * police PLUKA, vient du layout racine.
 */
const barlow = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-site-barlow-condensed',
});
const oswald = Oswald({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-site-oswald',
});
const bebas = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  preload: false,
  variable: '--font-site-bebas-neue',
});
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-site-space-grotesk',
});
const montserrat = Montserrat({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-site-montserrat',
});
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-site-fraunces',
});
const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-site-playfair-display',
});

export const siteFontVariables = [
  barlow,
  oswald,
  bebas,
  spaceGrotesk,
  montserrat,
  fraunces,
  playfair,
]
  .map((font) => font.variable)
  .join(' ');

/**
 * La famille et la casse des titres. Les polices condensées se lisent en
 * capitales, comme sur une affiche ; les autres gardent leur casse.
 */
export const HEADING_STYLE: Readonly<
  Record<SiteHeadingFont, { readonly family: string; readonly uppercase: boolean }>
> = {
  archivo: { family: 'var(--font-archivo)', uppercase: false },
  'barlow-condensed': { family: 'var(--font-site-barlow-condensed)', uppercase: true },
  oswald: { family: 'var(--font-site-oswald)', uppercase: true },
  'bebas-neue': { family: 'var(--font-site-bebas-neue)', uppercase: true },
  'space-grotesk': { family: 'var(--font-site-space-grotesk)', uppercase: false },
  montserrat: { family: 'var(--font-site-montserrat)', uppercase: false },
  fraunces: { family: 'var(--font-site-fraunces)', uppercase: false },
  'playfair-display': { family: 'var(--font-site-playfair-display)', uppercase: false },
};
