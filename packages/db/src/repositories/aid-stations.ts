import { defineRepository } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';

/*
 * Contenu des ravitaillements — migration 0110 ; NUTRITION_ENGINE §31, §32.
 *
 * Ce que propose un point se lit avec la course, même sans compte (0005, §42),
 * et s'écrit par `set_race_aid_station_items` : l'organisation éditrice ou
 * l'administration PLUKA. La note du coureur, quand rien n'est annoncé, est à
 * lui seul (RLS) et s'écrit par `set_participant_aid_note`.
 */

export type AidItemKind =
  'water' | 'sports_drink' | 'cola' | 'soup' | 'fruit' | 'sweet' | 'salty' | 'hot_meal' | 'other';

export const AID_ITEM_KINDS: readonly AidItemKind[] = [
  'water',
  'sports_drink',
  'cola',
  'soup',
  'fruit',
  'sweet',
  'salty',
  'hot_meal',
  'other',
];

export interface AidStationItemRecord {
  readonly waypointId: string;
  readonly kind: AidItemKind;
  readonly label: string;
  readonly sortOrder: number;
}

export interface AidStationItemInput {
  readonly kind: AidItemKind;
  readonly label: string;
}

export interface AidStationRepository {
  /** Ce que proposent les points d'une course, point par point, dans l'ordre. */
  listByRace(raceId: string): Promise<readonly AidStationItemRecord[]>;
  /** Remplace ce que propose un point ; vide, il n'annonce plus rien. */
  setForWaypoint(waypointId: string, items: readonly AidStationItemInput[]): Promise<void>;
}

type ItemRow = {
  race_waypoint_id: string;
  kind: string;
  label: string;
  sort_order: number;
};

function kindOf(value: string): AidItemKind {
  return (AID_ITEM_KINDS as readonly string[]).includes(value) ? (value as AidItemKind) : 'other';
}

export const aidStationRepository = defineRepository<AidStationRepository>((context) => ({
  async listByRace(raceId) {
    const rows = unwrap(
      await context.client
        .from('race_aid_station_items')
        .select('race_waypoint_id, kind, label, sort_order, race_waypoints!inner(race_id)')
        .eq('race_waypoints.race_id', raceId)
        .order('sort_order', { ascending: true }),
      'race_aid_station_items.listByRace',
    ) as ItemRow[];

    return rows.map((row) => ({
      waypointId: row.race_waypoint_id,
      kind: kindOf(row.kind),
      label: row.label,
      sortOrder: row.sort_order,
    }));
  },

  async setForWaypoint(waypointId, items) {
    unwrapMaybe(
      await context.client.rpc('set_race_aid_station_items', {
        p_race_waypoint_id: waypointId,
        p_items: items.map((item) => ({ kind: item.kind, label: item.label })),
      }),
      'set_race_aid_station_items',
    );
  },
}));

// ------------------------------------------------------------
// La note du coureur
// ------------------------------------------------------------

/** Ce que le coureur sait d'un ravitaillement qui n'annonce rien — jamais officiel. */
export interface AidNoteRecord {
  readonly waypointId: string;
  readonly kinds: readonly Exclude<AidItemKind, 'other'>[];
  readonly note: string | null;
}

export interface AidNoteRepository {
  listByParticipation(participantRaceId: string): Promise<readonly AidNoteRecord[]>;
  /** Ni genre ni texte : la note s'efface. */
  set(
    participantRaceId: string,
    waypointId: string,
    kinds: readonly Exclude<AidItemKind, 'other'>[],
    note: string | null,
  ): Promise<void>;
}

type NoteRow = { race_waypoint_id: string; kinds: string[]; note: string | null };

export const aidNoteRepository = defineRepository<AidNoteRepository>((context) => ({
  async listByParticipation(participantRaceId) {
    const rows = unwrap(
      await context.client
        .from('participant_aid_notes')
        .select('race_waypoint_id, kinds, note')
        .eq('participant_race_id', participantRaceId),
      'participant_aid_notes.list',
    ) as NoteRow[];

    return rows.map((row) => ({
      waypointId: row.race_waypoint_id,
      kinds: row.kinds
        .map(kindOf)
        .filter((kind): kind is Exclude<AidItemKind, 'other'> => kind !== 'other'),
      note: row.note,
    }));
  },

  async set(participantRaceId, waypointId, kinds, note) {
    unwrapMaybe(
      await context.client.rpc('set_participant_aid_note', {
        p_participant_race_id: participantRaceId,
        p_race_waypoint_id: waypointId,
        p_kinds: [...kinds],
        // Le type généré ne connaît pas la nullabilité des paramètres : la fonction l'accepte.
        p_note: note as string,
      }),
      'set_participant_aid_note',
    );
  },
}));
