import { GPX_QUEUE, handleGpxMessage } from './jobs/gpx-process.js';
import { IMPACT_QUEUE, handleImpactMessage, isImpactMessage } from './jobs/change-impact.js';
import { handleExtractMessage, isExtractMessage } from './jobs/source-extract.js';
import { SOURCES_QUEUE, handleSourceMessage } from './jobs/source-ingest.js';
import { handleParseMessage, isParseMessage } from './jobs/source-parse.js';
import type { QueueMessage, WorkerPorts } from './ports.js';

/**
 * Boucle de consommation.
 *
 * 01_ARCHITECTURE §4.4 : « processus Node.js durable consommant les jobs
 * asynchrones ». Durable veut dire qu'il tourne, pas qu'il est invoqué : il
 * n'est pas serverless, et il n'est jamais appelé depuis une requête.
 *
 * Chaque tour fait deux choses : vider un peu l'outbox vers les files (§22.2),
 * puis consommer les messages disponibles. Le dispatcher est dans la même
 * boucle plutôt que dans un cron parce qu'un événement écrit en base doit
 * atteindre sa file rapidement, et qu'un worker arrêté n'a de toute façon
 * personne pour traiter le message.
 */

export interface LoopOptions {
  /** Durée d'invisibilité d'un message pendant son traitement, en secondes. */
  readonly visibilitySeconds: number;
  /** Nombre de messages lus par tour. */
  readonly batchSize: number;
  /** Pause entre deux tours à vide, en millisecondes. */
  readonly idleDelayMs: number;
  /** Événements outbox traduits par tour. */
  readonly outboxBatchSize: number;
}

export const DEFAULT_LOOP_OPTIONS: LoopOptions = {
  // Un GPX de 20 000 points se traite en quelques centaines de millisecondes ;
  // 60 s laisse une marge confortable sans immobiliser un message longtemps si
  // le processus meurt.
  visibilitySeconds: 60,
  batchSize: 10,
  idleDelayMs: 1000,
  outboxBatchSize: 50,
};

export interface TickResult {
  readonly dispatched: number;
  readonly processed: number;
  readonly abandoned: number;
  readonly retried: number;
}

/**
 * Verdict commun aux deux familles de job.
 *
 * `done` couvre aussi bien un traitement réussi qu'un travail déjà fait ou un
 * contenu inchangé : dans les trois cas le message a rempli son office et doit
 * quitter la file.
 */
type Verdict = 'done' | 'abandoned' | 'retry';

/**
 * Files consommées, et leur traitement.
 *
 * Le worker consomme plusieurs files — les queues sont groupées par domaine,
 * pas une par type de job (migration 0002). En ajouter une se fait ici.
 */
const CONSUMERS: readonly {
  readonly queue: string;
  readonly handle: (ports: WorkerPorts, message: QueueMessage) => Promise<{ kind: string }>;
}[] = [
  { queue: GPX_QUEUE, handle: handleGpxMessage },
  // La file `pluka_sources` porte les deux étapes : capture puis parsing. Le
  // groupement est par domaine, pas par type de job (migration 0002), donc le
  // routage se fait sur la forme de la charge utile.
  {
    queue: SOURCES_QUEUE,
    handle: (ports, message) => {
      // L'ordre compte : un message d'extraction porte aussi un `snapshotId`,
      // et le tester en premier le ferait reparser indéfiniment. Le
      // discriminant le plus spécifique passe donc devant.
      if (isExtractMessage(message)) return handleExtractMessage(ports, message);
      if (isParseMessage(message)) return handleParseMessage(ports, message);

      return handleSourceMessage(ports, message);
    },
  },
  // §44 : les changements de course descendent vers les objets dépendants.
  // La file portera aussi les recalculs de Plan et de Nutrition (0002), d'où
  // le routage sur la forme du message.
  {
    queue: IMPACT_QUEUE,
    handle: (ports, message) =>
      isImpactMessage(message)
        ? handleImpactMessage(ports, message)
        : Promise.resolve({ kind: 'abandoned' as const }),
  },
];

function verdictOf(kind: string): Verdict {
  if (kind === 'retry') return 'retry';
  if (kind === 'abandoned') return 'abandoned';
  return 'done';
}

/**
 * Un tour de boucle.
 *
 * Extrait de la boucle infinie pour être testable et rejouable : c'est cette
 * fonction que le test de bout en bout appelle, sans avoir à démarrer puis
 * arrêter un processus.
 */
export async function tick(
  ports: WorkerPorts,
  options: LoopOptions = DEFAULT_LOOP_OPTIONS,
): Promise<TickResult> {
  const dispatched = await ports.outbox.dispatch(options.outboxBatchSize);

  let processed = 0;
  let abandoned = 0;
  let retried = 0;

  for (const consumer of CONSUMERS) {
    const messages = await ports.queue.read(
      consumer.queue,
      options.visibilitySeconds,
      options.batchSize,
    );

    for (const message of messages) {
      const verdict = verdictOf((await consumer.handle(ports, message)).kind);

      if (verdict === 'retry') {
        // Le message n'est pas archivé : pgmq le rendra visible à l'expiration
        // du délai, et le compteur de tentatives du job aura avancé.
        retried += 1;
        continue;
      }

      // Archivé pour ne pas tourner en boucle. Le job garde sa trace et son
      // erreur normalisée dans `ingestion_jobs`.
      await ports.queue.archive(consumer.queue, message.msgId);

      if (verdict === 'abandoned') abandoned += 1;
      else processed += 1;
    }
  }

  return { dispatched, processed, abandoned, retried };
}

export interface RunOptions extends LoopOptions {
  /** Signal d'arrêt. Un tour en cours va jusqu'à son terme. */
  readonly signal?: AbortSignal;
}

/**
 * Boucle durable.
 *
 * L'arrêt est coopératif : le signal est vérifié entre deux tours, jamais au
 * milieu du traitement d'un message. Interrompre un job en cours laisserait
 * une géométrie à moitié écrite — que la transaction annulerait, mais au prix
 * d'une tentative gaspillée.
 */
export async function run(ports: WorkerPorts, options: RunOptions): Promise<void> {
  ports.logger.info('worker démarré', {
    queues: CONSUMERS.map((consumer) => consumer.queue),
    batchSize: options.batchSize,
  });

  while (options.signal?.aborted !== true) {
    let result: TickResult;

    try {
      result = await tick(ports, options);
    } catch (error) {
      // Un tour ne doit jamais tuer le processus : la base peut redémarrer, le
      // réseau hoqueter. On journalise et on retente au tour suivant.
      ports.logger.error('tour en échec', {
        message: error instanceof Error ? error.name : 'inconnu',
      });
      await sleep(options.idleDelayMs, options.signal);
      continue;
    }

    const worked = result.processed + result.abandoned + result.retried + result.dispatched;
    if (worked === 0) await sleep(options.idleDelayMs, options.signal);
  }

  ports.logger.info('worker arrêté');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
