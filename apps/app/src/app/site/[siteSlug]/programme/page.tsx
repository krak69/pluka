import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SITE_PROGRAM_VISIBLE, siteProgram } from '@/app/site/program';
import { loadEventSite } from '@/lib/event-site';

/**
 * Le programme d'un site, jour par jour — EVENT_SITE §3.9.
 *
 * Une page sans contenu n'existe pas : le menu ne la propose pas non plus.
 */
export const metadata = { title: 'Programme' };

export default async function SiteProgramPage({
  params,
}: {
  readonly params: Promise<{ readonly siteSlug: string }>;
}) {
  if (!SITE_PROGRAM_VISIBLE) notFound();

  const site = await loadEventSite((await params).siteSlug);
  const days = siteProgram(site.program, site.races);
  if (days.length === 0) notFound();

  return (
    <div className="es-section-white">
      <header className="es-wrap es-page-head">
        <h1 className="es-page-title">Programme</h1>
      </header>
      {days.map((day) => (
        <section key={day.key} className="es-wrap es-program-day">
          <h2>{day.label}</h2>
          <ol className="es-program-list">
            {day.entries.map((entry) => (
              <li key={entry.key} className="es-program-entry">
                <span className="es-program-time">{entry.time}</span>
                <div>
                  <span className="es-program-title">
                    {entry.href === null ? (
                      entry.title
                    ) : (
                      <Link href={entry.href}>{entry.title}</Link>
                    )}
                  </span>
                  {entry.location === null ? null : (
                    <span className="es-program-location">{entry.location}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
