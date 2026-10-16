import type { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { HEADING_STYLE, siteFontVariables } from '@/app/site/fonts';
import { safeHttpUrl } from '@/app/site/format';
import { loadEventSite, siteAssetUrl, siteTheme } from '@/lib/event-site';

import '@/app/site/site.css';

/**
 * Le site d'un événement — EVENT_SITE §3, §4, §9.
 *
 * Servi par l'app sur `{slug}.pluka.run`, que le proxy réécrit ici. Le gabarit
 * porte l'identité de l'événement — logo, accent, police de titres — et rien
 * d'autre : les blocs fonctionnels gardent la grammaire PLUKA
 * (06_DESIGN_SYSTEM §96). L'en-tête est clair pour tous les sites : la
 * plupart des logos sont sombres sur fond transparent.
 */

type Params = { readonly siteSlug: string };

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<Params>;
}): Promise<Metadata> {
  const site = await loadEventSite((await params).siteSlug);
  const year = site.edition === null ? '' : ` ${String(site.edition.year)}`;

  return {
    // `absolute` : le gabarit « — PLUKA » de l'app ne s'applique pas au site
    // d'un événement, qui porte son propre nom (§1).
    title: { absolute: `${site.event.name}${year}`, template: `%s — ${site.event.name}` },
    description: site.event.description ?? undefined,
    // Un site en ligne est fait pour être trouvé (§7.3) ; l'app reste `noindex`.
    robots: { index: true, follow: true },
  };
}

export default async function SiteLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<Params>;
}) {
  const site = await loadEventSite((await params).siteSlug);
  const theme = siteTheme(site);
  const heading = HEADING_STYLE[theme.headingFont];
  const logo = siteAssetUrl(site.appearance.logoPath);
  const registration = safeHttpUrl(site.edition?.registrationUrl ?? null);

  const style = {
    '--site-accent': theme.accent,
    '--site-accent-ink': theme.accentInk,
    '--site-heading': heading.family,
    '--site-heading-case': heading.uppercase ? 'uppercase' : 'none',
  } as CSSProperties;

  return (
    <div className={`es-site ${siteFontVariables}`} style={style}>
      <a className="es-skip" href="#contenu">
        Aller au contenu
      </a>
      <header className="es-header">
        <div className="es-wrap es-header-inner">
          <Link href="/" className="es-brand">
            {logo === null ? null : (
              // Une image déposée par l'organisation, servie par le stockage
              // public : pas d'optimisation Next, qui exigerait de déclarer
              // chaque domaine d'origine.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="es-brand-logo" />
            )}
            <span className="es-brand-name">{site.event.name}</span>
          </Link>
          <nav aria-label="Rubriques" className="es-nav">
            <Link href="/#epreuves">Épreuves</Link>
            <Link href="/#infos">Infos pratiques</Link>
            {site.documents.length === 0 ? null : <Link href="/#documents">Documents</Link>}
            {site.partners.length === 0 ? null : <Link href="/#partenaires">Partenaires</Link>}
          </nav>
          {registration === null ? null : (
            <a href={registration} className="es-cta es-cta-small" rel="noopener" target="_blank">
              S’inscrire
              <span aria-hidden="true"> ↗</span>
              <span className="es-visually-hidden"> (plateforme d’inscription, nouvel onglet)</span>
            </a>
          )}
        </div>
      </header>

      <main id="contenu">{children}</main>

      <footer className="es-footer">
        <div className="es-wrap es-footer-inner">
          <span className="es-footer-name">{site.event.name}</span>
          <a href="https://pluka.run" className="es-powered">
            Propulsé par <strong>PLUKA</strong>
          </a>
        </div>
      </footer>
    </div>
  );
}
