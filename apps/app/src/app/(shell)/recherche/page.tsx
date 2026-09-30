import { searchRaces } from '@pluka/domain';
import { EmptyState, SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { raceContext } from '@/lib/race-information';

/**
 * Trouver ma course — `05_ROUTES_FLOWS.md` §5.3.
 *
 * La recherche est dans l'URL, pas dans un état : une recherche se partage, se
 * recharge et revient par le bouton « précédent ». Le formulaire est donc un
 * `GET`, et la page n'a besoin d'aucun JavaScript.
 *
 * Aucun résultat inventé : sans requête, la page explique ce qu'elle attend.
 * Avec une requête sans résultat, elle le dit — et propose la seule suite
 * honnête, qui est de vérifier le nom.
 */

export const metadata = { title: 'Trouver ma course' };

export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly q?: string }>;
}) {
  const { q } = await searchParams;
  const term = q?.trim() ?? '';

  /* `searchRacesQuerySchema` demande deux caractères : inutile d'appeler avant. */
  const results = term.length < 2 ? [] : await searchRaces(await raceContext(), { query: term });

  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma saison" title="Trouver ma course" />

      <form method="get" className="rp-search-form">
        <label className="pk-field-label" htmlFor="q">
          Nom de la course
        </label>
        <div className="rp-search-row">
          <input
            id="q"
            name="q"
            className="pk-input"
            defaultValue={term}
            placeholder="Wildstrubel by UTMB"
            autoComplete="off"
          />
          <button type="submit" className="pk-btn pk-button-primary">
            Chercher
          </button>
        </div>
      </form>

      {term.length < 2 ? (
        <EmptyState
          label="Recherche"
          title="Cherche ta course par son nom."
          detail="La recherche porte sur le nom de l’événement. Seules les courses publiées apparaissent : une épreuve non listée s’ouvre par le lien que l’organisation t’a envoyé."
        >
          <p>
            Saisis le nom de l’événement — PLUKA affiche ensuite ses épreuves, avec leur distance et
            leur dénivelé.
          </p>
        </EmptyState>
      ) : results.length === 0 ? (
        <EmptyState
          label="Recherche"
          title={`Aucune course publiée ne correspond à « ${term} ».`}
          detail="Une épreuve non listée ou privée ne sort jamais d’une recherche : elle s’ouvre par le lien de l’organisation ou par une invitation."
        >
          <p>Vérifie l’orthographe du nom de l’événement, ou essaie un mot plus court.</p>
        </EmptyState>
      ) : (
        <div className="rp-results">
          {results.map((result) => (
            <section key={result.event.id} className="rp-result">
              <h2 className="pk-h2">{result.event.name}</h2>
              <p className="rp-result-edition">Édition {result.edition.year}</p>

              <ul className="rp-result-races">
                {result.races.map((race) => (
                  <li key={race.id}>
                    <Link
                      href={`/epreuves/${result.event.slug}/${result.edition.slug}/${race.slug}`}
                      className="rp-result-race"
                    >
                      <span className="rp-result-race-name">{race.name}</span>
                      <span className="rp-result-race-meta">
                        {race.distanceKm} km
                        {race.elevationGainM === null
                          ? ''
                          : ` · ${String(race.elevationGainM)} m D+`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
