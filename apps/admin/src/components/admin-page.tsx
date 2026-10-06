import type { ReactNode } from 'react';

import { AdminIcon, type AdminIconName } from '@/components/admin-icon';

/**
 * Briques d'écran de la console — reprises du prototype (`screen === 'admin'`).
 *
 * Chaque onglet du prototype répète les mêmes formes : un h1 de 38 px suivi
 * d'une phrase grise, des cartes blanches cernées d'un filet
 * (`--shadow-sm: 0 0 0 1px #DCD8CB` — un filet, pas une ombre portée), des
 * pastilles de 3 × 9 px. Elles vivent ici une fois, et `admin.css` les dessine
 * avec les tokens `--pk-*`.
 */

export function AdminPageHeader({
  title,
  lede,
  aside,
}: {
  readonly title: string;
  /** La phrase grise sous le titre — absente sur certains onglets du prototype. */
  readonly lede?: ReactNode;
  /** Action principale, alignée à droite du titre. */
  readonly aside?: ReactNode;
}) {
  return (
    <header className={lede === undefined ? 'ad-head ad-head-bare' : 'ad-head'}>
      <div className="ad-head-row">
        <h1 className="ad-h1">{title}</h1>
        {aside === undefined ? null : <div className="ad-head-aside">{aside}</div>}
      </div>
      {lede === undefined ? null : <p className="ad-lede">{lede}</p>}
    </header>
  );
}

/**
 * Pastille. Les cinq tons sont ceux du prototype : succès, glacier (en cours),
 * sable (neutre), avertissement, erreur. `plain` retire la graisse — la
 * pastille de type du prototype (« Partenaire », « Matériel obligatoire »).
 */
export type ChipTone = 'success' | 'glacier' | 'neutral' | 'warning' | 'error';

export function Chip({
  tone,
  plain = false,
  children,
}: {
  readonly tone: ChipTone;
  readonly plain?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <span className={`ad-chip ad-chip-${tone}${plain ? ' ad-chip-plain' : ''}`}>{children}</span>
  );
}

/**
 * État vide en carte — « Aucune fiche en attente. » du prototype : icône,
 * titre, une phrase. Jamais un écran blanc.
 */
export function AdminEmpty({
  icon,
  title,
  children,
}: {
  readonly icon: AdminIconName;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="ad-empty">
      <span className="ad-empty-icon" aria-hidden="true">
        <AdminIcon name={icon} size={24} />
      </span>
      <p className="ad-empty-title">{title}</p>
      <div className="ad-empty-body">{children}</div>
    </div>
  );
}

/** Petit intitulé de section — « Plateforme », « Activité récente ». */
export function AdminSectionLabel({ children }: { readonly children: ReactNode }) {
  return <h2 className="ad-section-label">{children}</h2>;
}
