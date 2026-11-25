'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * L'état partagé de l'écran du Plan — prototype `nutViews`, `showNut`,
 * `nutPrep`.
 *
 * La bande Nutrition (rendue par le serveur) porte les boutons, la frise des
 * passages porte les prises : les deux lisent ici la vue choisie (« Ma
 * stratégie », « Par section », « Mes flasques »), si les prises sont
 * masquées, et si « À préparer » est ouvert. Rien de ce qui est calculé ne
 * passe par cet état : il ne dit que ce qui est montré.
 */

export type PlanView = 'strategie' | 'section' | 'flasques';

interface PlanBoardState {
  readonly view: PlanView;
  readonly setView: (view: PlanView) => void;
  readonly intakesHidden: boolean;
  readonly toggleIntakes: () => void;
  readonly preparationOpen: boolean;
  readonly setPreparationOpen: (open: boolean) => void;
  /** Les sections ouvertes de « Par section ». */
  readonly openSections: ReadonlySet<string>;
  readonly setOpenSections: (next: (current: ReadonlySet<string>) => ReadonlySet<string>) => void;
  /** Ouvre « Par section » sur une section, depuis la frise. */
  readonly showSection: (key: string) => void;
  /** La prise visée depuis le profil ; `seq` refait défiler sur un second clic. */
  readonly target: { readonly anchor: string; readonly seq: number } | null;
}

const NOOP = () => undefined;

/** L'ancre d'une section de « Par section ». */
export function sectionAnchor(key: string): string {
  return `section-${key}`;
}

/** Hors du fournisseur — un rendu isolé, un test : la frise s'affiche en entier. */
const DEFAULT: PlanBoardState = {
  view: 'strategie',
  setView: NOOP,
  intakesHidden: false,
  toggleIntakes: NOOP,
  preparationOpen: false,
  setPreparationOpen: NOOP,
  openSections: new Set(),
  setOpenSections: NOOP,
  showSection: NOOP,
  target: null,
};

const PlanBoardContext = createContext<PlanBoardState>(DEFAULT);

export function usePlanBoard(): PlanBoardState {
  return useContext(PlanBoardContext);
}

export function PlanBoard({ children }: { readonly children: ReactNode }) {
  const [view, setView] = useState<PlanView>('strategie');
  const [intakesHidden, setIntakesHidden] = useState(false);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());
  const [target, setTarget] = useState<PlanBoardState['target']>(null);

  useEffect(() => {
    // Les prises du profil visent leur ligne dans la frise : on revient sur
    // « Ma stratégie », on démasque les prises, puis on fait défiler.
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a.pl-intake')?.getAttribute('href')?.slice(1);
      if (anchor === undefined || anchor === '') return;
      event.preventDefault();
      setView('strategie');
      setIntakesHidden(false);
      setTarget((current) => ({ anchor, seq: (current?.seq ?? 0) + 1 }));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (target === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(target.anchor)
      ?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [target]);

  const state = useMemo<PlanBoardState>(
    () => ({
      view,
      setView,
      intakesHidden,
      toggleIntakes: () => setIntakesHidden((current) => !current),
      preparationOpen,
      setPreparationOpen,
      openSections,
      setOpenSections,
      showSection: (key) => {
        setOpenSections((current) => new Set([...current, key]));
        setView('section');
        // La frise disparaît : on amène la section à l'écran plutôt que de laisser le coureur la chercher.
        setTarget((current) => ({ anchor: sectionAnchor(key), seq: (current?.seq ?? 0) + 1 }));
      },
      target,
    }),
    [view, intakesHidden, preparationOpen, openSections, target],
  );

  return <PlanBoardContext.Provider value={state}>{children}</PlanBoardContext.Provider>;
}
