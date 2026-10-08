import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AddEquipmentForm } from '@/app/courses/[raceId]/equipment-forms';

vi.mock('@/app/fact-actions', () => ({
  addEquipmentAction: async () => ({}),
  reviseEquipmentAction: async () => ({}),
}));

/**
 * Saisie du matériel — migration 0045. Pas de catalogue : un nom libre. Les
 * trois exigences sont décrites ; l'épreuve de la fiche est toujours visée,
 * les autres de l'édition se cochent. La garde est en base (pgTAP 31).
 */

const MARKUP = renderToStaticMarkup(
  <AddEquipmentForm
    raceId="race-a"
    raceName="Grand Trail"
    siblings={[
      { id: 'race-b', name: 'Petit Trail' },
      { id: 'race-c', name: 'Marche' },
    ]}
  />,
);

describe('ajouter du matériel', () => {
  it('un nom libre, trois exigences décrites', () => {
    expect(MARKUP).toContain('name="label"');
    expect(MARKUP.match(/type="radio"[^>]*name="requirement"/g)).toHaveLength(3);
    for (const label of ['Obligatoire', 'Conditionnel', 'Recommandé']) {
      expect(MARKUP).toContain(label);
    }
    expect(MARKUP).not.toContain('catalogue');
  });

  it('vise l’épreuve de la fiche, et propose les autres de l’édition', () => {
    expect(MARKUP).toMatch(/type="hidden"[^>]*name="raceIds"[^>]*value="race-a"/);
    expect(MARKUP.match(/type="checkbox"[^>]*name="raceIds"/g)).toHaveLength(2);
    expect(MARKUP).toContain('Petit Trail');
  });

  it('propose « Validée PLUKA » par défaut, « Officielle » restant nommée', () => {
    expect(MARKUP).toContain('<option value="pluka_validated" selected="">');
    expect(MARKUP).toContain('réservé à un éditeur de l’organisation');
  });
});
