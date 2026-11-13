'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon, type IconName } from '@/components/icon';

/**
 * Navigation de l'espace organisateur — prototype, `screen: 'org'`.
 *
 * Client Component pour une seule raison : savoir quelle entrée est active.
 * Les entrées arrivent toutes faites du layout, qui connaît l'organisation.
 */
export interface OrgNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** Préfixe qui rend l'entrée active, quand elle couvre plusieurs écrans. */
  readonly match?: string;
  /** Vrai : actif seulement sur l'adresse exacte (l'accueil). */
  readonly exact?: boolean;
}

export function OrgSideNav({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly OrgNavItem[];
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="os-nav">
      <ul>
        {items.map((item) => {
          const prefix = item.match ?? item.href;
          const current =
            item.exact === true
              ? pathname === item.href
              : pathname === prefix || pathname.startsWith(`${prefix}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={current ? 'os-nav-link os-nav-link-current' : 'os-nav-link'}
                aria-current={current ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
