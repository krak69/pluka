import Link from 'next/link';

import { BrandLockup } from '@/components/brand-lockup';

/**
 * Pied de page des deux pages d'atterrissage.
 *
 * Server Component : aucun état. Les deux pages n'ont pas la même trame — la
 * homepage répartit quatre colonnes en grille automatique, la page
 * Organisateurs en aligne deux à droite de la marque — d'où `layout`.
 *
 * La mention finale de la homepage fait partie de l'intégrité éditoriale du
 * prototype marketing (06_DESIGN_SYSTEM.md §2815) : elle est reprise telle
 * quelle, pas résumée.
 */

export type FooterColumn = {
  readonly title: string;
  readonly links: readonly { readonly label: string; readonly href: string }[];
};

type SiteFooterProps = {
  readonly layout: 'grid' | 'inline';
  readonly tagline: string;
  readonly columns: readonly FooterColumn[];
  readonly domain: string;
  /** Mention de périmètre, présente sur la homepage uniquement. */
  readonly disclaimer?: string;
};

function Column({ column }: { readonly column: FooterColumn }) {
  return (
    <div>
      <p className="lp-footer-col-title">{column.title}</p>
      <div className="lp-stack lp-gap-1">
        {column.links.map((link) =>
          link.href.startsWith('/') ? (
            <Link key={`${column.title}-${link.label}`} href={link.href} className="lp-footer-link">
              {link.label}
            </Link>
          ) : (
            <a key={`${column.title}-${link.label}`} href={link.href} className="lp-footer-link">
              {link.label}
            </a>
          ),
        )}
      </div>
    </div>
  );
}

export function SiteFooter({ layout, tagline, columns, domain, disclaimer }: SiteFooterProps) {
  return (
    <footer className={layout === 'grid' ? 'lp-footer' : 'lp-footer lp-footer-org'}>
      <div className="lp-wrap">
        {layout === 'grid' ? (
          <div className="lp-auto-180" style={{ marginBottom: 'var(--space-8)' }}>
            <div>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <BrandLockup />
              </div>
              <p className="lp-footer-tagline lp-measure-26">{tagline}</p>
            </div>

            {columns.map((column) => (
              <Column key={column.title} column={column} />
            ))}
          </div>
        ) : (
          <div className="lp-footer-cols" style={{ marginBottom: 'var(--space-8)' }}>
            <div className="lp-footer-brand">
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <BrandLockup />
              </div>
              <p className="lp-footer-tagline lp-measure-30">{tagline}</p>
            </div>

            <div className="lp-footer-groups">
              {columns.map((column) => (
                <Column key={column.title} column={column} />
              ))}
            </div>
          </div>
        )}

        <div className="lp-footer-legal">
          <span>© PLUKA</span>
          <span>{domain}</span>
          {disclaimer === undefined ? null : (
            <span className="lp-footer-legal-end">{disclaimer}</span>
          )}
        </div>
      </div>
    </footer>
  );
}
