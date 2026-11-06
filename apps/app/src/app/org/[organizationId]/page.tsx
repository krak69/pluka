import {
  DomainError,
  getEventSiteEditor,
  listCandidatesForReview,
  listOrganizationTeam,
  organizerAttention,
  siteUrl,
  type AttentionKind,
  type AttentionTarget,
  type InformationReviewSummary,
  type TeamInvitationsSummary,
} from '@pluka/domain';
import { TerrainBand } from '@pluka/ui';
import Link from 'next/link';

import { editionDateRange } from '@/app/site/format';
import { publicEnv } from '@/lib/env';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { courseHref, factReviewContext } from '@/lib/organizer-course';
import { requireSession } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';

/**
 * Accueil organisateur — 00_PRODUCT_SPEC §26, 06_DESIGN_SYSTEM §125.
 *
 * Un centre d'attention, pas un tableau de bord : la conclusion dans la scène,
 * puis trois ou quatre sujets. Pas de graphique, pas de grille de chiffres.
 */
export const metadata = { title: 'Accueil' };

type SearchParams = Record<string, string | string[] | undefined>;

const KIND_LABELS: Readonly<Record<AttentionKind, string>> = {
  todo: 'À faire',
  check: 'À vérifier',
  know: 'À savoir',
};

/** Aujourd'hui, en date civile à Paris : le domaine ne lit pas l'horloge (AGENTS §35). */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

export default async function OrganizerHomePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  const eventSlug = typeof query.evenement === 'string' ? query.evenement : undefined;

  const session = await requireSession(`/org/${organizationId}`);
  const [editor, team] = await Promise.all([
    getEventSiteEditor(sessionEventSiteContext(session), {
      organizationId,
      today: today(),
      ...(eventSlug === undefined ? {} : { eventSlug }),
    }),
    // Seul un propriétaire lit l'équipe : pour les autres, le sujet n'existe pas.
    listOrganizationTeam(sessionTeamContext(session), { organizationId }).catch(
      (error: unknown) => {
        if (error instanceof DomainError && error.code === 'forbidden') return null;
        throw error;
      },
    ),
  ]);

  const { event, edition, site } = editor;
  const invitations: TeamInvitationsSummary | null =
    team === null
      ? null
      : {
          failed: team.invitations.filter((item) => item.sendFailed).length,
          expired: team.invitations.filter((item) => item.status === 'expired' && !item.sendFailed)
            .length,
        };

  // Un lecteur ne tranche rien : pour lui, le sujet n'existe pas.
  const pending = editor.permissions.canEdit
    ? await Promise.all(
        editor.races.map(async (race) => {
          const candidates = await listCandidatesForReview(factReviewContext(session), {
            raceId: race.id,
            limit: 100,
          });
          const toDecide = candidates.filter((candidate) =>
            ['detected', 'needs_review', 'conflict'].includes(candidate.status),
          );
          const conflicts = toDecide.filter((candidate) => candidate.status === 'conflict').length;
          return { slug: race.slug, conflicts, toCheck: toDecide.length - conflicts };
        }),
      )
    : [];
  const firstRace =
    pending.find((race) => race.conflicts > 0) ?? pending.find((race) => race.toCheck > 0);
  const review: InformationReviewSummary | null =
    firstRace === undefined
      ? null
      : {
          conflicts: pending.reduce((total, race) => total + race.conflicts, 0),
          toCheck: pending.reduce((total, race) => total + race.toCheck, 0),
          raceSlug: firstRace.slug,
        };

  const items = organizerAttention(editor, invitations, today(), review);

  if (event === null) {
    return (
      <TerrainBand
        tone="dark"
        topo
        eyebrow={editor.organizationName}
        title="Votre premier événement arrive"
        body="L’accueil se remplira dès que PLUKA aura créé votre événement."
      />
    );
  }

  const address = siteUrl(event.slug, publicEnv().NEXT_PUBLIC_APP_URL);
  const siteBase = `/org/${organizationId}/parametres/site?evenement=${event.slug}`;
  const hrefOf = (target: AttentionTarget): string => {
    if (target.screen === 'live') return address;
    if (target.screen === 'team') return `/org/${organizationId}/parametres/equipe`;
    if (target.screen === 'informations') {
      return courseHref(organizationId, 'informations', {
        event: event.slug,
        year: edition?.year,
        race: target.raceSlug,
        panel: 'a-verifier',
      });
    }
    return `${siteBase}&onglet=${target.tab}`;
  };

  // « À savoir » n'attend rien de l'organisation : seul le reste se compte.
  const topicCount = items.filter((item) => item.kind !== 'know').length;
  const first = items[0]?.action ?? null;
  const summary = [
    `${String(editor.races.length)} ${editor.races.length > 1 ? 'épreuves' : 'épreuve'}`,
    site?.status === 'published' && editor.blockers.length === 0
      ? 'Site en ligne'
      : site?.status === 'suspended'
        ? 'Site suspendu'
        : 'Site hors ligne',
    ...(team === null
      ? []
      : [`${String(team.members.length)} ${team.members.length > 1 ? 'membres' : 'membre'}`]),
  ].join(' · ');

  return (
    <div className="st-editor or-frame">
      <TerrainBand
        tone="dark"
        topo
        eyebrow={
          edition === null
            ? 'Accueil'
            : `Édition ${String(edition.year)} · ${editionDateRange(edition.startDate, edition.endDate)}`
        }
        title={event.name}
        body={
          topicCount === 0
            ? 'Rien d’urgent aujourd’hui.'
            : topicCount === 1
              ? 'Un sujet mérite votre attention.'
              : `${String(topicCount)} sujets méritent votre attention.`
        }
        footer={<span className="or-summary">{summary}</span>}
        primaryAction={
          first === null ? undefined : first.target.screen === 'live' ? (
            <a href={address} className="pk-btn pk-button-primary" target="_blank" rel="noopener">
              {first.label} ↗
            </a>
          ) : (
            <Link href={hrefOf(first.target)} className="pk-btn pk-button-primary">
              {first.label}
            </Link>
          )
        }
      />

      {editor.events.length > 1 ? (
        <nav aria-label="Événements" className="st-events">
          {editor.events.map((candidate) => (
            <Link
              key={candidate.id}
              href={`/org/${organizationId}?evenement=${candidate.slug}`}
              aria-current={candidate.id === event.id ? 'page' : undefined}
              className="st-event"
            >
              {candidate.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="attention-title" className="or-attention">
        <h2 id="attention-title" className="pk-label">
          À retenir
        </h2>
        <ol>
          {items.map((item, index) => (
            <li key={item.key} className="or-topic" data-kind={item.kind}>
              <span className="or-topic-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="or-topic-main">
                <p className="pk-label or-topic-kind">{KIND_LABELS[item.kind]}</p>
                <h3 className="or-topic-title">{item.title}</h3>
                <p className="pk-body">{item.text}</p>
              </div>
              {/* Le premier geste est déjà l'appel à l'action de la scène : un seul par zone. */}
              {index === 0 || item.action === null ? null : item.action.target.screen === 'live' ? (
                <a
                  href={address}
                  className="pk-btn pk-button-secondary"
                  target="_blank"
                  rel="noopener"
                >
                  {item.action.label} ↗
                </a>
              ) : (
                <Link href={hrefOf(item.action.target)} className="pk-btn pk-button-secondary">
                  {item.action.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
