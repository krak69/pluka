import type { RaceEquipmentItem } from '@pluka/domain';
import Link from 'next/link';

import { REQUIREMENT_OPTIONS } from '@/app/courses/[raceId]/equipment-requirements';
import { RequirementGlyph } from '@/app/evenements/[eventId]/equipment-glyph';
import { AdminIcon } from '@/components/admin-icon';

/**
 * Le matériel de l'épreuve, en lecture — migrations 0045 à 0048.
 *
 * Ce que les coureurs de cette épreuve lisent, groupé dans l'ordre où ils le
 * lisent, avec les pictos du tableau de l'événement : le même matériel se
 * reconnaît d'un écran à l'autre. On ne le modifie pas ici — un règlement
 * vaut le plus souvent pour toute l'édition, et c'est le tableau de
 * l'événement qui le règle, épreuve par épreuve.
 */

const TRUST: Readonly<Record<string, string>> = {
  official: 'Officielle',
  pluka_validated: 'Validée PLUKA',
  community: 'Communauté',
};

const GROUPS: readonly {
  readonly key: 'mandatory' | 'conditional' | 'recommended' | 'unknown';
  readonly title: string;
  readonly lede: string;
}[] = [
  ...REQUIREMENT_OPTIONS.map((option) => ({
    key: option.value,
    title: option.label,
    lede: option.description,
  })),
  {
    key: 'unknown',
    title: 'À préciser',
    lede: 'La source ne dit pas l’exigence : les coureurs le lisent tel quel.',
  },
];

function EquipmentLine({ item }: { readonly item: RaceEquipmentItem }) {
  const source =
    item.source === null
      ? null
      : `${item.source.title}${item.source.page === null ? '' : `, p. ${String(item.source.page)}`}`;

  return (
    <li className="ad-race-gear-item">
      <span className="ad-race-gear-glyph">
        <RequirementGlyph value={item.requirement ?? 'unknown'} />
      </span>
      <span className="ad-race-gear-body">
        <span className="ad-race-gear-name">{item.label}</span>
        {item.requirement === 'conditional' && item.condition !== null ? (
          <span className="ad-race-gear-condition">{item.condition}</span>
        ) : null}
        {item.detail === null ? null : <span className="ad-race-gear-detail">{item.detail}</span>}
      </span>
      <span className="ad-race-gear-meta">
        {source === null ? null : <span>{source}</span>}
        <span>{TRUST[item.trustLevel] ?? item.trustLevel}</span>
      </span>
    </li>
  );
}

export function EquipmentPanel({
  raceName,
  items,
  pendingFromSources,
  manageHref,
}: {
  readonly raceName: string;
  /** `null` si la lecture a échoué : le panneau le dit plutôt que d'afficher une liste vide. */
  readonly items: readonly RaceEquipmentItem[] | null;
  /** Matériel lu dans les sources, en attente de revue (0046). `null` si la file est illisible. */
  readonly pendingFromSources: number | null;
  /** L'onglet Matériel de l'événement, où la gestion se fait. */
  readonly manageHref: string;
}) {
  const live = items?.filter((item) => !item.retired) ?? [];
  const groupOf = (item: RaceEquipmentItem) => item.requirement ?? 'unknown';

  return (
    <section className="ad-org-panel ad-race-gear" id="materiel" aria-labelledby="equipment-title">
      <header className="ad-race-gear-head">
        <div>
          <h2 id="equipment-title" className="ad-org-panel-title">
            Matériel
          </h2>
          <p className="ad-org-panel-lede">
            Ce que lisent les coureurs de {raceName}. Il se règle pour toute l’édition, épreuve par
            épreuve, dans l’onglet Matériel de l’événement.
          </p>
        </div>
        <Link href={manageHref} className="pk-btn pk-button-secondary ad-race-gear-manage">
          Modifier dans l’événement
          <AdminIcon name="ArrowRight" size={16} />
        </Link>
      </header>

      {live.length === 0 ? null : (
        <dl className="ad-gear-counts ad-race-gear-counts">
          {REQUIREMENT_OPTIONS.map((option) => (
            <div key={option.value} className="ad-gear-count" data-requirement={option.value}>
              <dt>{option.label}</dt>
              <dd>{live.filter((item) => item.requirement === option.value).length}</dd>
            </div>
          ))}
        </dl>
      )}

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
        <p className="ad-gear-empty">Le matériel n’a pas pu être lu. Réessaie dans un instant.</p>
      ) : live.length === 0 ? (
        <div className="ad-gear-empty ad-race-gear-empty">
          <p>Aucun matériel pour cette épreuve.</p>
          <Link href={manageHref} className="pk-link">
            Le renseigner dans l’événement — ou le reprendre de l’édition précédente
          </Link>
        </div>
      ) : (
        <div className="ad-race-gear-groups">
          {GROUPS.map((group) => {
            const rows = live
              .filter((item) => groupOf(item) === group.key)
              .sort((left, right) => left.label.localeCompare(right.label, 'fr'));
            if (rows.length === 0) return null;
            return (
              <section
                key={group.key}
                className="ad-race-gear-group"
                data-requirement={group.key}
                aria-label={`${group.title} · ${String(rows.length)}`}
              >
                <h3 className="ad-race-gear-group-title">
                  <span className="ad-race-gear-group-glyph">
                    <RequirementGlyph value={group.key} />
                  </span>
                  {group.title}
                  <span className="ad-grid-group-count">{rows.length}</span>
                  <span className="ad-race-gear-group-lede">{group.lede}</span>
                </h3>
                <ul className="ad-race-gear-list">
                  {rows.map((item) => (
                    <EquipmentLine key={item.factId} item={item} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
