import { DomainError, getMyOrganization, listOrganizationTeam } from '@pluka/domain';
import { MicroLabel } from '@pluka/ui';

import {
  InviteTeamMemberForm,
  RemoveTeamMemberForm,
  RevokeTeamInvitationForm,
  TeamMemberRoleForm,
} from '@/components/team-forms';
import { requireSession } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';
import { teamRoleLabel } from '@/lib/team-roles';

/**
 * Paramètres · Équipe — `orgTeam` du prototype, avec ses gestes
 * (05_ROUTES_FLOWS §6.1, migration 0033).
 *
 * Le propriétaire gère l'équipe. Les autres membres arrivent ici aussi — le
 * cadre est le même — mais la base leur refuse la liste : l'écran dit
 * pourquoi, avec leur rôle, plutôt qu'une page vide ou un 404.
 */
export const metadata = { title: 'Équipe' };

const NOTICES: Readonly<Record<string, string>> = {
  'invitation-envoyee':
    'Invitation enregistrée : l’email part dans quelques instants. Le lien est valable 7 jours.',
  'invitation-revoquee': 'Invitation révoquée : son lien ne fonctionne plus.',
  'role-modifie': 'Rôle modifié.',
  'role-inchange': 'Aucune modification : le membre avait déjà ce rôle.',
  'membre-retire': 'Membre retiré : ses accès à l’organisation ont cessé.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function dayOf(instant: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instant));
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { organizationId } = await params;
  const fait = (await searchParams).fait;
  const notice = typeof fait === 'string' ? NOTICES[fait] : undefined;

  const session = await requireSession(`/org/${organizationId}/parametres/equipe`);
  const context = sessionTeamContext(session);
  // Le layout a déjà vérifié l'appartenance ; on relit le rôle pour le dire.
  const membership = await getMyOrganization(context, { organizationId });

  const team = await listOrganizationTeam(context, { organizationId }).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'forbidden') return null;
    throw error;
  });

  return (
    <>
      <div>
        <MicroLabel>Paramètres</MicroLabel>
        <h1 className="pk-h1">Équipe</h1>
      </div>

      {notice === undefined ? null : (
        <p className="pk-body" role="status">
          {notice}
        </p>
      )}

      {team === null ? (
        <p className="pk-body">
          Seul un propriétaire de {membership.organizationName} gère son équipe. Votre rôle :{' '}
          {teamRoleLabel(membership.role)}.
        </p>
      ) : (
        <>
          <section aria-labelledby="members-title">
            <h2 id="members-title" className="pk-h2">
              Membres
            </h2>
            <ul className="or-list">
              {team.members.map((member) => {
                const name =
                  [member.firstName, member.lastName].filter((part) => part !== null).join(' ') ||
                  member.email;
                const isMe = member.userId === session.userId;

                return (
                  <li key={member.userId} className="or-row">
                    <div className="or-row-main">
                      <span className="pk-body">
                        {name}
                        {isMe ? ' (vous)' : ''}
                      </span>
                      <span className="or-row-meta">
                        {member.email} · membre depuis le {dayOf(member.joinedAt)}
                      </span>
                    </div>
                    <TeamMemberRoleForm
                      organizationId={organizationId}
                      userId={member.userId}
                      memberName={name}
                      role={member.role}
                    />
                    <details>
                      <summary>Retirer…</summary>
                      <RemoveTeamMemberForm
                        organizationId={organizationId}
                        userId={member.userId}
                        memberName={name}
                      />
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>

          {team.invitations.length === 0 ? null : (
            <section aria-labelledby="invitations-title">
              <h2 id="invitations-title" className="pk-h2">
                Invitations en attente
              </h2>
              <ul className="or-list">
                {team.invitations.map((invitation) => (
                  <li key={invitation.invitationId} className="or-row">
                    <div className="or-row-main">
                      <span className="pk-body">{invitation.email}</span>
                      <span className="or-row-meta">
                        {teamRoleLabel(invitation.role)} ·{' '}
                        {invitation.status === 'expired'
                          ? 'Expirée — renvoyez une invitation'
                          : invitation.sendFailed
                            ? 'Envoi en échec — l’email n’est pas parti'
                            : invitation.sentAt !== null
                              ? `Envoyée le ${dayOf(invitation.sentAt)}`
                              : 'Envoi en cours'}
                      </span>
                    </div>
                    <RevokeTeamInvitationForm
                      organizationId={organizationId}
                      invitationId={invitation.invitationId}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="invite-title">
            <h2 id="invite-title" className="pk-h2">
              Inviter quelqu’un
            </h2>
            <p className="pk-body">
              L’invitation part par email ; la personne l’accepte en se connectant avec cette
              adresse. Réinviter une adresse annule le lien précédent.
            </p>
            <InviteTeamMemberForm organizationId={organizationId} />
          </section>
        </>
      )}
    </>
  );
}
