import { describe, expect, it } from 'vitest';

import { storageError } from '../src/repositories/gpx.js';

/**
 * La traduction d'un refus du stockage — incident du 2026-11-09 (0071).
 *
 * Un refus de policy est un refus de rôle ; une fonction de policy que la base
 * ne laisse pas exécuter est une panne, qui ne doit pas se lire comme un rôle.
 */

describe('storageError', () => {
  it('un refus de policy est un refus de droit', () => {
    const error = storageError(
      { statusCode: '403', message: 'new row violates row-level security policy' },
      'race_gpx.upload',
    );

    expect(error.code).toBe('permission_denied');
  });

  it('une fonction de policy inexécutable est une panne, pas un refus de rôle', () => {
    const error = storageError(
      { statusCode: '403', message: 'permission denied for function can_upload_edition_document' },
      'edition_document.upload',
    );

    expect(error.code).toBe('unknown');
  });

  it('un fichier trop gros reste une contrainte', () => {
    expect(storageError({ statusCode: '413', message: 'too large' }, 'race_gpx.upload').code).toBe(
      'constraint_violation',
    );
  });
});
