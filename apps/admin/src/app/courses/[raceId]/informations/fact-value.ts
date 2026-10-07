/** Une valeur d'information, telle qu'on la lit : texte, puis nombre et unité. */
export function factValue(fact: {
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
}): string {
  const number =
    fact.valueNumber === null
      ? null
      : `${fact.valueNumber.toLocaleString('fr-FR')}${fact.unit === null ? '' : ` ${fact.unit}`}`;
  return [fact.valueText, number].filter((part) => part !== null).join(' · ') || '—';
}
