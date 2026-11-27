import Link from 'next/link';
import type { ReactNode } from 'react';

import { Avatar, type AvatarSource } from '@/components/avatar';
import { Icon } from '@/components/icon';

/**
 * Pièces communes des écrans de la Communauté : la ligne d'un auteur, et le
 * rappel que ces échanges ne remplacent pas l'information officielle
 * (AC-COM-04).
 */

/**
 * L'auteur et le moment, en une ligne : sa photo ou son illustration (0115),
 * cerclée de Lichen quand c'est soi, pour se retrouver d'un coup d'œil.
 */
export function Byline({
  label,
  avatar,
  mine,
  when,
  children,
}: {
  readonly label: string;
  readonly avatar: AvatarSource;
  readonly mine: boolean;
  readonly when: string;
  readonly children?: ReactNode;
}) {
  return (
    <span className="cm-byline" data-mine={mine ? 'true' : undefined}>
      <Avatar avatar={avatar} size={30} />
      <span className="cm-byline-name">{mine ? 'Toi' : label}</span>
      <span className="cm-byline-when">{when}</span>
      {children}
    </span>
  );
}

/** Encart « Bon à savoir » : pour une règle, La course fait foi. */
export function TrustNote({ courseHref }: { readonly courseHref: string | null }) {
  return (
    <section className="cm-card cm-note" aria-labelledby="cm-note-title">
      <p id="cm-note-title" className="pk-label">
        Bon à savoir
      </p>
      <p className="cm-note-text">
        Ici, ce sont des conseils de participants. Pour une règle, un horaire ou le matériel
        obligatoire, l’information officielle fait foi.
      </p>
      {courseHref === null ? null : (
        <Link href={courseHref} className="cm-note-link">
          <Icon name="BookOpenText" size={16} />
          Ouvrir La course
        </Link>
      )}
    </section>
  );
}
