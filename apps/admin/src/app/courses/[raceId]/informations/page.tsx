import { getRaceAdministration, listRaceFactsForEditing } from '@pluka/domain';
import type { EditableFactRecord } from '@pluka/db';
import Link from 'next/link';

import { restoreFactAction } from '@/app/fact-actions';
import { AdminEmpty, AdminPageHeader, Chip } from '@/components/admin-page';
import { factCategoryLabel } from '@/components/admin-status';
import { ConsoleAction, ConsoleNotice } from '@/components/console-action';
import {
  factEditingContext,
  redirectOnDomainError,
  redirectOnReadError,
  requireAdminContext,
} from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { day } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { factValue } from './fact-value';

/**
 * Informations publiées d'une épreuve — migration 0043.
 *
 * Tout ce qui est publié, par catégorie, avec sa version et sa preuve. Chaque
 * information s'ouvre pour être corrigée ou retirée ; les retirées restent en
 * bas, restaurables. Rien n'est effacé : une correction est une nouvelle
 * version, un retrait se défait (SOURCES_EXTRACTION §35, §37).
 */
export const metadata = { title: 'Informations de course' };

const TRUST: Readonly<Record<string, { label: string; tone: 'success' | 'glacier' | 'neutral' }>> =
  {
    official: { label: 'Officielle', tone: 'success' },
    pluka_validated: { label: 'Validée PLUKA', tone: 'glacier' },
    community: { label: 'Communautaire', tone: 'neutral' },
  };

function FactRow({ raceId, fact }: { readonly raceId: string; readonly fact: EditableFactRecord }) {
  const trust = TRUST[fact.trustLevel] ?? TRUST['community']!;

  return (
    <li className="ad-row ad-fact">
      <div className="ad-row-main">
        <span className="ad-row-title">{factValue(fact)}</span>
        <span className="ad-row-meta">
          {fact.factKey} · version {fact.versionNumber}
          {fact.publishedAt === null ? '' : ` · ${day(fact.publishedAt)}`}
          {fact.source === null
            ? ''
            : ` · ${fact.source.title}${fact.source.page === null ? '' : `, p. ${fact.source.page}`}`}
        </span>
      </div>
      <Chip tone={trust.tone}>{trust.label}</Chip>
      <div className="ad-row-actions">
        {fact.archivedAt === null ? (
          <Link
            // Le matériel a son propre geste de correction (0045), sur la fiche.
            href={
              fact.category === 'equipment'
                ? `/courses/${raceId}#materiel`
                : `/courses/${raceId}/informations/${fact.factId}`
            }
            className="pk-btn pk-button-secondary"
            aria-label={`Modifier ou supprimer : ${fact.factKey}`}
          >
            Modifier
          </Link>
        ) : (
          <ConsoleAction
            action={restoreFactAction}
            fields={{ raceId, factId: fact.factId }}
            label="Restaurer"
          />
        )}
      </div>
    </li>
  );
}

export default async function RaceInformationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly raceId: string }>;
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const { raceId } = await params;
  const returnTo = `/courses/${raceId}/informations`;

  const course = await requireAdminContext(returnTo);
  const { race, event } = await getRaceAdministration(course, { raceId }).catch(
    redirectOnDomainError,
  );
  const facts = await listRaceFactsForEditing(factEditingContext(await requireSession(returnTo)), {
    raceId,
  }).catch(redirectOnReadError);
  const notice = consoleNotice(await searchParams);

  const published = facts.filter((fact) => fact.archivedAt === null);
  const retired = facts.filter((fact) => fact.archivedAt !== null);
  const categories = [...new Set(published.map((fact) => fact.category))];

  return (
    <main className="ad-page ad-org">
      <Link href={`/courses/${raceId}`} className="pk-link">
        {event.name} · {race.name}
      </Link>

      <AdminPageHeader
        title="Informations de course"
        lede="Tout ce qui est publié pour cette épreuve. Chaque information se corrige — une nouvelle version, l’ancienne reste dans l’historique — ou se retire : elle disparaît pour les coureurs, et se restaure."
        aside={
          <Link href={`/courses/${raceId}/revue`} className="pk-btn pk-button-secondary">
            Propositions à revoir
          </Link>
        }
      />

      <ConsoleNotice notice={notice} />

      {published.length === 0 ? (
        <AdminEmpty icon="Files" title="Aucune information publiée.">
          <p>Les informations arrivent par la revue des propositions extraites des documents.</p>
        </AdminEmpty>
      ) : (
        categories.map((category) => (
          <section key={category} className="ad-org-panel" aria-labelledby={`cat-${category}`}>
            <h2 id={`cat-${category}`} className="ad-org-panel-title">
              {factCategoryLabel(category)}
            </h2>
            <ul className="ad-rows">
              {published
                .filter((fact) => fact.category === category)
                .map((fact) => (
                  <FactRow key={fact.factId} raceId={raceId} fact={fact} />
                ))}
            </ul>
          </section>
        ))
      )}

      {retired.length === 0 ? null : (
        <section className="ad-org-panel ad-org-panel-quiet" aria-labelledby="retired-title">
          <h2 id="retired-title" className="ad-org-panel-title">
            Informations retirées ({retired.length})
          </h2>
          <p className="ad-org-panel-lede">
            Invisibles des coureurs. Leur historique est conservé.
          </p>
          <ul className="ad-rows">
            {retired.map((fact) => (
              <FactRow key={fact.factId} raceId={raceId} fact={fact} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
