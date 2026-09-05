import { lookup } from 'node:dns/promises';
import {
  ACQUISITION_LIMITS,
  AcquisitionError,
  isAllowedAddress,
  validateSourceUrl,
} from '@pluka/sources';

import type { Capture } from '@pluka/sources';

/**
 * Récupération web — docs/engines/SOURCES_EXTRACTION.md §11, §12.
 *
 * §11 donne la séquence : valider l'URL, appliquer les protections SSRF,
 * résoudre la destination, refuser localhost et les réseaux privés, limiter
 * les redirections, appliquer un timeout, limiter la taille, capturer le
 * contenu et l'URL finale.
 *
 * Deux points méritent d'être explicites.
 *
 * **La validation est refaite à chaque saut.** §12 : « la validation doit être
 * refaite après résolution DNS et redirection ». Une URL publique peut
 * rediriger vers `http://169.254.169.254/`, et un domaine public peut résoudre
 * vers 127.0.0.1. Valider une seule fois à l'entrée ne protège de rien.
 *
 * **Les redirections sont suivies à la main.** `fetch` sait le faire, mais
 * suivrait sans repasser par la garde : `redirect: 'manual'` est ce qui rend
 * la revalidation possible.
 *
 * Reste une fenêtre connue, non fermée ici : entre la résolution DNS et la
 * connexion, un DNS hostile peut changer sa réponse (rebinding). La fermer
 * demande de se connecter à l'adresse validée et de porter le nom d'hôte dans
 * l'en-tête `Host`, ce que `fetch` n'expose pas. C'est une limite assumée de
 * ce lot, pas un oubli.
 */

export interface FetchOptions {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
}

/**
 * Vérifie qu'une URL est autorisée, forme puis destination résolue.
 *
 * Toutes les adresses renvoyées par le DNS sont contrôlées, pas seulement la
 * première : un enregistrement peut mêler une adresse publique et une adresse
 * privée, et le système d'exploitation ne choisit pas forcément celle qu'on a
 * regardée.
 */
async function assertReachable(candidate: string): Promise<URL> {
  const verdict = validateSourceUrl(candidate);

  if (!verdict.ok) {
    throw new AcquisitionError('URL_REJECTED', 'URL refusée par la politique', verdict.reason);
  }

  let addresses: readonly { address: string }[];

  try {
    addresses = await lookup(verdict.url.hostname, { all: true });
  } catch {
    throw new AcquisitionError('NETWORK', 'résolution DNS impossible');
  }

  if (addresses.length === 0) {
    throw new AcquisitionError('NETWORK', 'aucune adresse résolue');
  }

  for (const { address } of addresses) {
    if (!isAllowedAddress(address)) {
      // Le détail journalisé est la plage, pas l'adresse complète : suffisant
      // pour diagnostiquer, sans recopier une cible interne dans les logs.
      throw new AcquisitionError('ADDRESS_BLOCKED', 'destination interdite', verdict.url.hostname);
    }
  }

  return verdict.url;
}

/**
 * Lit le corps en respectant la limite de taille.
 *
 * La limite est appliquée **pendant** la lecture, pas après : télécharger
 * intégralement un fichier de 4 Go pour ensuite le refuser reviendrait à
 * offrir le déni de service qu'on prétend éviter. `Content-Length` est un
 * indice, pas une garantie — un serveur peut mentir, ou l'omettre.
 */
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AcquisitionError('CONTENT_TOO_LARGE', 'taille annoncée au-delà de la limite');
  }

  const body = response.body;
  if (body === null) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;

  const reader = body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        throw new AcquisitionError('CONTENT_TOO_LARGE', 'contenu au-delà de la limite');
      }

      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export async function fetchSource(url: string, options: FetchOptions = {}): Promise<Capture> {
  const maxBytes = options.maxBytes ?? ACQUISITION_LIMITS.maxBytes;
  const timeoutMs = options.timeoutMs ?? ACQUISITION_LIMITS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? ACQUISITION_LIMITS.maxRedirects;

  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // Revalidation à chaque saut : c'est l'exigence de §12.
    const target = await assertReachable(current);

    let response: Response;

    try {
      response = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: '*/*', 'user-agent': 'PLUKA-SourceFetcher/1.0' },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new AcquisitionError('TIMEOUT', 'délai dépassé');
      }
      throw new AcquisitionError('NETWORK', 'requête impossible');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) {
        throw new AcquisitionError('HTTP_ERROR', 'redirection sans destination');
      }

      current = new URL(location, target).toString();
      continue;
    }

    if (!response.ok) {
      throw new AcquisitionError('HTTP_ERROR', 'réponse en erreur', String(response.status));
    }

    return {
      bytes: await readLimited(response, maxBytes),
      // §11 étape 9 : c'est la destination réellement lue qui est conservée.
      finalUrl: target.toString(),
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
    };
  }

  throw new AcquisitionError('TOO_MANY_REDIRECTS', 'trop de redirections');
}
