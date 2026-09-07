import { AUTHORED_WAYPOINT_TYPES, setRaceWaypointsCommandSchema } from '@pluka/domain';
import type { RaceWaypointView } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WaypointsForm } from '@/app/courses/[raceId]/waypoints-form';
import { raceWaypointsCommand } from '@/lib/form';

/**
 * Saisie du référentiel de parcours — PLAN_ENGINE §7, §8.1.
 *
 * L'écran poste la chaîne en champs répétés : c'est l'ordre du document qui
 * fait le rang. Ces tests relisent le balisage rendu, reconstituent ce que le
 * navigateur enverrait, et vérifient que la commande qui en sort est celle que
 * le domaine attend — le point où un renommage de champ casserait tout sans
 * qu'aucun type ne s'en aperçoive.
 */

const RACE_ID = 'aaaaaaaa-0000-4000-8000-000000000013';

function waypoint(overrides: Partial<RaceWaypointView> = {}): RaceWaypointView {
  return {
    id: 'dddddddd-0000-4000-8000-000000000001',
    raceId: RACE_ID,
    name: 'Départ',
    waypointType: 'start',
    distanceKm: 0,
    sortOrder: 1,
    altitudeM: null,
    cutoffAt: null,
    ...overrides,
  } as RaceWaypointView;
}

const SAVED: readonly RaceWaypointView[] = [
  waypoint(),
  waypoint({
    id: 'dddddddd-0000-4000-8000-000000000002',
    name: 'Ravito 1',
    waypointType: 'aid_station',
    distanceKm: 18.5,
    sortOrder: 2,
    cutoffAt: '2026-06-20T11:00:00Z',
  }),
  waypoint({
    id: 'dddddddd-0000-4000-8000-000000000003',
    name: 'Arrivée',
    waypointType: 'finish',
    distanceKm: 70,
    sortOrder: 3,
  }),
];

/** Les champs d'un formulaire, dans l'ordre du document — ce que poste le navigateur. */
function submitted(markup: string): FormData {
  const form = new FormData();

  for (const tag of markup.matchAll(/<(?:input|select)\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(tag[0])?.[1];
    if (name === undefined) continue;

    // `<select>` : la valeur postée est celle de l'option sélectionnée.
    if (tag[0].startsWith('<select')) continue;

    form.append(name, /\bvalue="([^"]*)"/.exec(tag[0])?.[1] ?? '');
  }

  return form;
}

/** Valeurs des `<select>` retenues par le rendu, dans l'ordre. */
function selectedTypes(markup: string): readonly string[] {
  return [...markup.matchAll(/<option[^>]*\bvalue="([^"]*)"[^>]*\bselected/g)].map(
    (match) => match[1] as string,
  );
}

const EMPTY = renderToStaticMarkup(<WaypointsForm raceId={RACE_ID} waypoints={[]} />);
const FILLED = renderToStaticMarkup(<WaypointsForm raceId={RACE_ID} waypoints={SAVED} />);

describe('chaîne vide', () => {
  it('part d’un départ et d’une arrivée', () => {
    // Le minimum qu'exige `validateInput` : un parcours d'un seul point n'a
    // aucun segment.
    expect(EMPTY).toContain('value="Départ"');
    expect(EMPTY).toContain('value="Arrivée"');
    expect(submitted(EMPTY).getAll('name')).toHaveLength(2);
  });

  it('ne transmet aucune identité pour des points neufs', () => {
    expect(submitted(EMPTY).getAll('waypointId')).toEqual(['', '']);
  });
});

describe('chaîne existante', () => {
  it('rouvre les points dans leur ordre', () => {
    const form = submitted(FILLED);

    expect(form.getAll('name')).toEqual(['Départ', 'Ravito 1', 'Arrivée']);
    expect(form.getAll('distanceKm')).toEqual(['0', '18.5', '70']);
  });

  it('reporte l’identité de chaque point existant', () => {
    // Sans elle, réenregistrer recréerait les points, et les sacs qui les
    // référencent tomberaient.
    expect(submitted(FILLED).getAll('waypointId')).toEqual(SAVED.map((point) => point.id));
  });

  it('présente la barrière au format que le champ accepte', () => {
    // `datetime-local` n'accepte ni fuseau ni secondes.
    expect(submitted(FILLED).getAll('cutoffAt')).toEqual(['', '2026-06-20T11:00', '']);
  });

  it('retient le type enregistré de chaque point', () => {
    expect(selectedTypes(FILLED)).toEqual(['start', 'aid_station', 'finish']);
  });

  it('propose les types de la saisie, et eux seuls', () => {
    for (const type of AUTHORED_WAYPOINT_TYPES) {
      expect(FILLED).toContain(`value="${type}"`);
    }

    // `summit`, `pass`, `water`, `other` existent en base mais ne sont pas
    // proposés : une saisie n'est pas un questionnaire.
    expect(FILLED).not.toContain('value="summit"');
    expect(FILLED).not.toContain('value="other"');
  });
});

describe('transmission jusqu’à la Server Action', () => {
  it('produit une commande que le domaine accepte', () => {
    const form = submitted(FILLED);
    // Le rendu statique ne porte pas la valeur du `<select>` : le navigateur,
    // lui, poste l'option retenue. On la reconstitue dans le même ordre.
    for (const type of selectedTypes(FILLED)) form.append('waypointType', type);

    const command = raceWaypointsCommand(form);

    expect(setRaceWaypointsCommandSchema.safeParse(command).success).toBe(true);
  });

  it('porte l’ordre, les kilomètres et les identités', () => {
    const form = submitted(FILLED);
    for (const type of selectedTypes(FILLED)) form.append('waypointType', type);

    expect(raceWaypointsCommand(form)).toEqual({
      raceId: RACE_ID,
      waypoints: [
        {
          id: SAVED[0]?.id,
          name: 'Départ',
          waypointType: 'start',
          distanceKm: 0,
          cutoffAt: null,
        },
        {
          id: SAVED[1]?.id,
          name: 'Ravito 1',
          waypointType: 'aid_station',
          distanceKm: 18.5,
          // Le champ rend une heure sans fuseau : l'action la complète en UTC.
          cutoffAt: '2026-06-20T11:00:00Z',
        },
        {
          id: SAVED[2]?.id,
          name: 'Arrivée',
          waypointType: 'finish',
          distanceKm: 70,
          cutoffAt: null,
        },
      ],
    });
  });

  it('n’invente aucune identité pour un point ajouté', () => {
    const form = submitted(EMPTY);
    for (const type of selectedTypes(EMPTY)) form.append('waypointType', type);

    const command = raceWaypointsCommand(form) as { waypoints: Record<string, unknown>[] };

    expect(command.waypoints.every((point) => !('id' in point))).toBe(true);
  });

  it('laisse le domaine refuser un kilomètre vide', () => {
    const form = submitted(EMPTY);
    for (const type of selectedTypes(EMPTY)) form.append('waypointType', type);

    // L'arrivée n'a pas de kilomètre par défaut : la commande porte
    // `undefined`, et le schéma nomme le champ plutôt que de compter `NaN`.
    const result = setRaceWaypointsCommandSchema.safeParse(raceWaypointsCommand(form));

    expect(result.success).toBe(false);
  });

  it('ne transmet aucune identité d’acteur', () => {
    expect(FILLED).not.toContain('userId');
    expect(FILLED).not.toContain('platformRole');
  });

  it('ne fait saisir ni rang ni segment', () => {
    // L'ordre du document est le rang, et les segments sont dérivés : les
    // exposer serait une seconde façon de dire la même chose.
    expect(FILLED).not.toContain('name="sortOrder"');
    expect(FILLED).not.toContain('name="segment"');
  });
});
