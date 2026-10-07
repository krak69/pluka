import { getRaceFactHistory, listRaceFactsForEditing } from '@pluka/domain';
import type { FactHistoryAction } from '@pluka/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { retireFactAction } from '@/app/fact-actions';
import { AdminPageHeader } from '@/components/admin-page';
import { factCategoryLabel } from '@/components/admin-status';
import { ConsoleAction } from '@/components/console-action';
import { factEditingContext, redirectOnReadError } from '@/lib/admin';
import { dateTime } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { FactForm } from '../fact-form';
import { factValue } from '../fact-value';

/**
 * Une information publiée — corriger, retirer, et son historique (0043).
 *
 * La preuve d'origine reste affichée : la correction porte sur la lecture,
 * pas sur le document. Le retrait est le « supprimer » de l'écran : il se
 * confirme, et se défait depuis la liste.
 */
export const metadata = { title: 'Information de course' };

const ACTIONS: Readonly<Record<FactHistoryAction, string>> = {
  publish: 'Publiée',
  edit_and_publish: 'Corrigée puis publiée',
  revise: 'Corrigée',
  retire: 'Retirée',
  restore: 'Restaurée',
  reject: 'Proposition supprimée',
  mark_duplicate: 'Marquée doublon',
  needs_review: 'Renvoyée en revue',
};

export default async function FactPage({
  params,
}: {
  readonly params: Promise<{ readonly raceId: string; readonly factId: string }>;
}) {
  const { raceId, factId } = await params;
  const context = factEditingContext(
    await requireSession(`/courses/${raceId}/informations/${factId}`),
  );

  const [facts, history] = await Promise.all([
    listRaceFactsForEditing(context, { raceId }).catch(redirectOnReadError),
    getRaceFactHistory(context, { factId }).catch(redirectOnReadError),
  ]);
  const fact = facts.find((candidate) => candidate.factId === factId);
  if (fact === undefined || fact.archivedAt !== null) notFound();

  return (
    <main className="ad-page ad-org">
      <Link href={`/courses/${raceId}/informations`} className="pk-link">
        Informations de course
      </Link>

      <AdminPageHeader
        title={factValue(fact)}
        lede={`${factCategoryLabel(fact.category)} · ${fact.factKey} · version ${fact.versionNumber}`}
      />

      {fact.source === null ? null : (
        <section className="ad-org-panel ad-org-panel-quiet" aria-labelledby="fact-source">
          <h2 id="fact-source" className="ad-org-panel-title">
            Preuve · {fact.source.title}
            {fact.source.page === null ? '' : `, p. ${fact.source.page}`}
          </h2>
          {fact.source.excerpt === null ? null : (
            <blockquote className="ad-quote">« {fact.source.excerpt} »</blockquote>
          )}
        </section>
      )}

      <FactForm
        fact={{
          raceId,
          factId,
          valueText: fact.valueText,
          valueNumber: fact.valueNumber,
          unit: fact.unit,
          trustLevel: fact.trustLevel,
        }}
      />

      <section className="ad-org-panel ad-org-panel-quiet" aria-labelledby="fact-retire">
        <h2 id="fact-retire" className="ad-org-panel-title">
          Supprimer l’information
        </h2>
        <p className="ad-org-panel-lede">
          Elle disparaît pour les coureurs et l’organisation. Ses versions restent dans
          l’historique, et elle peut être restaurée. Les plans qui en dépendaient sont signalés à
          revoir.
        </p>
        <ConsoleAction
          action={retireFactAction}
          fields={{ raceId, factId }}
          label="Supprimer l’information"
          variant="destructive"
          confirm="Je confirme retirer cette information des coureurs"
        />
      </section>

      <section className="ad-org-panel" aria-labelledby="fact-history">
        <h2 id="fact-history" className="ad-org-panel-title">
          Historique
        </h2>
        {history.length === 0 ? (
          <p className="pk-body ad-measure">Aucun geste enregistré.</p>
        ) : (
          <ul className="ad-activity">
            {history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="ad-activity-row">
                <span className="ad-activity-when">{dateTime(entry.at)}</span>
                <span className="ad-activity-who">{entry.actorEmail ?? 'Système'}</span>
                <span className="ad-activity-what">
                  {ACTIONS[entry.action] ?? entry.action}
                  {entry.versionNumber === null ? '' : ` · version ${entry.versionNumber}`}
                  {entry.action === 'retire' || entry.action === 'restore'
                    ? ''
                    : ` — ${factValue(entry)}`}
                  {entry.note === null ? null : <span className="ad-sub">{entry.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
