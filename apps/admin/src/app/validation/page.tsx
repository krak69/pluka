import { listAdminFactCandidates } from '@pluka/domain';
import Link from 'next/link';

import { AdminEmpty, AdminPageHeader, Chip } from '@/components/admin-page';
import { AdminStatus, factCategoryLabel } from '@/components/admin-status';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * File de validation, toutes courses — `adminValidation` du prototype.
 *
 * Une carte par information : épreuve, type, état, confiance ; la valeur
 * proposée ; puis « Examiner », qui ouvre la revue de l'épreuve. C'est là que
 * vivent les décisions et le tiroir de provenance : cet écran est en lecture
 * seule. Le prototype y ajoute « Marquer validée PLUKA » ; ce geste reste sur
 * la revue, où la source et l'extrait sont sous les yeux.
 *
 * Une seule requête, pas un appel par course : `admin_list_fact_candidates`
 * existe pour ça.
 */
export const metadata = { title: 'Validation' };

export default async function ValidationPage() {
  const context = await requireAdminConsoleContext('/validation');
  const candidates = await listAdminFactCandidates(context, {}).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <AdminPageHeader
        title="Validation"
        lede="File d’extraction, toutes organisations confondues. PLUKA peut marquer une information comme « validée PLUKA » ; seul un organisateur autorisé peut la rendre officielle."
      />

      {candidates.length === 0 ? (
        <AdminEmpty icon="CheckCircle" title="Rien à examiner.">
          <p>Les informations extraites d’une source apparaîtront ici dès son analyse.</p>
        </AdminEmpty>
      ) : (
        <ul className="ad-cards" aria-label={`${candidates.length} information${candidates.length > 1 ? 's' : ''} à examiner`}>
          {candidates.map((candidate) => (
            <li key={candidate.candidateId} className="ad-card ad-card-stack">
              <div className="ad-card-line">
                <span className="ad-card-meta">
                  {candidate.eventName} · {candidate.raceName}
                </span>
                <Chip tone="neutral" plain>
                  {factCategoryLabel(candidate.category)}
                </Chip>
                <AdminStatus domain="candidate" status={candidate.status} />
                {candidate.conflictStatus === null ? null : (
                  <AdminStatus domain="conflict" status={candidate.conflictStatus} />
                )}
                {candidate.confidenceLabel === null ? null : (
                  <span className="ad-card-meta ad-card-line-end">
                    confiance {candidate.confidenceLabel}
                  </span>
                )}
              </div>

              {/* `value_text` est nul quand la valeur est structurée : le dire
                  vaut mieux qu'un tiret, qui se lirait « pas de valeur ». */}
              <p className="ad-card-value">{candidate.valueText ?? 'Valeur structurée'}</p>

              <p className="ad-card-meta ad-card-source">
                <span className="ad-mono">{candidate.factKey}</span>
                {candidate.extractedAt === null
                  ? null
                  : ` · extraite le ${dateTime(candidate.extractedAt)}`}
              </p>

              <div className="ad-card-actions">
                <Link
                  href={`/courses/${candidate.raceId}/revue`}
                  className="pk-btn pk-button-secondary"
                >
                  Examiner
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
