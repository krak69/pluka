import type { NutritionCatalogueRow } from '@pluka/db';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ActionState } from '@/app/actions';
import { ProductTable } from '@/app/produits/product-table';
import { ConsoleAction, ConsoleNotice } from '@/components/console-action';
import { consoleNotice } from '@/lib/console-notice';
import { checked } from '@/lib/form';

/**
 * Gestes de la console — lot 4b, migration 0029.
 *
 * La garde et l'audit sont prouvés par pgTAP 18, la confirmation et la
 * traduction des refus par les tests du domaine. Ce fichier relit ce que
 * l'écran envoie et ce qu'il montre :
 *
 * - un geste destructeur porte une case de confirmation, décochée ;
 * - les gestes suivent le statut de l'objet, et chacun poste sa propre cible ;
 * - le compte rendu d'un succès ne recopie jamais l'URL.
 */

const noop = async (): Promise<ActionState> => ({});

function forms(markup: string): readonly string[] {
  return [...markup.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1] as string);
}

function hidden(form: string): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};

  for (const tag of form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(tag[0])?.[1];
    const value = /\bvalue="([^"]*)"/.exec(tag[0])?.[1];
    if (name !== undefined && value !== undefined) fields[name] = value;
  }

  return fields;
}

describe('ConsoleAction', () => {
  it('rend un bouton de soumission et les champs cachés, sans case quand le geste n’en demande pas', () => {
    const markup = renderToStaticMarkup(
      <ConsoleAction action={noop} fields={{ jobId: 'j-1' }} label="Relancer" />,
    );

    expect(hidden(markup)).toEqual({ jobId: 'j-1' });
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Relancer<\/button>/);
    expect(markup).not.toContain('type="checkbox"');
  });

  it('un geste destructeur porte une case de confirmation, décochée et étiquetée', () => {
    const markup = renderToStaticMarkup(
      <ConsoleAction
        action={noop}
        fields={{ reportId: 'r-1' }}
        label="Masquer le contenu"
        variant="destructive"
        confirm="Je confirme masquer ce message aux participants"
      />,
    );

    const checkbox = /<input[^>]*type="checkbox"[^>]*>/.exec(markup)?.[0] ?? '';
    const id = /\bid="([^"]+)"/.exec(checkbox)?.[1];

    expect(checkbox).toContain('name="confirmed"');
    expect(checkbox).not.toContain('checked');
    expect(id).toBeDefined();
    expect(markup).toContain(`for="${id}"`);
    expect(markup).toContain('pk-button-destructive');
  });

  it('n’affiche aucun refus avant soumission', () => {
    const markup = renderToStaticMarkup(
      <ConsoleAction action={noop} fields={{}} label="Valider" />,
    );

    expect(markup).not.toContain('role="alert"');
  });
});

describe('case de confirmation postée', () => {
  it('vaut true seulement cochée', () => {
    const on = new FormData();
    on.set('confirmed', 'on');

    expect(checked(on, 'confirmed')).toBe(true);
    expect(checked(new FormData(), 'confirmed')).toBe(false);

    const forged = new FormData();
    forged.set('confirmed', 'true');
    expect(checked(forged, 'confirmed')).toBe(false);
  });
});

describe('compte rendu d’un geste', () => {
  it('dit chacun des gestes', () => {
    for (const fait of [
      'masque',
      'classe',
      'relance',
      'valide',
      'archive',
      'organisation',
      'organisation-modifiee',
      'organisation-inchangee',
      'organisation-supprimee',
      'invitation-envoyee',
      'invitation-revoquee',
      'role-modifie',
      'role-inchange',
      'membre-retire',
      'acces-admin-retire',
    ]) {
      expect(consoleNotice({ fait }), fait).not.toBeNull();
    }
  });

  it('dit combien de signalements un masquage a clos', () => {
    expect(consoleNotice({ fait: 'masque', n: '3' })).toContain('3 signalements');
    expect(consoleNotice({ fait: 'relance', n: '2' })).toContain('n° 2');
  });

  it('n’affiche rien pour un code inconnu, et ne recopie jamais l’URL', () => {
    expect(consoleNotice({})).toBeNull();
    expect(consoleNotice({ fait: '<script>' })).toBeNull();

    for (const n of ['<b>9</b>', '-1', '0', '123456', '2;drop']) {
      const notice = consoleNotice({ fait: 'masque', n }) ?? '';
      expect(notice).not.toContain(n);
    }
  });

  it('s’annonce comme un statut, sans voler le focus', () => {
    expect(renderToStaticMarkup(<ConsoleNotice notice="Fait." />)).toContain('role="status"');
    expect(renderToStaticMarkup(<ConsoleNotice notice={null} />)).toBe('');
  });
});

function product(
  productId: string,
  status: NutritionCatalogueRow['status'],
  inUse = false,
): NutritionCatalogueRow {
  return {
    productId,
    brand: 'Marque',
    name: `Gel ${productId}`,
    variant: null,
    category: 'gel',
    status,
    servingQuantity: 32,
    servingUnit: 'g',
    carbsG: 22,
    sodiumMg: 50,
    caffeineMg: 0,
    hydrationMl: 0,
    caloriesKcal: 90,
    tags: [],
    imageUrl: null,
    purchaseUrl: null,
    purchaseIsAffiliate: false,
    inUse,
    updatedAt: '2026-10-01T10:00:00Z',
  };
}

describe('gestes de la Banque Nutrition', () => {
  it('À vérifier : une fiche se valide, se refuse ou se supprime — ces deux-là confirmés', () => {
    const markup = renderToStaticMarkup(
      <ProductTable products={[product('p-draft', 'draft')]} tab="a-verifier" />,
    );
    const posted = forms(markup);

    expect(posted).toHaveLength(3);
    expect(hidden(posted[0] as string)).toEqual({ productId: 'p-draft', from: 'a-verifier' });
    expect(posted[0]).toContain('>Valider<');
    expect(posted[0]).not.toContain('type="checkbox"');
    expect(posted[1]).toContain('name="confirmed"');
    expect(posted[2]).toContain('name="confirmed"');
    expect(markup).toMatch(/<details[^>]*><summary>Refuser…<\/summary>/);
    expect(markup).toContain('href="/produits/p-draft"');
  });

  it('une fiche utilisée par un coureur ne se supprime pas : elle s’archive seulement', () => {
    const markup = renderToStaticMarkup(
      <ProductTable products={[product('p-valid', 'validated', true)]} tab="catalogue" />,
    );
    const posted = forms(markup);

    expect(posted).toHaveLength(1);
    expect(hidden(posted[0] as string)).toEqual({ productId: 'p-valid', from: 'catalogue' });
    expect(markup).toMatch(/<summary>Archiver…<\/summary>/);
    expect(markup).not.toContain('Supprimer…');
  });

  it('une fiche archivée n’a pas de désarchivage ; inutilisée, elle se supprime', () => {
    const markup = renderToStaticMarkup(
      <ProductTable products={[product('p-archived', 'archived')]} tab="archives" />,
    );

    expect(forms(markup)).toHaveLength(1);
    expect(markup).toContain('Supprimer…');
    expect(markup).not.toContain('Archiver…');
  });

  it('un lien affilié se dit, toujours, à côté du lien (§98)', () => {
    const affiliate = {
      ...product('p-aff', 'validated'),
      purchaseUrl: 'https://exemple.test/a',
      purchaseIsAffiliate: true,
    };
    const plain = { ...product('p-plain', 'validated'), purchaseUrl: 'https://exemple.test/b' };

    const markup = renderToStaticMarkup(<ProductTable products={[affiliate, plain]} tab="tous" />);

    expect(markup.match(/lien affilié/g)).toHaveLength(1);
    expect(markup.match(/>Acheter/g)).toHaveLength(2);
  });
});
