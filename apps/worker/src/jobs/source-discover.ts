import { discoverSite, isAcquisitionError, isDiscoveryError } from '@pluka/sources';

import { normalizeError } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `source.discover` — SOURCES_EXTRACTION §11.1, migrations 0040 et 0042.
 *
 * Inventorie le site officiel d'un événement, borné et sans IA : pages lues et
 * documents liés. Rien d'autre — ni source, ni snapshot, ni fait. Les pages
 * et documents que l'administrateur choisit entrent ensuite dans la chaîne
 * ordinaire, où l'extraction peut faire appel à l'IA.
 *
 * Chaque requête passe par `ports.sources.fetch`, donc par la garde SSRF de
 * §12 refaite à chaque saut ; robots.txt est lu avant toute page.
 *
 * La file `pluka_sources` est partagée : ce message se reconnaît à
 * `discoveryId`, que ni la capture, ni le parsing, ni l'extraction ne portent.
 */

/** Au-delà, une panne passagère devient un échec visible plutôt qu'une attente sans fin. */
const MAX_READS = 3;

export type DiscoverOutcome =
  | { readonly kind: 'discovered'; readonly pagesRead: number }
  | { readonly kind: 'already_done' }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

export function isDiscoverMessage(message: QueueMessage): boolean {
  return typeof message.payload.discoveryId === 'string';
}

export async function handleDiscoverMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<DiscoverOutcome> {
  const discoveryId = message.payload.discoveryId;
  if (typeof discoveryId !== 'string') return { kind: 'abandoned', code: 'PAYLOAD_INVALID' };

  const url = await ports.discoveries.begin(discoveryId);
  if (url === null) {
    ports.logger.info('inventaire déjà fait', { discoveryId });
    return { kind: 'already_done' };
  }

  try {
    const outcome = await discoverSite({ read: (target) => ports.sources.fetch(target) }, url);

    await ports.discoveries.complete({
      discoveryId,
      finalUrl: outcome.inventory.finalUrl,
      inventory: outcome.inventory,
      pagesRead: outcome.pagesRead,
      discoveryVersion: outcome.inventory.version,
    });

    ports.logger.info('inventaire terminé', {
      discoveryId,
      host: new URL(outcome.inventory.finalUrl).hostname,
      pagesRead: outcome.pagesRead,
      pagesFailed: outcome.pagesFailed,
      documents: outcome.inventory.documents.length,
    });

    return { kind: 'discovered', pagesRead: outcome.pagesRead };
  } catch (error) {
    const failure = classify(error);
    const exhausted = message.readCount >= MAX_READS;

    if (failure.permanent || exhausted) {
      await ports.discoveries.fail(discoveryId, failure.code).catch(() => undefined);
      ports.logger.error('inventaire en échec', { discoveryId, code: failure.code });
      return { kind: 'abandoned', code: failure.code };
    }

    ports.logger.warn('inventaire à reprendre', { discoveryId, code: failure.code });
    return { kind: 'retry', code: failure.code };
  }
}

function classify(error: unknown): { readonly code: string; readonly permanent: boolean } {
  // Une URL refusée, un robots.txt qui interdit ou une page qui n'est pas du
  // HTML ne guériront pas en réessayant.
  if (isDiscoveryError(error)) return { code: error.code, permanent: true };
  if (isAcquisitionError(error)) return { code: error.code, permanent: error.permanent };

  const normalized = normalizeError(error);
  return { code: normalized.code, permanent: normalized.kind === 'permanent' };
}
