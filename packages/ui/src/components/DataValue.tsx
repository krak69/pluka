import type { ReactNode } from 'react';

import { classNames } from '../internal/class-names.js';
import { MicroLabel } from './MicroLabel.js';

/**
 * Valeur de donnée — 06_DESIGN_SYSTEM.md §184, et chiffres §16.
 *
 * Martian Mono et `tabular-nums` : les ETA, horaires, marges, températures,
 * km et D+ doivent pouvoir se comparer en colonne sans que les chiffres
 * dansent d'une ligne à l'autre.
 *
 * L'unité vit dans le même bloc que la valeur, jamais dans une balise
 * séparée du flux : `12` et `km` restent solidaires au retour à la ligne.
 */
export interface DataValueProps {
  readonly value: ReactNode;
  readonly label?: string;
  readonly unit?: string;
  readonly emphasis?: 'normal' | 'strong';
  readonly className?: string;
}

export function DataValue({ value, label, unit, emphasis = 'normal', className }: DataValueProps) {
  return (
    <span className={classNames('pk-data-value', className)}>
      {label === undefined ? null : <MicroLabel>{label}</MicroLabel>}
      <span
        className={classNames(
          'pk-data-value-figure',
          emphasis === 'strong' && 'pk-data-value-strong',
        )}
      >
        {value}
        {unit === undefined ? null : <span className="pk-data-value-unit">{unit}</span>}
      </span>
    </span>
  );
}
