import { z } from 'zod';

/**
 * Événements métier structurants — liste de `01_ARCHITECTURE.md` §23.
 *
 * Un événement métier n'est pas un événement analytics (§23, §24) : les
 * analytics first-party vivent dans `packages/analytics` avec leur propre
 * vocabulaire.
 *
 * Ajouter un type suppose une décision documentée dans l'architecture.
 */
export const DOMAIN_EVENT_TYPES = [
  'race.fact.published',
  'race.official_notice.published',
  'race.course_geometry.updated',
  'participant.imported',
  'participant.invited',
  'participant.activated',
  'plan.generated',
  'plan.updated',
  'nutrition.updated',
  'preparation.updated',
  'assistance.configured',
  'outing.created',
  'weather.updated',
  'pluka.question.asked',
  'postrace.completed',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const domainEventTypeSchema = z.enum(DOMAIN_EVENT_TYPES);
