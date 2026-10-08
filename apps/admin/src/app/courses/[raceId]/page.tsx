import {
  allowedRaceTransitions,
  getEditionAdministration,
  getRaceAdministration,
  getRaceGpxImport,
  getRaceWaypoints,
  listCandidatesForReview,
  listRaceEquipment,
  listRaceFactsForEditing,
  raceVisibilityChain,
  type VisibilityConditionKey,
} from '@pluka/domain';
import { StatTiles, TerrainBand } from '@pluka/ui';
import Link from 'next/link';

import { EquipmentPanel } from '@/app/courses/[raceId]/equipment-panel';
import { RaceStatusPanel, RaceVisibilityForm, UpdateRaceForm } from '@/app/courses/[raceId]/forms';
import { GpxImportStatus, STAGE_LABEL } from '@/app/courses/[raceId]/gpx-import-status';
import { ImportGpxForm } from '@/app/courses/[raceId]/import-gpx-form';
import { WaypointsForm } from '@/app/courses/[raceId]/waypoints-form';
import { editionDates, raceMeasures, raceStart } from '@/app/evenements/[eventId]/event-overview';
import { StatusHistory } from '@/app/status-history';
import { AdminIcon } from '@/components/admin-icon';
import { ConsoleNotice } from '@/components/console-action';
import { factCategoryLabel, raceVisibilityLabel, statusLabel } from '@/components/admin-status';
import {
  factEditingContext,
  factReviewContext,
  redirectOnDomainError,
  requireAdminContext,
  requireGpxImportContext,
} from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { requireSession } from '@/lib/session';

/**
 * Fiche d'une épreuve — même grammaire que la fiche événement :
 *
 * 1. **l'en-tête** : l'épreuve, son édition, ses mesures, son départ ;
 * 2. **une bande de terrain** : visible des coureurs ou pas, et pourquoi, en
 *    une phrase ; le compte des conditions en Aube ; une seule action Lichen,
 *    le prochain geste utile sur la fiche ;
 * 3. **des tuiles** — publication, parcours, informations, revue ;
 * 4. **Publication** : la chaîne qui décide de la visibilité (0005), avec le
 *    statut et la visibilité de l'épreuve, réglables ici ;
 * 5. **Parcours** (GPX) et **Informations de course**, côte à côte ;
 * 6. **le référentiel de parcours**, puis **la fiche** de l'épreuve, repliée.
 *
 * Le référentiel — waypoints, ordre, kilomètres, barrières — est ce dont le
 * prétraitement a besoin : sans lui, `preprocessCourse` se met de côté et
 * aucun Plan n'est calculable. Le GPX est le seul point d'entrée du parcours
 * (01_ARCHITECTURE §15). Les transitions viennent de `allowedRaceTransitions` :
 * l'écran n'en invente aucune, `changeRaceStatus` refuse ce qui n'est pas dû.
 *
 * Les informations publiées et la file de revue sont des lectures d'appoint :
 * une panne retire leur compte, pas la fiche.
 */
export const metadata = { title: 'Épreuve' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** La phrase du bandeau, d'après la première condition qui manque. */
const BLOCKING_HEADLINE: Readonly<Record<VisibilityConditionKey, string>> = {
  event: 'L’événement est en préparation : l’épreuve ne peut pas encore être vue.',
  edition: 'L’édition n’est pas encore diffusée : l’épreuve reste invisible.',
  race: 'L’épreuve est en préparation : elle n’est pas encore visible des coureurs.',
  visibility: 'L’épreuve est diffusée, mais sa visibilité la cache aux coureurs.',
};

export default async function RacePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly raceId: string }>;
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const { raceId } = await params;
  const notice = consoleNotice(await searchParams);
  const returnTo = `/courses/${raceId}`;
  const context = await requireAdminContext(returnTo);

  const { race, edition, event, history } = await getRaceAdministration(context, { raceId }).catch(
    redirectOnDomainError,
  );
  const transitions = allowedRaceTransitions(race.status);

  // L'état d'un import n'est pas une donnée du référentiel : son use case a
  // ses propres dépendances — le Storage et les fonctions d'ingestion.
  const [gpx, waypoints] = await Promise.all([
    getRaceGpxImport(await requireGpxImportContext(returnTo), { raceId }).catch(
      redirectOnDomainError,
    ),
    getRaceWaypoints(context, { raceId }).catch(redirectOnDomainError),
  ]);

  const session = await requireSession(returnTo);
  const [facts, candidates, equipment, editionRaces] = await Promise.all([
    listRaceFactsForEditing(factEditingContext(session), { raceId }).catch(() => null),
    listCandidatesForReview(factReviewContext(session), { raceId, limit: 100 }).catch(() => null),
    listRaceEquipment(factEditingContext(session), { raceId }).catch(() => null),
    // Les autres épreuves de l'édition : le matériel s'y ajoute en un geste.
    getEditionAdministration(context, { editionId: edition.id })
      .then(({ races }) => races)
      .catch(() => []),
  ]);

  const live = facts?.filter((fact) => fact.archivedAt === null) ?? null;
  const byCategory = new Map<string, number>();
  for (const fact of live ?? []) {
    byCategory.set(fact.category, (byCategory.get(fact.category) ?? 0) + 1);
  }
  const pending = candidates?.length ?? null;

  const chain = raceVisibilityChain(event, edition, race);
  const met = chain.conditions.filter((condition) => condition.ok).length;
  const eventHref = `/evenements/${event.id}`;
  const hasTrace = gpx.stage !== 'none';

  const steps: Readonly<
    Record<
      VisibilityConditionKey,
      {
        readonly label: string;
        readonly state: string;
        readonly href: string;
        readonly action: string;
      }
    >
  > = {
    event: {
      label: `Événement « ${event.name} »`,
      state: statusLabel('event', event.status),
      href: `${eventHref}#statut`,
      action: 'Publier l’événement',
    },
    edition: {
      label: `Édition ${edition.year}`,
      state: statusLabel('edition', edition.status),
      href: `${eventHref}#edition-${edition.id}-statut`,
      action: 'Diffuser l’édition',
    },
    race: {
      label: 'Statut de l’épreuve',
      state: statusLabel('race', race.status),
      href: '#statut-epreuve',
      action: 'Changer le statut',
    },
    visibility: {
      label: 'Visibilité',
      state: raceVisibilityLabel(race.publicVisibility),
      href: '#visibilite',
      action: 'Rendre publique',
    },
  };

  // Une seule action Lichen : le prochain geste utile sur cette fiche.
  const primaryAction =
    pending !== null && pending > 0 ? (
      <Link href={`/courses/${race.id}/revue`} className="pk-btn pk-button-primary">
        Vérifier {plural(pending, 'proposition', 'propositions')}
      </Link>
    ) : !hasTrace ? (
      <a href="#parcours" className="pk-btn pk-button-primary">
        Importer le GPX
      </a>
    ) : (
      <Link href={`/courses/${race.id}/informations`} className="pk-btn pk-button-primary">
        Informations publiées
      </Link>
    );

  return (
    <main className="ad-page ad-org ad-event ad-race">
      <nav className="ad-race-crumbs" aria-label="Fil d’Ariane">
        <Link href="/" className="pk-link">
          Événements
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={eventHref} className="pk-link">
          {event.name}
        </Link>
      </nav>

      <header className="ad-event-head">
        <h1 className="ad-event-name">{race.name}</h1>
        <p className="ad-event-sub">
          Édition {edition.year} · {editionDates(edition)} · {raceMeasures(race)}
        </p>
        <p className="ad-event-sub">
          Départ {raceStart(race)}
          {race.startLocationName === null ? '' : ` · ${race.startLocationName}`}
          {race.finishLocationName === null ? '' : ` → ${race.finishLocationName}`}
        </p>
      </header>

      <TerrainBand
        tone="dark"
        topo
        level={2}
        className="ad-event-band"
        eyebrow={`${event.name} ${edition.year} · ${statusLabel('race', race.status)} · ${raceVisibilityLabel(race.publicVisibility)}`}
        title={
          chain.blocking === null
            ? 'Visible des coureurs : ils peuvent la trouver et la préparer.'
            : BLOCKING_HEADLINE[chain.blocking]
        }
        body={
          <p className={chain.visible ? 'ad-org-next' : 'ad-org-next ad-org-next-due'}>
            {met} condition{met > 1 ? 's' : ''} de visibilité sur 4
          </p>
        }
        footer={
          <span className="ad-event-band-footer">
            <span className="ad-mono">{race.slug}</span>
            <span aria-hidden="true">·</span>
            <span>{race.timezone}</span>
          </span>
        }
        primaryAction={primaryAction}
      />

      <ConsoleNotice notice={notice} />

      <StatTiles
        tiles={[
          {
            key: 'tile-publication',
            label: 'Publication',
            value: chain.visible ? 'Visible' : 'Non visible',
            meta: `${statusLabel('race', race.status)} · ${raceVisibilityLabel(race.publicVisibility)}`,
            due: !chain.visible,
          },
          {
            key: 'tile-course',
            label: 'Parcours',
            value: STAGE_LABEL[gpx.stage],
            meta: plural(waypoints.length, 'point de passage', 'points de passage'),
            due: gpx.stage !== 'completed',
          },
          {
            key: 'tile-facts',
            label: 'Informations',
            value: live === null ? '—' : plural(live.length, 'publiée', 'publiées'),
            meta:
              live === null
                ? 'Non lu'
                : plural(byCategory.size, 'catégorie couverte', 'catégories couvertes'),
          },
          {
            key: 'tile-review',
            label: 'À vérifier',
            value:
              pending === null
                ? '—'
                : pending === 0
                  ? 'Rien'
                  : plural(pending, 'proposition', 'propositions'),
            meta: pending === null ? 'Non lu' : 'Extraites des documents de course',
            due: pending !== null && pending > 0,
          },
        ]}
      />

      {/*
        Publication — tout ce qui décide si les coureurs voient l'épreuve, au
        même endroit. La règle est celle de `private.race_is_publicly_readable`
        (0005), relue par `raceVisibilityChain`.
      */}
      <section className="ad-org-panel ad-race-publication" aria-labelledby="publication-title">
        <h2 id="publication-title" className="ad-org-panel-title">
          Publication
        </h2>
        <p className={chain.visible ? 'ad-race-verdict ad-race-verdict-ok' : 'ad-race-verdict'}>
          <AdminIcon name={chain.visible ? 'CheckCircle' : 'WarningDiamond'} size={18} />
          {chain.visible
            ? 'Visible des coureurs.'
            : 'Non visible des coureurs : les quatre conditions ci-dessous doivent être remplies, dans l’ordre.'}
        </p>

        <ol className="ad-race-chain" aria-label="Conditions de visibilité">
          {chain.conditions.map((condition) => {
            const step = steps[condition.key];
            return (
              <li
                key={condition.key}
                className={condition.ok ? 'ad-race-step ad-race-step-ok' : 'ad-race-step'}
              >
                <AdminIcon name={condition.ok ? 'Check' : 'XCircle'} size={16} />
                <span className="ad-race-step-label">{step.label}</span>
                <span className="ad-race-step-state">{step.state}</span>
                {condition.ok ? null : (
                  <a href={step.href} className="pk-link">
                    {step.action}
                  </a>
                )}
              </li>
            );
          })}
        </ol>

        <div className="ad-org-grid">
          <div className="ad-race-publication-block" id="statut-epreuve">
            <h3 className="ad-org-subtitle">Statut de l’épreuve</h3>
            <RaceStatusPanel raceId={race.id} status={race.status} transitions={transitions} />
            <details className="ad-advanced">
              <summary>Historique de l’épreuve</summary>
              <StatusHistory entries={history} domain="race" />
            </details>
          </div>
          <div className="ad-race-publication-block" id="visibilite">
            <RaceVisibilityForm raceId={race.id} visibility={race.publicVisibility} />
          </div>
        </div>
      </section>

      <div className="ad-org-grid">
        <section className="ad-org-panel" id="parcours" aria-labelledby="course-title">
          <h2 id="course-title" className="ad-org-panel-title">
            Parcours
          </h2>
          <p className="ad-org-panel-lede">
            La trace est traitée en arrière-plan : géométrie, puis prétraitement du parcours. Sans
            parcours prétraité, aucun Plan ne peut être calculé.
          </p>
          <GpxImportStatus status={gpx} />
          <details className="ad-advanced" open={!hasTrace}>
            <summary>{hasTrace ? 'Importer une nouvelle trace' : 'Importer la trace GPX'}</summary>
            <ImportGpxForm raceId={race.id} />
          </details>
        </section>

        <section className="ad-org-panel" aria-labelledby="facts-title">
          <h2 id="facts-title" className="ad-org-panel-title">
            Informations de course
          </h2>
          <p className="ad-org-panel-lede">
            Extraites des documents puis validées : barrières, matériel, ravitaillements,
            assistance. Rien n’est publié sans décision humaine.
          </p>
          {live === null ? (
            <p className="ad-org-panel-lede">Les informations n’ont pas pu être lues.</p>
          ) : byCategory.size === 0 ? (
            <p className="ad-org-panel-lede">Aucune information publiée pour l’instant.</p>
          ) : (
            <ul className="ad-race-categories" aria-label="Informations publiées par catégorie">
              {[...byCategory.entries()]
                .sort((left, right) => right[1] - left[1])
                .map(([category, count]) => (
                  <li key={category}>
                    <span className="ad-finding-count">{count}</span>
                    <span>{factCategoryLabel(category)}</span>
                  </li>
                ))}
            </ul>
          )}
          <div className="ad-race-links">
            <Link href={`/courses/${race.id}/revue`} className="pk-link">
              Revue des propositions
              {pending === null || pending === 0 ? '' : ` (${pending})`}
            </Link>
            <Link href={`/courses/${race.id}/informations`} className="pk-link">
              Corriger ou retirer une information
            </Link>
            <Link href={`${eventHref}/documents?edition=${edition.id}`} className="pk-link">
              Documents de l’édition
            </Link>
          </div>
        </section>
      </div>

      <EquipmentPanel
        raceId={race.id}
        raceName={race.name}
        items={equipment}
        siblings={editionRaces
          .filter((candidate) => candidate.id !== race.id)
          .map((candidate) => ({ id: candidate.id, name: candidate.name }))}
      />

      <section className="ad-org-panel" aria-labelledby="waypoints-title">
        <h2 id="waypoints-title" className="ad-org-panel-title">
          Référentiel de parcours
        </h2>
        <p className="ad-org-panel-lede">
          Les points de passage découpent le parcours. Sans eux, le prétraitement reste en attente
          et aucun Plan ne peut être calculé. Les segments en sont déduits.
        </p>
        <WaypointsForm raceId={race.id} waypoints={waypoints} timezone={race.timezone} />
      </section>

      <section className="ad-org-panel ad-org-panel-quiet" aria-labelledby="sheet-title">
        <h2 id="sheet-title" className="ad-org-panel-title">
          Fiche de l’épreuve
        </h2>
        <dl className="ad-org-facts">
          <dt>Nom</dt>
          <dd>{race.name}</dd>
          <dt>Slug</dt>
          <dd className="ad-mono">{race.slug}</dd>
          <dt>Mesures</dt>
          <dd>{raceMeasures(race)}</dd>
          <dt>Départ</dt>
          <dd>{raceStart(race)}</dd>
          <dt>Barrière finale</dt>
          <dd>
            {race.cutoffDatetime === null
              ? 'Aucune'
              : raceStart({ startDatetime: race.cutoffDatetime, timezone: race.timezone })}
          </dd>
          <dt>Fuseau</dt>
          <dd>{race.timezone}</dd>
        </dl>
        <details className="ad-advanced">
          <summary>Modifier la fiche</summary>
          <UpdateRaceForm race={race} />
        </details>
      </section>
    </main>
  );
}
