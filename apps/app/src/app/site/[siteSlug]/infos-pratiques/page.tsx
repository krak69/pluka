import { notFound } from 'next/navigation';

import { loadPracticalGuide } from '@/lib/event-site-practical';

/**
 * Les infos pratiques d'un site, par moment — EVENT_SITE §3.3.
 *
 * Une page sans contenu n'existe pas : le menu ne la propose pas non plus.
 */
export const metadata = { title: 'Infos pratiques' };

export default async function SitePracticalPage({
  params,
}: {
  readonly params: Promise<{ readonly siteSlug: string }>;
}) {
  const guide = await loadPracticalGuide((await params).siteSlug);
  if (guide.length === 0) notFound();

  return (
    <div className="es-section-white">
      <header className="es-wrap es-page-head">
        <h1 className="es-page-title">Infos pratiques</h1>
      </header>
      {guide.map((moment) => (
        <section key={moment.moment} className="es-wrap es-moment-section">
          <h2 className="es-moment-title">{moment.title}</h2>
          <ul className="es-rubrics">
            {moment.rubrics.map((rubric) => (
              <li key={rubric.key} id={rubric.key} className="es-rubric">
                <h3>{rubric.title}</h3>
                {rubric.items.map((item) => (
                  <p key={item.value}>
                    {item.value}
                    {item.races.length === 0 ? null : (
                      <span className="es-rubric-races">{item.races.join(', ')}</span>
                    )}
                  </p>
                ))}
                {rubric.body === null ? null : <p className="es-rubric-text">{rubric.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
