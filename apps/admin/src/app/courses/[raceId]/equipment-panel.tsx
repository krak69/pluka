import type { RaceEquipmentItem } from '@pluka/domain';
import Link from 'next/link';

import { REQUIREMENT_OPTIONS } from '@/app/courses/[raceId]/equipment-requirements';
import { Chip } from '@/components/admin-page';

/**
 * Le matériel de l'épreuve, en lecture — migrations 0045, 0047.
 *
 * Il se gère depuis l'écran événement, une case par épreuve : un règlement
 * vaut le plus souvent pour toute l'édition. Ici, ce que les coureurs de
 * cette épreuve lisent, groupé dans l'ordre où ils le lisent.
 */

const TRUST: Readonly<
  Record<string, { readonly label: string; readonly tone: 'success' | 'glacier' | 'neutral' }>
> = {
  official: { label: 'Officielle', tone: 'success' },
  pluka_validated: { label: 'Validée PLUKA', tone: 'glacier' },
  community: { label: 'Communauté', tone: 'neutral' },
};

const GROUPS = [
  ...REQUIREMENT_OPTIONS.map((option) => ({ key: option.value, title: option.label })),
  { key: 'unknown', title: 'À préciser — exigence non indiquée' },
] as const;

export function EquipmentPanel({
  items,
  pendingFromSources,
  manageHref,
}: {
  /** `null` si la lecture a échoué : le panneau le dit plutôt que d'afficher une liste vide. */
  readonly items: readonly RaceEquipmentItem[] | null;
  /** Matériel lu dans les sources, en attente de revue (0046). `null` si la file est illisible. */
  readonly pendingFromSources: number | null;
  /** Le panneau Matériel de l'événement, où la gestion se fait. */
  readonly manageHref: string;
}) {
  const live = items?.filter((item) => !item.retired) ?? [];

  return (
    <section className="ad-org-panel" id="materiel" aria-labelledby="equipment-title">
      <div className="ad-equipment-head">
        <h2 id="equipment-title" className="ad-org-panel-title">
          Matériel
        </h2>
        <Link href={manageHref} className="pk-btn pk-button-secondary">
          Gérer depuis l’événement
        </Link>
      </div>
      <p className="ad-org-panel-lede">
        Ce que les coureurs de cette épreuve lisent. Le matériel se gère pour toute l’édition,
        épreuve par épreuve, depuis l’écran de l’événement.
      </p>

      {pendingFromSources === null || pendingFromSources === 0 ? null : (
        <p className="ad-equipment-pending">
          <strong>
            {pendingFromSources} proposition{pendingFromSources > 1 ? 's' : ''} de matériel
          </strong>{' '}
          lue{pendingFromSources > 1 ? 's' : ''} dans les sources, à relire avant publication.{' '}
          <Link href={manageHref} className="pk-link">
            Relire dans le tableau de l’événement
          </Link>
        </p>
      )}

      {items === null ? (
        <p className="ad-org-panel-lede">Le matériel n’a pas pu être lu : réessaie dans un instant.</p>
      ) : live.length === 0 ? (
        <p className="ad-org-panel-lede">Aucun matériel pour cette épreuve.</p>
      ) : (
        GROUPS.map((group) => {
          const rows = live.filter((item) => (item.requirement ?? 'unknown') === group.key);
          if (rows.length === 0) return null;
          return (
            <div key={group.key} className="ad-equipment-group">
              <h3 className="ad-org-subtitle">
                {group.title} <span className="ad-row-meta">· {rows.length}</span>
              </h3>
              <ul className="ad-rows">
                {rows.map((item) => {
                  const trust = TRUST[item.trustLevel] ?? {
                    label: item.trustLevel,
                    tone: 'neutral' as const,
                  };
                  const meta = [
                    item.condition,
                    item.detail,
                    item.source === null ? null : `Source : ${item.source.title}`,
                  ].filter((part): part is string => part !== null);
                  return (
                    <li key={item.factId} className="ad-row">
                      <div className="ad-row-main">
                        <span className="ad-row-title">{item.label}</span>
                        {meta.length === 0 ? null : (
                          <span className="ad-row-meta">{meta.join(' · ')}</span>
                        )}
                      </div>
                      <Chip tone={trust.tone}>{trust.label}</Chip>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
