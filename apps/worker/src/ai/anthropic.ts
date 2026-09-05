import { createHash } from 'node:crypto';

import type {
  AIGroundedAnswerRequest,
  AIGroundedAnswerResult,
  AIProvider,
  AIStructuredExtractionRequest,
  AIStructuredExtractionResult,
  AIUsage,
} from '@pluka/contracts';
import { z } from 'zod';

import { permanent, transient } from '../errors.js';

/**
 * Adapter Anthropic — implémentation concrète d'`AIProvider`.
 *
 * C'est le **seul** fichier du dépôt où un nom de fournisseur apparaît.
 * `01_ARCHITECTURE` §4.5 et SOURCES_EXTRACTION §56 posent la règle : aucun
 * moteur ne connaît son fournisseur, et l'interface vit dans
 * `packages/contracts`. `packages/sources` reçoit donc un `AIProvider` et ne
 * sait rien de ce qu'il y a derrière.
 *
 * Deux choses sont faites ici, et rien d'autre.
 *
 * **Contraindre la sortie.** Le schéma Zod fourni par l'appelant est traduit en
 * JSON Schema et passé comme outil ; le modèle ne peut alors répondre que dans
 * cette forme. C'est l'étape 1 de §27, et elle se fait au plus près du réseau.
 *
 * **Refuser ce qui n'y répond pas.** La sortie est validée contre le même
 * schéma Zod avant d'être rendue. Rien n'est réparé, rien n'est complété : §27
 * interdit le « parse partiel silencieux ». L'appelant revalide de son côté, et
 * cette redondance est voulue — c'est la seule barrière qui tiendrait si cet
 * adapter était fautif.
 *
 * Aucun outil exécutable n'est exposé au modèle : le seul « outil » déclaré est
 * la forme de la réponse. §65 l'exige — « aucune action outil déclenchée par le
 * document ».
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  /**
   * Transport injecté.
   *
   * Permet d'exercer le contrat — en-têtes, forme du corps, refus d'une réponse
   * hors schéma — sans appeler le fournisseur ni détenir de clé.
   */
  readonly fetch?: typeof globalThis.fetch;
}

interface ToolUseBlock {
  readonly type: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly text?: string;
}

interface AnthropicResponse {
  readonly content?: readonly ToolUseBlock[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  readonly stop_reason?: string;
}

/** Empreinte des consignes réellement envoyées — voir `promptVersion` plus bas. */
function fingerprint(instructions: string): string {
  return createHash('sha256').update(instructions, 'utf8').digest('hex').slice(0, 16);
}

/** Nom d'outil accepté par l'API : lettres, chiffres, tirets et soulignés. */
function toolNameOf(schemaName: string): string {
  return schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export function createAnthropicProvider(options: AnthropicOptions): AIProvider {
  const call = options.fetch ?? globalThis.fetch;
  const url = options.baseUrl ?? ANTHROPIC_URL;

  async function post(body: Record<string, unknown>): Promise<AnthropicResponse> {
    let response: Response;

    try {
      response = await call(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw transient('AI_UNREACHABLE', 'fournisseur IA injoignable', error);
    }

    if (!response.ok) {
      // 4xx : la requête est fautive et le restera. 429 et 5xx passeront
      // peut-être au tour suivant.
      const retriable = response.status === 429 || response.status >= 500;
      const message = `réponse ${response.status} du fournisseur IA`;

      throw retriable ? transient('AI_HTTP_ERROR', message) : permanent('AI_HTTP_ERROR', message);
    }

    return (await response.json()) as AnthropicResponse;
  }

  function usageOf(response: AnthropicResponse): AIUsage | null {
    const input = response.usage?.input_tokens;
    const output = response.usage?.output_tokens;

    if (input === undefined && output === undefined) return null;

    return {
      ...(input === undefined ? {} : { inputTokens: input }),
      ...(output === undefined ? {} : { outputTokens: output }),
    };
  }

  return {
    name: 'anthropic',

    async extractStructured<T>(
      request: AIStructuredExtractionRequest<T>,
    ): Promise<AIStructuredExtractionResult<T>> {
      const toolName = toolNameOf(request.schemaName);

      const response = await post({
        model: options.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        // Consignes et contenu dans deux canaux distincts — §65.
        system: request.instructions,
        messages: [{ role: 'user', content: request.input }],
        tools: [
          {
            name: toolName,
            description: 'Renvoie les candidats extraits, et rien d’autre.',
            input_schema: z.toJSONSchema(request.schema),
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
      });

      const block = response.content?.find(
        (entry) => entry.type === 'tool_use' && entry.name === toolName,
      );

      if (block === undefined) {
        // Le modèle a répondu autre chose que la forme demandée. C'est un refus,
        // pas une matière à interpréter.
        throw permanent('AI_RESPONSE_INVALID', 'aucune sortie structurée dans la réponse');
      }

      const parsed = request.schema.safeParse(block.input);

      if (!parsed.success) {
        throw permanent(
          'AI_RESPONSE_INVALID',
          `sortie hors schéma (${parsed.error.issues[0]?.path.join('.') ?? 'racine'})`,
        );
      }

      return {
        data: parsed.data,
        model: {
          provider: 'anthropic',
          model: options.model,
          // L'adapter ne connaît pas le numéro de version du prompt : celui-ci
          // appartient au moteur, et c'est lui qui l'enregistre dans le run
          // (§26). Ce que l'adapter peut constater, en revanche, c'est le texte
          // qu'il a réellement envoyé — d'où son empreinte. Les deux se
          // recoupent : une version figée sur des consignes modifiées se verrait.
          promptVersion: fingerprint(request.instructions),
        },
        usage: usageOf(response),
      };
    },

    async answerFromEvidence(request: AIGroundedAnswerRequest): Promise<AIGroundedAnswerResult> {
      // §48 et §49 : hors périmètre de l'étape 3. Déclarer la méthode fait
      // partie du contrat ; l'implémenter à moitié serait pire que la refuser.
      void request;
      throw permanent('AI_NOT_IMPLEMENTED', 'réponse sourcée : lot Q&A');
    },
  };
}
