import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import {
  participantRaceSettingsRepository,
  type ParticipantRaceSettingsRepository,
} from './participation.js';
import { raceRepository, type RaceRepository } from './course.js';
import { racePlanRepository, type RacePlanRepository } from './plan.js';
import { raceWaypointRepository, type RaceWaypointRepository } from './waypoints.js';

/*
 * Assistance du coureur — migrations 0001, 0098, 0099 ; 00_PRODUCT_SPEC §15.
 *
 * Sous la session du coureur : la RLS (0005) réserve personnes, rendez-vous et
 * « À me donner » au propriétaire de la participation, et l'organisation n'y a
 * aucun accès (03_PRIVACY_RLS §43). Le droit commercial se décide dans le
 * domaine ; un déclencheur (0098) refuse un rendez-vous hors d'un point où
 * l'assistance est autorisée.
 *
 * Aucune lecture `select *` (AGENTS §80) : les colonnes sont nommées.
 */

export interface AssistantRecord {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string | null;
}

export interface AssistantInput {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string | null;
}

export interface AssistanceAssignmentRecord {
  readonly id: string;
  readonly assistantId: string;
  readonly raceWaypointId: string;
  readonly instructions: string | null;
}

export interface AssistanceItemRecord {
  readonly id: string;
  readonly assignmentId: string;
  readonly label: string;
}

export interface AssistanceRepository {
  /** Les personnes actives d'une participation, dans l'ordre d'ajout. */
  listAssistants(participantRaceId: string): Promise<readonly AssistantRecord[]>;
  createAssistant(participantRaceId: string, assistant: AssistantInput): Promise<void>;
  updateAssistant(
    participantRaceId: string,
    assistantId: string,
    assistant: AssistantInput,
  ): Promise<void>;
  /** Retire la personne, ses rendez-vous et ce qu'elle devait apporter (cascade). */
  deleteAssistant(participantRaceId: string, assistantId: string): Promise<void>;
  listAssignments(assistantIds: readonly string[]): Promise<readonly AssistanceAssignmentRecord[]>;
  createAssignment(assistantId: string, raceWaypointId: string): Promise<void>;
  setInstructions(assignmentId: string, instructions: string | null): Promise<void>;
  deleteAssignment(assignmentId: string): Promise<void>;
  listItems(assignmentIds: readonly string[]): Promise<readonly AssistanceItemRecord[]>;
  addItems(assignmentId: string, labels: readonly string[]): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  /** Les liens privés actifs d'une participation (0100) ; jamais leur empreinte. */
  listLinks(participantRaceId: string): Promise<readonly AssistantLinkRecord[]>;
  /** Crée le lien d'une personne, en éteignant l'ancien. Seule l'empreinte entre en base. */
  createLink(assistantId: string, tokenHash: string): Promise<void>;
  revokeLink(assistantId: string): Promise<void>;
}

export interface AssistantLinkRecord {
  readonly assistantId: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/**
 * La page de l'accompagnant, telle que `assistant_link_view` la rend (0100) :
 * une projection sûre, rien d'autre (03_PRIVACY_RLS §46).
 */
export type AssistantLinkViewRecord =
  | { readonly state: 'unknown' | 'revoked' | 'expired' }
  | {
      readonly state: 'valid';
      readonly runnerFirstName: string | null;
      readonly assistantFirstName: string;
      readonly raceName: string;
      readonly eventName: string | null;
      readonly timezone: string;
      readonly startAt: string;
      readonly planUpdatedAt: string | null;
      readonly rendezvous: readonly {
        readonly pointName: string;
        readonly distanceKm: number;
        readonly instructions: string | null;
        readonly plannedElapsedSeconds: number | null;
        readonly items: readonly string[];
      }[];
    };

export interface AssistantLinkViewRepository {
  /** Sans session : la fonction valide le lien elle-même, par son empreinte. */
  view(tokenHash: string): Promise<AssistantLinkViewRecord>;
}

export const assistantLinkViewRepository = defineRepository<AssistantLinkViewRepository>(
  (context) => ({
    async view(tokenHash) {
      const data = unwrap(
        await context.client.rpc('assistant_link_view', { p_token_hash: tokenHash }),
        'assistant_link_view',
      );
      return data as unknown as AssistantLinkViewRecord;
    },
  }),
);

type AssistantRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
};

type AssignmentRow = {
  id: string;
  assistant_id: string;
  race_waypoint_id: string;
  instructions: string | null;
};

type ItemRow = { id: string; assistance_assignment_id: string; label: string };

export const assistanceRepository = defineRepository<AssistanceRepository>((context) => ({
  async listAssistants(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client
        .from('race_assistants')
        .select('id, first_name, last_name, phone')
        .eq('participant_race_id', participantRaceId)
        .eq('status', 'active')
        .order('created_at', { ascending: true }),
      'race_assistants.list',
    );

    return ((rows ?? []) as AssistantRow[]).map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
    }));
  },

  async createAssistant(participantRaceId, assistant) {
    unwrapMaybe(
      await context.client.from('race_assistants').insert({
        participant_race_id: participantRaceId,
        first_name: assistant.firstName,
        last_name: assistant.lastName,
        phone: assistant.phone,
      }),
      'race_assistants.create',
    );
  },

  async updateAssistant(participantRaceId, assistantId, assistant) {
    unwrapMaybe(
      await context.client
        .from('race_assistants')
        .update({
          first_name: assistant.firstName,
          last_name: assistant.lastName,
          phone: assistant.phone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', assistantId)
        .eq('participant_race_id', participantRaceId),
      'race_assistants.update',
    );
  },

  async deleteAssistant(participantRaceId, assistantId) {
    unwrapMaybe(
      await context.client
        .from('race_assistants')
        .delete()
        .eq('id', assistantId)
        .eq('participant_race_id', participantRaceId),
      'race_assistants.delete',
    );
  },

  async listAssignments(assistantIds) {
    if (assistantIds.length === 0) return [];
    const rows = unwrapMaybe(
      await context.client
        .from('assistance_assignments')
        .select('id, assistant_id, race_waypoint_id, instructions')
        .in('assistant_id', [...assistantIds])
        .order('created_at', { ascending: true }),
      'assistance_assignments.list',
    );

    return ((rows ?? []) as AssignmentRow[]).map((row) => ({
      id: row.id,
      assistantId: row.assistant_id,
      raceWaypointId: row.race_waypoint_id,
      instructions: row.instructions,
    }));
  },

  async createAssignment(assistantId, raceWaypointId) {
    // Un même point deux fois pour la même personne : la contrainte unique de
    // 0001 rend l'ajout idempotent.
    unwrapMaybe(
      await context.client
        .from('assistance_assignments')
        .upsert(
          { assistant_id: assistantId, race_waypoint_id: raceWaypointId },
          { onConflict: 'assistant_id,race_waypoint_id', ignoreDuplicates: true },
        ),
      'assistance_assignments.create',
    );
  },

  async setInstructions(assignmentId, instructions) {
    unwrapMaybe(
      await context.client
        .from('assistance_assignments')
        .update({ instructions, updated_at: new Date().toISOString() })
        .eq('id', assignmentId),
      'assistance_assignments.setInstructions',
    );
  },

  async deleteAssignment(assignmentId) {
    unwrapMaybe(
      await context.client.from('assistance_assignments').delete().eq('id', assignmentId),
      'assistance_assignments.delete',
    );
  },

  async listItems(assignmentIds) {
    if (assignmentIds.length === 0) return [];
    const rows = unwrap(
      await context.client
        .from('assistance_items')
        .select('id, assistance_assignment_id, label')
        .in('assistance_assignment_id', [...assignmentIds])
        .order('created_at', { ascending: true }),
      'assistance_items.list',
    );

    return (rows as ItemRow[]).map((row) => ({
      id: row.id,
      assignmentId: row.assistance_assignment_id,
      label: row.label,
    }));
  },

  async addItems(assignmentId, labels) {
    if (labels.length === 0) return;
    unwrapMaybe(
      await context.client.from('assistance_items').insert(
        labels.map((label) => ({
          assistance_assignment_id: assignmentId,
          item_type: 'other' as const,
          label,
        })),
      ),
      'assistance_items.add',
    );
  },

  async deleteItem(itemId) {
    unwrapMaybe(
      await context.client.from('assistance_items').delete().eq('id', itemId),
      'assistance_items.delete',
    );
  },

  async listLinks(participantRaceId) {
    const rows = unwrapMaybe(
      await context.client.rpc('list_assistant_links', {
        p_participant_race_id: participantRaceId,
      }),
      'list_assistant_links',
    );

    return (rows ?? []).map((row) => ({
      assistantId: row.assistant_id,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  },

  async createLink(assistantId, tokenHash) {
    unwrapMaybe(
      await context.client.rpc('create_assistant_link', {
        p_assistant_id: assistantId,
        p_token_hash: tokenHash,
      }),
      'create_assistant_link',
    );
  },

  async revokeLink(assistantId) {
    unwrapMaybe(
      await context.client.rpc('revoke_assistant_link', { p_assistant_id: assistantId }),
      'revoke_assistant_link',
    );
  },
}));

export interface AssistanceRepositories {
  readonly assistance: AssistanceRepository;
  /** Le choix « autonome / avec assistance / plus tard » (`assistance_status`). */
  readonly participantRaceSettings: ParticipantRaceSettingsRepository;
  /** Les points du parcours, dont ceux où l'assistance est autorisée (0098). */
  readonly waypoints: RaceWaypointRepository;
  /** Le Plan actif, d'où viennent les heures des rendez-vous (AC-ASST-04). */
  readonly racePlans: RacePlanRepository;
  /** Le fuseau de la course, pour dire l'heure des rendez-vous. */
  readonly races: RaceRepository;
}

export function createAssistanceRepositories(context: RepositoryContext): AssistanceRepositories {
  return {
    assistance: assistanceRepository(context),
    participantRaceSettings: participantRaceSettingsRepository(context),
    waypoints: raceWaypointRepository(context),
    racePlans: racePlanRepository(context),
    races: raceRepository(context),
  };
}
