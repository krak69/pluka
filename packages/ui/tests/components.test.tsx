import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Badge,
  Button,
  DataValue,
  Divider,
  IconButton,
  Input,
  Link,
  MicroLabel,
  SourceDrawer,
  SourceLink,
  StatusBadge,
  TRUST_LEVEL_LABELS,
  TrustBadge,
  type TrustLevel,
} from '../src/index.js';

/**
 * Les primitives sont rendues en balisage statique.
 *
 * Ce que ces tests protègent n'est pas l'apparence — une capture visuelle
 * s'en chargerait — mais les règles du Design System que le composant doit
 * porter lui-même : texte toujours présent, label lié, couleur jamais seule
 * porteuse de sens (06_DESIGN_SYSTEM.md §103, §137).
 */

describe('Button', () => {
  it('porte la classe de base et la variante', () => {
    const html = renderToStaticMarkup(<Button variant="primary">Générer mon Plan</Button>);

    expect(html).toContain('pk-btn');
    expect(html).toContain('pk-button-primary');
    expect(html).toContain('Générer mon Plan');
  });

  it('vaut secondaire par défaut', () => {
    // §25 : un seul CTA Lichen dominant par écran. Le défaut ne doit pas
    // fabriquer des CTA primaires par inadvertance.
    expect(renderToStaticMarkup(<Button>Annuler</Button>)).toContain('pk-button-secondary');
  });

  it('n’est pas un bouton de soumission par défaut', () => {
    // Un `<button>` sans type vaut `submit` : dans un formulaire, un bouton
    // secondaire le soumettrait sans que personne l'ait demandé.
    expect(renderToStaticMarkup(<Button>Annuler</Button>)).toContain('type="button"');
  });

  it('laisse passer un type explicite', () => {
    expect(renderToStaticMarkup(<Button type="submit">Envoyer</Button>)).toContain('type="submit"');
  });

  it('n’utilise jamais le Lichen pour une action destructive', () => {
    // §28 : un bouton rouge n'est pas un CTA primaire de page.
    const html = renderToStaticMarkup(<Button variant="destructive">Supprimer</Button>);

    expect(html).toContain('pk-button-destructive');
    expect(html).not.toContain('pk-button-primary');
  });

  it('conserve les classes de l’appelant', () => {
    expect(renderToStaticMarkup(<Button className="ma-mise-en-page">X</Button>)).toContain(
      'ma-mise-en-page',
    );
  });

  it('transmet l’état désactivé', () => {
    expect(renderToStaticMarkup(<Button disabled>X</Button>)).toContain('disabled');
  });
});

describe('IconButton', () => {
  it('nomme la commande pour un lecteur d’écran', () => {
    // §105 : une icône seule n'annonce rien.
    const html = renderToStaticMarkup(
      <IconButton label="Fermer">
        <svg />
      </IconButton>,
    );

    expect(html).toContain('aria-label="Fermer"');
  });

  it('masque l’icône, qui doublerait le nom', () => {
    const html = renderToStaticMarkup(
      <IconButton label="Fermer">
        <svg />
      </IconButton>,
    );

    expect(html).toContain('aria-hidden="true"');
  });
});

describe('Link', () => {
  it('souligne par défaut', () => {
    // §32, §103 : la couleur seule ne distingue pas un lien inline.
    expect(renderToStaticMarkup(<Link href="/x">Voir la source</Link>)).toContain('pk-link');
  });

  it('retire le soulignement pour un lien de bloc', () => {
    const html = renderToStaticMarkup(
      <Link href="/x" standalone>
        Ma saison
      </Link>,
    );

    expect(html).toContain('pk-link-standalone');
  });

  it('bascule sur fond sombre', () => {
    const html = renderToStaticMarkup(
      <Link href="/x" onDark>
        Continuer
      </Link>,
    );

    expect(html).toContain('pk-link-on-dark');
  });
});

describe('MicroLabel', () => {
  it('laisse les capitales au CSS', () => {
    // §14 : le texte reste en casse naturelle pour qu'un lecteur d'écran
    // l'énonce comme un mot, pas comme une suite de lettres.
    const html = renderToStaticMarkup(<MicroLabel>Prochaine étape</MicroLabel>);

    expect(html).toContain('Prochaine étape');
    expect(html).toContain('pk-label');
  });
});

describe('DataValue', () => {
  it('rend la valeur et son unité', () => {
    const html = renderToStaticMarkup(<DataValue value="12" unit="km" />);

    expect(html).toContain('12');
    expect(html).toContain('km');
    expect(html).toContain('pk-data-value-figure');
  });

  it('garde l’unité dans le même bloc que la valeur', () => {
    // §16, §184 : une unité rejetée à la ligne suivante n'est plus lisible
    // comme donnée.
    const html = renderToStaticMarkup(<DataValue value="1 240" unit="m D+" />);
    const figure = html.slice(html.indexOf('pk-data-value-figure'));

    expect(figure.indexOf('1 240')).toBeLessThan(figure.indexOf('m D+'));
  });

  it('affiche un micro-label quand il est fourni', () => {
    const html = renderToStaticMarkup(<DataValue value="04:12" label="Passage prévu" />);

    expect(html).toContain('pk-label');
    expect(html).toContain('Passage prévu');
  });

  it('accentue sans changer de nature', () => {
    const html = renderToStaticMarkup(<DataValue value="80" emphasis="strong" />);

    expect(html).toContain('pk-data-value-strong');
    expect(html).toContain('pk-data-value-figure');
  });
});

describe('Badge', () => {
  it('vaut neutre par défaut', () => {
    expect(renderToStaticMarkup(<Badge>Ravito</Badge>)).toContain('pk-badge-neutral');
  });

  it('porte l’Aube sur une échéance', () => {
    // §36.3, §7.2 : Aube est la prochaine échéance, jamais une erreur.
    expect(renderToStaticMarkup(<Badge tone="deadline">À faire avant vendredi</Badge>)).toContain(
      'pk-badge-deadline',
    );
  });
});

describe('TrustBadge', () => {
  const levels: readonly TrustLevel[] = [
    'official',
    'pluka_validated',
    'community',
    'external_forecast',
    'estimated',
  ];

  for (const level of levels) {
    it(`affiche le libellé humain de ${level}`, () => {
      // §87, §182 : « Le libellé humain reste visible. » La hiérarchie n'est
      // jamais portée par la seule couleur.
      const html = renderToStaticMarkup(<TrustBadge level={level} />);

      expect(html).toContain(TRUST_LEVEL_LABELS[level]);
    });
  }

  it('expose le niveau sans en faire le porteur du sens', () => {
    const html = renderToStaticMarkup(<TrustBadge level="official" />);

    expect(html).toContain('data-trust-level="official"');
    expect(html).toContain('Officielle');
  });

  it('n’emploie pas le Lichen pour qualifier une donnée', () => {
    // §7.1 : le Lichen est réservé à l'action et à la progression.
    const html = renderToStaticMarkup(<TrustBadge level="official" />);

    expect(html).not.toContain('pk-badge-active');
  });

  it('couvre les cinq niveaux de la Charte', () => {
    expect(Object.keys(TRUST_LEVEL_LABELS)).toHaveLength(5);
  });
});

describe('StatusBadge', () => {
  it('rend toujours un texte, jamais un rond seul', () => {
    // §185 : « Ne jamais retourner uniquement un rond vert. »
    const html = renderToStaticMarkup(<StatusBadge tone="success">Complet</StatusBadge>);

    expect(html).toContain('Complet');
  });

  it('masque la pastille, qui double le texte', () => {
    const html = renderToStaticMarkup(<StatusBadge tone="warning">À vérifier</StatusBadge>);

    expect(html).toContain('pk-badge-dot');
    expect(html).toContain('aria-hidden="true"');
  });

  it('masque aussi une icône fournie', () => {
    const html = renderToStaticMarkup(
      <StatusBadge tone="error" icon={<svg />}>
        Annulée
      </StatusBadge>,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Annulée');
  });
});

describe('Divider', () => {
  it('rend une séparation structurelle', () => {
    // §19 : les filets font partie de l'identité fonctionnelle.
    expect(renderToStaticMarkup(<Divider />)).toContain('<hr');
  });
});

describe('Input', () => {
  it('lie le label au champ', () => {
    // §106 : un placeholder n'est pas un label.
    const html = renderToStaticMarkup(<Input id="email" label="Adresse email" />);

    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('Adresse email');
  });

  it('décrit le champ par son aide', () => {
    const html = renderToStaticMarkup(
      <Input id="email" label="Adresse email" hint="Aucun mot de passe." />,
    );

    expect(html).toContain('aria-describedby="email-hint"');
    expect(html).toContain('id="email-hint"');
  });

  it('annonce l’erreur autrement que par une bordure', () => {
    // §35 : « Ne pas utiliser une bordure rouge seule. »
    const html = renderToStaticMarkup(
      <Input id="email" label="Adresse email" error="Adresse invalide." />,
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('Adresse invalide.');
  });

  it('conserve l’aide et l’erreur ensemble', () => {
    // Sinon l'utilisateur perdrait la consigne au moment précis où il en a le
    // plus besoin.
    const html = renderToStaticMarkup(
      <Input id="email" label="Adresse" hint="Format attendu." error="Adresse invalide." />,
    );

    expect(html).toContain('aria-describedby="email-hint email-error"');
  });

  it('ne déclare rien quand le champ est valide', () => {
    const html = renderToStaticMarkup(<Input id="email" label="Adresse email" />);

    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
  });
});

describe('SourceLink', () => {
  it('affiche « Voir la source » par défaut', () => {
    // §186 : le libellé est porté par le composant, pour qu'une information
    // sourcée propose le même mot sur tous les écrans.
    const html = renderToStaticMarkup(<SourceLink />);

    expect(html).toContain('Voir la source');
    expect(html).toContain('pk-source-link');
  });

  it('rend un bouton sans destination, un lien avec', () => {
    // Ouvrir un tiroir n'est pas une navigation : un `<a>` sans `href` n'est
    // pas atteignable au clavier.
    expect(renderToStaticMarkup(<SourceLink />)).toContain('<button');
    expect(renderToStaticMarkup(<SourceLink href="https://exemple.test" />)).toContain('<a');
  });
});

describe('SourceDrawer', () => {
  const complete = (
    <SourceDrawer
      type="url"
      title="Règlement 2026"
      organization="Organisation Test"
      sectionLabel="Règlement › Assistance"
      pageLabel="14"
      excerpt="Assistance autorisée uniquement à Lenk."
      date="2026-03-01"
      trustLevel="official"
      href="https://exemple.test/reglement"
    />
  );

  it('affiche les sept éléments de §86', () => {
    const html = renderToStaticMarkup(complete);

    for (const expected of [
      'url',
      'Règlement 2026',
      'Organisation Test',
      'Règlement › Assistance',
      '14',
      'Assistance autorisée uniquement à Lenk.',
      '2026-03-01',
      'Officielle',
    ]) {
      expect(html, `§86 : ${expected} absent du tiroir`).toContain(expected);
    }
  });

  it('reste replié : la source ne pollue pas l’écran principal', () => {
    // §86 : « accessible depuis l'information critique sans polluer l'écran
    // principal ». Le `<details>` est fermé tant qu'on ne l'ouvre pas.
    const html = renderToStaticMarkup(complete);

    expect(html).toContain('<details');
    expect(html).not.toContain('open=""');
  });

  it('omet un champ absent plutôt que d’afficher un tiret', () => {
    // « selon disponibilité » : une page inconnue n'est pas une page vide.
    const html = renderToStaticMarkup(<SourceDrawer title="Guide coureur" />);

    expect(html).toContain('Guide coureur');
    expect(html).not.toContain('Page');
    expect(html).not.toContain('Organisme');
  });

  it('accueille une provenance propre au contexte', () => {
    // Le locator et l'adresse du block dépendent du format : le tiroir les
    // reçoit en enfants plutôt que d'imposer une liste de champs.
    const html = renderToStaticMarkup(
      <SourceDrawer title="Règlement">
        <span>block n° 12</span>
      </SourceDrawer>,
    );

    expect(html).toContain('block n° 12');
  });

  it('marque un lien externe comme tel', () => {
    const html = renderToStaticMarkup(complete);

    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });
});
