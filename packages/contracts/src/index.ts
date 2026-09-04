/**
 * `@pluka/contracts` — schémas Zod partagés, contrats de providers externes et
 * événements métier.
 *
 * Ce paquet ne dépend que de `zod`. Il ne contient aucun calcul moteur, aucune
 * règle d'entitlement et aucun accès base : il décrit des frontières
 * (01_ARCHITECTURE §4.5, §5).
 */

export { ContractValidationError, toContractIssues, type ContractIssue } from './errors.js';

export {
  createDomainEventEnvelope,
  defineDomainEvent,
  domainEventEnvelopeSchema,
  parseDomainEvent,
  type DomainEvent,
  type DomainEventDefinition,
  type DomainEventEnvelope,
} from './events/envelope.js';
export { DOMAIN_EVENT_TYPES, domainEventTypeSchema, type DomainEventType } from './events/names.js';

export { latitudeSchema, longitudeSchema, routeAltitudeMetersSchema } from './primitives/geo.js';
export { nonEmptyStringSchema, sha256HexSchema, uuidSchema } from './primitives/ids.js';
export {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from './primitives/json.js';
export { ianaTimeZoneSchema, instantSchema } from './primitives/time.js';
export { httpUrlSchema } from './primitives/url.js';
export { computationMetadataSchema, type ComputationMetadata } from './primitives/versioning.js';

export {
  aiEvidenceSchema,
  aiGroundedAnswerSchema,
  aiModelDescriptorSchema,
  aiUsageSchema,
  type AIEvidence,
  type AIGroundedAnswer,
  type AIGroundedAnswerRequest,
  type AIGroundedAnswerResult,
  type AIModelDescriptor,
  type AIProvider,
  type AIStructuredExtractionRequest,
  type AIStructuredExtractionResult,
  type AIUsage,
} from './providers/ai.js';
export {
  billingCheckoutRequestSchema,
  billingCheckoutSessionSchema,
  verifiedBillingEventSchema,
  type BillingCheckoutRequest,
  type BillingCheckoutSession,
  type BillingProvider,
  type BillingWebhookDelivery,
  type VerifiedBillingEvent,
} from './providers/billing.js';
export {
  emailMessageSchema,
  emailRecipientSchema,
  emailSendResultSchema,
  type EmailMessage,
  type EmailProvider,
  type EmailRecipient,
  type EmailSendResult,
} from './providers/email.js';
export {
  isRetryableByDefault,
  PROVIDER_ERROR_CODES,
  ProviderError,
  type ProviderErrorCode,
  type ProviderErrorParams,
} from './providers/errors.js';
export { parseProviderResponse, type ProviderCallContext } from './providers/validate.js';
export {
  normalizedWeatherPointSchema,
  weatherProviderPointRequestSchema,
  weatherProviderRequestSchema,
  weatherProviderResponseSchema,
  type NormalizedWeatherPoint,
  type WeatherProvider,
  type WeatherProviderPointRequest,
  type WeatherProviderRequest,
  type WeatherProviderResponse,
} from './providers/weather.js';
