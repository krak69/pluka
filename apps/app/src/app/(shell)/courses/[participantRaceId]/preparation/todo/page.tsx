import { DomainError, getTasks } from '@pluka/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  adoptSuggestionAction,
  dismissSuggestionAction,
  restoreSuggestionsAction,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/todo/actions';
import {
  AddTaskForm,
  TaskRow,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/todo/task-forms';
import { Icon } from '@/components/icon';
import { tasksContext } from '@/lib/preparation';
import { requireSession } from '@/lib/session';

/**
 * Préparation · À faire — 00_PRODUCT_SPEC §14.5 ; prototype, `isTodo`.
 *
 * Comme le prototype : le compte et l'ajout en tête, « Mes tâches », puis les
 * suggestions PLUKA, tirées des données de la course, que le coureur ajoute à
 * ses tâches ou écarte. Les suggestions sont gratuites ; ses propres tâches
 * demandent le Race Pass, et l'écran le dit au lieu de masquer la section
 * (04 §45). Décisions produit du 2026-11-17.
 */
export const metadata = { title: 'À faire' };

export default async function TasksPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const session = await requireSession(`/courses/${participantRaceId}/preparation/todo`);

  const overview = await getTasks(tasksContext(session), { participantRaceId }).catch(
    (error: unknown) => {
      if (error instanceof DomainError && error.code === 'not_found') notFound();
      throw error;
    },
  );

  const { progress, canEdit } = overview;

  return (
    <div className="eq-page td-page">
      <div className="td-head">
        <h1 className="td-count">
          {progress.done} / {progress.total} terminée{progress.done > 1 ? 's' : ''}
        </h1>
        {canEdit ? <AddTaskForm participantRaceId={participantRaceId} /> : null}
      </div>

      <section aria-labelledby="td-mine-title">
        <h2 id="td-mine-title" className="td-label">
          Mes tâches
        </h2>
        {overview.mine.length === 0 ? (
          <p className="eq-empty">
            {canEdit
              ? 'Ajoute ici ce que tu dois faire avant le départ, ou reprends une suggestion PLUKA.'
              : 'Ajoute ici les suggestions PLUKA qui te concernent.'}
          </p>
        ) : (
          <ul className="td-list">
            {overview.mine.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                participantRaceId={participantRaceId}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}
        {canEdit ? null : (
          <div className="eq-locked">
            <p>
              Écris tes propres tâches, avec leur échéance, et coche-les au fil de ta préparation.
              Tes tâches font partie de la préparation complète.
            </p>
            <Link
              href={`/offre?course=${participantRaceId}`}
              className="pk-btn pk-button-secondary"
            >
              Voir le Race Pass
            </Link>
          </div>
        )}
      </section>

      {overview.suggestions.length === 0 && overview.dismissedCount === 0 ? null : (
        <section aria-labelledby="td-suggestions-title">
          <h2 id="td-suggestions-title" className="td-label td-label-accent">
            Suggestions PLUKA
          </h2>
          {overview.suggestions.length === 0 ? null : (
            <>
              <p className="td-hint">
                Ajoute-les à tes tâches si elles te concernent, ou écarte-les.
              </p>
              <ul className="td-suggestions">
                {overview.suggestions.map((suggestion) => (
                  <li key={suggestion.key} className="td-suggestion">
                    <span className="td-suggestion-title">{suggestion.title}</span>
                    <div className="td-suggestion-actions">
                      <form action={adoptSuggestionAction}>
                        <input type="hidden" name="participantRaceId" value={participantRaceId} />
                        <input type="hidden" name="key" value={suggestion.key} />
                        <button
                          type="submit"
                          className="pk-btn pk-button-secondary td-row-button"
                          aria-label={`Ajouter à mes tâches : ${suggestion.title}`}
                        >
                          <Icon name="Plus" size={16} /> Ajouter à mes tâches
                        </button>
                      </form>
                      <form action={dismissSuggestionAction}>
                        <input type="hidden" name="participantRaceId" value={participantRaceId} />
                        <input type="hidden" name="key" value={suggestion.key} />
                        <button
                          type="submit"
                          className="pk-btn pk-button-ghost td-row-button"
                          aria-label={`Écarter : ${suggestion.title}`}
                        >
                          Écarter
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {overview.dismissedCount === 0 ? null : (
            <form action={restoreSuggestionsAction} className="bg-restore">
              <input type="hidden" name="participantRaceId" value={participantRaceId} />
              <button type="submit" className="eq-add-all">
                Réafficher les suggestions écartées ({overview.dismissedCount})
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
