/**
 * Protection SSRF — docs/engines/SOURCES_EXTRACTION.md §12,
 * docs/01_ARCHITECTURE.md §32.1.
 *
 * Une URL de source vient d'une organisation ou d'un administrateur : elle est
 * hostile par défaut. Sans garde, une source pointant vers
 * `http://169.254.169.254/latest/meta-data/` ferait télécharger par le worker
 * les identifiants de la machine, et les stockerait comme contenu de source.
 *
 * Le module est **pur** : il décide, il ne résout rien. La résolution DNS est
 * une I/O, faite par l'appelant, qui repasse ensuite chaque adresse obtenue
 * ici. C'est ce qui permet de tester la politique sans réseau — et c'est aussi
 * ce qui rend possible la re-validation après redirection, exigée par §12 :
 * « la validation doit être refaite après résolution DNS et redirection ».
 */

export const URL_REJECTION_REASONS = [
  'malformed',
  'scheme_not_allowed',
  'credentials_in_url',
  'host_missing',
  'host_blocked',
  'port_not_allowed',
] as const;

export type UrlRejectionReason = (typeof URL_REJECTION_REASONS)[number];

export type UrlVerdict =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: UrlRejectionReason; readonly detail?: string };

/** §32.1 : http ou https, rien d'autre. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Ports autorisés.
 *
 * Restreindre le port ferme le balayage de services internes par une URL
 * publique qui redirigerait vers `http://interne:5432`.
 */
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/**
 * Noms d'hôte refusés avant toute résolution.
 *
 * Le filtrage par nom ne suffit pas — un domaine public peut résoudre vers
 * 127.0.0.1 — mais il évite un aller-retour DNS sur les cas évidents.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain'];

/**
 * Valide la forme d'une URL.
 *
 * Ne dit rien de sa destination : `isAllowedAddress` doit être appelé sur
 * chaque adresse résolue, et de nouveau après chaque redirection.
 */
export function validateSourceUrl(candidate: string): UrlVerdict {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: 'scheme_not_allowed', detail: url.protocol };
  }

  // `http://user:pass@hôte` : les identifiants partiraient dans les journaux
  // et dans la provenance stockée.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials_in_url' };
  }

  if (url.hostname === '') return { ok: false, reason: 'host_missing' };

  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: 'port_not_allowed', detail: url.port };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: 'host_blocked', detail: hostname };
  }

  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: 'host_blocked', detail: hostname };
  }

  // Une IP écrite directement dans l'URL est validée tout de suite : il n'y
  // aura pas de résolution DNS pour l'attraper plus tard.
  if (isIpLiteral(hostname) && !isAllowedAddress(stripBrackets(hostname))) {
    return { ok: false, reason: 'host_blocked', detail: hostname };
  }

  return { ok: true, url };
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

/**
 * Décide si une adresse résolue est atteignable.
 *
 * Les plages viennent de §12, mot pour mot :
 * 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16,
 * ::1, fc00::/7, fe80::/10.
 *
 * S'y ajoutent quelques plages que §12 ne cite pas mais qui relèvent de la
 * même intention — 0.0.0.0/8, 100.64.0.0/10 (CGNAT), multicast, broadcast :
 * aucune n'est une source de course légitime.
 */
export function isAllowedAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();

  if (normalized.includes(':')) return isAllowedIpv6(normalized);
  return isAllowedIpv4(normalized);
}

function isAllowedIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;

  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return false; // 0.0.0.0/8
  if (a === 127) return false; // boucle locale
  if (a === 10) return false; // privé
  if (a === 172 && b >= 16 && b <= 31) return false; // privé
  if (a === 192 && b === 168) return false; // privé
  if (a === 169 && b === 254) return false; // link-local, métadonnées cloud
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false; // multicast et broadcast

  return true;
}

function isAllowedIpv6(address: string): boolean {
  const normalized = stripBrackets(address);

  if (normalized === '::' || normalized === '::1') return false;

  // Adresse IPv4 encapsulée : la politique IPv4 s'applique telle quelle,
  // sinon `::ffff:127.0.0.1` contournerait tout le filtre.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (mapped?.[1] !== undefined) return isAllowedIpv4(mapped[1]);

  const firstGroup = normalized.split(':')[0] ?? '';
  const prefix = Number.parseInt(firstGroup === '' ? '0' : firstGroup, 16);

  if (Number.isNaN(prefix)) return false;
  if ((prefix & 0xfe00) === 0xfc00) return false; // fc00::/7, adresses locales uniques
  if ((prefix & 0xffc0) === 0xfe80) return false; // fe80::/10, link-local
  if ((prefix & 0xff00) === 0xff00) return false; // multicast

  return true;
}
