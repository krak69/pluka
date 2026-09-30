import type { Metadata } from 'next';
import { Archivo, Hanken_Grotesk, Martian_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import '@pluka/ui/styles.css';
import '@/app/shell.css';

/**
 * Les trois familles de la Charte — 06_DESIGN_SYSTEM.md §114, §115.
 *
 * Chargées par `next/font` et non par un `@import` runtime. Archivo demande
 * explicitement l'axe `wdth` : la Charte s'en sert comme paramètre de
 * composition, et `font-variation-settings` n'a aucun effet sur une police non
 * variable. `shell.css` réassigne les trois variables de `@pluka/ui` aux
 * familles générées, en gardant le repli système en queue de pile.
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
});

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken',
});

const martian = Martian_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-martian',
});

const fontVariables = `${archivo.variable} ${hanken.variable} ${martian.variable}`;

/**
 * Application authentifiée : jamais indexée (01_ARCHITECTURE §6).
 *
 * L'en-tête `X-Robots-Tag` de `next.config.ts` couvre en plus les Route
 * Handlers, que cette métadonnée n'atteint pas.
 */
export const metadata: Metadata = {
  title: { default: 'PLUKA', template: '%s — PLUKA' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="fr" className={fontVariables}>
      <body className="pk-surface-page">{children}</body>
    </html>
  );
}
