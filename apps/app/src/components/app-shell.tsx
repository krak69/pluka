'use client';

import type { OwnParticipationSummary } from '@pluka/domain';
import { EmptyState, Logo, NavItem, NavList } from '@pluka/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Icon } from '@/components/icon';
import {
  GLOBAL_NAV,
  RACE_NAV,
  isCurrent,
  isRaceZone,
  participantRaceIdFromPath,
  raceHref,
} from '@/components/shell-nav';

/**
 * Shell de l'application coureur — `06_DESIGN_SYSTEM.md` §69, §70.
 *
 * Client Component pour trois raisons, et trois seulement : `usePathname()`
 * détermine la destination active, le sélecteur de course s'ouvre et se ferme,
 * et le panneau « Demander à PLUKA » aussi. Le contenu des pages arrive déjà
 * rendu côté serveur et traverse ce composant sans être re-rendu.
 *
 * §69 : « navigation stable ; zone contenu lisible ; pas de sidebar immense
 * remplie d'icônes ; priorité au contenu terrain. » §70 : la barre mobile reste
 * simple, à 44 px de cible, avec des libellés — jamais d'icônes seules.
 *
 * La course courante vient de l'URL quand on est dans la zone course, sinon de
 * la première participation par date de départ. C'est la course qu'on prépare.
 */

/**
 * La formule qui couvre une course, pour l'encart du bas de la barre latérale.
 * `unknown` : la lecture a échoué, l'encart ne dit rien plutôt qu'une erreur.
 */
export type ShellPlan = 'free' | 'race_pass' | 'organizer_included' | 'plus' | 'beta' | 'unknown';

export interface AppShellProps {
  readonly races: readonly OwnParticipationSummary[];
  /** Nul pour qui n'est membre d'aucune organisation : le lien n'existe pas. */
  readonly organizerHref: string | null;
  /** La formule de chaque course, par participation. */
  readonly plans: Readonly<Record<string, ShellPlan>>;
  readonly children: ReactNode;
}

/** Jours restants avant le départ, dans le fuseau du navigateur. */
function daysUntil(startsAt: string): number | null {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;

  const midnight = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

  return Math.round((midnight(start) - midnight(new Date())) / 86_400_000);
}

function countdownLabel(startsAt: string): string | null {
  const days = daysUntil(startsAt);
  if (days === null) return null;
  if (days === 0) return 'C’est aujourd’hui';
  if (days < 0) return 'Course passée';

  return days === 1 ? 'Demain' : `Dans ${String(days)} jours`;
}

function raceYear(startsAt: string): string | null {
  const start = new Date(startsAt);
  return Number.isNaN(start.getTime()) ? null : String(start.getFullYear());
}

/** Les écrans hors navigation principale, pour le titre de l'en-tête. */
const OTHER_TITLES: readonly (readonly [string, string])[] = [
  ['/offre', 'Mon offre'],
  ['/profil', 'Profil trailer'],
  ['/recherche', 'Trouver ma course'],
  ['/produits', 'Produits'],
];

/** Les sous-écrans de la course, plus précis que l'onglet qui les porte. */
const RACE_SUBTITLES: readonly (readonly [string, string])[] = [
  ['/plan/conditions', 'Conditions'],
  ['/nutrition', 'Nutrition'],
  ['/objectif', 'Mon objectif'],
  ['/apres-course', 'Après-course'],
];

/** Le nom de l'écran en cours, tel que l'en-tête et la barre mobile le disent. */
function screenTitle(pathname: string): string {
  if (isRaceZone(pathname)) {
    const sub = RACE_SUBTITLES.find(([suffix]) => pathname.includes(suffix));
    if (sub !== undefined) return sub[1];
    const tab = RACE_NAV.find((destination) =>
      new RegExp(`^/courses/[^/]+/${destination.segment}(/|$)`).test(pathname),
    );
    return tab?.label ?? 'Ma course';
  }
  const global = GLOBAL_NAV.find((destination) => isCurrent(pathname, destination.href));
  if (global !== undefined) return global.label;
  return OTHER_TITLES.find(([prefix]) => isCurrent(pathname, prefix))?.[1] ?? 'Mon espace';
}

const PLAN_LABELS: Readonly<
  Record<Exclude<ShellPlan, 'unknown'>, { readonly title: string; readonly line: string }>
> = {
  free: { title: 'PLUKA Free', line: 'Voir les formules' },
  race_pass: { title: 'Race Pass', line: 'Préparation complète de cette course' },
  organizer_included: { title: 'Offert par l’organisation', line: 'Préparation complète incluse' },
  plus: { title: 'PLUKA+', line: 'Toute ta saison avec toi' },
  beta: { title: 'Accès bêta', line: 'Tout PLUKA est ouvert' },
};

export function AppShell({ races, organizerHref, plans, children }: AppShellProps) {
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  const fromPath = participantRaceIdFromPath(pathname);
  const current = races.find((race) => race.participantRaceId === fromPath) ?? races[0] ?? null;
  const plan: ShellPlan =
    current === null ? 'unknown' : (plans[current.participantRaceId] ?? 'unknown');
  const title = screenTitle(pathname);
  const countdown = current === null ? null : countdownLabel(current.startsAt);
  const year = current === null ? null : raceYear(current.startsAt);

  const raceNav =
    current === null
      ? null
      : RACE_NAV.map((destination) => ({
          ...destination,
          href: raceHref(current.participantRaceId, destination.segment),
        }));

  /* §70 : la barre mobile suit la zone. Quatre entrées, jamais plus. */
  const mobileNav =
    isRaceZone(pathname) && raceNav !== null
      ? raceNav.map((destination) => ({
          href: destination.href,
          label: destination.shortLabel ?? destination.label,
          icon: destination.icon,
        }))
      : GLOBAL_NAV.slice(0, 4).map((destination) => ({
          href: destination.href,
          label: destination.shortLabel ?? destination.label,
          icon: destination.icon,
        }));

  return (
    <div className="ap-shell">
      <a className="ap-skip" href="#contenu">
        Aller au contenu
      </a>

      {/* Barre latérale sombre, motif topo — prototype, `#pk-side`. */}
      <aside className="ap-sidebar">
        <div className="ap-brand">
          {/* Le logo nomme le lien : pas décoratif. Fond sombre → `inverse`. */}
          <Link href="/" className="ap-logo">
            <Logo height={26} tone="inverse" />
          </Link>
        </div>

        <RacePicker
          races={races}
          current={current}
          open={pickerOpen}
          onToggle={() => setPickerOpen((value) => !value)}
          onPick={() => setPickerOpen(false)}
          onDark
        />

        <div className="ap-nav-groups">
          <NavList label="Mon espace">
            {GLOBAL_NAV.map((destination) => (
              <NavItem
                key={destination.href}
                href={destination.href}
                icon={<Icon name={destination.icon} size={18} />}
                current={isCurrent(pathname, destination.href)}
                onDark
              >
                {destination.label}
              </NavItem>
            ))}
          </NavList>

          {raceNav === null || current === null ? null : (
            <NavList label={year === null ? current.name : `${current.name} · ${year}`}>
              {raceNav.map((destination) => (
                <NavItem
                  key={destination.href}
                  href={destination.href}
                  icon={<Icon name={destination.icon} size={18} />}
                  current={isCurrent(pathname, destination.href)}
                  onDark
                >
                  {destination.label}
                </NavItem>
              ))}
            </NavList>
          )}

          <Link href="/recherche" className="ap-find">
            <Icon name="MagnifyingGlass" size={17} />
            Trouver une autre course
          </Link>
        </div>

        <div className="ap-sidebar-foot">
          {plan === 'unknown' ? null : (
            <Link
              href={current === null ? '/offre' : `/offre?course=${current.participantRaceId}`}
              className="ap-plan"
            >
              <Icon name="Sparkle" size={16} />
              <span className="ap-plan-text">
                <span className="ap-plan-title">
                  {PLAN_LABELS[plan].title}
                  {plan === 'race_pass' && current !== null ? ` · ${current.name}` : ''}
                </span>
                <span className="ap-plan-line">{PLAN_LABELS[plan].line}</span>
              </span>
            </Link>
          )}
          <nav aria-label="Compte" className="ap-sidebar-links">
            <Link href="/profil" className="ap-sidebar-link">
              Profil trailer
            </Link>
            {organizerHref === null ? null : (
              <Link href={organizerHref} className="ap-sidebar-link">
                Espace organisateur
              </Link>
            )}
          </nav>
        </div>
      </aside>

      <div className="ap-frame">
        {/* En-tête de l'écran, desktop — prototype, barre au-dessus du contenu. */}
        <header className="ap-header">
          <div className="ap-header-title">
            <span className="pk-label">
              {isRaceZone(pathname) && current !== null ? current.name : 'Espace participant'}
            </span>
            <span className="ap-header-name">{title}</span>
          </div>
          {current === null || countdown === null ? null : (
            <span className="ap-header-race">
              {current.name}
              {year === null ? '' : ` · ${year}`}
              <span className="ap-header-countdown">{countdown}</span>
            </span>
          )}
          <button type="button" className="ap-ask" onClick={() => setAskOpen(true)}>
            <Icon name="Sparkle" size={18} />
            Demander à PLUKA
          </button>
        </header>

        <header className="ap-topbar">
          <div className="ap-topbar-row">
            {/*
              Barre mobile sur fond Ardoise, et place comptée : le symbole seul,
              en Lichen — c'est le couple de marque sur fond sombre, et c'est ce
              que le prototype y place (`#pk-mark`).
            */}
            <Link href="/" className="ap-topbar-logo" aria-label="Accueil PLUKA">
              <Logo variant="mark" tone="lichen" height={24} decorative />
            </Link>

            <div className="ap-topbar-race">
              <RacePicker
                races={races}
                current={current}
                open={pickerOpen}
                onToggle={() => setPickerOpen((value) => !value)}
                onPick={() => setPickerOpen(false)}
                onDark
                compact
              />
            </div>

            <button
              type="button"
              className="ap-topbar-ask"
              aria-label="Demander à PLUKA"
              onClick={() => setAskOpen(true)}
            >
              <Icon name="Sparkle" size={19} />
            </button>
          </div>
          <div className="ap-topbar-sub">
            <span className="pk-label">{title}</span>
            {countdown === null ? null : <span className="ap-topbar-countdown">{countdown}</span>}
          </div>
        </header>

        <main id="contenu" className="ap-content">
          {children}
        </main>

        <nav aria-label="Navigation principale" className="ap-mobile-nav">
          {mobileNav.map((destination) => (
            <a
              key={destination.href}
              href={destination.href}
              aria-current={isCurrent(pathname, destination.href) ? 'page' : false}
              className="ap-mobile-item"
            >
              <Icon name={destination.icon} size={20} />
              <span className="ap-mobile-label">{destination.label}</span>
            </a>
          ))}
        </nav>
      </div>

      {askOpen ? <AskPanel onClose={() => setAskOpen(false)} /> : null}
    </div>
  );
}

/**
 * Sélecteur de course.
 *
 * Il ne liste que les participations réelles du coureur. Sans aucune, il le dit
 * et n'offre pas de choix : la navigation course disparaît avec lui, parce
 * qu'elle n'a pas de sujet.
 */
function RacePicker({
  races,
  current,
  open,
  onToggle,
  onPick,
  onDark = false,
  compact = false,
}: {
  readonly races: readonly OwnParticipationSummary[];
  readonly current: OwnParticipationSummary | null;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onPick: () => void;
  readonly onDark?: boolean;
  /** Barre mobile : le nom seul, le compte à rebours vit sur la ligne du dessous. */
  readonly compact?: boolean;
}) {
  if (current === null) {
    return (
      <p className={onDark ? 'ap-picker-empty ap-picker-empty-on-dark' : 'ap-picker-empty'}>
        Aucune course
      </p>
    );
  }

  const countdown = countdownLabel(current.startsAt);

  return (
    <div className="ap-picker">
      <button
        type="button"
        className={[
          'ap-picker-button',
          onDark ? 'ap-picker-button-on-dark' : '',
          compact ? 'ap-picker-button-compact' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="ap-picker-text">
          <span className="ap-picker-name">{current.name}</span>
          {countdown === null || compact ? null : (
            <span className="ap-picker-countdown">{countdown}</span>
          )}
        </span>
        <Icon name="CaretUpDown" size={14} />
      </button>

      {open ? (
        <div className="ap-picker-menu">
          {races.map((race) => (
            <Link
              key={race.participantRaceId}
              href={raceHref(race.participantRaceId, 'plan')}
              onClick={onPick}
              aria-current={race.participantRaceId === current.participantRaceId ? 'true' : false}
              className="ap-picker-option"
            >
              <span className="ap-picker-option-name">{race.name}</span>
              <span className="ap-picker-option-when">
                {countdownLabel(race.startsAt) ?? 'date inconnue'}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Panneau « Demander à PLUKA ».
 *
 * L'action est transversale — §66 l'autorise comme action dédiée plutôt que
 * comme destination. Le moteur n'existe pas : le panneau porte l'état vide,
 * comme n'importe quel onglet non branché, plutôt qu'un champ de saisie qui
 * n'enverrait rien.
 */
function AskPanel({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="ap-drawer" role="dialog" aria-modal="true" aria-label="Demander à PLUKA">
      <div className="ap-drawer-head">
        <span className="pk-label">Demander à PLUKA</span>
        <button type="button" className="ap-drawer-close" aria-label="Fermer" onClick={onClose}>
          <Icon name="X" size={18} />
        </button>
      </div>

      <EmptyState
        label="Demander à PLUKA"
        title="Cette partie n’est pas encore branchée."
        detail="Aucun moteur de réponse n’est branché, et aucun fournisseur d’IA n’est appelé."
      >
        <p>
          Ce panneau interrogera les informations officielles de ta course, en citant leur source.
        </p>
        <p>
          Rien n’est affiché ici tant que le service ne le fournit pas : PLUKA préfère un écran vide
          à des réponses inventées.
        </p>
      </EmptyState>
    </div>
  );
}
