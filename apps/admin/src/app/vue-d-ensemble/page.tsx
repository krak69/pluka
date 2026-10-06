import { getAdminPlatformCounters, listAdminAudit } from '@pluka/domain';
import Link from 'next/link';

import { AdminIcon, type AdminIconName } from '@/components/admin-icon';
import { AdminPageHeader, AdminSectionLabel } from '@/components/admin-page';
import { auditActionLabel, auditActor } from '@/lib/audit-label';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Vue d'ensemble — `adminOverview` du prototype : « À traiter », « Plateforme »,
 * « Activité récente ».
 *
 * Chaque chiffre est un `count(*)` de `admin_platform_counters`, jamais une
 * estimation. Une ligne à zéro reste affichée, sur fond neutre : « rien à
 * examiner » est une information.
 *
 * Le prototype liste six lignes à traiter ; cinq ont un compteur en base. « 3
 * conflits de sources » n'en a pas — les conflits sont comptés avec les
 * extractions à examiner, qui les incluent.
 *
 * « Activité récente » relit le journal (§104), sans s'y inscrire : la
 * consultation des compteurs et du journal n'est pas journalisée (lot 4a).
 */
export const metadata = { title: 'Vue d’ensemble' };

const RECENT = 4;

interface TodoEntry {
  readonly count: number;
  readonly href: string;
  readonly icon: AdminIconName;
  readonly one: string;
  readonly many: string;
}

export default async function OverviewPage() {
  const context = await requireAdminConsoleContext('/vue-d-ensemble');
  const [counters, audit] = await Promise.all([
    getAdminPlatformCounters(context).catch(redirectOnReadError),
    listAdminAudit(context, { limit: RECENT }).catch(redirectOnReadError),
  ]);

  const todo: readonly TodoEntry[] = [
    {
      count: counters.candidatesPending,
      href: '/validation',
      icon: 'CheckSquareOffset',
      one: 'extraction à examiner',
      many: 'extractions à examiner',
    },
    {
      count: counters.jobsFailed,
      href: '/traitements',
      icon: 'XCircle',
      one: 'traitement en erreur',
      many: 'traitements en erreur',
    },
    {
      count: counters.reportsOpen,
      href: '/signalements',
      icon: 'Flag',
      one: 'signalement communauté',
      many: 'signalements communauté',
    },
    {
      count: counters.sourcesFailed,
      href: '/sources',
      icon: 'Files',
      one: 'source en erreur',
      many: 'sources en erreur',
    },
    {
      count: counters.productsDraft,
      href: '/produits/a-verifier',
      icon: 'Package',
      one: 'produit nutrition à vérifier',
      many: 'produits nutrition à vérifier',
    },
  ];

  const platform = [
    { label: 'Événements', value: counters.eventsTotal },
    { label: 'Épreuves', value: counters.racesTotal },
    { label: 'Participations actives', value: counters.participationsActive },
    { label: 'Organisations actives', value: counters.organizationsActive },
  ];

  return (
    <main className="ad-page">
      <AdminPageHeader title="À traiter" lede="Ce qui attend une action de l’équipe PLUKA." />

      <ul className="ad-todo">
        {todo.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className={entry.count > 0 ? 'ad-todo-row ad-todo-row-warn' : 'ad-todo-row'}
            >
              <AdminIcon name={entry.icon} size={19} />
              <span className="ad-todo-label">
                {entry.count} {entry.count === 1 ? entry.one : entry.many}
              </span>
              <span className="ad-todo-arrow" aria-hidden="true">
                <AdminIcon name="ArrowRight" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <AdminSectionLabel>Plateforme</AdminSectionLabel>

      <ul className="ad-counters">
        {platform.map((counter) => (
          <li key={counter.label} className="ad-counter">
            <span className="ad-counter-value">{counter.value.toLocaleString('fr-FR')}</span>
            <span className="ad-counter-label">{counter.label}</span>
          </li>
        ))}
      </ul>

      <AdminSectionLabel>Activité récente</AdminSectionLabel>

      {audit.length === 0 ? (
        <p className="ad-card-meta">Aucune action enregistrée pour l’instant.</p>
      ) : (
        <ul className="ad-activity">
          {audit.map((entry) => (
            <li key={entry.entryId} className="ad-activity-row">
              <span className="ad-activity-when">{dateTime(entry.createdAt)}</span>
              <span className="ad-activity-who">{auditActor(entry.actorEmail)}</span>
              <span className="ad-activity-what">{auditActionLabel(entry.action)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
