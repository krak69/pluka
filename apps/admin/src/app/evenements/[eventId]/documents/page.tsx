import {
  getEditionAdministration,
  getEventAdministration,
  getEventInventory,
  listEditionDocuments,
  type EventDiscoveryView,
} from '@pluka/domain';
import { TerrainBand } from '@pluka/ui';
import Link from 'next/link';

import { refreshEventInventoryAction } from '@/app/discovery-actions';
import { AdminEmpty, AdminPageHeader, Chip, type ChipTone } from '@/components/admin-page';
import { factCategoryLabel } from '@/components/admin-status';
import { AutoRefresh } from '@/components/auto-refresh';
import { CreationStepper } from '@/components/creation-stepper';
import {
  eventDiscoveryContext,
  redirectOnDomainError,
  redirectOnReadError,
  requireAdminContext,
} from '@/lib/admin';
import { requireSession } from '@/lib/session';

import { DocumentsForm, type FoundDocument } from './documents-form';

/**
 * Documents de course — étape 4 de la création (0040, 0042).
 *
 * En haut, ce qu'on peut analyser : les pages et documents relevés sur le site
 * officiel (inventaire sans IA), et le dépôt de PDF. En bas, ce que la chaîne
 * a fait de chaque source, puis « PLUKA a identifié » : les informations en
 * attente de revue, par catégorie. Elles se relisent dans /validation, avec
 * leur preuve — rien n'est publié d'ici.
 *
 * L'analyse des sources choisies est la seule étape où l'IA peut intervenir,
 * dans l'extraction (SOURCES_EXTRACTION §21) ; sans IA configurée, seule la
 * passe déterministe tourne.
 *
 * Les traces GPX relevées ne partent pas d'ici : une trace appartient à une
 * épreuve, et se dépose sur sa fiche.
 */
export const metadata = { title: 'Documents de course' };

const STATES: Readonly<Record<string, { label: string; tone: ChipTone }>> = {
  queued: { label: 'En file', tone: 'neutral' },
  reading: { label: 'Analyse en cours', tone: 'glacier' },
  done: { label: 'Analysé', tone: 'success' },
  failed: { label: 'Erreur', tone: 'error' },
};

/** Raisons d'échec de la lecture du site, traduites. Un code inconnu s'affiche tel quel. */
const FAILURES: Readonly<Record<string, string>> = {
  ROBOTS_DISALLOWED: 'Le fichier robots.txt du site interdit sa lecture automatique.',
  NOT_HTML: 'L’adresse donnée n’est pas une page web.',
  URL_REJECTED: 'Cette adresse n’est pas acceptée.',
  ADDRESS_BLOCKED: 'Cette adresse mène vers un réseau interdit.',
  NETWORK: 'Le site ne répond pas.',
  TIMEOUT: 'Le site a mis trop de temps à répondre.',
  HTTP_ERROR: 'Le site a répondu par une erreur.',
  TOO_MANY_REDIRECTS: 'Le site redirige trop de fois.',
  CONTENT_TOO_LARGE: 'La page est trop volumineuse.',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function foundOf(
  discovery: EventDiscoveryView | null,
  declared: ReadonlySet<string | null>,
): FoundDocument[] {
  const inventory = discovery?.inventory ?? null;
  if (inventory === null) return [];

  return [
    ...inventory.pages.map((page) => ({
      url: page.url,
      title: page.title ?? page.url,
      kind: 'page' as const,
      // Accueil et pages qui parlent de course cochées ; chacune est une analyse.
      checked: page.suggested,
    })),
    ...inventory.documents
      .filter((document) => document.kind === 'pdf')
      .map((document) => ({
        url: document.url,
        title: document.title,
        kind: 'pdf' as const,
        // Règlement, roadbook, guide : cochés ; communiqués et dossiers, au choix.
        checked: document.suggested,
      })),
  ].filter((document) => !declared.has(document.url));
}

export default async function EventDocumentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly eventId: string }>;
  readonly searchParams: Promise<{ readonly edition?: string; readonly creation?: string }>;
}) {
  const { eventId } = await params;
  const { edition: editionParam, creation } = await searchParams;
  const returnTo = `/evenements/${eventId}/documents`;

  const course = await requireAdminContext(returnTo);
  const { event, editions } = await getEventAdministration(course, { eventId }).catch(
    redirectOnDomainError,
  );

  const edition =
    editions.find((candidate) => candidate.id === editionParam) ??
    [...editions].sort((left, right) => right.year - left.year)[0];

  if (edition === undefined) {
    return (
      <main className="ad-page ad-org">
        <Link href={`/evenements/${eventId}`} className="pk-link">
          {event.name}
        </Link>
        <AdminPageHeader title="Documents de course" />
        <AdminEmpty icon="Files" title="Aucune édition.">
          <p>Les documents se rattachent à une édition : crée-la d’abord sur la fiche.</p>
        </AdminEmpty>
      </main>
    );
  }

  const context = eventDiscoveryContext(await requireSession(returnTo));
  const [{ races }, state, discovery] = await Promise.all([
    getEditionAdministration(course, { editionId: edition.id }).catch(redirectOnDomainError),
    listEditionDocuments(context, { editionId: edition.id }).catch(redirectOnReadError),
    getEventInventory(context, { eventId }).catch(redirectOnReadError),
  ]);

  // Ce qui est déjà déclaré n'est plus proposé.
  const declared = new Set(state.documents.map((document) => document.url));
  const found = foundOf(discovery, declared);
  const reading = discovery?.status === 'queued' || discovery?.status === 'running';
  const traces =
    discovery?.inventory?.documents.filter((document) => document.kind === 'gpx') ?? [];
  const working = state.documents.some(
    (document) => document.state === 'queued' || document.state === 'reading',
  );
  const pending = state.pendingByCategory.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <main className="ad-page ad-org">
      <Link href={`/evenements/${eventId}`} className="pk-link">
        {event.name}
      </Link>

      {/*
        Juste après la création, le parcours continue dans le même bandeau :
        c'est l'étape 5. En dehors, l'écran est un écran de fiche ordinaire.
      */}
      {creation === '1' ? (
        <TerrainBand
          tone="dark"
          topo
          eyebrow="Événement créé · étape 5 sur 5"
          title={event.name}
          body={
            <div className="ad-wizard-done">
              <p>
                Dernière étape : choisis les pages et documents à analyser. PLUKA en extrait les
                informations de course — barrières, matériel, ravitaillements, assistance — que tu
                valides avant toute publication.
              </p>
            </div>
          }
          footer={`Édition ${edition.year} · ${races.length} épreuve${races.length > 1 ? 's' : ''}`}
        />
      ) : (
        <AdminPageHeader
          title="Documents de course"
          lede={`Édition ${edition.year}. Choisis les pages et documents à analyser : PLUKA en extrait les informations de course — barrières, matériel, ravitaillements, assistance — que tu valides avant toute publication.`}
        />
      )}

      {creation === '1' ? <CreationStepper current={5} reached={5} /> : null}

      <AutoRefresh active={reading || working} />

      {discovery === null ? null : (
        <section className="ad-org-panel" aria-labelledby="site-title">
          <h2 id="site-title" className="ad-org-panel-title">
            Site officiel · {hostOf(discovery.finalUrl ?? discovery.siteUrl)}
          </h2>
          {reading ? (
            <p className="pk-body ad-measure" aria-live="polite">
              Lecture du site en cours : pages et documents liés. L’écran se met à jour seul.
            </p>
          ) : null}
          {discovery.status === 'failed' ? (
            <p className="ad-notice" role="alert">
              {FAILURES[discovery.errorCode ?? ''] ??
                `Le site n’a pas pu être lu (${discovery.errorCode ?? 'erreur inconnue'}).`}
            </p>
          ) : null}
          {discovery.status === 'ready' ? (
            <p className="pk-body ad-measure">
              {discovery.pagesRead ?? 0} page{(discovery.pagesRead ?? 0) > 1 ? 's' : ''} lue
              {(discovery.pagesRead ?? 0) > 1 ? 's' : ''},{' '}
              {discovery.inventory?.documents.length ?? 0} document
              {(discovery.inventory?.documents.length ?? 0) > 1 ? 's' : ''} relevé
              {(discovery.inventory?.documents.length ?? 0) > 1 ? 's' : ''}. Ils sont proposés
              ci-dessous ; les pages et documents de course sont cochés.
            </p>
          ) : null}
          {reading ? null : (
            <form action={refreshEventInventoryAction}>
              <input type="hidden" name="eventId" value={eventId} />
              <button type="submit" className="pk-btn pk-button-secondary">
                Relire le site
              </button>
            </form>
          )}
        </section>
      )}

      <DocumentsForm
        eventId={eventId}
        editionId={edition.id}
        found={found}
        races={races.map((race) => ({ id: race.id, name: race.name }))}
      />

      {traces.length === 0 ? null : (
        <section className="ad-org-panel" aria-labelledby="traces-title">
          <h2 id="traces-title" className="ad-org-panel-title">
            Traces GPX trouvées
          </h2>
          <p className="ad-org-panel-lede">
            Une trace appartient à une épreuve : télécharge-la, puis dépose-la sur la fiche de
            l’épreuve.
          </p>
          <ul className="ad-similar">
            {traces.map((trace) => (
              <li key={trace.url}>
                <a href={trace.url} className="pk-link" target="_blank" rel="noreferrer">
                  {trace.title}
                </a>
              </li>
            ))}
          </ul>
          {races.length === 0 ? null : (
            <ul className="ad-similar">
              {races.map((race) => (
                <li key={race.id}>
                  <Link href={`/courses/${race.id}`} className="pk-link">
                    Déposer le GPX de {race.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="ad-org-panel" aria-labelledby="analysis-title">
        <h2 id="analysis-title" className="ad-org-panel-title">
          Analyse des sources
        </h2>

        {state.documents.length === 0 ? (
          <p className="pk-body ad-measure">Rien n’est encore analysé pour cette édition.</p>
        ) : (
          <ul className="ad-rows" aria-live="polite">
            {state.documents.map((document) => {
              const style = STATES[document.state] ?? STATES['queued']!;
              return (
                <li key={document.sourceId} className="ad-row ad-doc-state">
                  <div className="ad-row-main">
                    <span className="ad-row-title">{document.title}</span>
                    <span className="ad-row-meta">
                      {document.uploaded
                        ? 'Fichier déposé'
                        : document.url === null
                          ? ''
                          : hostOf(document.url)}
                      {document.raceName === null ? '' : ` · ${document.raceName}`}
                    </span>
                  </div>
                  <span className="ad-row-meta">
                    {document.state === 'done'
                      ? `${document.candidateCount} information${document.candidateCount > 1 ? 's' : ''}`
                      : null}
                  </span>
                  <Chip tone={style.tone}>{style.label}</Chip>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ad-org-panel" aria-labelledby="findings-title">
        <h2 id="findings-title" className="ad-org-panel-title">
          PLUKA a identifié
        </h2>
        {pending === 0 ? (
          <p className="pk-body ad-measure">
            {working
              ? 'Rien encore : les sources sont en cours de lecture.'
              : 'Aucune information en attente de revue pour cette édition.'}
          </p>
        ) : (
          <>
            <ul className="ad-findings">
              {state.pendingByCategory.map((entry) => (
                <li key={entry.category} className="ad-finding">
                  <span className="ad-finding-count">{entry.count}</span>
                  <span>{factCategoryLabel(entry.category)}</span>
                </li>
              ))}
            </ul>
            <div className="ad-form-actions">
              <Link href="/validation" className="pk-btn pk-button-primary">
                Vérifier ces informations
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
