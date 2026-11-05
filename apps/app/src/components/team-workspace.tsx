'use client';

import { StatusBadge, TerrainBand } from '@pluka/ui';
import { useState, type ReactNode } from 'react';

import { WorkspaceTabs } from '@/components/workspace-tabs';

/**
 * L'écran Équipe — même cadre que Site : la scène, puis une rubrique à la fois.
 * Client pour une seule raison : garder la rubrique ouverte quand un geste
 * recharge la page.
 */

type TeamTab = 'membres' | 'invitations' | 'inviter';

export function TeamWorkspace({
  organizationName,
  roleLabel,
  notice,
  focus,
  memberCount,
  invitationCount,
  members,
  invitations,
  invite,
}: {
  readonly organizationName: string;
  readonly roleLabel: string;
  readonly notice: string | undefined;
  /** La rubrique où regarder après un geste : une invitation envoyée s'y retrouve. */
  readonly focus: TeamTab | undefined;
  readonly memberCount: number;
  readonly invitationCount: number;
  readonly members: ReactNode;
  readonly invitations: ReactNode;
  readonly invite: ReactNode;
}) {
  const [tab, setTab] = useState<TeamTab>(focus ?? 'membres');
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (focus !== undefined) setTab(focus);
  }

  return (
    <div className="st-editor">
      <TerrainBand
        tone="dark"
        topo
        eyebrow="Équipe"
        title={organizationName}
        body="Qui peut travailler sur vos événements, et avec quel rôle."
        footer={<StatusBadge tone="neutral">{`Votre rôle : ${roleLabel}`}</StatusBadge>}
        primaryAction={
          <button
            type="button"
            className="pk-btn pk-button-primary"
            onClick={() => setTab('inviter')}
          >
            Inviter quelqu’un
          </button>
        }
      />

      {notice === undefined ? null : (
        <p className="pk-body st-notice" role="status">
          {notice}
        </p>
      )}

      <div className="st-workspace">
        <div className="st-rail">
          <WorkspaceTabs
            label="Rubriques de l’équipe"
            current={tab}
            onSelect={setTab}
            tabs={[
              { key: 'membres', label: 'Membres', count: memberCount },
              { key: 'invitations', label: 'Invitations', count: invitationCount },
              { key: 'inviter', label: 'Inviter' },
            ]}
          />
        </div>

        <div className="st-panels">
          <div hidden={tab !== 'membres'}>{members}</div>
          <div hidden={tab !== 'invitations'}>{invitations}</div>
          <div hidden={tab !== 'inviter'}>{invite}</div>
        </div>
      </div>
    </div>
  );
}
