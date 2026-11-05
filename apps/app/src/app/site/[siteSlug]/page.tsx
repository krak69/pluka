import { registrationUrlOf } from '@pluka/domain';
import { TrustBadge } from '@pluka/ui';
import Link from 'next/link';

import { SiteContactForm } from '@/components/site-contact-form';
import { loadEventSite, siteAssetUrl } from '@/lib/event-site';
import { loadPracticalGuide } from '@/lib/event-site-practical';
import { editionDateRange, raceDayLabel, raceTimeLabel, safeHttpUrl } from '@/app/site/format';

/**
 * L'accueil d'un site d'événement — EVENT_SITE §3.1 à §3.6.
 *
 * Une page longue, en sections : épreuves, infos pratiques, documents,
 * partenaires. Tout ce qui s'y lit vient de la charge publique ou des faits
 * publiés des épreuves publiques ; une section sans contenu disparaît plutôt
 * que d'afficher un vide habillé.
 *
 * Le contact n'apparaît que si l'organisation a donné une adresse ; les
 * fichiers se téléchargent par la route `/documents/[sourceId]` (§3.4, §6).
 */

type Params = { readonly siteSlug: string };

export default async function SiteHome({ params }: { readonly params: Promise<Params> }) {
  const { siteSlug } = await params;
  const site = await loadEventSite(siteSlug);
  const guide = await loadPracticalGuide(siteSlug);
  const links = [
    { href: safeHttpUrl(site.links.results), label: 'Résultats' },
    { href: safeHttpUrl(site.links.live), label: 'Suivi en direct' },
    { href: safeHttpUrl(site.links.volunteers), label: 'Devenir bénévole' },
    { href: safeHttpUrl(site.links.newsletter), label: 'Newsletter' },
  ].flatMap(({ href, label }) => (href === null ? [] : [{ href, label }]));
  const cover = siteAssetUrl(site.appearance.coverPath);
  const registration = safeHttpUrl(site.edition?.registrationUrl ?? null);
  const latestNotice = site.notices[0];
  // Un fichier se télécharge par la route du site, qui signe l'adresse ; un
  // lien externe s'ouvre tel quel, s'il est http(s).
  const documents = site.documents.flatMap((document) => {
    if (document.hasFile) {
      return [{ ...document, href: `/documents/${document.id}`, external: false, action: 'Télécharger' }];
    }
    const url = safeHttpUrl(document.url);
    return url === null ? [] : [{ ...document, href: url, external: true, action: 'Ouvrir' }];
  });
  const raceCount = site.races.length;

  return (
    <>
      <section className="es-hero" data-cover={cover === null ? 'none' : 'image'}>
        {cover === null ? (
          <svg className="es-hero-ridge" viewBox="0 0 1440 520" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 380 L120 300 L210 340 L330 210 L420 260 L540 150 L640 230 L760 120 L880 200 L990 140 L1100 240 L1220 170 L1340 250 L1440 210 L1440 520 L0 520 Z" />
            <path d="M0 380 L120 300 L210 340 L330 210 L420 260 L540 150 L640 230 L760 120 L880 200 L990 140 L1100 240 L1220 170 L1340 250 L1440 210" className="es-hero-ridge-line" />
          </svg>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="es-hero-cover" />
        )}
        <div className="es-wrap es-hero-inner">
          <h1 className="es-hero-title">{site.event.name}</h1>
          <p className="es-hero-meta">
            {site.edition === null ? null : (
              <span>{editionDateRange(site.edition.startDate, site.edition.endDate)}</span>
            )}
            {(site.venue ?? site.event.city) === null ? null : (
              <span>{site.venue ?? site.event.city}</span>
            )}
          </p>
          {site.event.description === null ? null : (
            <p className="es-hero-lede">{site.event.description}</p>
          )}
          <div className="es-hero-actions">
            {registration === null ? null : (
              <a href={registration} className="es-cta" rel="noopener" target="_blank">
                S’inscrire<span aria-hidden="true"> ↗</span>
                <span className="es-visually-hidden"> (plateforme d’inscription, nouvel onglet)</span>
              </a>
            )}
            {raceCount === 0 ? null : (
              <a href="#epreuves" className="es-ghost">
                Voir {raceCount === 1 ? 'l’épreuve' : `les ${String(raceCount)} épreuves`}
              </a>
            )}
          </div>
        </div>
      </section>

      {latestNotice === undefined ? null : (
        <section className="es-notice" aria-label="Dernier communiqué">
          <div className="es-wrap es-notice-inner">
            <span className="es-notice-tag">Communiqué</span>
            <TrustBadge level={latestNotice.trustLevel} />
            <p>
              <strong>{latestNotice.title}</strong> {latestNotice.body}
            </p>
          </div>
        </section>
      )}

      {site.presentation === null && site.figures.length === 0 ? null : (
        <section id="presentation" className="es-section es-section-white">
          <div className="es-wrap es-presentation">
            {site.presentation === null ? null : (
              <p className="es-presentation-text">{site.presentation}</p>
            )}
            {site.figures.length === 0 ? null : (
              <dl className="es-figures">
                {site.figures.map((figure, index) => (
                  <div key={index}>
                    <dd>{figure.value}</dd>
                    <dt>{figure.label}</dt>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>
      )}

      <section id="epreuves" className="es-section">
        <div className="es-wrap">
          <header className="es-section-head">
            {site.edition === null ? null : (
              <p className="es-eyebrow">
                Édition {String(site.edition.year)} · {raceCount}{' '}
                {raceCount > 1 ? 'épreuves' : 'épreuve'}
              </p>
            )}
            <h2 className="es-h2">Les épreuves</h2>
          </header>
          {raceCount === 0 ? (
            <p className="es-empty">Les épreuves de cette édition ne sont pas encore publiées.</p>
          ) : (
            <ul className="es-races">
              {site.races.map((race) => {
                const raceRegistration = safeHttpUrl(registrationUrlOf(race, site.edition));
                return (
                  <li key={race.id} className="es-race">
                    <div className="es-race-head">
                      <h3 className="es-race-name">{race.name}</h3>
                      <span className="es-race-day">
                        {raceDayLabel(race.startDatetime, race.timezone)}
                      </span>
                    </div>
                    <dl className="es-race-facts">
                      <div>
                        <dt>Distance</dt>
                        <dd>{race.distanceKm.toLocaleString('fr-FR')} km</dd>
                      </div>
                      <div>
                        <dt>D+</dt>
                        <dd>
                          {race.elevationGainM === null
                            ? 'non renseigné'
                            : `${race.elevationGainM.toLocaleString('fr-FR')} m`}
                        </dd>
                      </div>
                      <div>
                        <dt>Départ</dt>
                        <dd>{raceTimeLabel(race.startDatetime, race.timezone)}</dd>
                      </div>
                    </dl>
                    {race.startLocationName === null ? null : (
                      <p className="es-race-place">{race.startLocationName}</p>
                    )}
                    <div className="es-race-actions">
                      <Link href={`/epreuves/${race.slug}`} className="es-outline">
                        Voir l’épreuve
                      </Link>
                      {raceRegistration === null ? null : (
                        <a href={raceRegistration} className="es-link" rel="noopener" target="_blank">
                          S’inscrire
                          <span aria-hidden="true"> ↗</span>
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {site.program.length === 0 ? null : (
            <Link href="/programme" className="es-ghost-dark es-program-link">
              Voir le programme
            </Link>
          )}
        </div>
      </section>

      {guide.length === 0 ? null : (
        <section id="infos" className="es-section es-section-white">
          <div className="es-wrap">
            <h2 className="es-h2">Infos pratiques</h2>
            <div className="es-moments">
              {guide.map((moment) => (
                <div key={moment.moment} className="es-moment">
                  <h3>{moment.title}</h3>
                  <ul>
                    {moment.rubrics.map((rubric) => (
                      <li key={rubric.key}>
                        <Link href={`/infos-pratiques#${rubric.key}`}>{rubric.title}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <Link href="/infos-pratiques" className="es-ghost-dark">
              Toutes les infos pratiques
            </Link>
          </div>
        </section>
      )}

      {links.length === 0 ? null : (
        <section aria-label="Liens utiles" className="es-section es-section-sand es-links-band">
          <div className="es-wrap">
            <ul className="es-links">
              {links.map((link) => (
                <li key={link.label}>
                  <a href={link.href} rel="noopener" target="_blank">
                    {link.label}
                    <span aria-hidden="true"> ↗</span>
                    <span className="es-visually-hidden"> (nouvel onglet)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {documents.length === 0 ? null : (
        <section id="documents" className="es-section">
          <div className="es-wrap">
            <h2 className="es-h2">Documents</h2>
            <ul className="es-docs">
              {documents.map((document) => (
                <li key={document.id} className="es-doc">
                  <span className="es-doc-title">{document.title}</span>
                  {document.external ? (
                    <a href={document.href} className="es-link" rel="noopener" target="_blank">
                      {document.action}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  ) : (
                    <a href={document.href} className="es-link">
                      {document.action}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {site.partners.length === 0 ? null : (
        <section id="partenaires" className="es-section es-section-sand">
          <div className="es-wrap">
            <h2 className="es-h2 es-h2-small">Partenaires</h2>
            <ul className="es-partners">
              {site.partners.map((partner, index) => {
                const logoUrl = safeHttpUrl(partner.logoUrl);
                const websiteUrl = safeHttpUrl(partner.websiteUrl);
                const body =
                  logoUrl === null ? (
                    <span>{partner.name}</span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt={partner.name} loading="lazy" />
                  );
                return (
                  <li key={index} className="es-partner">
                    {websiteUrl === null ? (
                      body
                    ) : (
                      <a href={websiteUrl} rel="noopener sponsored" target="_blank">
                        {body}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {site.hasContact ? (
        <section id="contact" className="es-section">
          <div className="es-wrap es-contact">
            <div className="es-contact-intro">
              <h2 className="es-h2">Une question ?</h2>
              <p>
                Votre message part directement à l’équipe de {site.event.name}, qui vous répond à
                votre adresse.
              </p>
              <p className="es-contact-note">PLUKA transmet le message sans le conserver.</p>
            </div>
            <SiteContactForm
              eventName={site.event.name}
              races={site.races.map((race) => ({ slug: race.slug, name: race.name }))}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}
