'use client';

import {
  ArrowRightIcon,
  FlagBannerIcon,
  ListIcon,
  SneakerMoveIcon,
} from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { useState } from 'react';

import { BrandLockup } from '@/components/brand-lockup';

/**
 * En-tête des deux pages d'atterrissage.
 *
 * Client Component : le menu replié est le seul état de la page, et le seul
 * motif de l'être. Le prototype gère en plus une largeur observée en
 * JavaScript pour masquer la navigation ; `landing.css` le fait en media
 * query, donc rien de tout cela ne remonte ici.
 *
 * Le bandeau « Je suis » est le commutateur d'audience de la Charte : les deux
 * pages le portent, avec l'audience courante en Lichen et l'autre en lien.
 */

export type NavLink = { readonly label: string; readonly href: string };

type Audience = 'coureur' | 'organisateur';

type SiteHeaderProps = {
  /** Audience de la page courante — détermine l'onglet actif du bandeau. */
  readonly audience: Audience;
  /** Accroche du bandeau sombre, masquée sous 620 px comme dans le prototype. */
  readonly claim: string;
  /** Ancres de la page, dans son ordre de lecture. */
  readonly links: readonly NavLink[];
  /** Destination du lockup. */
  readonly homeHref: string;
  /** Action principale de l'en-tête. */
  readonly action: { readonly label: string; readonly href: string };
  /** Lien de connexion — absent de la page Organisateurs. */
  readonly login?: { readonly label: string; readonly href: string };
  /** Renvoi vers l'autre audience, repris dans le menu replié. */
  readonly cross: {
    readonly href: string;
    readonly title: string;
    readonly text: string;
    readonly audience: Audience;
  };
};

export function SiteHeader({
  audience,
  claim,
  links,
  homeHref,
  action,
  login,
  cross,
}: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  const CrossIcon = cross.audience === 'organisateur' ? FlagBannerIcon : SneakerMoveIcon;

  return (
    <header className="lp-header">
      <div className="lp-strip">
        <div className="lp-strip-inner">
          <span className="lp-strip-claim">{claim}</span>

          <div className="lp-audience">
            <span className="lp-audience-intro">Je suis</span>

            {audience === 'coureur' ? (
              <span aria-current="page" className="lp-aud lp-aud-on">
                <SneakerMoveIcon size={14} />
                Coureur
              </span>
            ) : (
              <Link href="/" className="lp-aud lp-aud-off">
                <SneakerMoveIcon size={14} />
                Coureur
              </Link>
            )}

            {audience === 'organisateur' ? (
              <span aria-current="page" className="lp-aud lp-aud-on">
                <FlagBannerIcon size={14} />
                Organisateur
              </span>
            ) : (
              <Link href="/organisateurs" className="lp-aud lp-aud-off">
                <FlagBannerIcon size={14} />
                Organisateur
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="lp-bar">
        <Link href={homeHref} className="lp-logo">
          <BrandLockup />
        </Link>

        <nav aria-label="Navigation principale" className="lp-nav">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="lp-navlink">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="lp-bar-actions">
          {login === undefined ? null : (
            <a className="lp-navlink lp-login-link" href={login.href}>
              {login.label}
            </a>
          )}

          <a className="pk-btn pk-button-primary lp-btn-compact" href={action.href}>
            {action.label}
          </a>

          <button
            type="button"
            className="lp-burger"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <ListIcon size={22} />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="lp-menu">
          <nav className="lp-stack" aria-label="Navigation de la page">
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={closeMenu} className="lp-menu-link">
                {link.label}
              </a>
            ))}

            {login === undefined ? null : (
              <a href={login.href} className="lp-menu-login">
                {login.label}
              </a>
            )}
          </nav>

          <Link href={cross.href} onClick={closeMenu} className="lp-menu-cross">
            <CrossIcon size={20} className="lp-icon-ink" />
            <span className="lp-grow">
              <span className="lp-menu-cross-title">{cross.title}</span>
              <span className="lp-menu-cross-text">{cross.text}</span>
            </span>
            <ArrowRightIcon size={17} className="lp-icon-ink" />
          </Link>
        </div>
      ) : null}
    </header>
  );
}
