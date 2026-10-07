import { AcquisitionError, type Capture } from '@pluka/sources';
import { describe, expect, it } from 'vitest';

import { handleDiscoverMessage, isDiscoverMessage } from '../src/jobs/source-discover.js';
import type { DiscoveryCompletion, QueueMessage, WorkerPorts } from '../src/ports.js';

/** Job `source.discover` — migration 0040, SOURCES_EXTRACTION §11.1. */

const DISCOVERY = '00000000-0000-4000-8000-000000000140';
const SITE = 'https://trail.example/';

function html(body: string): Capture {
  return {
    bytes: new TextEncoder().encode(
      `<html><head><title>Trail</title></head><body>${body}</body></html>`,
    ),
    finalUrl: SITE,
    httpStatus: 200,
    contentType: 'text/html',
  };
}

function setup(options: {
  readonly begin?: string | null;
  readonly fetch?: (url: string) => Promise<Capture>;
}) {
  const completed: DiscoveryCompletion[] = [];
  const failed: string[] = [];
  const fetched: string[] = [];
  const logs: unknown[] = [];
  const log = (...args: unknown[]) => void logs.push(args);

  const ports = {
    sources: {
      fetch: (url: string) => {
        fetched.push(url);
        return options.fetch?.(url) ?? Promise.resolve(html('<p>Bienvenue</p>'));
      },
    },
    discoveries: {
      begin: () => Promise.resolve(options.begin === undefined ? SITE : options.begin),
      complete: (input: DiscoveryCompletion) => {
        completed.push(input);
        return Promise.resolve();
      },
      fail: (_id: string, code: string) => {
        failed.push(code);
        return Promise.resolve();
      },
    },
    logger: { info: log, warn: log, error: log },
  } as unknown as WorkerPorts;

  return { ports, completed, failed, fetched, logs };
}

function message(readCount = 1): QueueMessage {
  return { msgId: 1, readCount, payload: { discoveryId: DISCOVERY, url: SITE } };
}

describe('job source.discover', () => {
  it('se reconnaît à discoveryId dans la file des sources', () => {
    expect(isDiscoverMessage(message())).toBe(true);
    expect(isDiscoverMessage({ msgId: 1, readCount: 1, payload: { sourceId: 'x' } })).toBe(false);
  });

  it('dépose l’inventaire du site, sans IA', async () => {
    const { ports, completed } = setup({});

    const outcome = await handleDiscoverMessage(ports, message());

    expect(outcome).toEqual({ kind: 'discovered', pagesRead: 1 });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      discoveryId: DISCOVERY,
      pagesRead: 1,
      inventory: { siteTitle: 'Trail', documents: [] },
    });
  });

  it('ne refait pas un inventaire terminé', async () => {
    const { ports, fetched } = setup({ begin: null });

    expect(await handleDiscoverMessage(ports, message())).toEqual({ kind: 'already_done' });
    expect(fetched).toEqual([]);
  });

  it('lit robots.txt avant la page', async () => {
    const { ports, fetched } = setup({});

    await handleDiscoverMessage(ports, message());

    expect(fetched[0]).toBe('https://trail.example/robots.txt');
  });

  it('une adresse bloquée par la garde SSRF échoue définitivement', async () => {
    const { ports, failed } = setup({
      fetch: (url) =>
        url.endsWith('robots.txt')
          ? Promise.reject(new Error('404'))
          : Promise.reject(new AcquisitionError('ADDRESS_BLOCKED', 'destination interdite')),
    });

    expect(await handleDiscoverMessage(ports, message())).toEqual({
      kind: 'abandoned',
      code: 'ADDRESS_BLOCKED',
    });
    expect(failed).toEqual(['ADDRESS_BLOCKED']);
  });

  it('une panne passagère se reprend, puis devient un échec visible', async () => {
    const timeout = (url: string) =>
      url.endsWith('robots.txt')
        ? Promise.reject(new Error('404'))
        : Promise.reject(new AcquisitionError('TIMEOUT', 'délai dépassé'));

    const first = setup({ fetch: timeout });
    expect(await handleDiscoverMessage(first.ports, message(1))).toEqual({
      kind: 'retry',
      code: 'TIMEOUT',
    });
    expect(first.failed).toEqual([]);

    const last = setup({ fetch: timeout });
    expect(await handleDiscoverMessage(last.ports, message(3))).toEqual({
      kind: 'abandoned',
      code: 'TIMEOUT',
    });
    expect(last.failed).toEqual(['TIMEOUT']);
  });

  it('ne journalise que l’hôte, jamais l’URL complète', async () => {
    const { ports, logs } = setup({});

    await handleDiscoverMessage(ports, message());

    expect(JSON.stringify(logs)).not.toContain('https://');
  });
});
