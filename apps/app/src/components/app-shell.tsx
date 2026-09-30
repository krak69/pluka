'use client';

import type { OwnParticipationSummary } from '@pluka/domain';
import { EmptyState, NavItem, NavList } from '@pluka/ui';
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

export interface AppShellProps {
  readonly races: readonly OwnParticipationSummary[];
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

export function AppShell({ races, children }: AppShellProps) {
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  const fromPath = participantRaceIdFromPath(pathname);
  const current = races.find((race) => race.participantRaceId === fromPath) ?? races[0] ?? null;

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

      <aside className="ap-sidebar">
        <div className="ap-brand">
          <Link href="/" className="ap-wordmark">
            PLUKA
          </Link>
        </div>

        <RacePicker
          races={races}
          current={current}
          open={pickerOpen}
          onToggle={() => setPickerOpen((value) => !value)}
          onPick={() => setPickerOpen(false)}
        />

        <button type="button" className="ap-ask" onClick={() => setAskOpen(true)}>
          <Icon name="Sparkle" size={18} />
          Demander à PLUKA
        </button>

        <div className="ap-nav-groups">
          <NavList label="Ma saison">
            {GLOBAL_NAV.map((destination) => (
              <NavItem
                key={destination.href}
                href={destination.href}
                icon={<Icon name={destination.icon} size={18} />}
                current={isCurrent(pathname, destination.href)}
              >
                {destination.label}
              </NavItem>
            ))}
          </NavList>

          {raceNav === null ? null : (
            <NavList label={current === null ? 'Ma course' : current.name}>
              {raceNav.map((destination) => (
                <NavItem
                  key={destination.href}
                  href={destination.href}
                  icon={<Icon name={destination.icon} size={18} />}
                  current={isCurrent(pathname, destination.href)}
                >
                  {destination.label}
                </NavItem>
              ))}
            </NavList>
          )}
        </div>
      </aside>

      <div className="ap-frame">
        <header className="ap-topbar">
          <Link href="/" className="ap-topbar-mark">
            PLUKA
          </Link>

          <div className="ap-topbar-race">
            <RacePicker
              races={races}
              current={current}
              open={pickerOpen}
              onToggle={() => setPickerOpen((value) => !value)}
              onPick={() => setPickerOpen(false)}
              onDark
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
}: {
  readonly races: readonly OwnParticipationSummary[];
  readonly current: OwnParticipationSummary | null;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onPick: () => void;
  readonly onDark?: boolean;
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
        className={onDark ? 'ap-picker-button ap-picker-button-on-dark' : 'ap-picker-button'}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="ap-picker-name">{current.name}</span>
        {countdown === null ? null : <span className="ap-picker-countdown">{countdown}</span>}
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
