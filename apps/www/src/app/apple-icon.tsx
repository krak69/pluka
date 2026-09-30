import { brandColors } from '@pluka/ui';
import { MARK_PATH, MARK_VIEWBOX } from '@pluka/ui/brand';
import { ImageResponse } from 'next/og';

/**
 * Icône d'application iOS — 06_DESIGN_SYSTEM.md §143, §1321.
 *
 * Apple n'accepte qu'un PNG opaque : un favicon SVG ne lui suffit pas, et le
 * dépôt n'embarque aucun rastériseur. `next/og` rend du JSX en image, donc
 * l'icône est produite au build depuis le tracé officiel — jamais redessinée.
 *
 * Les couleurs viennent de `brandColors`, le miroir TypeScript des tokens. Il
 * existe exactement pour ces cas : « les usages qui ne peuvent pas lire une
 * variable CSS — un canvas, un SVG généré côté serveur ». Aucune valeur n'est
 * donc écrite en dur, et `tests/tokens.test.ts` garde le miroir aligné sur le
 * CSS.
 *
 * Le couple est celui du symbole sur fond sombre : Lichen sur Forêt.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: brandColors.forest,
      }}
    >
      {/* 120 × 98 conserve le rapport du symbole — 240 × 195. */}
      <svg width="120" height="98" viewBox={MARK_VIEWBOX}>
        <path fill={brandColors.lichen} d={MARK_PATH} />
      </svg>
    </div>,
    size,
  );
}
