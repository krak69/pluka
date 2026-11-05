import type { OrganizerCourse } from '@pluka/domain';
import { NavTabs, TerrainBand } from '@pluka/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { editionDateRange } from '@/app/site/format';
import { courseHref } from '@/lib/organizer-course';

/**
 * Le cadre de Ma course : la scène, puis l'événement et l'édition choisis.
 * L'édition courante par défaut ; les sélecteurs n'apparaissent que s'il y a un
 * choix à faire (05_ROUTES_FLOWS §12.1).
 */
const SCREENS = [
  { screen: 'informations', label: 'Informations' },
  { screen: 'sources', label: 'Sources' },
] as const;

export function CourseFrame({
  organizationId,
  screen,
  course,
  body,
  footer,
  children,
}: {
  readonly organizationId: string;
  readonly screen: string;
  readonly course: OrganizerCourse;
  readonly body: string;
  readonly footer: ReactNode;
  readonly children: ReactNode;
}) {
  const { event, edition, events, editions } = course;

  return (
    <div className="st-editor">
      {events.length > 1 ? (
        <nav aria-label="Événements" className="st-events">
          {events.map((candidate) => (
            <Link
              key={candidate.id}
              href={courseHref(organizationId, screen, { event: candidate.slug })}
              aria-current={candidate.id === event?.id ? 'page' : undefined}
              className="st-event"
            >
              {candidate.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <TerrainBand
        tone="dark"
        topo
        eyebrow={
          edition === null
            ? 'Ma course'
            : `Ma course · ${editionDateRange(edition.startDate, edition.endDate)}`
        }
        title={event?.name ?? 'Ma course'}
        body={body}
        footer={footer}
      />

      {editions.length > 1 ? (
        <nav aria-label="Éditions" className="st-events">
          {editions.map((candidate) => (
            <Link
              key={candidate.id}
              href={courseHref(organizationId, screen, {
                event: event?.slug,
                year: candidate.year,
              })}
              aria-current={candidate.id === edition?.id ? 'page' : undefined}
              className="st-event"
            >
              {candidate.year}
            </Link>
          ))}
        </nav>
      ) : null}

      <NavTabs
        label="Ma course"
        tabs={SCREENS.map((item) => ({
          href: courseHref(organizationId, item.screen, {
            event: event?.slug,
            year: edition?.year,
          }),
          label: item.label,
          current: item.screen === screen,
        }))}
      />

      {children}
    </div>
  );
}
