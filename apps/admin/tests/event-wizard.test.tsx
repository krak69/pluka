import { createEventWithEditionCommandSchema } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DocumentsForm } from '@/app/evenements/[eventId]/documents/documents-form';
import { EventWizard } from '@/app/evenements/nouveau/event-wizard';
import { CREATION_STEPS } from '@/components/creation-stepper';
import { createEventWithEditionCommand } from '@/lib/form';
import { slugify } from '@/lib/slug';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
}));

/**
 * Création classique d'un événement — 0042 : le balisage rendu, les champs
 * qu'il enverra, la commande que l'action en tire, et le verdict du schéma du
 * domaine. Un `name` renommé d'un côté sans l'autre casse ici.
 */

const MARKUP = renderToStaticMarkup(
  <EventWizard step={1} organizations={[{ id: 'o', name: 'Org A' }]} />,
);

function fieldNames(markup: string): readonly string[] {
  return [
    ...new Set(
      [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ].sort();
}

describe('parcours de création', () => {
  it('annonce les cinq étapes, la première courante', () => {
    expect(CREATION_STEPS).toEqual([
      'Événement',
      'Édition',
      'Épreuves',
      'Vérification',
      'Documents',
    ]);
    expect(MARKUP).toMatch(/aria-current="step"[^>]*>.*?Événement/);
    expect(MARKUP).toContain('Étape 1 sur 5');
  });

  it('un écran par étape : les trois autres sont masquées', () => {
    expect(MARKUP.match(/<section[^>]*hidden=""/g)).toHaveLength(3);
  });

  it('nomme ses champs comme la commande, une première épreuve prête', () => {
    expect(fieldNames(MARKUP)).toEqual([
      'edition.endDate',
      'edition.slug',
      'edition.startDate',
      'edition.year',
      'event.city',
      'event.name',
      'event.officialWebsiteUrl',
      'event.organizationId',
      'event.slug',
      'races.0.distanceKm',
      'races.0.elevationGainM',
      'races.0.name',
      'races.0.slug',
      'races.0.startDate',
      'races.0.startTime',
      'races.0.timezone',
    ]);
  });

  it('une seule action dominante : continuer', () => {
    expect(MARKUP.match(/pk-button-primary/g)).toHaveLength(1);
    expect(MARKUP).toContain('Continuer');
    expect(MARKUP).not.toContain('Précédent');
  });

  it('replie les réglages rarement changés, sans les cacher', () => {
    expect(MARKUP).toContain('<summary>Adresse de l’événement');
    expect(MARKUP).toContain('Réglages avancés — slug, fuseau horaire');
  });

  it('la saisie devient une commande que le domaine accepte', () => {
    const form = new FormData();
    for (const [name, value] of Object.entries({
      'event.name': 'Trail des Cimes',
      'event.slug': 'trail-des-cimes',
      'event.organizationId': '',
      'event.city': '',
      'event.officialWebsiteUrl': 'https://trail-des-cimes.example',
      'edition.year': '2027',
      'edition.slug': '2027',
      'edition.startDate': '2027-06-12',
      'edition.endDate': '',
      'races.0.name': 'Grand Tour',
      'races.0.slug': 'grand-tour',
      'races.0.distanceKm': '82.5',
      'races.0.elevationGainM': '',
      'races.0.startDate': '2027-06-12',
      'races.0.startTime': '05:00',
      'races.0.timezone': 'Europe/Paris',
    })) {
      form.set(name, value);
    }

    const command = createEventWithEditionCommand(form);
    const parsed = createEventWithEditionCommandSchema.safeParse(command);

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(command).toMatchObject({
      event: { organizationId: null, city: null },
      edition: { endDate: null },
      races: [{ distanceKm: 82.5, elevationGainM: null }],
    });
  });

  it('propose un slug sans accent ni tiret double', () => {
    expect(slugify('  Ultra-Trail du Mont-Blanc® 2027 ')).toBe('ultra-trail-du-mont-blanc-2027');
  });
});

describe('étape 4 : pages et documents', () => {
  it('coche ce qui est suggéré, laisse le reste au choix, accepte des PDF', () => {
    const markup = renderToStaticMarkup(
      <DocumentsForm
        eventId="00000000-0000-4000-8000-000000000150"
        editionId="00000000-0000-4000-8000-000000000151"
        found={[
          {
            url: 'https://trail.example/reglement.pdf',
            title: 'Règlement',
            kind: 'pdf',
            checked: true,
          },
          { url: 'https://trail.example/presse', title: 'Presse', kind: 'page', checked: false },
        ]}
        races={[
          { id: 'a', name: 'Grand Tour' },
          { id: 'b', name: 'Crête' },
        ]}
      />,
    );

    expect(markup).toContain(
      'checked="" value="pdf|https://trail.example/reglement.pdf|Règlement"',
    );
    expect(markup).toContain('name="documents" value="page|https://trail.example/presse|Presse"');
    expect(markup).toContain('accept="application/pdf,.pdf"');
    expect(markup).toContain('name="scope.https://trail.example/reglement.pdf"');
    // Par défaut, un document concerne toutes les épreuves ; le choix est nommé.
    expect(markup).toContain('<option value="" selected="">Toutes les épreuves (2)</option>');
    expect(markup).toContain('label="Une épreuve en particulier"');
    expect(markup).toMatch(/class="ad-doc-scope-label"[^>]*>Concerne/);
  });
});
