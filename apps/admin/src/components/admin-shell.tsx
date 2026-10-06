'use client';

import { Logo, NavItem, NavList, NavTabs } from '@pluka/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminIcon } from '@/components/admin-icon';
import { ADMIN_NAV, isCurrent } from '@/components/admin-nav';

/**
 * Shell de la console d'administration — `screen === 'admin'` du prototype.
 *
 * Décision produit du 2026-10-06 : la console suit la barre latérale du
 * prototype, et non plus un bandeau d'onglets (`05_ROUTES_FLOWS.md` §7.6,
 * `06_DESIGN_SYSTEM.md` §69).
 *
 * Les deux navigations sont rendues côté serveur, et c'est la feuille qui
 * choisit (`admin.css`, seuil 1100 px du prototype). Aucun hook de largeur :
 * une valeur initiale côté client ferait apparaître la mauvaise variante au
 * premier rendu, puis basculer.
 *
 * Client Component pour une seule raison : `usePathname()` détermine l'entrée
 * active.
 */
export interface AdminShellProps {
  /**
   * Extractions à examiner — le badge de « Validation ». `null` quand le
   * compteur n'a pas été lu (pas de session, ou pas `pluka_admin`) : aucun
   * badge plutôt qu'un zéro qui affirmerait « rien à examiner ».
   */
  readonly pendingValidation: number | null;
  /** Origine de `apps/app`, pour les deux liens de pied (§8). */
  readonly appUrl: string;
  /**
   * Déconnexion — la Server Action de `app/actions.ts`, transmise par le
   * layout. Absente sans session : `/connexion` n'a personne à déconnecter.
   */
  readonly signOut: (() => Promise<void>) | null;
  readonly children: ReactNode;
}

const NAV_LABEL = 'Sections de l’administration';

export function AdminShell({
  pendingValidation,
  appUrl,
  signOut,
  children,
}: AdminShellProps) {
  const pathname = usePathname();
  const base = appUrl.replace(/\/+$/, '');

  return (
    <div className="ad-shell">
      <a className="ad-skip" href="#contenu">
        Aller au contenu
      </a>

      <aside className="ad-sidebar">
        <div className="ad-brand">
          <Link href="/" className="ad-brand-link" aria-label="Administration PLUKA, accueil">
            {/* Fond Ardoise : le symbole en Lichen, comme `#pk-mark` du prototype. */}
            <Logo variant="mark" tone="lichen" height={21} decorative />
            <span className="ad-brand-title">Administration</span>
          </Link>
          <p className="ad-brand-scope">Équipe PLUKA · toutes organisations</p>
        </div>

        <NavList label={NAV_LABEL} hideLabel>
          {ADMIN_NAV.map((destination) => (
            <NavItem
              key={destination.href}
              href={destination.href}
              icon={<AdminIcon name={destination.icon} />}
              current={isCurrent(pathname, destination.href)}
              {...(destination.href === '/validation' && pendingValidation !== null
                ? { badge: pendingValidation }
                : {})}
              onDark
            >
              {destination.label}
            </NavItem>
          ))}
        </NavList>

        <div className="ad-sidebar-foot">
          <a href={`${base}/org`} className="ad-foot-link ad-foot-link-org">
            <AdminIcon name="Buildings" size={17} />
            Espace organisateur
          </a>
          <a href={`${base}/`} className="ad-foot-link">
            <AdminIcon name="SneakerMove" size={17} />
            Espace coureur
          </a>
        </div>
      </aside>

      <div className="ad-frame">
        <header className="ad-topbar">
          <span className="ad-topbar-title">Administration PLUKA</span>
          <span className="ad-topbar-badge">Équipe interne</span>

          {/*
            Le prototype n'a pas de déconnexion : elle vivait dans l'en-tête de
            la liste des événements. Le bandeau est le seul endroit visible à
            toutes les largeurs et sur tous les écrans.
          */}
          {signOut === null ? null : (
            <form action={signOut} className="ad-topbar-signout">
              <button type="submit" className="ad-topbar-signout-button">
                <AdminIcon name="SignOut" size={17} />
                Se déconnecter
              </button>
            </form>
          )}
        </header>

        {/* Variante étroite : les dix destinations en onglets, sans icône. */}
        <NavTabs
          className="ad-mobile-nav"
          label={NAV_LABEL}
          tabs={ADMIN_NAV.map((destination) => ({
            href: destination.href,
            label: destination.label,
            current: isCurrent(pathname, destination.href),
          }))}
        />

        <div id="contenu" className="ad-content">
          {children}
        </div>
      </div>
    </div>
  );
}
