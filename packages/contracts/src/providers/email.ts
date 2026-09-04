import { z } from 'zod';

import { nonEmptyStringSchema } from '../primitives/ids.js';
import { instantSchema } from '../primitives/time.js';

/**
 * Contrat provider email — `01_ARCHITECTURE.md` §28.
 *
 * Transport uniquement. Les gabarits et l'orchestration appartiennent à
 * `packages/notifications` (§4.5) : le provider reçoit un message déjà rendu.
 *
 * L'expéditeur n'appartient pas au message : il vient de la configuration de
 * l'adapter (`EMAIL_FROM`), pas de l'appelant.
 */
export const emailRecipientSchema = z.object({
  address: z.email(),
  name: nonEmptyStringSchema.optional(),
});

export type EmailRecipient = z.infer<typeof emailRecipientSchema>;

export const emailMessageSchema = z.object({
  to: z.array(emailRecipientSchema).min(1),
  replyTo: emailRecipientSchema.optional(),
  subject: nonEmptyStringSchema,
  textBody: nonEmptyStringSchema,
  htmlBody: nonEmptyStringSchema.optional(),

  /**
   * Clé d'idempotence obligatoire : un retry de job ne doit pas produire une
   * deuxième invitation ni un deuxième email transactionnel
   * (01_ARCHITECTURE §22.1, AGENTS §32).
   */
  idempotencyKey: nonEmptyStringSchema,
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;

export const emailSendResultSchema = z.object({
  /** Identifiant provider, utile au diagnostic. Absent chez certains providers. */
  providerMessageId: z.string().nullable(),
  acceptedAt: instantSchema,
});

export type EmailSendResult = z.infer<typeof emailSendResultSchema>;

export interface EmailProvider {
  readonly name: string;

  /**
   * Un échec ne perd jamais l'objet métier : l'invitation reste persistée et le
   * job est retenté (01_ARCHITECTURE §35).
   */
  send(message: EmailMessage): Promise<EmailSendResult>;
}
