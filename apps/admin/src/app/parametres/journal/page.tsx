import { getMyStaffRole, listAdminAudit } from '@pluka/domain';

import { AdminEmpty } from '@/components/admin-page';
import { auditActionLabel, auditActor } from '@/lib/audit-label';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext, staffTeamContext } from '@/lib/admin';
import { requireSession } from '@/lib/session';

import { SettingsHeader } from '../tabs';

/**
 * Paramètres · Journal — `adminAudit` du prototype : « Qui a fait quoi, et
 * quand. » Rangé sous Paramètres le 2026-10-07 (décision produit), sans
 * changer qui le lit : tout le staff, support compris (0035).
 *
 * Une ligne par action, comme le prototype : quand, qui, et l'action en
 * phrase (`lib/audit-label.ts`). L'objet touché et le détail — ce qu'une
 * enquête demande — restent sur la ligne, repliés.
 *
 * `private.audit_logs` reste `service only` (03_PRIVACY_RLS §8) : la lecture
 * passe par `admin_list_audit`.
 *
 * Cette lecture-ci n'est pas journalisée. Chaque visite ajouterait une ligne au
 * journal qu'elle affiche, et le bruit finirait par masquer les accès aux
 * données personnelles que §104 veut rendre visibles.
 *
 * Ce que l'on y voit : les trois lectures auditées de la console —
 * `report.read`, `user.read`, `user.search` — et les écritures du lot 4b, par
 * le même mécanisme `private.record_audit` : `report.hide_content`,
 * `report.dismiss`, `job.retry`, `nutrition_product.validate`,
 * `nutrition_product.archive`. Un masquage liste dans `closedReportIds` les
 * signalements qu'il a clos : c'est par là qu'on les retrouve.
 *
 * Le nom de la table touchée est rendu tel quel, sans traduction. C'est un
 * journal technique : « race_facts » est plus utile à une enquête que
 * « informations de course », et une table de correspondance serait une
 * seconde vérité à maintenir.
 */
export const metadata = { title: 'Journal' };

function Payload({ data }: { readonly data: Readonly<Record<string, unknown>> | null }) {
  if (data === null) return <span className="ad-muted">aucune</span>;

  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="ad-muted">aucune</span>;

  return (
    <dl className="ad-payload">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="pk-label">{key}</dt>
          <dd className="ad-mono">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AuditPage() {
  const context = await requireAdminConsoleContext('/parametres/journal');
  const [entries, staffRole] = await Promise.all([
    listAdminAudit(context, {}).catch(redirectOnReadError),
    getMyStaffRole(staffTeamContext(await requireSession('/parametres/journal'))),
  ]);

  return (
    <main className="ad-page">
      <SettingsHeader current="/parametres/journal" staffRole={staffRole} />
      <p className="pk-body ad-measure">
        Qui a fait quoi, et quand. Les consultations de données personnelles y figurent au même
        titre que les écritures.
      </p>

      {entries.length === 0 ? (
        <AdminEmpty icon="ClockCounterClockwise" title="Le journal est vide.">
          <p>
            Ouvrir une fiche utilisateur ou un signalement y laisse une ligne : c’est le moyen le
            plus simple de vérifier que le mécanisme fonctionne.
          </p>
        </AdminEmpty>
      ) : (
        <ul
          className="ad-activity"
          aria-label={`${entries.length} entrée${entries.length > 1 ? 's' : ''}, la plus récente en premier`}
        >
          {entries.map((entry) => (
            <li key={entry.entryId} className="ad-activity-row">
              <span className="ad-activity-when">{dateTime(entry.createdAt)}</span>
              {/* Un acteur nul est une action système : le worker n'a pas de
                  session, et c'est une information, pas un trou. */}
              <span className="ad-activity-who">
                {auditActor(entry.actorEmail)}
                {entry.organizationName === null ? null : (
                  <span className="ad-sub">{entry.organizationName}</span>
                )}
              </span>
              <span className="ad-activity-what">
                {auditActionLabel(entry.action)}
                <details className="ad-tech">
                  <summary>Détail</summary>
                  <span className="ad-sub ad-mono">
                    {entry.action} · {entry.entityTable}
                    {entry.entityId === null ? null : ` · ${entry.entityId}`}
                  </span>
                  <Payload data={entry.afterData} />
                  {entry.requestId === null ? null : (
                    <span className="ad-sub ad-mono">requête {entry.requestId}</span>
                  )}
                </details>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
