import {
  DEFAULT_SITE_ACCENT,
  SITE_HEADING_FONTS,
  getEventSiteEditor,
  siteUrl,
  type EventSiteBlocker,
} from '@pluka/domain';
import { MicroLabel } from '@pluka/ui';
import Link from 'next/link';

import { HEADING_STYLE, siteFontVariables } from '@/app/site/fonts';
import { SiteEditorForm, SiteImageForm, SiteStatusForm } from '@/components/site-editor-forms';
import { publicEnv } from '@/lib/env';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { siteAssetUrl } from '@/lib/event-site';
import { requireSession } from '@/lib/session';
import { teamRoleLabel } from '@/lib/team-roles';

/**
 * Paramètres · Site — l'éditeur du site d'un événement (EVENT_SITE §4, §5, §8).
 *
 * Owner, admin et editor éditent ; owner et admin mettent en ligne ; un
 * viewer voit le même écran, champs désactivés, et la raison. Une
 * organisation à plusieurs événements choisit le site en tête d'écran.
 */
export const metadata = { title: 'Site' };

type SearchParams = Record<string, string | string[] | undefined>;

const NOTICES: Readonly<Record<string, string>> = {
  enregistre: 'Site enregistré.',
  'en-ligne': 'Le site est en ligne.',
  'hors-ligne': 'Le site est retiré : son adresse ne répond plus.',
  logo: 'Logo mis à jour.',
  couverture: 'Image de couverture mise à jour.',
  'image-retiree': 'Image retirée.',
};

const FONT_LABELS: Readonly<Record<(typeof SITE_HEADING_FONTS)[number], string>> = {
  archivo: 'Archivo (PLUKA)',
  'barlow-condensed': 'Barlow Condensed',
  oswald: 'Oswald',
  'bebas-neue': 'Bebas Neue',
  'space-grotesk': 'Space Grotesk',
  montserrat: 'Montserrat',
  fraunces: 'Fraunces',
  'playfair-display': 'Playfair Display',
};

const BLOCKERS: Readonly<Record<EventSiteBlocker, string>> = {
  event_not_published:
    'L’événement n’est pas publié : le site restera hors ligne tant qu’il ne l’est pas.',
  slug_not_subdomain:
    'L’adresse courte de l’événement ne peut pas servir d’adresse de site. Demandez à PLUKA de la changer.',
  no_public_race: 'Aucune épreuve publique dans cette édition : le site n’en montrera aucune.',
};

/** Aujourd'hui, en date civile à Paris : le domaine ne lit pas l'horloge (AGENTS §35). */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

export default async function SitePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  const eventSlug = typeof query.evenement === 'string' ? query.evenement : undefined;
  const notice = typeof query.fait === 'string' ? NOTICES[query.fait] : undefined;

  const session = await requireSession(`/org/${organizationId}/parametres/site`);
  const editor = await getEventSiteEditor(sessionEventSiteContext(session), {
    organizationId,
    today: today(),
    ...(eventSlug === undefined ? {} : { eventSlug }),
  });
  const { permissions, event, site } = editor;

  const fonts = SITE_HEADING_FONTS.map((value) => ({
    value,
    label: FONT_LABELS[value],
    family: HEADING_STYLE[value].family,
    uppercase: HEADING_STYLE[value].uppercase,
  }));

  return (
    <>
      <div>
        <MicroLabel>Paramètres</MicroLabel>
        <h1 className="pk-h1">Site de l’événement</h1>
        <p className="pk-body">
          Un site public pour votre événement, construit sur les informations que vous tenez dans
          PLUKA : épreuves, horaires, barrières, matériel, documents. Rien n’y est saisi deux fois.
        </p>
      </div>

      {notice === undefined ? null : (
        <p className="pk-body st-notice" role="status">
          {notice}
        </p>
      )}

      {editor.events.length > 1 ? (
        <nav aria-label="Événements" className="st-events">
          {editor.events.map((candidate) => (
            <Link
              key={candidate.id}
              href={`/org/${organizationId}/parametres/site?evenement=${candidate.slug}`}
              aria-current={candidate.id === event?.id ? 'page' : undefined}
              className="st-event"
            >
              {candidate.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {event === null ? (
        <p className="pk-body">
          {editor.organizationName} n’a pas encore d’événement. Le site se règle une fois
          l’événement créé.
        </p>
      ) : (
        <div className={`st-editor ${siteFontVariables}`}>
          {permissions.canEdit ? null : (
            <p className="pk-body st-readonly">
              Votre rôle — {teamRoleLabel(permissions.role)} — permet de voir le site, pas de le
              modifier.
            </p>
          )}

          <section aria-labelledby="site-status" className="st-status">
            <div className="st-status-head">
              <h2 id="site-status" className="pk-h2">
                {site?.status === 'published'
                  ? 'En ligne'
                  : site?.status === 'suspended'
                    ? 'Suspendu par PLUKA'
                    : 'Brouillon'}
              </h2>
              <span className="st-address">{siteUrl(event.slug, publicEnv().NEXT_PUBLIC_APP_URL)}</span>
            </div>

            {editor.blockers.length === 0 ? null : (
              <ul className="st-blockers">
                {editor.blockers.map((blocker) => (
                  <li key={blocker}>{BLOCKERS[blocker]}</li>
                ))}
              </ul>
            )}

            <div className="st-status-actions">
              {site?.status === 'published' && editor.blockers.length === 0 ? (
                <a
                  href={siteUrl(event.slug, publicEnv().NEXT_PUBLIC_APP_URL)}
                  className="pk-btn pk-button-secondary"
                  target="_blank"
                  rel="noopener"
                >
                  Voir le site ↗
                </a>
              ) : null}
              {!permissions.canPublish || site === null || site.status === 'suspended' ? null : site.status ===
                'published' ? (
                <SiteStatusForm
                  organizationId={organizationId}
                  eventId={event.id}
                  eventSlug={event.slug}
                  status="draft"
                  label="Retirer le site"
                  primary={false}
                />
              ) : (
                <SiteStatusForm
                  organizationId={organizationId}
                  eventId={event.id}
                  eventSlug={event.slug}
                  status="published"
                  label="Mettre en ligne"
                  primary
                />
              )}
            </div>
            {site === null && permissions.canPublish ? (
              <p className="pk-field-hint">Enregistrez le site une première fois pour le mettre en ligne.</p>
            ) : null}
            {permissions.canEdit && !permissions.canPublish ? (
              <p className="pk-field-hint">
                Un propriétaire ou un administrateur de l’organisation met le site en ligne.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="site-images" className="st-images">
            <h2 id="site-images" className="pk-h2">
              Logo et couverture
            </h2>
            <div className="st-images-grid">
              <SiteImageForm
                organizationId={organizationId}
                eventId={event.id}
                eventSlug={event.slug}
                kind="logo"
                label="Logo"
                hint="PNG, JPEG ou WebP, 8 Mo au plus. Un fond transparent se lit mieux sur l’en-tête clair."
                currentUrl={siteAssetUrl(site?.logoPath ?? null)}
                canEdit={permissions.canEdit}
              />
              <SiteImageForm
                organizationId={organizationId}
                eventId={event.id}
                eventSlug={event.slug}
                kind="cover"
                label="Image de couverture"
                hint="Une photo en largeur, 8 Mo au plus. Elle est recadrée en bandeau ; sa position GPS est retirée."
                currentUrl={siteAssetUrl(site?.coverPath ?? null)}
                canEdit={permissions.canEdit}
              />
            </div>
          </section>

          <SiteEditorForm
            key={`${event.id}-${site?.accentColor ?? ''}-${String(editor.sections.length)}`}
            organizationId={organizationId}
            eventId={event.id}
            eventSlug={event.slug}
            eventName={event.name}
            canEdit={permissions.canEdit}
            accentColor={site?.accentColor ?? null}
            defaultAccent={DEFAULT_SITE_ACCENT}
            headingFont={site?.headingFont ?? null}
            fonts={fonts}
            contactEmail={site?.contactEmail ?? null}
            sections={editor.sections}
            edition={
              editor.edition === null
                ? null
                : {
                    id: editor.edition.id,
                    year: editor.edition.year,
                    registrationUrl: editor.edition.registrationUrl,
                  }
            }
            races={editor.races.map((race) => ({
              id: race.id,
              name: race.name,
              registrationUrl: race.registrationUrl,
            }))}
          />
        </div>
      )}
    </>
  );
}
