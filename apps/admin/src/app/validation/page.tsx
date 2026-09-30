import { listAdminFactCandidates } from '@pluka/domain';
import { EmptyState, SectionHeader, Table } from '@pluka/ui';
import Link from 'next/link';

import { AdminStatus } from '@/components/admin-status';
import { dateTime } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * File de validation, toutes courses — `adminTab: 'validation'`.
 *
 * Elle complète la revue par course sans la remplacer : celle-ci sert à choisir
 * quoi examiner, `/courses/[raceId]/revue` à examiner. Chaque ligne y renvoie,
 * et c'est là que vivent les décisions — cet écran est en lecture seule.
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
      <SectionHeader eyebrow="Administration" title="Validation" />

      <p className="pk-body ad-measure">
        Les informations extraites qui attendent une décision, toutes courses confondues. Le détail
        et les actions restent sur l’écran de revue de chaque épreuve.
      </p>

      {candidates.length === 0 ? (
        <EmptyState
          label="Validation"
          title="Rien à examiner."
          detail="Aucune extraction en attente : ni conflit, ni information détectée sans décision."
        >
          <p>Les candidats apparaissent ici dès qu’une source est analysée.</p>
        </EmptyState>
      ) : (
        <Table
          caption={`${candidates.length} information${candidates.length > 1 ? 's' : ''} à examiner`}
          columns={[
            { key: 'fact', label: 'Information' },
            { key: 'value', label: 'Valeur proposée' },
            { key: 'race', label: 'Épreuve' },
            { key: 'confidence', label: 'Confiance' },
            { key: 'status', label: 'État' },
            { key: 'extracted', label: 'Extraite le' },
          ]}
          rows={candidates.map((candidate) => ({
            key: candidate.candidateId,
            cells: {
              fact: (
                <>
                  <span className="ad-mono">{candidate.factKey}</span>
                  <span className="ad-sub">{candidate.category}</span>
                </>
              ),
              /* `value_text` est nul quand la valeur est structurée : le dire
                 vaut mieux qu'un tiret, qui se lirait « pas de valeur ». */
              value: candidate.valueText ?? <span className="ad-muted">valeur structurée</span>,
              race: (
                <>
                  <Link href={`/courses/${candidate.raceId}/revue`} className="pk-link">
                    {candidate.raceName}
                  </Link>
                  <span className="ad-sub">{candidate.eventName}</span>
                </>
              ),
              confidence: candidate.confidenceLabel ?? '—',
              status: (
                <>
                  <AdminStatus domain="candidate" status={candidate.status} />
                  {candidate.conflictStatus === null ? null : (
                    <span className="ad-sub">
                      <AdminStatus domain="conflict" status={candidate.conflictStatus} />
                    </span>
                  )}
                </>
              ),
              extracted: dateTime(candidate.extractedAt),
            },
          }))}
        />
      )}
    </main>
  );
}
