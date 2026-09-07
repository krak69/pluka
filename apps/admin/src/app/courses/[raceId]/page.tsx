import { allowedRaceTransitions, getRaceAdministration, getRaceGpxImport } from '@pluka/domain';
import { DataValue, Divider, MicroLabel } from '@pluka/ui';
import Link from 'next/link';

import { RaceStatusPanel, UpdateRaceForm } from '@/app/courses/[raceId]/forms';
import { GpxImportStatus } from '@/app/courses/[raceId]/gpx-import-status';
import { ImportGpxForm } from '@/app/courses/[raceId]/import-gpx-form';
import { StatusHistory } from '@/app/status-history';
import { redirectOnDomainError, requireAdminContext, requireGpxImportContext } from '@/lib/admin';

/**
 * Écran d'édition d'une épreuve, et transitions de statut de §4.1.
 *
 * L'écran porte aussi l'import du GPX — 01_ARCHITECTURE §15. C'est le seul
 * point d'entrée du parcours : sans lui, aucune géométrie, donc aucun
 * micro-segment et aucun Plan. Le dépôt et la lecture d'état passent par
 * `@pluka/domain`, qui relit l'autorité en base ; la policy du bucket
 * `race-sources` la revérifie au moment d'écrire le fichier.
 *
 * Les transitions proposées viennent de `allowedRaceTransitions`, la table
 * pure du domaine : l'écran n'en connaît aucune de son côté et ne peut donc
 * pas en inventer une. L'autorité requise est affichée telle que la table la
 * déclare, et c'est `changeRaceStatus` qui refusera si l'acteur ne l'a pas.
 */
export default async function RacePage({
  params,
}: {
  readonly params: Promise<{ readonly raceId: string }>;
}) {
  const { raceId } = await params;
  const context = await requireAdminContext(`/courses/${raceId}`);

  const { race, edition, event, history } = await getRaceAdministration(context, { raceId }).catch(
    redirectOnDomainError,
  );
  const transitions = allowedRaceTransitions(race.status);

  // Lecture séparée : l'état d'un import n'est pas une donnée du référentiel
  // de course, et son use case a ses propres dépendances — le Storage et les
  // fonctions d'ingestion.
  const gpx = await getRaceGpxImport(await requireGpxImportContext(`/courses/${raceId}`), {
    raceId,
  }).catch(redirectOnDomainError);

  return (
    <main
      style={{
        maxWidth: 'var(--content-main)',
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <Link href={`/evenements/${event.id}`} className="pk-link">
        {event.name}
      </Link>

      <MicroLabel>Épreuve</MicroLabel>
      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        {race.name}
      </h1>

      <div style={{ display: 'flex', gap: 'var(--space-10)', flexWrap: 'wrap' }}>
        <DataValue label="Édition" value={edition.year} />
        <DataValue label="Distance" value={race.distanceKm} unit="km" />
        <DataValue label="Statut" value={race.status} />
        <DataValue label="Visibilité" value={race.publicVisibility} />
      </div>

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-2)' }}>
        Revue des candidats
      </h2>
      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Les informations extraites des sources attendent une décision humaine avant publication
        (SOURCES_EXTRACTION §30).
      </p>
      <Link href={`/courses/${race.id}/revue`} className="pk-link">
        Ouvrir la revue
      </Link>

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-2)' }}>
        Parcours
      </h2>
      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Le GPX est traité de façon asynchrone : géométrie, puis prétraitement du parcours
        (PLAN_ENGINE §8).
      </p>

      <div style={{ marginTop: 'var(--space-5)' }}>
        <GpxImportStatus status={gpx} />
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        <ImportGpxForm raceId={race.id} />
      </div>

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Statut
      </h2>

      <RaceStatusPanel raceId={race.id} status={race.status} transitions={transitions} />

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Historique
      </h2>

      <StatusHistory entries={history} />

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Informations
      </h2>

      <UpdateRaceForm race={race} />
    </main>
  );
}
