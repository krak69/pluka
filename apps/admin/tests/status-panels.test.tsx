import {
  allowedEditionTransitions,
  allowedEventTransitions,
  allowedRaceTransitions,
  changeEditionStatusCommandSchema,
  changeEventStatusCommandSchema,
} from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RaceStatusPanel } from '@/app/courses/[raceId]/forms';
import { EditionStatusPanel, EventStatusPanel } from '@/app/evenements/[eventId]/forms';
import { StatusHistory } from '@/app/status-history';
import { text } from '@/lib/form';

/**
 * Transitions de statut sur les trois niveaux de la chaîne — §4.1.
 *
 * L'écran Race en avait, les écrans Event et Edition non : la chaîne était
 * donc impossible à publier depuis l'interface, alors que publier une épreuve
 * exige une édition diffusée sous un événement publié.
 *
 * Ces tests rendent les trois panneaux et relisent dans le balisage ce qu'un
 * administrateur recevra : les transitions proposées, l'autorité annoncée, et
 * les champs que le formulaire transmettra à la Server Action.
 */

const EVENT_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
const EDITION_ID = 'aaaaaaaa-0000-4000-8000-000000000012';
const RACE_ID = 'aaaaaaaa-0000-4000-8000-000000000013';

/** Les valeurs que le navigateur postera : un `<input type="hidden">` par champ. */
function hiddenFields(markup: string): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};

  for (const tag of markup.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(tag[0])?.[1];
    const value = /\bvalue="([^"]*)"/.exec(tag[0])?.[1];
    if (name !== undefined && value !== undefined) fields[name] = value;
  }

  return fields;
}

/**
 * Un jeu de champs par formulaire.
 *
 * Le panneau rend un `<form>` par transition — chacun poste sa propre cible.
 * Les lire d'un bloc mélangerait deux soumissions qui ne partent jamais
 * ensemble.
 */
function submissions(markup: string): readonly Readonly<Record<string, string>>[] {
  return [...markup.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((match) =>
    hiddenFields(match[1] as string),
  );
}

/** Statuts cibles proposés, dans l'ordre du balisage. */
function offeredTargets(markup: string): readonly string[] {
  return [...markup.matchAll(/<input\b[^>]*name="status"[^>]*value="([^"]*)"/g)].map(
    (match) => match[1] as string,
  );
}

describe('écran Event', () => {
  const markup = renderToStaticMarkup(
    <EventStatusPanel
      eventId={EVENT_ID}
      status="draft"
      transitions={allowedEventTransitions('draft')}
    />,
  );

  it('propose la publication d’un événement en brouillon', () => {
    // Le premier maillon : sans lui, ni édition ni épreuve ne se publient.
    expect(offeredTargets(markup)).toEqual(['published']);
    expect(markup).toContain('Passer en published');
  });

  it('transmet l’identifiant de l’événement et le statut visé', () => {
    expect(submissions(markup)).toEqual([{ eventId: EVENT_ID, status: 'published' }]);
  });

  it('annonce l’autorité que la table déclare — §4.1', () => {
    expect(markup).toContain('éditeur de l’organisation, ou pluka_admin');
  });

  it('réserve l’archivage à l’admin plateforme', () => {
    const published = renderToStaticMarkup(
      <EventStatusPanel
        eventId={EVENT_ID}
        status="published"
        transitions={allowedEventTransitions('published')}
      />,
    );

    expect(offeredTargets(published)).toEqual(['archived']);
    expect(published).toContain('pluka_admin uniquement');
  });

  it('ne propose rien plutôt que de mentir quand la table est vide', () => {
    const empty = renderToStaticMarkup(
      <EventStatusPanel eventId={EVENT_ID} status="published" transitions={[]} />,
    );

    expect(empty).toContain('Aucune transition possible pour cet événement');
    expect(offeredTargets(empty)).toEqual([]);
  });
});

describe('écran Edition', () => {
  const markup = renderToStaticMarkup(
    <EditionStatusPanel
      editionId={EDITION_ID}
      status="published"
      transitions={allowedEditionTransitions('published')}
    />,
  );

  it('propose l’annulation et la clôture d’une édition diffusée', () => {
    expect(offeredTargets(markup)).toEqual(['cancelled', 'completed']);
  });

  it('distingue les deux autorités que §4.1 leur donne', () => {
    expect(markup).toContain('admin de l’organisation, ou pluka_admin');
    expect(markup).toContain('pluka_admin uniquement');
  });

  it('ne transmet que l’édition et le statut visé', () => {
    // L'écran à rafraîchir est celui de l'événement, mais son identifiant est
    // relu du côté serveur : `changeEditionStatus` rend l'édition, qui le
    // porte. Un champ caché de plus serait une valeur de plus à ne pas croire.
    expect(submissions(markup)).toEqual([
      { editionId: EDITION_ID, status: 'cancelled' },
      { editionId: EDITION_ID, status: 'completed' },
    ]);
  });

  it('propose la publication depuis le brouillon', () => {
    const draft = renderToStaticMarkup(
      <EditionStatusPanel
        editionId={EDITION_ID}
        status="draft"
        transitions={allowedEditionTransitions('draft')}
      />,
    );

    expect(offeredTargets(draft)).toEqual(['published']);
  });
});

describe('écran Race — inchangé', () => {
  it('propose toujours ses transitions', () => {
    // Le panneau partagé ne devait rien retirer à l'écran qui en avait déjà un.
    const markup = renderToStaticMarkup(
      <RaceStatusPanel
        raceId={RACE_ID}
        status="draft"
        transitions={allowedRaceTransitions('draft')}
      />,
    );

    expect(offeredTargets(markup)).toEqual(['published']);
    expect(submissions(markup)).toEqual([{ raceId: RACE_ID, status: 'published' }]);
  });
});

describe('champs transmis aux Server Actions', () => {
  /** Ce que l'action lira du formulaire, comme le fait `changeEventStatusAction`. */
  function submitted(markup: string): FormData {
    const form = new FormData();
    const posted = submissions(markup);

    expect(posted).toHaveLength(1);
    for (const [field, value] of Object.entries(posted[0] ?? {})) form.set(field, value);

    return form;
  }

  it('produit une commande d’événement que le domaine accepte', () => {
    const form = submitted(
      renderToStaticMarkup(
        <EventStatusPanel
          eventId={EVENT_ID}
          status="draft"
          transitions={allowedEventTransitions('draft')}
        />,
      ),
    );

    const command = { eventId: text(form, 'eventId'), status: text(form, 'status') };

    expect(changeEventStatusCommandSchema.safeParse(command).success).toBe(true);
  });

  it('produit une commande d’édition que le domaine accepte', () => {
    const form = submitted(
      renderToStaticMarkup(
        <EditionStatusPanel
          editionId={EDITION_ID}
          status="draft"
          transitions={allowedEditionTransitions('draft')}
        />,
      ),
    );

    const command = { editionId: text(form, 'editionId'), status: text(form, 'status') };

    expect(changeEditionStatusCommandSchema.safeParse(command).success).toBe(true);
  });

  it('ne transmet aucune identité d’acteur', () => {
    // L'autorité est relue en base par le use case (03_PRIVACY_RLS §11) : un
    // champ caché la porterait telle que le navigateur la déclare.
    const markup = renderToStaticMarkup(
      <EventStatusPanel
        eventId={EVENT_ID}
        status="draft"
        transitions={allowedEventTransitions('draft')}
      />,
    );

    expect(markup).not.toContain('userId');
    expect(markup).not.toContain('platformRole');
  });
});

describe('journal affiché', () => {
  it('lit une entrée d’événement et une d’édition de la même façon', () => {
    // Les deux journaux ont des enums différents mais la même forme : le
    // composant ne demande que ce qu'ils ont en commun.
    const markup = renderToStaticMarkup(
      <StatusHistory
        entries={[
          {
            id: 'ffffffff-0000-4000-8000-000000000001',
            fromStatus: 'draft',
            toStatus: 'published',
            createdAt: '2026-03-01T08:00:00Z',
          },
        ]}
      />,
    );

    expect(markup).toContain('draft');
    expect(markup).toContain('published');
    expect(markup).toContain('2026-03-01T08:00:00Z');
  });

  it('le dit plutôt que d’afficher une liste vide', () => {
    expect(renderToStaticMarkup(<StatusHistory entries={[]} />)).toContain(
      'Aucun changement de statut journalisé',
    );
  });

  it('n’expose pas l’auteur de la transition', () => {
    // §104 : l'historique reste interne, et l'écran n'a pas à résoudre un
    // identifiant d'utilisateur pour attester d'un changement.
    const markup = renderToStaticMarkup(
      <StatusHistory
        entries={[
          {
            id: 'ffffffff-0000-4000-8000-000000000002',
            fromStatus: 'published',
            toStatus: 'archived',
            createdAt: '2026-03-02T08:00:00Z',
          },
        ]}
      />,
    );

    expect(markup).not.toContain('actorUserId');
  });
});
