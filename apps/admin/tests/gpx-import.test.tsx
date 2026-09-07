import type { RaceGpxImport } from '@pluka/domain';
import { importRaceGpxCommandSchema } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GpxImportStatus } from '@/app/courses/[raceId]/gpx-import-status';
import { ImportGpxForm } from '@/app/courses/[raceId]/import-gpx-form';

/**
 * Import GPX sur l'écran d'une épreuve — 01_ARCHITECTURE §15, PLAN_ENGINE §8.
 *
 * C'est le seul point d'entrée du parcours : sans dépôt, pas de géométrie,
 * donc pas de micro-segments et aucun Plan. Ces tests relisent dans le
 * balisage rendu ce qu'un administrateur reçoit — le champ qu'il remplit, et
 * ce que l'écran lui dit de l'état du traitement.
 *
 * Le traitement est asynchrone : l'écran doit distinguer « en attente » de
 * « terminé » et de « en erreur », et ne jamais présenter un prétraitement
 * bloqué comme une réussite (§9.1).
 */

const RACE_ID = 'aaaaaaaa-0000-4000-8000-000000000013';

function importState(overrides: Partial<RaceGpxImport> = {}): RaceGpxImport {
  return {
    raceId: RACE_ID,
    officialDistanceMeters: 42000,
    officialElevationGainMeters: 2000,
    source: null,
    snapshot: null,
    job: null,
    geometry: null,
    stage: 'none',
    quality: [],
    ...overrides,
  } as RaceGpxImport;
}

function job(overrides: Record<string, unknown> = {}): RaceGpxImport['job'] {
  return {
    status: 'completed',
    attempts: 1,
    maxAttempts: 5,
    lastError: null,
    startedAt: '2026-03-01T08:00:00Z',
    completedAt: '2026-03-01T08:01:00Z',
    ...overrides,
  } as RaceGpxImport['job'];
}

function geometry(overrides: Record<string, unknown> = {}): RaceGpxImport['geometry'] {
  return {
    id: 'gggggggg-0000-4000-8000-000000000001',
    versionNumber: 1,
    pointCount: 4820,
    lengthMeters: 42150,
    elevationGainMeters: 2050,
    elevationLossMeters: 2050,
    processorVersion: 'gpx-processor-1',
    processedAt: '2026-03-01T08:01:00Z',
    preprocessingStatus: 'completed',
    preprocessingIssue: null,
    preprocessingWarnings: [],
    preprocessedAt: '2026-03-01T08:01:00Z',
    microSegmentCount: 421,
    ...overrides,
  } as RaceGpxImport['geometry'];
}

const FORM = renderToStaticMarkup(<ImportGpxForm raceId={RACE_ID} />);

describe('formulaire de dépôt', () => {
  it('porte un champ fichier et l’épreuve visée', () => {
    expect(FORM).toContain('name="gpx"');
    expect(FORM).toContain('type="file"');
    expect(FORM).toContain(`name="raceId" value="${RACE_ID}"`);
  });

  it('filtre la sélection sur les .gpx', () => {
    // Confort de sélecteur, pas une validation : le refus qui fait autorité
    // vient du domaine.
    expect(FORM).toContain('accept=".gpx,application/gpx+xml"');
  });

  it('transmet ce que la commande du domaine attend', () => {
    // Le nom des champs relie le formulaire à l'action ; ce que l'action en
    // tire doit passer le schéma sans retouche.
    const command = {
      raceId: RACE_ID,
      fileName: 'parcours.gpx',
      content: '<gpx />',
      contentHash: 'a'.repeat(64),
    };

    expect(importRaceGpxCommandSchema.safeParse(command).success).toBe(true);
  });

  it('ne transmet aucune identité d’acteur', () => {
    // L'autorité est relue en base par `importRaceGpx` (03_PRIVACY_RLS §11).
    expect(FORM).not.toContain('userId');
    expect(FORM).not.toContain('platformRole');
  });

  it('ne nomme ni le bucket ni un chemin de stockage', () => {
    // Le chemin est une donnée d'autorisation, construite par `@pluka/db`.
    expect(FORM).not.toContain('race-sources');
    expect(FORM).not.toContain('races/');
  });
});

describe('état du traitement', () => {
  it('dit qu’aucun GPX n’a été importé, et ce que ça empêche', () => {
    const markup = renderToStaticMarkup(<GpxImportStatus status={importState()} />);

    expect(markup).toContain('Aucun GPX importé');
    expect(markup).toContain('aucun Plan ne peut être calculé');
  });

  it('affiche l’attente après le dépôt', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({ stage: 'queued', job: job({ status: 'queued', attempts: 0 }) })}
      />,
    );

    expect(markup).toContain('En attente de traitement');
  });

  it('affiche l’erreur et le compte des tentatives', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'failed',
          job: job({
            status: 'failed',
            attempts: 5,
            lastError: 'parsing refusé (aucun point de trace)',
          }),
        })}
      />,
    );

    expect(markup).toContain('En erreur');
    expect(markup).toContain('parsing refusé (aucun point de trace)');
    expect(markup).toContain('5 tentatives sur 5');
  });

  it('affiche les faits de la géométrie une fois le traitement terminé', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({ stage: 'completed', job: job(), geometry: geometry() })}
      />,
    );

    expect(markup).toContain('Terminé');
    expect(markup).toContain('4820');
    expect(markup).toContain('42.15');
    expect(markup).toContain('421');
    expect(markup).toContain('gpx-processor-1');
  });

  it('ne présente pas un prétraitement bloqué comme une réussite — §9.1', () => {
    // La géométrie est valide, mais aucun Plan n'est possible : l'écran ne
    // doit pas afficher « Terminé ».
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'blocked',
          job: job(),
          geometry: geometry({ preprocessingStatus: 'blocked' }),
          quality: [
            {
              code: 'PREPROCESSING_BLOCKED',
              level: 'error',
              message: 'waypoint « Ravito 2 » à 312 m de la trace',
            },
          ],
        })}
      />,
    );

    expect(markup).toContain('Prétraitement bloqué');
    expect(markup).not.toContain('Terminé');
  });

  it('distingue un prétraitement en attente d’un blocage', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'preprocessing_pending',
          job: job(),
          geometry: geometry({ preprocessingStatus: 'pending' }),
        })}
      />,
    );

    expect(markup).toContain('prétraitement en attente');
  });
});

describe('mesuré face au déclaré — §9', () => {
  const markup = renderToStaticMarkup(
    <GpxImportStatus
      status={importState({ stage: 'completed', job: job(), geometry: geometry() })}
    />,
  );

  it('montre le D+ mesuré à côté du D+ officiel', () => {
    // Le contrôle « D+ GPX vs officiel > 15 % » n'était pas constatable : le
    // D+ mesuré n'était persisté nulle part.
    expect(markup).toContain('2050 m');
    expect(markup).toContain('2000 m');
  });

  it('montre la distance mesurée à côté de la distance officielle', () => {
    expect(markup).toContain('42.15 km');
    expect(markup).toContain('42.00 km');
  });

  it('chiffre l’écart sans le résorber', () => {
    // 2050 contre 2000 : 2.5 %. Sous le seuil de §9, donc aucun warning — mais
    // l'écart reste lisible.
    expect(markup).toContain('2.5 % d’écart');
    expect(markup).not.toContain('Contrôles qualité');
  });

  it('ne prétend aucun écart quand la mesure manque', () => {
    // Une géométrie d'avant 0026 n'a pas de D+ : un tiret, pas un zéro.
    const older = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'completed',
          job: job(),
          geometry: geometry({ elevationGainMeters: null }),
        })}
      />,
    );

    expect(older).toContain('—');
  });

  it('ne compare rien tant qu’aucune géométrie n’existe', () => {
    expect(renderToStaticMarkup(<GpxImportStatus status={importState()} />)).not.toContain(
      'Mesuré sur la trace',
    );
  });
});

describe('contrôles qualité — §9.1', () => {
  it('nomme l’écart constaté, sans le corriger', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'completed',
          job: job(),
          geometry: geometry({ lengthMeters: 60000 }),
          quality: [
            {
              code: 'GPX_DISTANCE_MISMATCH',
              level: 'warning',
              message: 'écart de 42.9 % entre la distance GPX et la distance officielle',
            },
          ],
        })}
      />,
    );

    expect(markup).toContain('Contrôles qualité');
    expect(markup).toContain('GPX_DISTANCE_MISMATCH');
    expect(markup).toContain('écart de 42.9 %');
    // La valeur mesurée reste affichée telle quelle : l'écran constate, il ne
    // réaligne pas sur la distance officielle.
    expect(markup).toContain('60.00');
  });

  it('affiche le motif d’un blocage', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'blocked',
          job: job(),
          geometry: geometry({ preprocessingStatus: 'blocked' }),
          quality: [
            {
              code: 'PREPROCESSING_BLOCKED',
              level: 'error',
              message: 'waypoint « Ravito 2 » à 312 m de la trace',
            },
          ],
        })}
      />,
    );

    expect(markup).toContain('waypoint « Ravito 2 » à 312 m de la trace');
  });

  it('affiche le contrôle de D+ de §9', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'completed',
          job: job(),
          geometry: geometry({ elevationGainMeters: 3200 }),
          quality: [
            {
              code: 'GPX_GAIN_MISMATCH',
              level: 'warning',
              message: 'écart de 60.0 % entre le D+ GPX et le D+ officiel',
            },
          ],
        })}
      />,
    );

    expect(markup).toContain('GPX_GAIN_MISMATCH');
    expect(markup).toContain('60.0 %');
    // Le D+ mesuré reste celui du fichier : §9.1 interdit de le corriger.
    expect(markup).toContain('3200 m');
  });

  it('distingue un avertissement d’une erreur sans compter sur la couleur — §185', () => {
    const blocked = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'blocked',
          job: job(),
          geometry: geometry({ preprocessingStatus: 'blocked' }),
          quality: [
            { code: 'PREPROCESSING_BLOCKED', level: 'error', message: 'waypoint hors trace' },
          ],
        })}
      />,
    );

    expect(blocked).toContain('Erreur');

    const warned = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'completed',
          job: job(),
          geometry: geometry(),
          quality: [{ code: 'GPX_GAIN_MISMATCH', level: 'warning', message: 'écart de 60.0 %' }],
        })}
      />,
    );

    expect(warned).toContain('Avertissement');
  });

  it('signale un D+ mesuré absent — §9.0', () => {
    // C'est ce que l'écran ne disait pas : il a fallu une requête SQL manuelle
    // pour découvrir le `null`. Le refus du Plan seul ne suffisait pas — il
    // n'arriverait qu'au moment où quelqu'un tente un calcul.
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({
          stage: 'completed',
          job: job(),
          geometry: geometry({ elevationGainMeters: null }),
          quality: [
            {
              code: 'GPX_GAIN_MISSING',
              level: 'error',
              message: 'le D+ mesuré manque sur la géométrie courante',
            },
          ],
        })}
      />,
    );

    expect(markup).toContain('GPX_GAIN_MISSING');
    expect(markup).toContain('Erreur');
    // Et la case du D+ mesuré porte un tiret, pas un zéro.
    expect(markup).toContain('—');
  });

  it('ne montre aucune section quand rien ne remonte', () => {
    const markup = renderToStaticMarkup(
      <GpxImportStatus
        status={importState({ stage: 'completed', job: job(), geometry: geometry() })}
      />,
    );

    expect(markup).not.toContain('Contrôles qualité');
  });
});
