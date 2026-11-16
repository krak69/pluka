import type { Metadata } from 'next';
import { Archivo, Hanken_Grotesk, Martian_Mono } from 'next/font/google';
import Script from 'next/script';
import type { ReactNode } from 'react';

import '@pluka/ui/styles.css';
import '@/app/landing.css';
import { publicEnv } from '@/lib/env';

/**
 * Site public, indexable — 01_ARCHITECTURE.md §4.1.
 *
 * Les trois familles de la Charte sont chargées par `next/font`, comme §114
 * l'exige : « ne pas dépendre nécessairement d'un `@import` Google Fonts
 * runtime comme le prototype ». Les fichiers sont servis depuis notre origine,
 * sans requête vers un tiers au rendu, et sans être committés — la licence
 * reste celle de Google Fonts (§114).
 *
 * Archivo demande explicitement l'axe `wdth` : la Charte s'en sert comme d'un
 * paramètre de composition, de 113 sur les boutons à 125 sur le lockup, et
 * `font-variation-settings` n'a aucun effet sur une police non variable.
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

/**
 * Les trois variables de `@pluka/ui` sont réassignées aux familles générées,
 * ce que `tokens/typography.css` prévoit explicitement. Le repli système reste
 * en queue de pile (§115) : si le chargement échoue, la page reste lisible.
 */
const fontVariables = `${archivo.variable} ${hanken.variable} ${martian.variable}`;

/*
 * `metadataBase` résout les URL relatives des `alternates` et des balises Open
 * Graph. Le prototype écrit `https://pluka.run` en dur ; ici l'origine vient de
 * la configuration publique, pour qu'une recette ne se déclare pas canonique.
 */
export const metadata: Metadata = {
  metadataBase: new URL(publicEnv().NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'PLUKA — Prépare ton trail : plan de course, nutrition, matériel et assistance',
    template: '%s — PLUKA',
  },
  description:
    'Prépare ton trail ou ultra-trail avec PLUKA : plan de course personnalisé, temps de passage, barrières horaires, nutrition, matériel et assistance réunis au même endroit.',
  applicationName: 'PLUKA',
  openGraph: {
    type: 'website',
    siteName: 'PLUKA',
    locale: 'fr_FR',
  },
};

/*
 * Mesure d'audience Umami Cloud : sans cookie, statistiques agrégées. Le site
 * public seulement — `apps/app` porte des données privées et des liens à jeton
 * qui ne doivent jamais partir chez un tiers (AGENTS §63, §64). Sans
 * identifiant configuré (local, recette), aucun script n'est chargé.
 */
const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  const umamiWebsiteId = publicEnv().NEXT_PUBLIC_UMAMI_WEBSITE_ID;

  return (
    <html lang="fr" className={fontVariables}>
      <body>
        {children}
        {umamiWebsiteId === undefined ? null : (
          <Script
            src={UMAMI_SCRIPT_URL}
            data-website-id={umamiWebsiteId}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
