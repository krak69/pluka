import type { PublishedRaceFactRecord } from '@pluka/db';
import { listRaceInformation, registrationUrlOf, type PublicEventSite } from '@pluka/domain';
import { TrustBadge } from '@pluka/ui';
import Link from 'next/link';

import { SiteContactForm } from '@/components/site-contact-form';
import { loadEventSite, siteAssetUrl } from '@/lib/event-site';
import { anonymousRaceContext } from '@/lib/race-information';
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

/** L'officiel des infos pratiques : ces catégories de faits, lues dans le règlement (§3.3). */
const PRACTICAL_CATEGORIES: readonly PublishedRaceFactRecord['category'][] = [
  'bib',
  'transport',
  'start',
  'contact',
];

const PRACTICAL_LABELS: Readonly<Partial<Record<PublishedRaceFactRecord['category'], string>>> = {
  bib: 'Dossards',
  transport: 'Transport',
  start: 'Départ',
  contact: 'Contact',
};

interface PracticalFact {
  readonly key: string;
  readonly title: string;
  readonly value: string;
  readonly races: readonly string[];
  readonly trustLevel: PublishedRaceFactRecord['trustLevel'];
  readonly source: string | null;
}

function factValue(fact: PublishedRaceFactRecord): string | null {
  if (fact.valueText !== null && fact.valueText.trim() !== '') return fact.valueText;
  if (fact.valueNumber !== null) return `${String(fact.valueNumber)}${fact.unit === null ? '' : ` ${fact.unit}`}`;
  return null;
}

function sourceLabel(fact: PublishedRaceFactRecord): string | null {
  if (fact.source?.title == null) return null;
  return fact.source.pageStart === null
    ? fact.source.title
    : `${fact.source.title}, p. ${String(fact.source.pageStart)}`;
}

/**
 * Les faits pratiques des épreuves, regroupés : un retrait des dossards
 * commun à toutes les épreuves ne s'affiche qu'une fois, avec les épreuves
 * qu'il concerne quand il ne les concerne pas toutes.
 */
async function practicalFacts(site: PublicEventSite): Promise<readonly PracticalFact[]> {
  const context = anonymousRaceContext();
  const informations = await Promise.all(
    site.races.map(async (race) => ({
      race,
      information: await listRaceInformation(context, { raceId: race.id }),
    })),
  );

  const grouped = new Map<string, PracticalFact>();
  for (const { race, information } of informations) {
    for (const fact of information.facts) {
      if (!PRACTICAL_CATEGORIES.includes(fact.category)) continue;
      const value = factValue(fact);
      if (value === null) continue;

      const key = `${fact.factKey}\u0000${value}`;
      const existing = grouped.get(key);
      grouped.set(
        key,
        existing === undefined
          ? {
              key,
              title: PRACTICAL_LABELS[fact.category] ?? fact.category,
              value,
              races: [race.name],
              trustLevel: fact.trustLevel,
              source: sourceLabel(fact),
            }
          : { ...existing, races: [...existing.races, race.name] },
      );
    }
  }

  const order = (fact: PracticalFact) =>
    PRACTICAL_CATEGORIES.findIndex((category) => PRACTICAL_LABELS[category] === fact.title);
  return [...grouped.values()].sort((left, right) => order(left) - order(right));
}

export default async function SiteHome({ params }: { readonly params: Promise<Params> }) {
  const site = await loadEventSite((await params).siteSlug);
  const facts = await practicalFacts(site);
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
            {site.event.city === null ? null : <span>{site.event.city}</span>}
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
                          S’inscrire au {race.name}
                          <span aria-hidden="true"> ↗</span>
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {facts.length === 0 && site.sections.length === 0 ? null : (
        <section id="infos" className="es-section es-section-white">
          <div className="es-wrap">
            <h2 className="es-h2">Infos pratiques</h2>
            <div className="es-infos">
              {facts.length === 0 ? null : (
                <div>
                  <p className="es-eyebrow">Lu dans le règlement</p>
                  <ul className="es-info-list">
                    {facts.map((fact) => (
                      <li key={fact.key} className="es-info">
                        <strong>{fact.title}</strong>
                        <span className="es-info-value">{fact.value}</span>
                        <span className="es-info-meta">
                          {fact.races.length === raceCount ? null : (
                            <span>{fact.races.join(', ')}</span>
                          )}
                          {fact.source === null ? null : <span>{fact.source}</span>}
                          <TrustBadge level={fact.trustLevel} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {site.sections.length === 0 ? null : (
                <div>
                  <p className="es-eyebrow">Écrit par l’organisation</p>
                  <ul className="es-info-list">
                    {site.sections.map((section, index) => (
                      <li key={index} className="es-info">
                        <strong>{section.title}</strong>
                        <span className="es-info-value es-info-text">{section.body}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
