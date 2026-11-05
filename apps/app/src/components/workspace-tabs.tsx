/**
 * Les rubriques d'un espace de travail organisateur.
 *
 * Des boutons plutôt que des liens : changer de rubrique garde ce qui est en
 * cours de saisie dans les autres.
 */
export function WorkspaceTabs<Key extends string>({
  label,
  tabs,
  current,
  onSelect,
}: {
  readonly label: string;
  readonly tabs: readonly {
    readonly key: Key;
    readonly label: string;
    readonly count?: number;
    readonly alert?: boolean;
  }[];
  readonly current: Key;
  readonly onSelect: (key: Key) => void;
}) {
  return (
    <nav aria-label={label} className="st-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className="st-tab"
          aria-current={current === tab.key ? 'true' : undefined}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
          {tab.count === undefined ? null : <span className="st-tab-count">{tab.count}</span>}
          {tab.alert === true ? (
            <span className="st-tab-error">
              <span aria-hidden="true">!</span>
              <span className="or-visually-hidden"> à corriger</span>
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
