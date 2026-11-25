import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { NutritionDialog } from '@/app/(shell)/courses/[participantRaceId]/plan/nutrition-dialog';
import type { ConditionsDraft } from '@/lib/nutrition-conditions';

/**
 * « Tes objectifs nutritionnels » — la modale de « Mes paramètres ». En-tête
 * et actions restent visibles, seul le contenu défile ; la croix ferme sans
 * enregistrer (demande du 2026-11-25).
 */
vi.mock('@/app/(shell)/courses/[participantRaceId]/plan/nutrition-actions', () => {
  const noop = async () => ({});
  return {
    saveNutritionAction: noop,
    searchCatalogueAction: async () => [],
    addCatalogueProductAction: noop,
    createProductAction: noop,
    setProductVolumeAction: noop,
  };
});

const CONDITIONS: ConditionsDraft = {
  conditions: [],
  caffeineSpread: 'auto',
  caffeineOptions: [],
  reference: null,
};

function render(): string {
  return renderToStaticMarkup(
    <NutritionDialog
      participantRaceId="pr-1"
      initial={{
        carbsGPerHour: 60,
        hydrationMlPerHour: 500,
        sodiumMgPerHour: 400,
        caffeineTotalMg: null,
        waterSharePercent: 100,
        density: 'auto',
        aidBuffer: true,
        placementMode: 'smart',
        intervalMinutes: null,
        flaskCount: 2,
        flaskCapacityMl: 500,
        bladderMl: null,
      }}
      conditions={CONDITIONS}
      triggerLabel="Mes paramètres"
      triggerClassName="pk-btn pk-button-secondary"
      submitLabel="Recalculer ma stratégie"
      products={[
        {
          id: 'p1',
          name: 'Gel 25',
          category: 'gel',
          carbsG: 25,
          sodiumMg: 50,
          caffeineMg: 0,
          hydrationMl: 0,
        },
      ]}
      selectedIds={['p1']}
    />,
  );
}

describe('la modale des objectifs', () => {
  it('a une croix dans l’en-tête, qui ferme sans enregistrer', () => {
    const html = render();
    const head = html.slice(html.indexOf('nu-dialog-head'), html.indexOf('nu-dialog-scroll'));

    expect(head).toContain('aria-label="Fermer sans enregistrer"');
    expect(head).toContain('nu-dialog-close');
  });

  it('garde en-tête et actions hors de la zone qui défile', () => {
    const html = render();
    const head = html.indexOf('nu-dialog-head');
    const scroll = html.indexOf('nu-dialog-scroll');
    const foot = html.indexOf('nu-dialog-foot');

    expect(head).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(head);
    expect(foot).toBeGreaterThan(scroll);
    const actions = html.slice(foot);
    expect(actions).toContain('Annuler');
    expect(actions).toContain('Choisir mes produits');
  });

  it('se nomme par le titre de l’étape, et un seul titre de modale', () => {
    const html = render();
    const labelledBy = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];

    expect(labelledBy).toBeDefined();
    expect(html).toContain(`id="${labelledBy ?? ''}" class="nu-dialog-title"`);
    expect(html).toContain('<p class="nu-dialog-eyebrow">Étape 1 sur 2</p>');
    expect(html.match(/<h2/g)).toHaveLength(1);
  });

  it('découpe le formulaire en parties titrées', () => {
    const html = render();

    for (const title of [
      'Tes cibles',
      'Eau et boisson d’effort',
      'Tes contenants',
      'Placement des prises',
    ]) {
      expect(html).toContain(`class="nu-part-title">${title}</h3>`);
    }
  });

  it('n’emploie pas la classe pk-button-ghost, que le Design System ne définit pas', () => {
    expect(render()).not.toContain('pk-button-ghost');
  });
});
