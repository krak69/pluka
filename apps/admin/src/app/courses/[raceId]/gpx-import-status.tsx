import { divergenceRatio, type RaceGpxImport, type RaceGpxImportStage } from '@pluka/domain';
import { Badge, DataValue } from '@pluka/ui';

/**
 * État du traitement d'un GPX — 01_ARCHITECTURE §22, PLAN_ENGINE §9, §9.1.
 *
 * Le traitement est asynchrone : entre le dépôt et les micro-segments, il y a
 * un job, un worker et un prétraitement qui peut refuser. L'écran doit donc
 * dire où l'on en est, et pourquoi on n'ira pas plus loin.
 *
 * L'étape affichée vient de `importStage`, dans le domaine : cet écran ne
 * déduit rien d'un statut de job, il rend une étape et son libellé. Un
 * prétraitement bloqué n'est pas présenté comme une panne — §9.1 en fait « un
 * état de qualité à résoudre », et c'est le référentiel de parcours qu'il faut
 * corriger, pas le fichier.
 */

const STAGE_LABEL: Readonly<Record<RaceGpxImportStage, string>> = {
  none: 'Aucun GPX importé',
  queued: 'En attente de traitement',
  running: 'Traitement en cours',
  failed: 'En erreur',
  preprocessing_pending: 'Géométrie enregistrée, prétraitement en attente',
  blocked: 'Prétraitement bloqué',
  completed: 'Terminé',
};

/**
 * Tonalité du bandeau.
 *
 * `blocked` partage la tonalité neutre plutôt que celle d'une réussite : la
 * trace est là, mais aucun Plan ne pourra être calculé tant que le référentiel
 * n'aura pas été corrigé.
 */
const STAGE_TONE: Readonly<Record<RaceGpxImportStage, 'glacier' | 'neutral'>> = {
  none: 'neutral',
  queued: 'neutral',
  running: 'neutral',
  failed: 'neutral',
  preprocessing_pending: 'neutral',
  blocked: 'neutral',
  completed: 'glacier',
};

/** Un écart relatif, tel qu'un administrateur le lit. */
function gap(measured: number | null, official: number | null): string | null {
  const ratio = divergenceRatio(measured, official);

  return ratio === null ? null : `${(ratio * 100).toFixed(1)} % d’écart`;
}

export function GpxImportStatus({ status }: { readonly status: RaceGpxImport }) {
  const { stage, job, snapshot, geometry, quality } = status;
  const distanceGap =
    geometry === null ? null : gap(geometry.lengthMeters, status.officialDistanceMeters);
  const gainGap =
    geometry === null
      ? null
      : gap(geometry.elevationGainMeters, status.officialElevationGainMeters);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
        <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>

        {snapshot === null ? null : (
          <span className="pk-label">version {snapshot.versionNumber}</span>
        )}
      </div>

      {stage === 'none' ? (
        <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
          Sans parcours prétraité, aucun Plan ne peut être calculé pour cette épreuve.
        </p>
      ) : null}

      {job === null || job.status !== 'failed' ? null : (
        <p className="pk-field-error" role="alert">
          {/* Le message vient du worker, déjà formaté pour être lu (§34.1). */}
          {job.lastError ?? 'Le traitement a échoué sans message.'}
          {` (${job.attempts} tentative${job.attempts > 1 ? 's' : ''} sur ${job.maxAttempts})`}
        </p>
      )}

      {geometry === null ? null : (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-10)', flexWrap: 'wrap' }}>
            <DataValue label="Points" value={geometry.pointCount} />
            <DataValue label="Micro-segments" value={geometry.microSegmentCount} />
            <DataValue label="Processeur" value={geometry.processorVersion} />
          </div>

          {/* §9 : le mesuré face au déclaré. L'écart est montré, jamais résorbé
              — §9.1 « ne falsifie pas le GPX, ne modifie pas artificiellement
              le D+ ». Les deux valeurs restent celles de leur source. */}
          <table className="pk-body" style={{ borderCollapse: 'collapse', textAlign: 'left' }}>
            <caption
              className="pk-label"
              style={{ textAlign: 'left', paddingBottom: 'var(--space-2)' }}
            >
              Mesuré sur la trace, face à l’annonce officielle
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}
                />
                <th
                  scope="col"
                  style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}
                >
                  Mesuré
                </th>
                <th
                  scope="col"
                  style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}
                >
                  Officiel
                </th>
                <th scope="col" style={{ padding: 'var(--space-2) 0' }}>
                  Écart
                </th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: '1px solid var(--pk-hairline)' }}>
                <th
                  scope="row"
                  style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}
                >
                  Distance
                </th>
                <td style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}>
                  {geometry.lengthMeters === null
                    ? '—'
                    : `${(geometry.lengthMeters / 1000).toFixed(2)} km`}
                </td>
                <td style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}>
                  {status.officialDistanceMeters === null
                    ? '—'
                    : `${(status.officialDistanceMeters / 1000).toFixed(2)} km`}
                </td>
                <td style={{ padding: 'var(--space-2) 0' }}>{distanceGap ?? '—'}</td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--pk-hairline)' }}>
                <th
                  scope="row"
                  style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}
                >
                  D+
                </th>
                <td style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}>
                  {geometry.elevationGainMeters === null
                    ? '—'
                    : `${geometry.elevationGainMeters} m`}
                </td>
                <td style={{ padding: 'var(--space-2) var(--space-6) var(--space-2) 0' }}>
                  {status.officialElevationGainMeters === null
                    ? '—'
                    : `${status.officialElevationGainMeters} m`}
                </td>
                <td style={{ padding: 'var(--space-2) 0' }}>{gainGap ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {quality.length === 0 ? null : (
        <section>
          <h3 className="pk-label" style={{ marginBottom: 'var(--space-2)' }}>
            Contrôles qualité
          </h3>

          {/* §9.1 : « il produit un état de qualité à résoudre ». L'écart est
              constaté et nommé, jamais corrigé ni lissé. */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {quality.map((finding) => (
              <li
                key={finding.code}
                className="pk-body"
                style={{
                  padding: 'var(--space-3) 0',
                  borderTop: '1px solid var(--pk-hairline)',
                }}
              >
                <span className="pk-label">
                  {finding.level === 'error' ? 'Erreur' : 'Avertissement'} · {finding.code}
                </span>
                <br />
                {finding.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
