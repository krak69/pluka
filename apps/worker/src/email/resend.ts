import type { EmailMessage, EmailProvider, EmailSendResult } from '@pluka/contracts';

import { permanent, transient } from '../errors.js';

/**
 * Adapter Resend — implémentation concrète d'`EmailProvider`.
 *
 * C'est, avec `ai/anthropic.ts`, l'un des deux seuls fichiers du dépôt où un
 * nom de fournisseur apparaît. `01_ARCHITECTURE` §4.5 et §28 posent la règle :
 * aucun moteur ne connaît son fournisseur, et l'interface vit dans
 * `packages/contracts`. `packages/notifications` reçoit donc un
 * `EmailProvider` et ne sait rien de ce qu'il y a derrière.
 *
 * L'API est appelée en HTTP, sans SDK : le contrat tient en une requête, et
 * une dépendance de plus ne l'aurait pas rendu plus clair.
 *
 * L'expéditeur vient de la configuration, jamais de l'appelant — le contrat le
 * dit explicitement, et c'est ce qui empêche un gabarit d'usurper une adresse.
 */

const RESEND_URL = 'https://api.resend.com/emails';

export interface ResendOptions {
  readonly apiKey: string;
  /** Adresse d'expédition, issue de `EMAIL_FROM`. */
  readonly from: string;
  readonly baseUrl?: string;
  /**
   * Transport injecté.
   *
   * Permet d'exercer le contrat — en-têtes, forme du corps, absence de copie —
   * sans appeler le fournisseur ni détenir de clé.
   */
  readonly fetch?: typeof globalThis.fetch;
}

interface ResendResponse {
  readonly id?: string;
}

function formatRecipient(recipient: EmailMessage['to'][number]): string {
  return recipient.name === undefined
    ? recipient.address
    : `${recipient.name} <${recipient.address}>`;
}

export function createResendProvider(options: ResendOptions): EmailProvider {
  const call = options.fetch ?? globalThis.fetch;
  const url = options.baseUrl ?? RESEND_URL;

  return {
    name: 'resend',

    async send(message: EmailMessage): Promise<EmailSendResult> {
      let response: Response;

      try {
        response = await call(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
            // La clé du contrat devient la clé du fournisseur : si le worker
            // meurt entre l'envoi et l'écriture en base, le rejeu ne produit
            // pas un second email (§22.1).
            'idempotency-key': message.idempotencyKey,
          },
          body: JSON.stringify({
            from: options.from,
            to: message.to.map(formatRecipient),
            subject: message.subject,
            text: message.textBody,
            ...(message.htmlBody === undefined ? {} : { html: message.htmlBody }),
            ...(message.replyTo === undefined
              ? {}
              : { reply_to: formatRecipient(message.replyTo) }),
          }),
        });
      } catch (error) {
        throw transient('EMAIL_UNREACHABLE', 'fournisseur email injoignable', error);
      }

      if (!response.ok) {
        // 4xx : la requête est fautive et le restera — adresse refusée, clé
        // invalide. 429 et 5xx passeront peut-être au tour suivant.
        const retriable = response.status === 429 || response.status >= 500;
        const detail = `réponse ${response.status} du fournisseur email`;

        throw retriable
          ? transient('EMAIL_HTTP_ERROR', detail)
          : permanent('EMAIL_HTTP_ERROR', detail);
      }

      const body = (await response.json()) as ResendResponse;

      return {
        providerMessageId: body.id ?? null,
        acceptedAt: new Date().toISOString(),
      };
    },
  };
}
