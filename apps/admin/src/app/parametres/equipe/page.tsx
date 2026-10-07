import { listStaffTeam, type StaffTeam } from '@pluka/domain';

import { removeStaffAction, revokeStaffInvitationAction } from '@/app/staff-actions';
import { Chip, type ChipTone } from '@/components/admin-page';
import { ConsoleAction, ConsoleNotice } from '@/components/console-action';
import { redirectOnReadError, staffTeamContext } from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { day } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { SettingsHeader } from '../tabs';

import { InviteStaffForm, StaffRoleForm } from './staff-forms';
import { STAFF_ROLE_OPTIONS, staffRoleLabel } from './staff-roles';

/**
 * Paramètres · Équipe PLUKA — migrations 0035, 0036.
 *
 * Réservé au super-admin : la lecture de l'équipe lève `42501` pour tout
 * autre compte, et `redirectOnReadError` renvoie vers `/refuse` — l'écran ne
 * vérifie rien lui-même.
 *
 * Même grammaire que l'équipe d'une organisation : membres et invitations en
 * listes à filets, l'invitation dans son panneau, les rôles décrits.
 */
export const metadata = { title: 'Équipe PLUKA' };

type Member = StaffTeam['members'][number];
type Invitation = StaffTeam['invitations'][number];

function displayName(member: Member): string {
  const name = [member.firstName, member.lastName].filter((part) => part !== null).join(' ');
  return name === '' ? member.email : name;
}

function invitationState(invitation: Invitation): {
  label: string;
  tone: ChipTone;
  detail: string;
} {
  if (invitation.status === 'expired') {
    return {
      label: 'Expirée',
      tone: 'neutral',
      detail: 'Le lien a expiré : renvoyez une invitation.',
    };
  }
  if (invitation.sendFailed) {
    return {
      label: 'Envoi en échec',
      tone: 'error',
      detail: 'L’email n’est pas parti. Vérifiez l’adresse, puis réinvitez.',
    };
  }
  if (invitation.sentAt !== null) {
    return {
      label: 'Envoyée',
      tone: 'success',
      detail: `Envoyée le ${day(invitation.sentAt)} · valable jusqu’au ${day(invitation.expiresAt)}`,
    };
  }
  return {
    label: 'Envoi en cours',
    tone: 'glacier',
    detail: 'L’email part dans quelques instants.',
  };
}

export default async function StaffTeamPage({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const session = await requireSession('/parametres/equipe');
  const team = await listStaffTeam(staffTeamContext(session)).catch(redirectOnReadError);
  const notice = consoleNotice(await searchParams);
  const superAdmins = team.members.filter((member) => member.staffRole === 'super_admin').length;

  return (
    <main className="ad-page ad-org">
      <SettingsHeader current="/parametres/equipe" staffRole="super_admin" />

      <ConsoleNotice notice={notice} />

      <ul className="ad-org-tiles" aria-label="L’équipe en bref">
        {STAFF_ROLE_OPTIONS.map((role) => {
          const count = team.members.filter((member) => member.staffRole === role.value).length;
          return (
            <li key={role.value} className="ad-org-tile">
              <span className="ad-org-tile-label">{role.label}</span>
              <span className="ad-org-tile-value">{count}</span>
              <span className="ad-org-tile-meta">{role.description}</span>
            </li>
          );
        })}
      </ul>

      <div className="ad-org-grid">
        <section className="ad-org-panel" aria-labelledby="staff-title">
          <h2 id="staff-title" className="ad-org-panel-title">
            Membres de l’équipe
          </h2>
          <p className="ad-org-panel-lede">
            L’équipe garde toujours au moins un super-admin
            {superAdmins === 1
              ? ' : le seul actuel ne peut être ni rétrogradé ni retiré.'
              : '.'}{' '}
            Retirer un membre le rend simple utilisateur ; ses actions passées restent au journal.
          </p>

          <ul className="ad-rows" aria-label={`Membres, ${team.members.length}`}>
            {team.members.map((member) => {
              const isMe = member.userId === session.userId;
              return (
                <li key={member.userId} className="ad-row">
                  <div className="ad-row-main">
                    <span className="ad-row-title">
                      {displayName(member)}
                      {isMe ? (
                        <Chip tone="neutral" plain>
                          Vous
                        </Chip>
                      ) : null}
                    </span>
                    <span className="ad-row-meta">
                      {member.email === displayName(member) ? '' : `${member.email} · `}
                      compte créé le {day(member.createdAt)}
                    </span>
                  </div>
                  <div className="ad-row-actions">
                    <StaffRoleForm
                      userId={member.userId}
                      memberName={displayName(member)}
                      staffRole={member.staffRole}
                    />
                    <details className="ad-disclosure ad-row-disclosure">
                      <summary>Retirer…</summary>
                      <ConsoleAction
                        action={removeStaffAction}
                        fields={{ userId: member.userId }}
                        label="Retirer de l’équipe PLUKA"
                        variant="destructive"
                        confirm={`Je confirme retirer ${displayName(member)} : ses accès à l’administration cessent immédiatement`}
                      />
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>

          {team.invitations.length === 0 ? null : (
            <>
              <h3 className="ad-org-subtitle">Invitations en attente</h3>
              <ul
                className="ad-rows"
                aria-label={`Invitations en attente, ${team.invitations.length}`}
              >
                {team.invitations.map((invitation) => {
                  const state = invitationState(invitation);
                  return (
                    <li key={invitation.invitationId} className="ad-row">
                      <div className="ad-row-main">
                        <span className="ad-row-title">
                          {invitation.email} <Chip tone={state.tone}>{state.label}</Chip>
                        </span>
                        <span className="ad-row-meta">
                          {staffRoleLabel(invitation.staffRole)} · {state.detail}
                        </span>
                      </div>
                      <div className="ad-row-actions">
                        <ConsoleAction
                          action={revokeStaffInvitationAction}
                          fields={{ invitationId: invitation.invitationId }}
                          label="Révoquer"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <section className="ad-org-panel" aria-labelledby="staff-invite-title">
          <h2 id="staff-invite-title" className="ad-org-panel-title">
            Inviter dans l’équipe
          </h2>
          <p className="ad-org-panel-lede">
            Par email, valable 7 jours. La personne accepte en se connectant à la console avec cette
            adresse. Réinviter une adresse annule le lien précédent.
          </p>
          <InviteStaffForm />
        </section>
      </div>
    </main>
  );
}
