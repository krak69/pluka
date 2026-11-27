import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from '@/components/icon';
import { authorInitials } from '@/lib/community-format';

/**
 * Pièces communes des écrans de la Communauté : le repère d'un auteur, et le
 * rappel que ces échanges ne remplacent pas l'information officielle
 * (AC-COM-04).
 */

/** Les initiales d'un auteur dans un rond ; le sien en Lichen, pour se retrouver d'un coup d'œil. */
export function AuthorMark({ label, mine }: { readonly label: string; readonly mine: boolean }) {
  return (
    <span className="cm-avatar" data-mine={mine ? 'true' : undefined} aria-hidden="true">
      {authorInitials(label)}
    </span>
  );
}

/** L'auteur et le moment, en une ligne. */
export function Byline({
  label,
  mine,
  when,
  children,
}: {
  readonly label: string;
  readonly mine: boolean;
  readonly when: string;
  readonly children?: ReactNode;
}) {
  return (
    <span className="cm-byline">
      <AuthorMark label={label} mine={mine} />
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
