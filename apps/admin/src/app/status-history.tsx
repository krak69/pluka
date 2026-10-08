import { Badge } from '@pluka/ui';

import { statusLabel, type StatusDomain } from '@/components/admin-status';
import { dateTime } from '@/lib/format';

/**
 * Journal des changements de statut — 00_PRODUCT_SPEC §4.1.
 *
 * « Un changement de statut est journalisé : qui, quand, depuis quel statut. »
 * Les trois niveaux ont chacun leur table (migrations 0006 et 0022) et leur
 * enum de statut ; ce composant ne demande que ce qu'ils ont en commun, et se
 * lit donc de la même façon pour un événement, une édition ou une épreuve.
 *
 * L'auteur n'est pas affiché : `actor_user_id` est un identifiant, et le
 * résoudre en nom demanderait une lecture de plus sur `users` que l'écran
 * n'a pas — l'entrée reste la preuve, pas le trombinoscope.
 */
export interface StatusHistoryEntry {
  readonly id: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly createdAt: string;
}

/**
 * `domain` traduit les statuts et date l'entrée en clair ; sans lui, le
 * journal se lit brut — enum et instant ISO.
 */
export function StatusHistory({
  entries,
  domain,
}: {
  readonly entries: readonly StatusHistoryEntry[];
  readonly domain?: StatusDomain;
}) {
  const label = (status: string): string =>
    domain === undefined ? status : statusLabel(domain, status);

  if (entries.length === 0) {
    return (
      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Aucun changement de statut journalisé.
      </p>
    );
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            alignItems: 'center',
            padding: 'var(--space-3) 0',
            borderTop: '1px solid var(--pk-hairline)',
          }}
        >
          <Badge tone="neutral">{label(entry.fromStatus)}</Badge>
          <span aria-hidden="true">→</span>
          <Badge tone="glacier">{label(entry.toStatus)}</Badge>
          <span className="pk-label" style={{ marginLeft: 'auto' }}>
            {domain === undefined ? entry.createdAt : dateTime(entry.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
