import type { OrganizerCourse } from '@pluka/domain';
import { NavTabs, TerrainBand } from '@pluka/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { editionDateRange } from '@/app/site/format';
import { courseHref } from '@/lib/organizer-course';

/**
 * Le cadre de Ma course : la scène, puis les sous-écrans et l'édition choisie sur
 * une même ligne. L'édition courante par défaut ; les sélecteurs n'apparaissent
 * que s'il y a un choix à faire (05_ROUTES_FLOWS §12.1).
 */
const SCREENS = [
  { screen: 'informations', label: 'Informations' },
  { screen: 'sources', label: 'Sources' },
  { screen: 'epreuves', label: 'Épreuves' },
] as const;

/** J-x tant que l'édition n'a pas commencé : passé le départ, le compte n'apprend plus rien. */
function countdown(startDate: string): string | null {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const days = Math.round(
    (Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (days < 0) return null;
  return days === 0 ? 'Jour J' : `J-${String(days)}`;
}

export function CourseFrame({
  organizationId,
  screen,
  course,
  body,
  footer,
  eyebrow = 'Ma course',
  section = 'course',
  children,
}: {
  readonly organizationId: string;
  readonly screen: string;
  readonly course: OrganizerCourse;
  readonly body: string;
  readonly footer: ReactNode;
  readonly eyebrow?: string;
  /** Participants partage ce cadre, sans les sous-écrans de Ma course. */
  readonly section?: 'course' | 'participants';
  readonly children: ReactNode;
}) {
  const { event, edition, events, editions } = course;
  const scene =
    edition === null
      ? [eyebrow]
      : [
          eyebrow,
          editionDateRange(edition.startDate, edition.endDate),
          ...[countdown(edition.startDate)].filter((value) => value !== null),
        ];

  return (
    <div className="st-editor or-frame">
      {events.length > 1 ? (
        <nav aria-label="Événements" className="st-events">
          {events.map((candidate) => (
            <Link
              key={candidate.id}
              href={courseHref(organizationId, screen, { event: candidate.slug }, section)}
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
        eyebrow={scene.join(' · ')}
        title={event?.name ?? 'Ma course'}
        body={body}
        footer={footer}
      />

      <div className="or-toolbar">
        {section === 'participants' ? null : (
          <NavTabs
            label="Ma course"
            className="or-subnav"
            tabs={SCREENS.map((item) => ({
              href: courseHref(organizationId, item.screen, {
                event: event?.slug,
                year: edition?.year,
              }),
              label: item.label,
              current: item.screen === screen,
            }))}
          />
        )}

        {editions.length > 1 ? (
          <nav aria-label="Éditions" className="st-events">
            {editions.map((candidate) => (
              <Link
                key={candidate.id}
                href={courseHref(
                  organizationId,
                  screen,
                  { event: event?.slug, year: candidate.year },
                  section,
                )}
                aria-current={candidate.id === edition?.id ? 'page' : undefined}
                className="st-event"
              >
                {candidate.year}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {children}
    </div>
  );
}
