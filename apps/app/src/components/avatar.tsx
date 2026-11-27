import type { AvatarIllustration } from '@pluka/db';

/**
 * L'avatar d'une personne — 03_PRIVACY_RLS §54.1 ; 0115.
 *
 * Sa photo, par un lien de lecture temporaire, ou l'une des trois
 * illustrations PLUKA : un buste sur le relief de la marque, Forêt et
 * Glacier, l'accent Lichen pour le détail qui distingue (un bandeau, une
 * casquette, un élastique). Dessinées ici, sans fichier ni couleur
 * littérale : les teintes viennent des tokens, par les classes `av-*`.
 *
 * Un avatar à côté d'un nom est décoratif (le nom dit qui c'est) ; seul celui
 * qui se montre seul porte un libellé.
 */

export type AvatarSource =
  { readonly kind: 'photo'; readonly url: string } | { readonly kind: AvatarIllustration };

export const ILLUSTRATION_LABELS: Readonly<Record<AvatarIllustration, string>> = {
  neutral: 'Neutre',
  man: 'Homme',
  woman: 'Femme',
};

export function AvatarArt({
  kind,
  size,
}: {
  readonly kind: AvatarIllustration;
  readonly size: number;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="av-art"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="av-bg" cx="32" cy="32" r="32" />
      {/* Le relief de la marque, en fond de scène, jamais au-dessus du sujet. */}
      <path className="av-topo" d="M-2 41 C 10 35, 21 43, 34 37 S 56 31, 66 35" />
      <path className="av-topo" d="M-2 50 C 12 44, 24 52, 38 46 S 58 42, 66 45" />
      <path className="av-body" d="M9.5 66 C 9.5 51, 19 44, 32 44 C 45 44, 54.5 51, 54.5 66 Z" />
      {/* La tête et ce qui la distingue, agrandies d'un même geste autour de leur centre. */}
      <g transform="translate(32 27) scale(1.14) translate(-32 -28.5)">
        <circle className="av-head" cx="32" cy="28.5" r="10.5" />
        {kind === 'neutral' ? (
          <path
            className="av-accent"
            d="M21.6 25 C 27 22, 37 22, 42.4 25 L 42.6 28.1 C 37 25.3, 27 25.3, 21.4 28.1 Z"
          />
        ) : null}
        {kind === 'man' ? (
          <>
            <path
              className="av-accent"
              d="M21.4 27.4 C 21.4 19.8, 26 16.2, 32 16.2 C 38 16.2, 42.6 19.8, 42.6 27.4 Z"
            />
            <path
              className="av-accent"
              d="M40.2 26.4 L 50.6 27.6 C 49.9 29.4, 47.6 30, 44.6 29.8 L 40.2 29.2 Z"
            />
          </>
        ) : null}
        {kind === 'woman' ? (
          <>
            <path
              className="av-hair"
              d="M21.6 29.4 C 20.8 20.4, 26 17, 32 17 C 38.5 17, 43.2 20.8, 42.4 29.4 C 40.6 24.4, 36.8 22, 32 22 C 27.2 22, 23.4 24.4, 21.6 29.4 Z"
            />
            <path
              className="av-hair"
              d="M40.8 20.9 C 47.5 21.9, 50 28.9, 47 36.9 C 45.6 31.6, 43.6 27.8, 41.2 25.8 Z"
            />
            <circle className="av-accent" cx="42.2" cy="22.2" r="1.9" />
          </>
        ) : null}
      </g>
    </svg>
  );
}

export function Avatar({
  avatar,
  size = 32,
  label,
}: {
  readonly avatar: AvatarSource;
  readonly size?: number;
  /** Seulement quand l'avatar se montre seul : sinon le nom voisin suffit. */
  readonly label?: string;
}) {
  return (
    <span
      className="av"
      data-size={size >= 64 ? 'large' : undefined}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {avatar.kind === 'photo' ? (
        // Un lien signé et temporaire : pas d'optimiseur d'images, qui le mettrait en cache.
        <img
          src={avatar.url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : (
        <AvatarArt kind={avatar.kind} size={size} />
      )}
    </span>
  );
}
