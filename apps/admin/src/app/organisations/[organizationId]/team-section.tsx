import type { OrganizationTeam } from '@pluka/domain';

import { removeMemberAction, revokeInvitationAction } from '@/app/team-actions';
import { MemberRoleForm } from '@/app/team-forms';
import { Chip, type ChipTone } from '@/components/admin-page';
import { ORGANIZATION_ROLE_OPTIONS, organizationRoleLabel } from '@/components/admin-status';
import { ConsoleAction } from '@/components/console-action';
import { day } from '@/lib/format';

/**
 * Équipe d'une organisation — `orgTeam` du prototype, avec ses gestes
 * (migration 0033).
 *
 * Listes bord à bord, une ligne par membre ou par invitation
 * (06_DESIGN_SYSTEM §38, §167) : nom, métadonnée, prochaine action. Le retrait
 * est replié sur sa ligne ; il demande une case cochée.
 *
 * Le panneau ne porte que l'équipe en place et les invitations ouvertes ;
 * l'invitation est son voisin, et ce qui attend un geste remonte dans
 * « À faire », en tête de fiche.
 *
 * Les gestes sont toujours proposés : c'est la base qui refuse — dernier
 * propriétaire, droit retiré en cours de session — et le refus s'affiche à
 * côté du geste qui l'a provoqué.
 */

type Member = OrganizationTeam['members'][number];
type Invitation = OrganizationTeam['invitations'][number];

function invitationState(invitation: Invitation): { label: string; tone: ChipTone } {
  if (invitation.status === 'expired') return { label: 'Expirée', tone: 'neutral' };
  if (invitation.sendFailed) return { label: 'Envoi en échec', tone: 'error' };
  if (invitation.sentAt !== null) return { label: 'Envoyée', tone: 'success' };
  return { label: 'Envoi en cours', tone: 'glacier' };
}

function invitationDetail(invitation: Invitation): string {
  if (invitation.status === 'expired') return 'Le lien a expiré : renvoyez une invitation.';
  if (invitation.sendFailed) return 'L’email n’est pas parti. Vérifiez l’adresse, puis réinvitez.';
  if (invitation.sentAt !== null) {
    return `Envoyée le ${day(invitation.sentAt)} · valable jusqu’au ${day(invitation.expiresAt)}`;
  }
  return 'L’email part dans quelques instants.';
}

function displayName(member: Member): string {
  const name = [member.firstName, member.lastName].filter((part) => part !== null).join(' ');
  return name === '' ? member.email : name;
}

export function TeamSection({
  organizationId,
  team,
}: {
  readonly organizationId: string;
  readonly team: OrganizationTeam;
}) {
  return (
    <>
      <h2 id="team-title" className="ad-org-panel-title">
        Équipe
      </h2>

      {team.members.length === 0 ? (
        <p className="ad-org-panel-lede">
          Aucun membre pour l’instant. Le premier invité devrait être un propriétaire : c’est lui
          qui gérera ensuite l’équipe depuis l’espace organisateur.
        </p>
      ) : (
        <ul className="ad-rows" aria-label={`Membres, ${team.members.length}`}>
          {team.members.map((member) => (
            <li key={member.userId} className="ad-row">
              <div className="ad-row-main">
                <span className="ad-row-title">{displayName(member)}</span>
                <span className="ad-row-meta">
                  {member.email === displayName(member) ? '' : `${member.email} · `}
                  membre depuis le {day(member.joinedAt)}
                </span>
              </div>

              <div className="ad-row-actions">
                <MemberRoleForm
                  organizationId={organizationId}
                  userId={member.userId}
                  memberName={displayName(member)}
                  role={member.role}
                  roles={ORGANIZATION_ROLE_OPTIONS}
                />

                <details className="ad-disclosure ad-row-disclosure">
                  <summary>Retirer…</summary>
                  <ConsoleAction
                    action={removeMemberAction}
                    fields={{ organizationId, userId: member.userId }}
                    label="Retirer de l’équipe"
                    variant="destructive"
                    confirm={`Je confirme retirer ${displayName(member)} : ses accès cessent immédiatement`}
                  />
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}

      {team.invitations.length === 0 ? null : (
        <>
          <h3 className="ad-org-subtitle">Invitations en attente</h3>
          <ul className="ad-rows" aria-label={`Invitations en attente, ${team.invitations.length}`}>
            {team.invitations.map((invitation) => {
              const state = invitationState(invitation);

              return (
                <li key={invitation.invitationId} className="ad-row">
                  <div className="ad-row-main">
                    <span className="ad-row-title">
                      {invitation.email} <Chip tone={state.tone}>{state.label}</Chip>
                    </span>
                    <span className="ad-row-meta">
                      {organizationRoleLabel(invitation.role)} · {invitationDetail(invitation)}
                    </span>
                  </div>
                  <div className="ad-row-actions">
                    <ConsoleAction
                      action={revokeInvitationAction}
                      fields={{ organizationId, invitationId: invitation.invitationId }}
                      label="Révoquer"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
