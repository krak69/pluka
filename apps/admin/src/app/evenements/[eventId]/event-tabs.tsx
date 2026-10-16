import Link from 'next/link';

/**
 * Les onglets d'un événement : la vue d'ensemble, puis les deux outils de
 * travail qui en ont chacun besoin de toute la largeur — le tableau du
 * matériel et les documents de course.
 *
 * Une pastille dit ce qui attend dans un onglet, pour qu'on le voie sans y
 * aller : les propositions de matériel à relire, les documents en erreur.
 */

export type EventTab = 'overview' | 'materiel' | 'documents';

export function EventTabs({
  eventId,
  current,
  editionId,
  equipmentPending,
  documentsDue,
}: {
  readonly eventId: string;
  readonly current: EventTab;
  /** L'édition affichée, gardée d'un onglet à l'autre quand ce n'est pas la plus récente. */
  readonly editionId?: string | null;
  readonly equipmentPending?: number | null;
  readonly documentsDue?: number | null;
}) {
  const base = `/evenements/${eventId}`;
  const edition = editionId === undefined || editionId === null ? '' : `?edition=${editionId}`;
  const tabs: readonly {
    readonly key: EventTab;
    readonly label: string;
    readonly href: string;
    readonly badge: number | null;
    readonly badgeLabel: string;
  }[] = [
    { key: 'overview', label: 'Vue d’ensemble', href: base, badge: null, badgeLabel: '' },
    {
      key: 'materiel',
      label: 'Matériel',
      href: `${base}/materiel${edition}`,
      badge: equipmentPending ?? null,
      badgeLabel: 'propositions à relire',
    },
    {
      key: 'documents',
      label: 'Documents',
      href: `${base}/documents${edition}`,
      badge: documentsDue ?? null,
      badgeLabel: 'documents en erreur',
    },
  ];

  return (
    <nav className="ad-event-tabs" aria-label="Sections de l’événement">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              className="ad-event-tab"
              aria-current={tab.key === current ? 'page' : undefined}
            >
              {tab.label}
              {tab.badge === null || tab.badge === 0 ? null : (
                <span className="ad-event-tab-badge">
                  {tab.badge}
                  <span className="pk-visually-hidden"> {tab.badgeLabel}</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
