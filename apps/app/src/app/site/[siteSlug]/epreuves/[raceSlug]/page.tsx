import { listRaceInformation, registrationUrlOf } from '@pluka/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { raceStartLabel, safeHttpUrl } from '@/app/site/format';
import { RaceFacts } from '@/components/race-facts';
import { appRaceUrl, loadEventSite } from '@/lib/event-site';
import { anonymousRaceContext } from '@/lib/race-information';

/**
 * La fiche d'une épreuve, sous l'habillage de l'événement — EVENT_SITE §3.2.
 *
 * Ce n'est pas une seconde fiche : le contenu est celui de la fiche publique
 * de l'app (`05_ROUTES_FLOWS.md` §1.8), lu par le même use case et rendu par
 * le même composant. Seuls l'en-tête, le lien d'inscription et l'appel vers
 * PLUKA changent.
 *
 * L'épreuve doit figurer dans la charge du site : une épreuve `unlisted` ou
 * `private`, ou d'une autre édition, n'existe pas ici, même par son slug.
 */

type Params = { readonly siteSlug: string; readonly raceSlug: string };

async function load(params: Params) {
  const site = await loadEventSite(params.siteSlug);
  const race = site.races.find((candidate) => candidate.slug === params.raceSlug);
  if (race === undefined) notFound();

  return { site, race };
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<Params>;
}): Promise<Metadata> {
  const { race } = await load(await params);

  return {
    title: race.name,
    description: `Horaires, barrières, ravitaillements et matériel du ${race.name}, ${race.distanceKm.toLocaleString('fr-FR')} km.`,
  };
}

export default async function SiteRacePage({ params }: { readonly params: Promise<Params> }) {
  const { site, race } = await load(await params);
  const information = await listRaceInformation(anonymousRaceContext(), { raceId: race.id });
  const registration = safeHttpUrl(registrationUrlOf(race, site.edition));
  const prepare = appRaceUrl(site, race.slug);
  const record = information.race;

  const stats = [
    { label: 'Distance', value: `${record.distanceKm.toLocaleString('fr-FR')} km` },
    {
      label: 'Dénivelé positif',
      value: record.elevationGainM === null ? null : `${record.elevationGainM.toLocaleString('fr-FR')} m`,
    },
    {
      label: 'Dénivelé négatif',
      value: record.elevationLossM === null ? null : `${record.elevationLossM.toLocaleString('fr-FR')} m`,
    },
    { label: 'Départ', value: record.startLocationName },
    { label: 'Arrivée', value: record.finishLocationName },
  ];

  return (
    <>
      <section className="es-race-hero">
        <div className="es-wrap es-race-hero-inner">
          <Link href="/#epreuves" className="es-back">
            ← Toutes les épreuves
          </Link>
          <p className="es-eyebrow es-eyebrow-dark">{raceStartLabel(record.startDatetime, record.timezone)}</p>
          <h1 className="es-race-title">{record.name}</h1>
        </div>
        <dl className="es-wrap es-stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd className={stat.value === null ? 'es-missing' : undefined}>
                {stat.value ?? 'non renseigné'}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="es-section es-race-body">
        <div className="es-wrap">
          <RaceFacts
            facts={information.facts}
            cutoffs={information.cutoffs}
            waypoints={information.waypoints}
            timezone={record.timezone}
          />
        </div>
      </section>

      {registration === null ? null : (
        <section className="es-band es-band-white" aria-label="Inscription">
          <div className="es-wrap es-band-inner">
            <div>
              <strong className="es-band-title">Prêt pour le {record.name} ?</strong>
              <span className="es-band-text">Les inscriptions se font sur la plateforme de l’organisation.</span>
            </div>
            <a href={registration} className="es-cta" rel="noopener" target="_blank">
              S’inscrire au {record.name}
              <span aria-hidden="true"> ↗</span>
              <span className="es-visually-hidden"> (nouvel onglet)</span>
            </a>
          </div>
        </section>
      )}

      {prepare === null ? null : (
        <section className="es-band es-band-pluka" aria-label="Préparer sa course avec PLUKA">
          <div className="es-wrap es-band-inner">
            <div>
              <span className="es-pluka-mark">PLUKA</span>
              <strong className="es-band-title">
                Ton plan de course, tes ravitos, ton sac — construits sur ce règlement.
              </strong>
              <span className="es-band-text">
                Gratuit pour démarrer. Les informations officielles restent accessibles à tous.
              </span>
            </div>
            <a href={prepare} className="es-pluka-cta">
              Préparer ma course
            </a>
          </div>
        </section>
      )}
    </>
  );
}
