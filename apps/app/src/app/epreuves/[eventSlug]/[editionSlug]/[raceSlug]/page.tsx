import { DomainError, findRaceBySlugs, listRaceInformation } from '@pluka/domain';
import { Divider, MicroLabel, SectionHeader } from '@pluka/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AttachToRace } from '@/app/epreuves/[eventSlug]/[editionSlug]/[raceSlug]/attach-to-race';
import { RaceFacts } from '@/components/race-facts';
import { publicEnv } from '@/lib/env';
import { raceContext } from '@/lib/race-information';

/**
 * Fiche épreuve publique — `05_ROUTES_FLOWS.md` §1.8, §4.3.
 *
 * La seule route indexable de `apps/app`, et la seule qui porte des slugs
 * (§1.9). Elle est à la fois la page publique de la course et la première
 * étape de l'entonnoir : c'est ici que le coureur valide la course qu'il
 * prépare, et cette validation crée la participation (§1.7).
 *
 * Elle se lit sans session. Avec session, la RLS ouvre en plus les courses
 * auxquelles le coureur participe déjà — une `private` importée, par exemple.
 *
 * Aucune donnée n'est inventée : les informations affichées sont les facts
 * publiés, avec leur niveau de confiance et leur source. `04_ENTITLEMENTS.md`
 * §6 les place dans le socle Free — aucun droit n'est demandé ici.
 */

type Params = {
  readonly eventSlug: string;
  readonly editionSlug: string;
  readonly raceSlug: string;
};

async function load(params: Params) {
  const context = await raceContext();

  try {
    return await findRaceBySlugs(context, params);
  } catch (error) {
    // §17 : une course privée est introuvable, jamais interdite. Répondre
    // « interdit » confirmerait son existence.
    if (error instanceof DomainError && error.code === 'not_found') notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const found = await load(resolved);
  const env = publicEnv();

  const path = `/epreuves/${resolved.eventSlug}/${resolved.editionSlug}/${resolved.raceSlug}`;

  return {
    title: `${found.race.name} — ${found.event.name} ${String(found.edition.year)}`,
    description: `Informations officielles, barrières horaires et points de passage de ${found.race.name}, ${String(found.race.distanceKm)} km.`,
    alternates: { canonical: new URL(path, env.NEXT_PUBLIC_APP_URL).toString() },
    /*
     * L'en-tête de `next.config.ts` ouvre `/epreuves` à l'indexation ; la
     * visibilité de la course décide au cas par cas. §17 : `unlisted` est
     * atteignable par lien mais ne doit pas être listée.
     */
    robots: found.indexable ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function RacePage({ params }: { readonly params: Promise<Params> }) {
  const resolved = await params;
  const found = await load(resolved);
  const context = await raceContext();

  const information = await listRaceInformation(context, { raceId: found.race.id });

  const returnTo = `/epreuves/${resolved.eventSlug}/${resolved.editionSlug}/${resolved.raceSlug}`;

  return (
    <main className="rp-page">
      <SectionHeader
        eyebrow={`${found.event.name} · ${String(found.edition.year)}`}
        title={found.race.name}
      />

      <dl className="rp-facts">
        <RaceFact label="Distance" value={`${String(found.race.distanceKm)} km`} />
        <RaceFact
          label="Dénivelé +"
          value={
            found.race.elevationGainM === null ? null : `${String(found.race.elevationGainM)} m`
          }
        />
        <RaceFact label="Départ" value={found.race.startLocationName} />
        <RaceFact label="Arrivée" value={found.race.finishLocationName} />
        <RaceFact label="Points de passage" value={String(information.waypoints.length)} />
        <RaceFact label="Barrières horaires" value={String(information.cutoffs.length)} />
      </dl>

      <Divider spaced />

      <AttachToRace raceId={found.race.id} returnTo={returnTo} raceName={found.race.name} />

      <Divider spaced />

      <RaceFacts
        facts={information.facts}
        cutoffs={information.cutoffs}
        waypoints={information.waypoints}
        timezone={found.race.timezone}
      />
    </main>
  );
}

/**
 * Une donnée de course, ou son absence dite explicitement.
 *
 * 06_DESIGN_SYSTEM §107 : « aucune donnée inventée pour remplir un vide ». Un
 * dénivelé non renseigné s'affiche « non renseigné », pas « 0 m ».
 */
function RaceFact({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <div className="rp-fact">
      <dt>
        <MicroLabel>{label}</MicroLabel>
      </dt>
      <dd className={value === null ? 'rp-fact-missing' : 'rp-fact-value'}>
        {value ?? 'non renseigné'}
      </dd>
    </div>
  );
}
