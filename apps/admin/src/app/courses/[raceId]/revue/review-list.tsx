'use client';

import type { FactCandidateReviewRecord } from '@pluka/db';
import { Badge, DataValue, Divider, MicroLabel, SourceDrawer, StatusBadge } from '@pluka/ui';
import type { TrustLevel } from '@pluka/ui';
import { useActionState } from 'react';

import { decideCandidateAction, publishCandidateAction, type ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/**
 * Liste de revue — SOURCES_EXTRACTION §30, Design System §86 et §185.
 *
 * Chaque candidat porte sa valeur, sa provenance et, quand il en existe une,
 * la valeur publiée en regard. Les actions sont des formulaires : un refus du
 * domaine revient dans l'état de l'action, à côté du candidat concerné.
 *
 * Rien ici ne juge d'une autorité. Les deux niveaux de confiance sont
 * proposés, et §32 est tranché par le domaine : un réviseur qui n'est pas
 * membre de l'organisation reçoit un refus explicite plutôt qu'un bouton
 * absent — il apprend ce qui lui manque au lieu de se demander pourquoi
 * l'écran est vide.
 */

/**
 * Le vocabulaire de confiance de la base et celui du Design System ne sont pas
 * écrits pareil : l'enum SQL dit `pluka_validated`, §87 dit `validated_pluka`.
 * La correspondance est faite ici, à la frontière d'affichage, plutôt que de
 * renommer l'un des deux — les deux sont déjà en place et portés par des
 * tests.
 */
const TRUST_DISPLAY: Readonly<Record<string, TrustLevel>> = {
  official: 'official',
  pluka_validated: 'validated_pluka',
  community: 'community',
};

/** §185 : un état se lit, il ne se devine pas à la couleur. */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  detected: 'Détecté',
  needs_review: 'À revoir',
  conflict: 'Contradiction',
};

const STATUS_TONE: Readonly<Record<string, 'neutral' | 'warning' | 'error'>> = {
  detected: 'neutral',
  needs_review: 'warning',
  conflict: 'error',
};

const ORIGIN_LABEL: Readonly<Record<string, string>> = {
  deterministic: 'Lecture déterministe',
  ai: 'Proposition d’un modèle',
};

function proposedValue(candidate: FactCandidateReviewRecord): string {
  if (candidate.valueText !== null) return candidate.valueText;
  if (candidate.valueNumber !== null) {
    return candidate.unit === null
      ? String(candidate.valueNumber)
      : `${candidate.valueNumber} ${candidate.unit}`;
  }

  return '—';
}

/**
 * Le locator, tel que le parseur l'a écrit — §20.
 *
 * Sa forme dépend du format : une page pour un PDF, un sélecteur et des index
 * de cellule pour du HTML. L'écran ne lui impose donc aucune structure et
 * affiche ce qu'il contient : figer une liste de clés ici rendrait invisible
 * la provenance d'un format qu'on n'a pas encore rencontré.
 */
function LocatorRows({ locator }: { readonly locator: Readonly<Record<string, unknown>> }) {
  const entries = Object.entries(locator);

  if (entries.length === 0) return null;

  return (
    <div className="pk-source-row">
      <MicroLabel>Locator</MicroLabel>
      <span className="pk-source-row-value">
        {entries.map(([key, value]) => `${key} : ${String(value)}`).join(' · ')}
      </span>
    </div>
  );
}

function CandidateCard({
  raceId,
  candidate,
}: {
  readonly raceId: string;
  readonly candidate: FactCandidateReviewRecord;
}) {
  const [publishState, publish, publishing] = useActionState(publishCandidateAction, INITIAL);
  const [decideState, decide, deciding] = useActionState(decideCandidateAction, INITIAL);

  const conflicting = candidate.status === 'conflict';
  const error = publishState.error ?? decideState.error;

  return (
    <li
      style={{
        listStyle: 'none',
        padding: 'var(--space-5) 0',
        borderTop: '1px solid var(--pk-hairline)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-3)',
        }}
      >
        <StatusBadge tone={STATUS_TONE[candidate.status] ?? 'neutral'}>
          {STATUS_LABEL[candidate.status] ?? candidate.status}
        </StatusBadge>
        <Badge tone="neutral">{candidate.category}</Badge>
        {candidate.origin === null ? null : (
          <Badge tone="neutral">{ORIGIN_LABEL[candidate.origin] ?? candidate.origin}</Badge>
        )}
        <code className="pk-label" style={{ marginLeft: 'auto' }}>
          {candidate.factKey}
        </code>
      </div>

      {/* Valeur proposée, et valeur publiée en regard quand elle existe (§30). */}
      <div style={{ display: 'flex', gap: 'var(--space-10)', flexWrap: 'wrap' }}>
        <DataValue label="Valeur proposée" value={proposedValue(candidate)} emphasis="strong" />

        {candidate.publishedValueText === null ? (
          <DataValue label="Fact courant" value="aucun" />
        ) : (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <DataValue label="Fact courant" value={candidate.publishedValueText} />
            {candidate.publishedTrustLevel === null ? null : (
              <span className="pk-label">
                {TRUST_DISPLAY[candidate.publishedTrustLevel] === undefined
                  ? candidate.publishedTrustLevel
                  : `niveau ${candidate.publishedTrustLevel}`}
              </span>
            )}
          </span>
        )}

        {candidate.confidenceLabel === null ? null : (
          <DataValue label="Confiance annoncée" value={candidate.confidenceLabel} />
        )}
      </div>

      {candidate.notes === null ? null : (
        <p
          className="pk-body"
          style={{ color: 'var(--pk-text-muted)', marginTop: 'var(--space-2)' }}
        >
          {candidate.notes}
        </p>
      )}

      {/* §86 : la source est à un geste, jamais étalée sur l'écran principal. */}
      <div style={{ marginTop: 'var(--space-2)' }}>
        <SourceDrawer
          {...(candidate.sourceType === null ? {} : { type: candidate.sourceType })}
          {...(candidate.sourceTitle === null ? {} : { title: candidate.sourceTitle })}
          {...(candidate.organizationName === null
            ? {}
            : { organization: candidate.organizationName })}
          {...(candidate.sectionPath.length === 0
            ? {}
            : { sectionLabel: candidate.sectionPath.join(' › ') })}
          {...(candidate.pageNumber === null ? {} : { pageLabel: String(candidate.pageNumber) })}
          {...(candidate.excerpt === null ? {} : { excerpt: candidate.excerpt })}
          {...(candidate.snapshotRetrievedAt === null
            ? {}
            : { date: candidate.snapshotRetrievedAt })}
          {...(candidate.sourceUrl === null ? {} : { href: candidate.sourceUrl })}
        >
          {/*
           * L'adresse de la preuve — §20 : « snapshot_id, block_id ou
           * chunk_id ». C'est ce qui permet de remonter d'une valeur affichée
           * jusqu'à sa position exacte dans le document capturé.
           */}
          {candidate.snapshotId === null ? null : (
            <div className="pk-source-row">
              <MicroLabel>Snapshot</MicroLabel>
              <span className="pk-source-row-value">
                {candidate.snapshotId}
                {candidate.snapshotContentHash === null
                  ? null
                  : ` · empreinte ${candidate.snapshotContentHash.slice(0, 12)}…`}
              </span>
            </div>
          )}

          {candidate.blockIndex === null ? null : (
            <div className="pk-source-row">
              <MicroLabel>Block</MicroLabel>
              <span className="pk-source-row-value">
                n° {candidate.blockIndex}
                {candidate.chunkIndex === null ? null : ` · chunk n° ${candidate.chunkIndex}`}
              </span>
            </div>
          )}

          <LocatorRows locator={candidate.locator} />

          {candidate.blockContent === null ||
          candidate.blockContent === candidate.excerpt ? null : (
            <div className="pk-source-row">
              <MicroLabel>Block complet</MicroLabel>
              <span className="pk-source-row-value">{candidate.blockContent}</span>
            </div>
          )}

          {candidate.provider === null ? null : (
            <div className="pk-source-row">
              <MicroLabel>Extraction</MicroLabel>
              <span className="pk-source-row-value">
                {candidate.provider}
                {candidate.model === null ? null : ` · ${candidate.model}`}
              </span>
            </div>
          )}
        </SourceDrawer>
      </div>

      {conflicting ? (
        <p
          className="pk-body"
          style={{ color: 'var(--pk-text-muted)', marginTop: 'var(--space-3)' }}
        >
          Cette proposition contredit la valeur publiée. Publier demande de le confirmer
          explicitement : la valeur existante ne sera pas écrasée, elle sera remplacée par une
          nouvelle version.
        </p>
      ) : null}

      {error === undefined ? null : (
        <p role="alert" className="pk-body" style={{ color: 'var(--pk-error-signal)' }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-6)',
          flexWrap: 'wrap',
          marginTop: 'var(--space-4)',
        }}
      >
        <form action={publish} style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <input type="hidden" name="raceId" value={raceId} />
          <input type="hidden" name="candidateId" value={candidate.candidateId} />

          <label className="pk-label" htmlFor={`trust-${candidate.candidateId}`}>
            Niveau de confiance
          </label>
          <select
            id={`trust-${candidate.candidateId}`}
            name="trustLevel"
            className="pk-input"
            defaultValue="official"
          >
            <option value="official">Officielle — au nom de l’organisation</option>
            <option value="pluka_validated">Validée PLUKA</option>
          </select>

          <label className="pk-label" htmlFor={`value-${candidate.candidateId}`}>
            Valeur publiée (laisser vide pour reprendre la proposition)
          </label>
          <input
            id={`value-${candidate.candidateId}`}
            name="valueText"
            className="pk-input"
            defaultValue=""
            placeholder={proposedValue(candidate)}
          />

          <label className="pk-label" htmlFor={`note-publish-${candidate.candidateId}`}>
            Note de revue
          </label>
          <input
            id={`note-publish-${candidate.candidateId}`}
            name="note"
            className="pk-input"
            defaultValue=""
          />

          {conflicting ? (
            <label className="pk-label" style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input type="checkbox" name="resolveConflict" />
              Je confirme remplacer la valeur publiée
            </label>
          ) : null}

          <button
            type="submit"
            className="pk-btn pk-button-primary"
            disabled={publishing}
            style={{ minHeight: '44px' }}
          >
            {conflicting ? 'Résoudre et publier' : 'Accepter et publier'}
          </button>
        </form>

        <form action={decide} style={{ display: 'grid', gap: 'var(--space-2)', alignSelf: 'end' }}>
          <input type="hidden" name="raceId" value={raceId} />
          <input type="hidden" name="candidateId" value={candidate.candidateId} />
          <input type="hidden" name="decision" value="reject" />

          <label className="pk-label" htmlFor={`note-reject-${candidate.candidateId}`}>
            Motif du rejet
          </label>
          <input
            id={`note-reject-${candidate.candidateId}`}
            name="note"
            className="pk-input"
            defaultValue=""
          />

          <button
            type="submit"
            className="pk-btn pk-button-secondary"
            disabled={deciding}
            style={{ minHeight: '44px' }}
          >
            Rejeter
          </button>
        </form>
      </div>
    </li>
  );
}

export function CandidateReviewList({
  raceId,
  candidates,
}: {
  readonly raceId: string;
  readonly candidates: readonly FactCandidateReviewRecord[];
}) {
  if (candidates.length === 0) {
    return (
      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Aucun candidat en attente de revue pour cette épreuve.
      </p>
    );
  }

  return (
    <>
      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-2)' }}>
        {candidates.length} proposition{candidates.length > 1 ? 's' : ''}
      </h2>
      <Divider />
      <ul style={{ margin: 0, padding: 0 }}>
        {candidates.map((candidate) => (
          <CandidateCard key={candidate.candidateId} raceId={raceId} candidate={candidate} />
        ))}
      </ul>
    </>
  );
}
