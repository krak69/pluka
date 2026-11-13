import { DomainError, getParticipation, listRaceInformation } from '@pluka/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RaceFacts } from '@/components/race-facts';
import { participationContext } from '@/lib/participations';
import { formatClock, formatDistance } from '@/lib/plan-format';
import { sessionRaceContext } from '@/lib/race-information';
import { requireSession } from '@/lib/session';

/**
 * La course — `05_ROUTES_FLOWS.md` §5.2, 06_DESIGN_SYSTEM.md §85.
 *
 * Les informations officielles de l'épreuve, chacune avec son niveau de
 * confiance et sa source. C'est le même contenu que la fiche épreuve publique,
 * lu par le même use case : `listRaceInformation`. Deux écrans, une vérité.
 *
 * `04_ENTITLEMENTS.md` §6 place les informations de course, les sources, les
 * alertes officielles et le matériel obligatoire dans le socle Free. Aucun
 * droit n'est donc demandé ici, et aucun paywall ne s'affiche.
 *
 * La participation sert uniquement à retrouver la course : l'écran lit
 * `participant_races` pour en tirer le `race_id`, puis ne parle plus que de
 * l'épreuve.
 */

export const metadata = { title: 'La course' };

export default async function RaceInformationPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const returnTo = `/courses/${participantRaceId}/course`;

  const session = await requireSession(returnTo);

  const detail = await getParticipation(participationContext(session), { participantRaceId }).catch(
    (error: unknown) => {
      // Une participation qui n'est pas la sienne est introuvable, jamais
      // interdite (03_PRIVACY_RLS §120).
      if (error instanceof DomainError && error.code === 'not_found') notFound();
      throw error;
    },
  );

  const information = await listRaceInformation(sessionRaceContext(session), {
    raceId: detail.participation.raceId,
  });

  const publicPath = `/epreuves/${information.event.slug}/${information.edition.slug}/${information.race.slug}`;

  const race = information.race;
  const startDay = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: race.timezone,
  }).format(new Date(race.startDatetime));
  const thousands = (value: number) => new Intl.NumberFormat('fr-FR').format(value);

  // Le résumé de l'épreuve — prototype, carte « Informations générales ».
  const lead = (
    <section className="rf-card rf-lead" aria-labelledby="rf-lead-title">
      <p className="pk-label">
        {information.event.name} · {String(information.edition.year)}
      </p>
      <h1 id="rf-lead-title" className="rf-lead-title">
        {race.name}
      </h1>
      <ul className="rf-lead-facts">
        <li>
          {formatDistance(race.distanceKm)} km
          {race.elevationGainM === null ? '' : `, ${thousands(race.elevationGainM)} m D+`}
          {race.elevationLossM === null ? '' : `, ${thousands(race.elevationLossM)} m D-`}
        </li>
        <li>
          {startDay.charAt(0).toUpperCase() + startDay.slice(1)}, départ{' '}
          {formatClock(race.startDatetime, race.timezone)}
        </li>
        {race.startLocationName === null ? null : (
          <li>
            {race.startLocationName}
            {race.finishLocationName === null || race.finishLocationName === race.startLocationName
              ? ''
              : ` → ${race.finishLocationName}`}
          </li>
        )}
      </ul>
      <p className="rf-lead-note">
        Chaque information porte sa provenance : une règle qui compte renvoie toujours à son
        document, sa page et son article.
        {race.publicVisibility === 'public' ? (
          <>
            {' '}
            <Link href={publicPath} className="pk-link">
              Page publique de l’épreuve
            </Link>{' '}
            — pratique à envoyer à ton accompagnant.
          </>
        ) : null}
      </p>
    </section>
  );

  return (
    <div className="ap-page">
      <RaceFacts
        facts={information.facts}
        cutoffs={information.cutoffs}
        waypoints={information.waypoints}
        timezone={race.timezone}
        indexed
        lead={lead}
      />
    </div>
  );
}
