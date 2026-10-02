import { listAdminAudit } from '@pluka/domain';
import { EmptyState, SectionHeader, Table } from '@pluka/ui';

import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Journal d'audit — `adminTab: 'journal'`.
 *
 * Qui a fait quoi, quand, sur quel objet. `private.audit_logs` reste
 * `service only` (03_PRIVACY_RLS §8) : la lecture passe par `admin_list_audit`.
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
export const metadata = { title: 'Journal d’audit' };

/**
 * Charge utile d'une entrée.
 *
 * `after_data` est du JSON libre : chaque action y met ce qui la caractérise —
 * le terme cherché et le nombre de correspondances pour `user.search`, l'objet
 * lu pour `report.read`. L'afficher en clé-valeur plutôt qu'en JSON brut le
 * rend lisible sans rien en cacher.
 */
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
  const context = await requireAdminConsoleContext('/journal');
  const entries = await listAdminAudit(context, {}).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Journal d’audit" />

      <p className="pk-body ad-measure">
        Qui a fait quoi, quand, sur quel objet. Les consultations de données personnelles y figurent
        au même titre que les écritures. Consulter ce journal ne s’y inscrit pas.
      </p>

      {entries.length === 0 ? (
        <EmptyState
          label="Journal"
          title="Le journal est vide."
          detail="Aucune action auditée n’a encore été enregistrée."
        >
          <p>
            Ouvrir une fiche utilisateur ou un signalement y laisse une ligne : c’est le moyen le
            plus simple de vérifier que le mécanisme fonctionne.
          </p>
        </EmptyState>
      ) : (
        <Table
          caption={`${entries.length} entrée${entries.length > 1 ? 's' : ''}, la plus récente en premier`}
          columns={[
            { key: 'when', label: 'Quand' },
            { key: 'actor', label: 'Qui' },
            { key: 'action', label: 'Quoi' },
            { key: 'entity', label: 'Sur quoi' },
            { key: 'payload', label: 'Détail' },
          ]}
          rows={entries.map((entry) => ({
            key: String(entry.entryId),
            cells: {
              when: dateTime(entry.createdAt),
              actor: (
                <>
                  {/* Un acteur nul est une action système : le worker n'a pas
                      de session, et c'est une information, pas un trou. */}
                  <span>{entry.actorEmail ?? 'système'}</span>
                  {entry.organizationName === null ? null : (
                    <span className="ad-sub">{entry.organizationName}</span>
                  )}
                </>
              ),
              action: <span className="ad-mono">{entry.action}</span>,
              entity: (
                <>
                  <span className="ad-mono">{entry.entityTable}</span>
                  {entry.entityId === null ? null : (
                    <span className="ad-sub ad-mono">{entry.entityId}</span>
                  )}
                </>
              ),
              payload: (
                <>
                  <Payload data={entry.afterData} />
                  {entry.requestId === null ? null : (
                    <span className="ad-sub ad-mono">requête {entry.requestId}</span>
                  )}
                </>
              ),
            },
          }))}
        />
      )}
    </main>
  );
}
