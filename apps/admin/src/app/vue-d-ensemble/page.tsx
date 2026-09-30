import { getAdminPlatformCounters } from '@pluka/domain';
import { DataValue, Divider, SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Vue d'ensemble — `adminTodo` et `adminPlatform` du prototype.
 *
 * Chaque chiffre est un `count(*)` de `admin_platform_counters`, jamais une
 * estimation : un nombre approché sur un écran d'administration serait pire
 * qu'absent.
 *
 * Les six entrées de `adminTodo` deviennent des liens vers l'onglet concerné,
 * avec leur compte réel. Quand le compte est nul, la ligne le dit plutôt que de
 * disparaître : « rien à examiner » est une information.
 */
export const metadata = { title: 'Vue d’ensemble' };

export default async function OverviewPage() {
  const context = await requireAdminConsoleContext('/vue-d-ensemble');
  const counters = await getAdminPlatformCounters(context).catch(redirectOnReadError);

  const todo = [
    {
      count: counters.candidatesPending,
      href: '/validation',
      label: 'extraction à examiner',
      plural: 'extractions à examiner',
    },
    {
      count: counters.jobsFailed,
      href: '/traitements',
      label: 'traitement en échec',
      plural: 'traitements en échec',
    },
    {
      count: counters.reportsOpen,
      href: '/signalements',
      label: 'signalement ouvert',
      plural: 'signalements ouverts',
    },
    {
      count: counters.productsDraft,
      href: '/produits',
      label: 'produit nutrition à vérifier',
      plural: 'produits nutrition à vérifier',
    },
    {
      count: counters.sourcesFailed,
      href: '/sources',
      label: 'source en erreur',
      plural: 'sources en erreur',
    },
  ];

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Vue d’ensemble" />

      <section>
        <h2 className="pk-h2 ad-section-title">À examiner</h2>

        <ul className="ad-todo">
          {todo.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className={entry.count > 0 ? 'ad-todo-row ad-todo-row-warn' : 'ad-todo-row'}
              >
                <span className="ad-todo-count">{entry.count}</span>
                <span className="ad-todo-label">
                  {entry.count === 1 ? entry.label : entry.plural}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Divider spaced />

      <section>
        <h2 className="pk-h2 ad-section-title">Plateforme</h2>

        <div className="ad-counters">
          <DataValue label="Événements" value={String(counters.eventsTotal)} />
          <DataValue label="dont publiés" value={String(counters.eventsPublished)} />
          <DataValue label="Éditions" value={String(counters.editionsTotal)} />
          <DataValue label="Épreuves" value={String(counters.racesTotal)} />
          <DataValue label="dont publiées" value={String(counters.racesPublished)} />
          <DataValue label="Organisations" value={String(counters.organizationsTotal)} />
          <DataValue label="dont actives" value={String(counters.organizationsActive)} />
          <DataValue label="Participations actives" value={String(counters.participationsActive)} />
        </div>
      </section>
    </main>
  );
}
