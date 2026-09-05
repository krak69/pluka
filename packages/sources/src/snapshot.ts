import { createHash } from 'node:crypto';

/**
 * Snapshot — docs/engines/SOURCES_EXTRACTION.md §6, §9, §10.
 *
 * « Une Source est une référence logique durable. Un Snapshot est le contenu
 * réellement utilisé à un instant donné. »
 *
 * Ce module décrit un snapshot à partir des octets capturés. Il ne parse rien,
 * n'extrait rien, n'appelle aucune IA : à ce stade le contenu est une suite
 * d'octets dont on retient l'empreinte et la provenance.
 */

/** §11 étapes 6 et 7 : limites de la capture. */
export const ACQUISITION_LIMITS = {
  /** Taille maximale téléchargée. Au-delà, la capture est refusée, pas tronquée. */
  maxBytes: 25 * 1024 * 1024,
  /** Délai maximal d'une requête, en millisecondes. */
  timeoutMs: 20000,
  /** §11 étape 5 : les redirections sont limitées, et chacune est revalidée. */
  maxRedirects: 3,
} as const;

/**
 * Empreinte de contenu — §10.
 *
 * « SHA-256(content bytes) ». Sur les octets, jamais sur une chaîne décodée :
 * un même document réencodé en UTF-8 depuis Latin-1 produirait la même chaîne
 * et une empreinte différente des octets réellement stockés, ce qui casserait
 * la reproductibilité que §10 attend.
 */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Provenance d'une capture — §9.
 *
 * Tout ce qui est connu au moment de la capture, et rien d'autre. Les champs
 * de traitement — version de parseur, blocs, chunks — appartiennent aux
 * étapes suivantes et ne figurent pas ici : un snapshot est immuable, et ce
 * qui viendra plus tard vit dans la couche de traitement privée.
 */
export interface CaptureProvenance {
  /** §11 étape 9 : l'URL finale, après redirections. */
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly sizeBytes: number;
  readonly contentHash: string;
}

export interface Capture {
  readonly bytes: Uint8Array;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
}

export function describeCapture(capture: Capture): CaptureProvenance {
  return {
    finalUrl: capture.finalUrl,
    httpStatus: capture.httpStatus,
    // `application/pdf; charset=binary` : on garde le type, pas les paramètres,
    // qui varient d'un serveur à l'autre sans changer la nature du contenu.
    contentType: normalizeContentType(capture.contentType),
    sizeBytes: capture.bytes.byteLength,
    contentHash: contentHash(capture.bytes),
  };
}

function normalizeContentType(value: string | null): string | null {
  if (value === null) return null;

  const type = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return type === '' ? null : type;
}

/**
 * Décision de déduplication — §10.
 *
 * « Éviter les snapshots strictement identiques. »
 *
 * Recapturer une source inchangée est le cas courant : un règlement est relu
 * chaque semaine et ne bouge pas. Créer un snapshot à chaque passage
 * gonflerait l'historique et, surtout, ferait croire à un changement là où il
 * n'y en a aucun — or §36 fait de la détection de changement une
 * fonctionnalité produit.
 *
 * La comparaison porte sur l'empreinte, pas sur l'URL : §10 note que « deux
 * URLs différentes peuvent produire le même hash sans devenir la même
 * Source », et la réciproque vaut ici — c'est bien au sein d'une même Source
 * que l'on déduplique.
 */
export type SnapshotDecision =
  | { readonly kind: 'create'; readonly reason: 'first_capture' | 'content_changed' }
  | { readonly kind: 'reuse'; readonly reason: 'identical_content' };

export function decideSnapshot(
  freshHash: string,
  knownHashes: readonly string[],
): SnapshotDecision {
  if (knownHashes.length === 0) return { kind: 'create', reason: 'first_capture' };
  if (knownHashes.includes(freshHash)) return { kind: 'reuse', reason: 'identical_content' };

  return { kind: 'create', reason: 'content_changed' };
}

/**
 * Chemin de stockage d'un snapshot.
 *
 * Dérivé de l'empreinte : deux captures identiques visent le même objet, et
 * le stockage devient adressable par contenu. Le chemin est donc stable et
 * reproductible, ce qui aide au diagnostic (§10).
 *
 * L'identifiant de source préfixe le chemin pour que les objets restent
 * rangés par source, et qu'une purge de source soit un préfixe à supprimer.
 */
export function snapshotStoragePath(sourceId: string, hash: string): string {
  return `sources/${sourceId}/${hash}`;
}
