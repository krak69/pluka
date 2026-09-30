import type { SVGAttributes } from 'react';

import {
  ACCENT_PATH,
  LOCKUP_CLEARSPACE_VIEWBOX,
  LOCKUP_MARK_TRANSFORM,
  LOCKUP_VIEWBOX,
  LOCKUP_WORDMARK_TRANSFORM,
  MARK_PATH,
  MARK_VIEWBOX,
  WORDMARK_PATH,
  WORDMARK_VIEWBOX,
} from '../brand/logo-paths.js';
import { classNames } from '../internal/class-names.js';

/**
 * Logo PLUKA — 06_DESIGN_SYSTEM.md §142, §143.
 *
 * §143 : « Le SVG doit être importé / rendu comme asset de marque. Ne pas
 * redessiner le logo manuellement en CSS. » Les tracés viennent donc de
 * `brand/logo-paths.ts`, extraits des fichiers officiels de
 * `reference/brand/logos/` et vérifiés par `tests/logo.test.ts`.
 *
 * Le SVG est rendu en ligne plutôt que servi en `<img>` pour une seule raison :
 * une image externe ne peut pas prendre une variable CSS. Or §139 exige que les
 * couleurs passent par les tokens `--pk-*`, et une déclinaison qui suit le
 * thème d'un fond ne peut pas être un fichier figé.
 *
 * TROIS DESSINS, ET LEURS DÉCLINAISONS RÉELLES
 *
 * Les combinaisons offertes sont exactement celles que les fichiers portent :
 * neuf pour le lockup, quatre pour le symbole, trois pour le mot. Elles ne sont
 * pas interchangeables, et le type les sépare — `variant="mark" tone="primary"`
 * ne compile pas, parce qu'aucun fichier ne le définit.
 */

/** Les cinq couleurs de la Charte que les fichiers emploient. */
const FILL = {
  forest: 'var(--pk-forest)',
  dawn: 'var(--pk-dawn)',
  lichen: 'var(--pk-lichen)',
  limestone: 'var(--pk-limestone)',
  ink: 'var(--pk-ink)',
  /**
   * Hérite de la couleur du texte — `pk-lockup-current` et `pk-mark` du
   * sprite officiel. Utile dans une navigation, où le logo doit suivre l'état
   * du lien plutôt que porter sa propre couleur.
   */
  current: 'currentColor',
} as const;

type Fill = keyof typeof FILL;

/** Les trois encres d'un dessin : symbole, lettres, accent. */
interface Inks {
  readonly mark: Fill;
  readonly wordmark: Fill;
  readonly accent: Fill;
  /** Vrai pour les déclinaisons `on-*`, qui portent leur zone de respect. */
  readonly clearspace?: true;
}

/**
 * Déclinaisons du lockup — `pluka-logo-*.svg`.
 *
 * `primary` est le défaut : c'est `pluka-logo-primary.svg`.
 *
 * Les `on-*` ne sont pas des couleurs de plus. Ce sont les trois combinaisons
 * validées pour être posées sur un fond donné, avec la marge de respect que le
 * fichier officiel inclut dans son `viewBox`. `on-calcaire` reprend l'encre de
 * `primary`, `on-ardoise` celle d'`inverse`, `on-lichen` celle de
 * `mono-ardoise` : le dessin est le même, la zone de respect fait la
 * différence.
 */
const LOCKUP_TONES = {
  primary: { mark: 'forest', wordmark: 'forest', accent: 'dawn' },
  inverse: { mark: 'lichen', wordmark: 'limestone', accent: 'dawn' },
  lichen: { mark: 'lichen', wordmark: 'forest', accent: 'dawn' },
  'mono-ardoise': { mark: 'ink', wordmark: 'ink', accent: 'ink' },
  'mono-calcaire': { mark: 'limestone', wordmark: 'limestone', accent: 'limestone' },
  'mono-foret': { mark: 'forest', wordmark: 'forest', accent: 'forest' },
  'on-ardoise': { mark: 'lichen', wordmark: 'limestone', accent: 'dawn', clearspace: true },
  'on-calcaire': { mark: 'forest', wordmark: 'forest', accent: 'dawn', clearspace: true },
  'on-lichen': { mark: 'ink', wordmark: 'ink', accent: 'ink', clearspace: true },
  current: { mark: 'current', wordmark: 'current', accent: 'current' },
} as const satisfies Readonly<Record<string, Inks>>;

/** Déclinaisons du symbole — `pluka-mark-*.svg`. */
const MARK_TONES = {
  foret: 'forest',
  ardoise: 'ink',
  calcaire: 'limestone',
  lichen: 'lichen',
  current: 'current',
} as const satisfies Readonly<Record<string, Fill>>;

/** Déclinaisons du mot — `pluka-wordmark-*.svg`. */
const WORDMARK_TONES = {
  foret: { wordmark: 'forest', accent: 'dawn' },
  calcaire: { wordmark: 'limestone', accent: 'dawn' },
  'mono-ardoise': { wordmark: 'ink', accent: 'ink' },
  current: { wordmark: 'current', accent: 'current' },
} as const satisfies Readonly<Record<string, Pick<Inks, 'wordmark' | 'accent'>>>;

export type LogoLockupTone = keyof typeof LOCKUP_TONES;
export type LogoMarkTone = keyof typeof MARK_TONES;
export type LogoWordmarkTone = keyof typeof WORDMARK_TONES;

/**
 * Attributs communs.
 *
 * `title` remplace le libellé accessible par défaut. Un logo répété dans une
 * page — en-tête et pied de page — n'a pas à être annoncé deux fois : passer
 * `decorative` le retire alors de l'arbre d'accessibilité, comme le veut §101.
 */
interface CommonProps extends Omit<SVGAttributes<SVGSVGElement>, 'viewBox' | 'children'> {
  /** Hauteur de rendu. La largeur suit le rapport du dessin. */
  readonly height?: number | string;
  /** Libellé accessible. Vaut « PLUKA », comme les fichiers officiels. */
  readonly title?: string;
  /** Retire le logo de l'arbre d'accessibilité — pour une répétition. */
  readonly decorative?: boolean;
}

export type LogoProps = CommonProps &
  (
    | { readonly variant?: 'lockup'; readonly tone?: LogoLockupTone }
    | { readonly variant: 'mark'; readonly tone?: LogoMarkTone }
    | { readonly variant: 'wordmark'; readonly tone?: LogoWordmarkTone }
  );

export function Logo(props: LogoProps) {
  const {
    height = 26,
    title = 'PLUKA',
    decorative = false,
    className,
    variant = 'lockup',
    tone,
    ...rest
  } = props as CommonProps & { readonly variant?: string; readonly tone?: string };

  /*
   * §101 : une image porteuse de sens est annoncée, une image décorative est
   * masquée. Les deux cas se distinguent par un attribut, jamais par l'absence
   * d'attribut.
   */
  const labelling = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': title } as const);

  const common = {
    height,
    focusable: false,
    className: classNames('pk-logo', className),
    ...labelling,
    ...rest,
  };

  if (variant === 'mark') {
    const ink = MARK_TONES[(tone as LogoMarkTone | undefined) ?? 'foret'];

    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={MARK_VIEWBOX} {...common}>
        <path fill={FILL[ink]} d={MARK_PATH} />
      </svg>
    );
  }

  if (variant === 'wordmark') {
    const inks = WORDMARK_TONES[(tone as LogoWordmarkTone | undefined) ?? 'foret'];

    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={WORDMARK_VIEWBOX} {...common}>
        <path fill={FILL[inks.wordmark]} d={WORDMARK_PATH} />
        <path fill={FILL[inks.accent]} d={ACCENT_PATH} />
      </svg>
    );
  }

  const inks = LOCKUP_TONES[(tone as LogoLockupTone | undefined) ?? 'primary'];
  const viewBox =
    'clearspace' in inks && inks.clearspace === true ? LOCKUP_CLEARSPACE_VIEWBOX : LOCKUP_VIEWBOX;

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} {...common}>
      {/*
        Les deux groupes et leurs transformations viennent du fichier officiel.
        Le lockup n'est pas un empilement libre du symbole et du mot : son
        calage a été décidé, et le recalculer le déformerait.
      */}
      <g transform={LOCKUP_MARK_TRANSFORM}>
        <path fill={FILL[inks.mark]} d={MARK_PATH} />
      </g>
      <g transform={LOCKUP_WORDMARK_TRANSFORM}>
        <path fill={FILL[inks.wordmark]} d={WORDMARK_PATH} />
        <path fill={FILL[inks.accent]} d={ACCENT_PATH} />
      </g>
    </svg>
  );
}
