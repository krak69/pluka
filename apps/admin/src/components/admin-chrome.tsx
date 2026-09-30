'use client';

import { Logo, NavTabs } from '@pluka/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ADMIN_NAV, isCurrent } from '@/components/admin-nav';

/**
 * Barre d'administration — 06_DESIGN_SYSTEM.md §69.
 *
 * Client Component pour une seule raison : `usePathname()` détermine l'onglet
 * actif. Rien d'autre n'est interactif.
 *
 * §1841 refuse « une sidebar immense remplie d'icônes » : dix destinations en
 * bandeau horizontal, libellées, sans icône — une console d'administration se
 * lit, elle ne se devine pas.
 */
export function AdminChrome() {
  const pathname = usePathname();

  return (
    <header className="ad-bar">
      <div className="ad-bar-top">
        {/* Fond Ardoise : `inverse` est la déclinaison prévue (§143). */}
        <Link href="/" className="ad-bar-logo" aria-label="Administration PLUKA">
          <Logo tone="inverse" height={22} decorative />
        </Link>

        <span className="pk-label ad-bar-scope">Administration</span>
      </div>

      <NavTabs
        label="Sections de l’administration"
        tone="inverse"
        tabs={ADMIN_NAV.map((destination) => ({
          href: destination.href,
          label: destination.label,
          current: isCurrent(pathname, destination.href),
        }))}
      />
    </header>
  );
}
