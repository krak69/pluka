import { DomainError, getParticipation, listRaceInformation } from '@pluka/domain';
import { Divider, SectionHeader } from '@pluka/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RaceFacts } from '@/components/race-facts';
import { participationContext } from '@/lib/participations';
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

  return (
    <div className="ap-page">
      <SectionHeader
        eyebrow={`${information.event.name} · ${String(information.edition.year)}`}
        title="La course"
      />

      <p className="pk-body rp-measure">
        Tout ce que PLUKA sait de ton épreuve, avec la provenance de chaque information. Une règle
        qui compte porte toujours son document, sa page et son article.
      </p>

      {information.race.publicVisibility === 'public' ? (
        <p className="rp-hint">
          Cette épreuve a une <Link href={publicPath}>page publique</Link> — pratique à envoyer à
          ton accompagnant.
        </p>
      ) : null}

      <Divider spaced />

      <RaceFacts
        facts={information.facts}
        cutoffs={information.cutoffs}
        waypoints={information.waypoints}
        timezone={information.race.timezone}
      />
    </div>
  );
}
