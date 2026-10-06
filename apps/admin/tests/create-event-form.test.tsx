import { DomainError, createEventCommandSchema, parseCommand } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CreateEventForm } from '@/app/create-event-form';
import { actionFailure, domainErrorMessage } from '@/lib/admin';
import { createEventCommand } from '@/lib/form';

/**
 * Le formulaire transmet-il vraiment ses champs à la Server Action ?
 *
 * La question n'est pas rhétorique : elle a coûté un diagnostic. En
 * développement, Next journalise un `FormData` comme `{}` — l'objet n'a aucune
 * propriété propre — et `createEventAction({}, {})` s'est lu comme « aucune
 * donnée n'arrive », alors que la saisie arrivait intacte et que le refus
 * venait de la validation.
 *
 * Ces tests relisent donc la chaîne complète, sans navigateur : le balisage
 * réellement rendu, les champs qu'il enverra, la commande que l'action en
 * tire, et le verdict du schéma du domaine. Un `name` renommé d'un côté sans
 * l'autre casse ici, pas en production.
 */

/** Saisie plausible des champs texte, par nom de champ tel que le formulaire le rend. */
const TYPED: Readonly<Record<string, string>> = {
  name: 'Trail des Cimes',
  slug: 'trail-des-cimes',
};

const ORGANIZATIONS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Wildstrubel by UTMB' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Festival des Templiers' },
] as const;

const MARKUP = renderToStaticMarkup(<CreateEventForm organizations={ORGANIZATIONS} />);

/** Champs que le navigateur enverra : tout contrôle nommé du formulaire. */
function fieldNames(markup: string): readonly string[] {
  return [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

/** Le `<select>` nommé `field`, tel que rendu. */
function selectMarkup(markup: string, field: string): string | undefined {
  return new RegExp(`<select\\b[^>]*\\bname="${field}"[^>]*>([\\s\\S]*?)</select>`).exec(
    markup,
  )?.[1];
}

/**
 * Valeur qu'un `<select>` poste sans que personne n'y touche : celle de
 * l'option marquée `selected`, sinon la première — la règle du navigateur.
 */
function defaultSelected(options: string): string {
  const values = [...options.matchAll(/<option\b([^>]*)>/g)].map((match) => match[1] as string);
  const chosen = values.find((attributes) => /\bselected\b/.test(attributes)) ?? values[0] ?? '';

  return /\bvalue="([^"]*)"/.exec(chosen)?.[1] ?? '';
}

/**
 * Ce que le navigateur postera, à partir du balisage et de la saisie.
 *
 * Un `<select>` laissé tel quel poste son option par défaut, lue dans le
 * balisage — pas une valeur supposée par le test.
 */
function submitted(overrides: Readonly<Record<string, string>> = {}): FormData {
  const form = new FormData();

  for (const field of fieldNames(MARKUP)) {
    const options = selectMarkup(MARKUP, field);
    const untouched = options === undefined ? (TYPED[field] ?? '') : defaultSelected(options);

    form.set(field, overrides[field] ?? untouched);
  }

  return form;
}

describe('organisation gestionnaire', () => {
  it('se choisit dans une liste, pas dans un champ libre', () => {
    // Le champ texte attendait un UUID : un nom saisi, ou le remplissage
    // automatique du navigateur, finissait en « UUID invalide ».
    expect(MARKUP).not.toMatch(/<input\b[^>]*\bname="organizationId"/);
    expect(selectMarkup(MARKUP, 'organizationId')).toBeDefined();
  });

  it('propose « Maintenu par PLUKA » par défaut, avec une valeur vide', () => {
    const options = selectMarkup(MARKUP, 'organizationId') ?? '';

    expect(defaultSelected(options)).toBe('');
    expect(options).toMatch(/<option value=""[^>]*>Maintenu par PLUKA<\/option>/);
  });

  it('ne propose que des organisations existantes, par leur identifiant', () => {
    const options = selectMarkup(MARKUP, 'organizationId') ?? '';

    for (const organization of ORGANIZATIONS) {
      expect(options).toContain(`<option value="${organization.id}">${organization.name}</option>`);
    }

    expect(options.match(/<option\b/g)).toHaveLength(ORGANIZATIONS.length + 1);
  });

  it('crée un événement PLUKA quand rien n’est choisi — le chemin du navigateur', () => {
    // FormData construit depuis le balisage : `organizationId=""`, exactement
    // ce que poste le formulaire laissé tel quel.
    const form = submitted();
    expect(form.get('organizationId')).toBe('');

    const command = createEventCommand(form);
    expect(command.organizationId).toBeNull();
    expect(createEventCommandSchema.safeParse(command).success).toBe(true);
  });

  it('dit qu’il n’y a aucune organisation, plutôt qu’une liste vide muette', () => {
    const empty = renderToStaticMarkup(<CreateEventForm organizations={[]} />);

    expect(empty).toContain('Aucune organisation enregistrée');
    expect(selectMarkup(empty, 'organizationId')?.match(/<option\b/g)).toHaveLength(1);
  });
});

describe('champs du formulaire', () => {
  it('porte un contrôle nommé pour chaque champ de la commande', () => {
    // Le lien entre l'écran et le domaine tient au nom des champs. On le
    // relit dans le schéma plutôt que dans une liste recopiée ici, qui
    // divergerait le jour où la commande gagne un champ.
    const rendered = fieldNames(MARKUP);

    for (const field of Object.keys(createEventCommandSchema.shape)) {
      expect(rendered).toContain(field);
    }
  });

  it('n’envoie rien que la commande ne connaisse', () => {
    // L'inverse compte autant : un champ que l'action ne lit pas est un champ
    // que l'utilisateur remplit pour rien.
    const known = Object.keys(createEventCommandSchema.shape);

    expect(fieldNames(MARKUP).filter((field) => !known.includes(field))).toEqual([]);
  });

  it('ne transmet aucune identité d’acteur', () => {
    // L'acteur vient de la session, relu côté serveur (03_PRIVACY_RLS §11).
    expect(MARKUP).not.toContain('userId');
    expect(MARKUP).not.toContain('platformRole');
  });
});

describe('transmission jusqu’à la Server Action', () => {
  it('porte la saisie jusqu’à la commande', () => {
    expect(createEventCommand(submitted())).toEqual({
      organizationId: null,
      name: 'Trail des Cimes',
      slug: 'trail-des-cimes',
    });
  });

  it('produit une commande que le domaine accepte', () => {
    // Le vrai test de bout en bout : ce que le formulaire poste passe la
    // validation du use case sans retouche.
    expect(createEventCommandSchema.safeParse(createEventCommand(submitted())).success).toBe(true);
  });

  it('rend `null` l’organisation laissée vide — §4.1', () => {
    // Un champ vide n'est pas une chaîne vide côté domaine : c'est l'absence
    // d'organisation gestionnaire, donc un événement maintenu par PLUKA.
    expect(createEventCommand(submitted()).organizationId).toBeNull();
  });

  it('accepte une organisation gestionnaire quand elle est saisie', () => {
    const organizationId = 'aaaaaaaa-0000-4000-8000-000000000001';

    expect(createEventCommand(submitted({ organizationId })).organizationId).toBe(organizationId);
  });
});

describe('refus lisible plutôt que message générique', () => {
  /** Le refus que `createEvent` opposerait à ce que le formulaire a posté. */
  function refusalFor(form: FormData): DomainError {
    try {
      parseCommand(createEventCommandSchema, createEventCommand(form), 'createEvent');
    } catch (error) {
      return error as DomainError;
    }

    throw new Error('la commande aurait dû être refusée');
  }

  function refusal(overrides: Readonly<Record<string, string>>): DomainError {
    return refusalFor(submitted(overrides));
  }

  it('nomme le champ fautif au lieu de tomber dans « erreur inattendue »', () => {
    // Le symptôme d'origine : un slug refusé s'affichait comme une panne.
    const error = refusal({ slug: 'Trail Des Cimes' });

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('validation');
    expect(error.details['slug']).toBeDefined();
    expect(domainErrorMessage(error)).not.toBe('Une erreur inattendue est survenue.');
  });

  it('rattache le message au champ, pour l’afficher contre l’`Input`', () => {
    // C'est `fieldErrors` que le formulaire lit ; sans lui, le refus resterait
    // une phrase unique au bas de l'écran (06_DESIGN_SYSTEM §35).
    const failure = actionFailure(refusal({ name: '' }));

    expect(failure.fieldErrors?.['name']).toBeDefined();
    expect(failure.fieldErrors?.['slug']).toBeUndefined();
  });

  it('signale un champ manquant plutôt que de l’ignorer', () => {
    // Le cas qu'on avait cru voir : la donnée n'arrive pas. S'il se produisait
    // vraiment, il se lirait maintenant comme tel.
    const form = submitted();
    form.delete('slug');

    const failure = actionFailure(refusalFor(form));

    expect(failure.fieldErrors?.['slug']).toBeDefined();
    expect(failure.error).toContain('slug');
  });

  it('écrit ses messages en français', () => {
    // Les messages de Zod sont anglais par défaut ; `parseCommand` passe la
    // locale. Un refus affiché tel quel doit rester lisible.
    expect(refusal({ name: '' }).details['name']).not.toMatch(/expected|received|Invalid input/);
  });
});
