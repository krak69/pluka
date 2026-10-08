import type { RaceEquipmentItem } from '@pluka/domain';

import {
  AddEquipmentForm,
  REQUIREMENT_OPTIONS,
  ReviseEquipmentForm,
  type SiblingRace,
} from '@/app/courses/[raceId]/equipment-forms';
import { restoreFactAction, retireFactAction } from '@/app/fact-actions';
import { Chip } from '@/components/admin-page';
import { ConsoleAction } from '@/components/console-action';

/**
 * Panneau « Matériel » de la fiche épreuve — migration 0045.
 *
 * Groupé par exigence, dans l'ordre où le coureur doit le lire : obligatoire,
 * conditionnel, recommandé. Un matériel extrait d'un document sans exigence
 * précisée a sa propre section, « À préciser » : la lecture ne le range nulle
 * part de son chef (§82). Les retirés sont en bas, restaurables.
 *
 * Chaque ligne dit son nom, sa condition, sa précision, sa source et son
 * niveau de confiance ; corriger crée une version, retirer se défait.
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

function EquipmentRow({
  raceId,
  item,
}: {
  readonly raceId: string;
  readonly item: RaceEquipmentItem;
}) {
  const trust = TRUST[item.trustLevel] ?? { label: item.trustLevel, tone: 'neutral' as const };
  const meta = [
    item.condition === null ? null : item.condition,
    item.detail,
    item.source === null
      ? null
      : `Source : ${item.source.title}${item.source.page === null ? '' : `, p. ${item.source.page}`}`,
    `version ${item.versionNumber}`,
  ].filter((part): part is string => part !== null);

  return (
    <li className="ad-row ad-equipment-row">
      <div className="ad-row-main">
        <span className="ad-row-title">{item.label}</span>
        <span className="ad-row-meta">{meta.join(' · ')}</span>
      </div>
      <Chip tone={trust.tone}>{trust.label}</Chip>
      {item.retired ? (
        <div className="ad-row-actions">
          <ConsoleAction
            action={restoreFactAction}
            fields={{ raceId, factId: item.factId, back: 'materiel' }}
            label="Restaurer"
          />
        </div>
      ) : (
        <details className="ad-row-disclosure ad-disclosure">
          <summary>Modifier ou retirer…</summary>
          <div className="ad-equipment-edit">
            <ReviseEquipmentForm raceId={raceId} item={item} />
            <ConsoleAction
              action={retireFactAction}
              fields={{ raceId, factId: item.factId, back: 'materiel' }}
              label="Retirer ce matériel"
              variant="destructive"
              confirm="Je confirme retirer ce matériel : il disparaît pour les coureurs, son historique est conservé."
            />
          </div>
        </details>
      )}
    </li>
  );
}

export function EquipmentPanel({
  raceId,
  raceName,
  items,
  siblings,
}: {
  readonly raceId: string;
  readonly raceName: string;
  /** `null` si la lecture a échoué : le panneau le dit plutôt que d'afficher une liste vide. */
  readonly items: readonly RaceEquipmentItem[] | null;
  readonly siblings: readonly SiblingRace[];
}) {
  const live = items?.filter((item) => !item.retired) ?? [];
  const retired = items?.filter((item) => item.retired) ?? [];

  return (
    <section className="ad-org-panel" id="materiel" aria-labelledby="equipment-title">
      <h2 id="equipment-title" className="ad-org-panel-title">
        Matériel
      </h2>
      <p className="ad-org-panel-lede">
        Le matériel tel que le règlement le nomme. Il apparaît aux coureurs dans les informations de
        course, et une modification leur est signalée. Rien n’est publié sans décision humaine.
      </p>

      {items === null ? (
        <p className="ad-org-panel-lede">
          Le matériel n’a pas pu être lu : réessaie dans un instant.
        </p>
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
                {rows.map((item) => (
                  <EquipmentRow key={item.factId} raceId={raceId} item={item} />
                ))}
              </ul>
            </div>
          );
        })
      )}

      <details className="ad-advanced" open={items !== null && live.length === 0}>
        <summary>Ajouter du matériel</summary>
        <AddEquipmentForm raceId={raceId} raceName={raceName} siblings={siblings} />
      </details>

      {retired.length === 0 ? null : (
        <details className="ad-advanced">
          <summary>Matériel retiré · {retired.length}</summary>
          <ul className="ad-rows">
            {retired.map((item) => (
              <EquipmentRow key={item.factId} raceId={raceId} item={item} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
