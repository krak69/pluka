import {
  DEFAULT_SITE_ACCENT,
  SITE_HEADING_FONTS,
  SITE_MOMENTS,
  SITE_MOMENT_LABELS,
  SITE_PRACTICAL_TOPICS,
  eventSiteChecklist,
  getEventSiteEditor,
  siteUrl,
  siteVideoUrl,
  type EventSiteBlocker,
} from '@pluka/domain';
import { StatusBadge, TerrainBand, type StatusTone } from '@pluka/ui';
import Link from 'next/link';

import { HEADING_STYLE, siteFontVariables } from '@/app/site/fonts';
import { SITE_PROGRAM_VISIBLE } from '@/app/site/program';
import {
  SiteDocumentForm,
  SiteEditorForm,
  SiteGalleryPhotoForm,
  SiteGalleryRemoveForm,
  SiteImageForm,
  SiteStatusForm,
} from '@/components/site-editor-forms';
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

const STATUS: Readonly<Record<string, { label: string; tone: StatusTone }>> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  published: { label: 'En ligne', tone: 'success' },
  suspended: { label: 'Suspendu par PLUKA', tone: 'error' },
};

const NOTICES: Readonly<Record<string, string>> = {
  enregistre: 'Site enregistré.',
  'en-ligne': 'Le site est en ligne.',
  'hors-ligne': 'Le site est retiré : son adresse ne répond plus.',
  logo: 'Logo mis à jour.',
  couverture: 'Image de couverture mise à jour.',
  'image-retiree': 'Image retirée.',
  photo: 'Photo ajoutée à la galerie.',
  'photo-retiree': 'Photo retirée de la galerie.',
  'document-diffuse': 'Document diffusé : il se télécharge depuis le site.',
  'document-retire': 'Document retiré du site.',
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

  const address = event === null ? '' : siteUrl(event.slug, publicEnv().NEXT_PUBLIC_APP_URL);
  const status = STATUS[site?.status ?? 'draft'] ?? { label: 'Brouillon', tone: 'neutral' as const };
  const isLive = site?.status === 'published' && editor.blockers.length === 0;
  const canToggle = permissions.canPublish && site !== null && site.status !== 'suspended';

  return (
    <>
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
        <TerrainBand
          tone="light"
          topo
          eyebrow="Site de l’événement"
          title="Pas encore d’événement"
          body={`${editor.organizationName} n’a pas encore d’événement. Le site se règle une fois l’événement créé.`}
        />
      ) : (
        <div className={`st-editor or-frame ${siteFontVariables}`}>
          <TerrainBand
            tone="dark"
            topo
            eyebrow="Site de l’événement"
            title={event.name}
            body={
              <p className="st-address">
                {isLive ? (
                  <a href={address} target="_blank" rel="noopener">
                    {address}
                  </a>
                ) : (
                  address
                )}
              </p>
            }
            footer={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
            secondaryAction={
              isLive && canToggle ? (
                <SiteStatusForm
                  organizationId={organizationId}
                  eventId={event.id}
                  eventSlug={event.slug}
                  status="draft"
                  label="Retirer le site"
                  primary={false}
                />
              ) : undefined
            }
            primaryAction={
              isLive ? (
                <a href={address} className="pk-btn pk-button-primary" target="_blank" rel="noopener">
                  Voir le site ↗
                </a>
              ) : canToggle && site.status === 'draft' ? (
                <SiteStatusForm
                  organizationId={organizationId}
                  eventId={event.id}
                  eventSlug={event.slug}
                  status="published"
                  label="Mettre en ligne"
                  primary
                />
              ) : canToggle ? (
                <SiteStatusForm
                  organizationId={organizationId}
                  eventId={event.id}
                  eventSlug={event.slug}
                  status="draft"
                  label="Retirer le site"
                  primary={false}
                />
              ) : undefined
            }
          />

          {notice === undefined ? null : (
            <p className="pk-body st-notice" role="status">
              {notice}
            </p>
          )}

          {editor.blockers.length === 0 ? null : (
            <ul className="st-blockers">
              {editor.blockers.map((blocker) => (
                <li key={blocker}>{BLOCKERS[blocker]}</li>
              ))}
            </ul>
          )}

          {permissions.canEdit ? null : (
            <p className="pk-body st-readonly">
              Votre rôle — {teamRoleLabel(permissions.role)} — permet de voir le site, pas de le
              modifier.
            </p>
          )}
          {site === null && permissions.canPublish ? (
            <p className="pk-field-hint">Enregistrez le site une première fois pour le mettre en ligne.</p>
          ) : null}
          {permissions.canEdit && !permissions.canPublish ? (
            <p className="pk-field-hint">
              Un propriétaire ou un administrateur de l’organisation met le site en ligne.
            </p>
          ) : null}

          <SiteEditorForm
            key={event.id}
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
            moments={SITE_MOMENTS.map((moment) => ({
              value: moment,
              label: SITE_MOMENT_LABELS[moment],
            }))}
            topics={SITE_PRACTICAL_TOPICS}
            presentation={site?.presentation ?? null}
            venue={site?.venue ?? null}
            figures={editor.figures}
            links={site?.links ?? null}
            program={editor.program}
            showProgram={SITE_PROGRAM_VISIBLE}
            video={site?.video == null ? null : siteVideoUrl(site.video)}
            edition={
              editor.edition === null
                ? null
                : {
                    id: editor.edition.id,
                    year: editor.edition.year,
                    startDate: editor.edition.startDate,
                    registrationUrl: editor.edition.registrationUrl,
                  }
            }
            races={editor.races.map((race) => ({
              id: race.id,
              name: race.name,
              registrationUrl: race.registrationUrl,
            }))}
            checklist={eventSiteChecklist(editor)}
            initialTab={typeof query.onglet === 'string' ? query.onglet : undefined}
            imagesPanel={
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
            }
            galleryPanel={
              <section aria-labelledby="site-gallery" className="or-card">
                <h2 id="site-gallery" className="pk-h2">
                  Galerie
                </h2>
                <p className="pk-body">
                  Douze photos au plus, ajoutées une par une. Elles s’affichent dans l’ordre de dépôt,
                  et leur position GPS est retirée.
                </p>
                {editor.gallery.length === 0 ? null : (
                  <ul className="st-gallery">
                    {editor.gallery.map((photo, index) => (
                      <li key={photo.id} className="st-gallery-item">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={siteAssetUrl(photo.path) ?? ''}
                          alt={photo.alt ?? `Photo ${String(index + 1)}`}
                          loading="lazy"
                        />
                        {permissions.canEdit ? (
                          <SiteGalleryRemoveForm
                            organizationId={organizationId}
                            eventId={event.id}
                            eventSlug={event.slug}
                            photoId={photo.id}
                            label={photo.alt ?? `la photo ${String(index + 1)}`}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {!permissions.canEdit || editor.gallery.length >= 12 ? null : (
                  <SiteGalleryPhotoForm
                    organizationId={organizationId}
                    eventId={event.id}
                    eventSlug={event.slug}
                  />
                )}
              </section>
            }
            documentsPanel={
              <section aria-labelledby="site-documents" className="or-card">
                <h2 id="site-documents" className="pk-h2">
                  Documents
                </h2>
                <p className="pk-body">
                  Un document de l’édition n’apparaît sur le site que si vous le diffusez. Diffuser un
                  fichier le rend téléchargeable par tous.
                </p>
                {editor.documents.length === 0 ? (
                  <p className="pk-field-hint">Aucun document dans cette édition.</p>
                ) : (
                  <ul className="cr-facts">
                    {editor.documents.map((document) => (
                      <li key={document.id} className="cr-fact or-line">
                        <div className="or-line-main">
                          <span className="cr-fact-value">{document.title}</span>
                          <span className="or-row-meta">
                            {document.hasFile ? 'Fichier' : document.url === null ? 'Saisie' : 'Lien'}
                            {' · '}
                            {document.publicDownloadAt === null ? 'Non diffusé' : 'Diffusé sur le site'}
                          </span>
                        </div>
                        {permissions.canPublish && (document.hasFile || document.url !== null) ? (
                          <SiteDocumentForm
                            organizationId={organizationId}
                            eventId={event.id}
                            eventSlug={event.slug}
                            sourceId={document.id}
                            title={document.title}
                            isPublic={document.publicDownloadAt !== null}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            }
          />
        </div>
      )}
    </>
  );
}
