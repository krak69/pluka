import {
  DomainError,
  getAdminOrganization,
  getAdminOrganizationDependencies,
  getMyStaffRole,
  ORGANIZATION_DELETION_EFFECTS,
  listAdminOrganizations,
  listOrganizationTeam,
  type OrganizationTeam,
} from '@pluka/domain';
import type { OrganizationDependencyRecord as OrganizationDependency } from '@pluka/db';
import { TerrainBand } from '@pluka/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { deleteOrganizationAction } from '@/app/console-actions';
import { EditOrganizationForm } from '@/app/edit-organization-form';
import { inviteMemberAction } from '@/app/team-actions';
import { InviteMemberForm } from '@/app/team-forms';
import {
  ORGANIZATION_ROLE_OPTIONS,
  organizationRoleLabel,
  statusLabel,
} from '@/components/admin-status';
import { ConsoleAction, ConsoleNotice } from '@/components/console-action';
import {
  organizationTeamContext,
  redirectOnReadError,
  requireAdminConsoleContext,
  staffTeamContext,
} from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { day } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { TeamSection } from './team-section';

/**
 * Fiche d'une organisation — dans la grammaire de l'accueil organisateur du
 * prototype (`orgOverview`) :
 *
 * 1. **une bande de terrain** Ardoise (06_DESIGN_SYSTEM §22) : l'organisation,
 *    son statut, la prochaine chose à faire en Aube, une seule action Lichen ;
 * 2. **« À faire »** — des lignes à liseré Aube, une par point qui attend un
 *    geste : pas de propriétaire, invitation non envoyée, lien expiré. Rien
 *    n'est inventé : chaque ligne vient d'un état lu en base ;
 * 3. **des tuiles** — équipe, invitations, courses, contact ;
 * 4. **deux panneaux** — l'équipe et l'invitation, côte à côte sur écran
 *    large (AGENTS §45 : organisateur desktop d'abord, responsive) ;
 * 5. **les informations**, repliées sous « Modifier », et la suppression,
 *    isolée en dernier (§28).
 */
export const metadata = { title: 'Organisation' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Les familles de 0037, dites comme l'écran les montre ailleurs. Des
 * fonctions plutôt que des paires singulier / pluriel : le pluriel se
 * construit, et aucune chaîne de l'écran ne recopie un nom de table.
 */
const s = (count: number): string => (count > 1 ? 's' : '');

const DEPENDENCY_LABELS: Readonly<Record<string, (count: number) => string>> = {
  members: (n) => `${n} membre${s(n)}`,
  events: (n) => `${n} événement${s(n)}`,
  sources: (n) => `${n} source${s(n)}`,
  published_facts: (n) => `${n} information${s(n)} publiée${s(n)}`,
  notices: (n) => `${n} notice${s(n)} officielle${s(n)}`,
  change_events: (n) => `${n} changement${s(n)} publié${s(n)}`,
  entitlements: (n) => `${n} droit${s(n)} participant${s(n)}`,
  participant_imports: (n) => `${n} import${s(n)} de participants`,
  enrichment_imports: (n) => `${n} import${s(n)} d’enrichissement`,
};

/** La part de ce qui retient l'organisation qui subit un effet donné (0038). */
function summaryOf(
  dependencies: readonly OrganizationDependency[],
  effect: 'removed' | 'detached',
  suffix: string,
  none: string,
): string {
  const parts = dependencies
    .filter((dependency) => ORGANIZATION_DELETION_EFFECTS[dependency.kind] === effect)
    .map(dependencyLabel);
  return parts.length === 0 ? none : `${parts.join(', ')}${suffix}`;
}

function removedSummary(dependencies: readonly OrganizationDependency[]): string {
  return summaryOf(
    dependencies,
    'removed',
    ', et les invitations en attente',
    'Les invitations en attente',
  );
}

function detachedSummary(dependencies: readonly OrganizationDependency[]): string {
  return summaryOf(dependencies, 'detached', ' → Maintenus par PLUKA', 'Aucun événement');
}

function dependencyLabel(dependency: { readonly kind: string; readonly total: number }): string {
  return (DEPENDENCY_LABELS[dependency.kind] ?? ((n) => `${n} ${dependency.kind}`))(
    dependency.total,
  );
}

type Invitation = OrganizationTeam['invitations'][number];

interface Todo {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly action: ReactNode;
}

/** Ce qui attend un geste, lu dans l'état de l'équipe — jamais supposé. */
function todosOf(organizationId: string, team: OrganizationTeam, owners: number): readonly Todo[] {
  const todos: Todo[] = [];

  if (owners === 0) {
    todos.push({
      key: 'owner',
      title: 'Nommer un propriétaire',
      detail:
        'Sans propriétaire, personne ne gère cette équipe depuis l’espace organisateur : tout passe par vous.',
      action: (
        <a href="#inviter" className="pk-btn pk-button-secondary">
          Inviter un propriétaire
        </a>
      ),
    });
  }

  const reinvite = (invitation: Invitation) => (
    <ConsoleAction
      action={inviteMemberAction}
      fields={{ organizationId, email: invitation.email, role: invitation.role }}
      label="Réinviter"
    />
  );

  for (const invitation of team.invitations) {
    if (invitation.sendFailed) {
      todos.push({
        key: `failed-${invitation.invitationId}`,
        title: `L’invitation de ${invitation.email} n’est pas partie`,
        detail: `${organizationRoleLabel(invitation.role)} · l’email a échoué. Vérifiez l’adresse, puis réinvitez : un nouveau lien remplace l’ancien.`,
        action: reinvite(invitation),
      });
    } else if (invitation.status === 'expired') {
      todos.push({
        key: `expired-${invitation.invitationId}`,
        title: `L’invitation de ${invitation.email} a expiré`,
        detail: `${organizationRoleLabel(invitation.role)} · le lien n’est plus valable depuis le ${day(invitation.expiresAt)}.`,
        action: reinvite(invitation),
      });
    }
  }

  return todos;
}

/** La ligne Aube de la bande : la prochaine chose à faire, ou rien. */
function nextStep(todos: readonly Todo[], pending: number): string {
  if (todos.length > 0) return plural(todos.length, 'point à reprendre', 'points à reprendre');
  if (pending > 0) return plural(pending, 'invitation en attente', 'invitations en attente');
  return 'Rien à reprendre';
}

export default async function OrganizationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const { organizationId } = await params;
  const returnTo = `/organisations/${organizationId}`;
  const context = await requireAdminConsoleContext(returnTo);
  const notice = consoleNotice(await searchParams);

  const organization = await getAdminOrganization(context, { organizationId }).catch(
    (error: unknown) => {
      // Un identifiant qui n'est pas un UUID est une adresse inexistante, pas une panne.
      if (error instanceof DomainError && error.code === 'validation') notFound();
      return redirectOnReadError(error);
    },
  );

  const session = await requireSession(returnTo);
  // Support lit la fiche sans ses gestes (0035) : la base les refuserait.
  const staffRole = await getMyStaffRole(staffTeamContext(session));
  const readOnly = staffRole === 'support';
  const isSuperAdmin = staffRole === 'super_admin';

  const [team, summaries] = await Promise.all([
    listOrganizationTeam(organizationTeamContext(session), {
      organizationId,
    }).catch(redirectOnReadError),
    // Les compteurs d'événements et d'épreuves sont ceux de la liste (0028).
    listAdminOrganizations(context, { limit: 500 }).catch(redirectOnReadError),
  ]);

  // Ce qui retient l'organisation (0037) — lu seulement pour qui peut supprimer.
  const dependencies = readOnly
    ? []
    : await getAdminOrganizationDependencies(context, { organizationId }).catch(
        redirectOnReadError,
      );

  const summary = summaries.find((candidate) => candidate.organizationId === organizationId);
  const owners = team.members.filter((member) => member.role === 'owner').length;
  const failed = team.invitations.filter((invitation) => invitation.sendFailed).length;
  const todos = todosOf(organizationId, team, owners);

  return (
    <main className="ad-page ad-org">
      <Link href="/organisations" className="pk-link">
        Organisations
      </Link>

      <TerrainBand
        tone="dark"
        topo
        eyebrow={`Organisation · ${statusLabel('organization', organization.status)}`}
        title={organization.name}
        body={
          <p className={todos.length > 0 ? 'ad-org-next ad-org-next-due' : 'ad-org-next'}>
            {nextStep(todos, team.invitations.length)}
          </p>
        }
        footer={`${organization.slug} · créée le ${day(organization.createdAt)}`}
        {...(readOnly
          ? {}
          : {
              primaryAction: (
                <a href="#inviter" className="pk-btn pk-button-primary">
                  Inviter un membre
                </a>
              ),
            })}
      />

      <ConsoleNotice notice={notice} />

      {todos.length === 0 ? null : (
        <ul className="ad-org-todos" aria-label={`À faire, ${todos.length}`}>
          {todos.map((todo) => (
            <li key={todo.key} className="ad-org-todo">
              <div className="ad-org-todo-text">
                <span className="pk-label ad-org-todo-label">À faire</span>
                <span className="ad-org-todo-title">{todo.title}</span>
                <span className="ad-org-todo-detail">{todo.detail}</span>
              </div>
              {readOnly ? null : <div className="ad-org-todo-action">{todo.action}</div>}
            </li>
          ))}
        </ul>
      )}

      <ul className="ad-org-tiles" aria-label="En bref">
        <li className="ad-org-tile">
          <span className="ad-org-tile-label">Équipe</span>
          <span className="ad-org-tile-value">
            {plural(team.members.length, 'membre', 'membres')}
          </span>
          <span
            className={owners === 0 ? 'ad-org-tile-meta ad-org-tile-meta-due' : 'ad-org-tile-meta'}
          >
            {plural(owners, 'propriétaire', 'propriétaires')}
          </span>
        </li>
        <li className="ad-org-tile">
          <span className="ad-org-tile-label">Invitations</span>
          <span className="ad-org-tile-value">
            {team.invitations.length === 0 ? 'Aucune' : `${team.invitations.length} en attente`}
          </span>
          <span
            className={failed > 0 ? 'ad-org-tile-meta ad-org-tile-meta-due' : 'ad-org-tile-meta'}
          >
            {failed > 0
              ? plural(failed, 'envoi en échec', 'envois en échec')
              : 'Aucun envoi en échec'}
          </span>
        </li>
        <li className="ad-org-tile">
          <span className="ad-org-tile-label">Courses</span>
          <span className="ad-org-tile-value">
            {summary === undefined ? '—' : plural(summary.eventsCount, 'événement', 'événements')}
          </span>
          <span className="ad-org-tile-meta">
            {summary === undefined ? '' : plural(summary.racesCount, 'épreuve', 'épreuves')}
          </span>
        </li>
        <li className="ad-org-tile">
          <span className="ad-org-tile-label">Contact</span>
          <span className="ad-org-tile-value ad-org-tile-value-text">
            {organization.contactEmail ?? 'Aucun'}
          </span>
          <span className="ad-org-tile-meta">
            {organization.websiteUrl === null ? (
              'Pas de site web'
            ) : (
              <a
                href={organization.websiteUrl}
                className="pk-link"
                rel="noreferrer"
                target="_blank"
              >
                {organization.websiteUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
          </span>
        </li>
      </ul>

      <div className="ad-org-grid">
        <section className="ad-org-panel" aria-labelledby="team-title">
          <TeamSection
            organizationId={organization.organizationId}
            team={team}
            readOnly={readOnly}
          />
        </section>

        {readOnly ? null : (
          <section className="ad-org-panel" aria-labelledby="invite-title" id="inviter">
            <h2 id="invite-title" className="ad-org-panel-title">
              Inviter quelqu’un
            </h2>
            <p className="ad-org-panel-lede">
              Par email, valable 7 jours. La personne accepte en se connectant avec cette adresse —
              pas besoin de compte au préalable. Réinviter une adresse annule le lien précédent.
            </p>
            <InviteMemberForm
              organizationId={organization.organizationId}
              roles={ORGANIZATION_ROLE_OPTIONS}
              defaultRole={owners === 0 ? 'owner' : 'viewer'}
            />
          </section>
        )}
      </div>

      <div className="ad-org-grid">
        <section className="ad-org-panel" aria-labelledby="information-title">
          <h2 id="information-title" className="ad-org-panel-title">
            Informations
          </h2>
          <dl className="ad-org-facts">
            <dt>Nom</dt>
            <dd>{organization.name}</dd>
            <dt>Slug</dt>
            <dd className="ad-mono">{organization.slug}</dd>
            <dt>Statut</dt>
            <dd>{statusLabel('organization', organization.status)}</dd>
            <dt>Contact</dt>
            <dd>{organization.contactEmail ?? 'Aucun'}</dd>
            <dt>Site web</dt>
            <dd>{organization.websiteUrl ?? 'Aucun'}</dd>
          </dl>
          {readOnly ? null : (
            <details className="ad-disclosure">
              <summary>Modifier les informations…</summary>
              <EditOrganizationForm organization={organization} />
            </details>
          )}
        </section>

        {readOnly ? null : (
          <section className="ad-org-panel ad-org-panel-quiet" aria-labelledby="delete-title">
            <h2 id="delete-title" className="ad-org-panel-title">
              Supprimer l’organisation
            </h2>
            {dependencies.length === 0 ? (
              <>
                <p className="ad-org-panel-lede">
                  Rien ne retient cette organisation : elle peut être supprimée. La suppression est
                  définitive ; le journal garde son slug.
                </p>
                <details className="ad-disclosure">
                  <summary>Supprimer…</summary>
                  <ConsoleAction
                    action={deleteOrganizationAction}
                    fields={{ organizationId: organization.organizationId }}
                    label="Supprimer définitivement"
                    variant="destructive"
                    confirm="Je confirme supprimer définitivement cette organisation"
                  />
                </details>
              </>
            ) : isSuperAdmin ? (
              <>
                <p className="ad-org-panel-lede">
                  L’organisation disparaît de PLUKA. Ce qu’elle porte est traité ainsi :
                </p>
                <dl className="ad-org-facts">
                  <dt>Retiré</dt>
                  <dd>{removedSummary(dependencies)}</dd>
                  <dt>Détaché</dt>
                  <dd>{detachedSummary(dependencies)}</dd>
                  <dt>Conservé</dt>
                  <dd>
                    Préparations et droits des coureurs, provenance des informations publiées.
                  </dd>
                </dl>
                <details className="ad-disclosure">
                  <summary>Supprimer…</summary>
                  <ConsoleAction
                    action={deleteOrganizationAction}
                    fields={{ organizationId: organization.organizationId }}
                    label="Supprimer l’organisation"
                    variant="destructive"
                    confirm="Je confirme supprimer cette organisation et détacher ce qu’elle porte"
                  />
                </details>
              </>
            ) : (
              <>
                <p className="ad-org-panel-lede">
                  Seul un super-admin peut supprimer une organisation qui porte des données :
                </p>
                <ul className="ad-org-blockers" aria-label="Ce qui retient l’organisation">
                  {dependencies.map((dependency) => (
                    <li key={dependency.kind}>{dependencyLabel(dependency)}</li>
                  ))}
                </ul>
                <p className="ad-org-panel-lede">
                  Sinon, une organisation qui a servi se termine par le statut « Terminé », dans les
                  informations ci-dessus.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
