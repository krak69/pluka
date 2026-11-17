import { defineRepository } from '../repository.js';
import { unwrapMaybe } from '../results.js';

/*
 * Contact d'urgence — migrations 0001, 0101 ; 03_PRIVACY_RLS §48.
 *
 * Côté coureur, sous sa session : la RLS (0005) réserve la ligne au
 * propriétaire de la participation. Côté organisation, aucune lecture directe
 * de la table : deux fonctions de 0101, réservées au propriétaire et aux
 * admins, dont la consultation est journalisée.
 */

export interface EmergencyContactRecord {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string;
  readonly relationshipLabel: string | null;
  /** La personne a accepté d'être ce contact (attesté par le coureur). */
  readonly explicitConsentAt: string;
  /** Partagé avec l'organisation de la course ; nul sinon. */
  readonly organizationShareConsentAt: string | null;
}

export interface EmergencyContactInput {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string;
  readonly relationshipLabel: string | null;
  readonly explicitConsentAt: string;
  readonly organizationShareConsentAt: string | null;
}

export interface EmergencyContactRepository {
  find(participantRaceId: string): Promise<EmergencyContactRecord | null>;
  /** Un contact par participation (0101) : l'enregistrer remplace le précédent. */
  save(participantRaceId: string, contact: EmergencyContactInput): Promise<void>;
  remove(participantRaceId: string): Promise<void>;
}

type ContactRow = {
  first_name: string;
  last_name: string | null;
  phone: string;
  relationship_label: string | null;
  explicit_consent_at: string;
  organization_share_consent_at: string | null;
};

export const emergencyContactRepository = defineRepository<EmergencyContactRepository>(
  (context) => ({
    async find(participantRaceId) {
      const row = unwrapMaybe(
        await context.client
          .from('emergency_contacts')
          .select(
            'first_name, last_name, phone, relationship_label, explicit_consent_at, organization_share_consent_at',
          )
          .eq('participant_race_id', participantRaceId)
          .maybeSingle(),
        'emergency_contacts.find',
      ) as ContactRow | null;

      return row === null
        ? null
        : {
            firstName: row.first_name,
            lastName: row.last_name,
            phone: row.phone,
            relationshipLabel: row.relationship_label,
            explicitConsentAt: row.explicit_consent_at,
            organizationShareConsentAt: row.organization_share_consent_at,
          };
    },

    async save(participantRaceId, contact) {
      unwrapMaybe(
        await context.client.from('emergency_contacts').upsert(
          {
            participant_race_id: participantRaceId,
            first_name: contact.firstName,
            last_name: contact.lastName,
            phone: contact.phone,
            relationship_label: contact.relationshipLabel,
            explicit_consent_at: contact.explicitConsentAt,
            organization_share_consent_at: contact.organizationShareConsentAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'participant_race_id' },
        ),
        'emergency_contacts.save',
      );
    },

    async remove(participantRaceId) {
      unwrapMaybe(
        await context.client
          .from('emergency_contacts')
          .delete()
          .eq('participant_race_id', participantRaceId),
        'emergency_contacts.remove',
      );
    },
  }),
);

export interface SharedEmergencyContactRecord {
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string;
  readonly relationshipLabel: string | null;
  readonly sharedAt: string;
}

export interface OrganizerEmergencyContactRepository {
  /** Les participations d'une édition dont le contact est partagé. Ni nom ni numéro. */
  listShared(editionId: string): Promise<readonly string[]>;
  /** Le contact partagé d'un participant ; chaque appel est journalisé (0101). */
  view(participantRaceId: string): Promise<SharedEmergencyContactRecord | null>;
}

export const organizerEmergencyContactRepository =
  defineRepository<OrganizerEmergencyContactRepository>((context) => ({
    async listShared(editionId) {
      const rows = unwrapMaybe(
        await context.client.rpc('org_list_shared_emergency_contacts', {
          p_edition_id: editionId,
        }),
        'org_list_shared_emergency_contacts',
      );
      return (rows ?? []).map((row) => row.participant_race_id);
    },

    async view(participantRaceId) {
      const rows = unwrapMaybe(
        await context.client.rpc('org_view_emergency_contact', {
          p_participant_race_id: participantRaceId,
        }),
        'org_view_emergency_contact',
      );
      const row = rows?.[0];
      return row === undefined
        ? null
        : {
            firstName: row.first_name,
            lastName: row.last_name,
            phone: row.phone,
            relationshipLabel: row.relationship_label,
            sharedAt: row.shared_at,
          };
    },
  }));
