import { Badge, type BadgeTone } from './Badge.js';

/**
 * Niveau de confiance — 06_DESIGN_SYSTEM.md §87, §150, §182.
 *
 * « Ne pas rendre la hiérarchie uniquement par couleur. Texte toujours
 * présent. » Le libellé est donc porté par le composant, pas laissé à
 * l'appelant : il ne peut ni être omis, ni être remplacé par une pastille.
 *
 * La confiance n'est pas une note en étoiles (§150) — cinq niveaux nommés,
 * rien de plus.
 */
export type TrustLevel =
  'official' | 'pluka_validated' | 'community' | 'external_forecast' | 'estimated';

export const TRUST_LEVEL_LABELS: Readonly<Record<TrustLevel, string>> = {
  official: 'Officielle',
  pluka_validated: 'Validée PLUKA',
  community: 'Communautaire',
  external_forecast: 'Prévision externe',
  estimated: 'Estimation',
};

/*
 * La teinte accompagne le libellé, elle ne le remplace pas. Une officielle
 * s'appuie sur le Glacier plutôt que sur le Lichen : le Lichen est réservé à
 * l'action et à la progression (§7.1), pas à la qualification d'une donnée.
 */
const TRUST_LEVEL_TONE: Readonly<Record<TrustLevel, BadgeTone>> = {
  official: 'glacier',
  pluka_validated: 'glacier',
  community: 'neutral',
  external_forecast: 'neutral',
  estimated: 'neutral',
};

export interface TrustBadgeProps {
  readonly level: TrustLevel;
  readonly className?: string;
}

export function TrustBadge({ level, className }: TrustBadgeProps) {
  return (
    <Badge tone={TRUST_LEVEL_TONE[level]} data-trust-level={level} className={className}>
      {TRUST_LEVEL_LABELS[level]}
    </Badge>
  );
}
