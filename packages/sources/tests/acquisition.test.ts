import { describe, expect, it } from 'vitest';

import {
  AcquisitionError,
  contentHash,
  decideSnapshot,
  describeCapture,
  isAllowedAddress,
  snapshotStoragePath,
  validateSourceUrl,
} from '../src/index.js';

/**
 * Étape 1 : acquisition et provenance.
 *
 * La politique SSRF est la partie la plus sensible de ce lot : une URL de
 * source vient d'une organisation, et le worker la suit avec les droits du
 * serveur. §12 en donne la liste exacte des plages à bloquer ; ces tests la
 * rejouent, plage par plage.
 */

describe('validation d’URL — §32.1', () => {
  it('accepte une URL publique en http et https', () => {
    expect(validateSourceUrl('https://organisation.example/reglement').ok).toBe(true);
    expect(validateSourceUrl('http://organisation.example/reglement').ok).toBe(true);
  });

  it('refuse tout autre schéma', () => {
    for (const url of ['file:///etc/passwd', 'ftp://x.example/a', 'gopher://x.example']) {
      const verdict = validateSourceUrl(url);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe('scheme_not_allowed');
    }
  });

  it('refuse une URL malformée', () => {
    const verdict = validateSourceUrl('pas une url');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('malformed');
  });

  it('refuse des identifiants dans l’URL', () => {
    // Ils finiraient dans les journaux et dans la provenance stockée.
    const verdict = validateSourceUrl('https://user:secret@organisation.example/x');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('credentials_in_url');
  });

  it('refuse un port de service interne', () => {
    // Fermer le balayage de ports par une URL publique.
    for (const url of [
      'http://x.example:5432/',
      'http://x.example:6379/',
      'http://x.example:22/',
    ]) {
      const verdict = validateSourceUrl(url);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe('port_not_allowed');
    }
  });

  it('accepte les ports web usuels', () => {
    for (const url of ['https://x.example/', 'https://x.example:443/', 'http://x.example:8080/']) {
      expect(validateSourceUrl(url).ok).toBe(true);
    }
  });

  it('refuse localhost sous toutes ses formes', () => {
    for (const url of [
      'http://localhost/x',
      'http://LOCALHOST/x',
      'http://localhost./x',
      'http://api.localhost/x',
      'http://service.internal/x',
      'http://box.local/x',
    ]) {
      const verdict = validateSourceUrl(url);
      expect(verdict.ok, url).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe('host_blocked');
    }
  });

  it('refuse l’hôte de métadonnées cloud', () => {
    // Le cas qui transforme une SSRF en fuite d'identifiants machine.
    expect(validateSourceUrl('http://metadata.google.internal/x').ok).toBe(false);
    expect(validateSourceUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
  });

  it('refuse une IP privée écrite directement', () => {
    // Sans résolution DNS pour l'attraper plus tard, la validation doit avoir
    // lieu à la lecture de l'URL.
    for (const url of [
      'http://127.0.0.1/x',
      'http://10.1.2.3/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
      'http://[::1]/x',
    ]) {
      expect(validateSourceUrl(url).ok, url).toBe(false);
    }
  });
});

describe('adresses résolues — §12', () => {
  it('bloque chaque plage citée par la spec', () => {
    const blocked = [
      '127.0.0.1', // 127.0.0.0/8
      '127.255.255.254',
      '10.0.0.1', // 10.0.0.0/8
      '172.16.0.1', // 172.16.0.0/12
      '172.31.255.254',
      '192.168.0.1', // 192.168.0.0/16
      '169.254.169.254', // 169.254.0.0/16
      '::1',
      'fc00::1', // fc00::/7
      'fd12:3456::1',
      'fe80::1', // fe80::/10
    ];

    for (const address of blocked) {
      expect(isAllowedAddress(address), address).toBe(false);
    }
  });

  it('bloque aussi les plages de même intention', () => {
    // Non citées mot pour mot par §12, mais aucune n'est une source de course.
    for (const address of ['0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isAllowedAddress(address), address).toBe(false);
    }
  });

  it('bloque une IPv4 encapsulée en IPv6', () => {
    // `::ffff:127.0.0.1` contournerait un filtre qui ne regarderait que la
    // famille d'adresses.
    expect(isAllowedAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isAllowedAddress('::ffff:10.0.0.1')).toBe(false);
  });

  it('laisse passer une adresse publique', () => {
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) {
      expect(isAllowedAddress(address), address).toBe(true);
    }
  });

  it('refuse une adresse illisible plutôt que de la laisser passer', () => {
    // En cas de doute, on bloque : c'est le sens d'une liste de refus.
    for (const address of ['', 'pas-une-ip', '999.1.1.1', '1.2.3']) {
      expect(isAllowedAddress(address), address).toBe(false);
    }
  });
});

describe('empreinte de contenu — §10', () => {
  it('calcule un SHA-256 stable', () => {
    // Vecteur connu : SHA-256 de la chaîne vide.
    expect(contentHash(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('rend la même empreinte pour les mêmes octets', () => {
    const bytes = new TextEncoder().encode('règlement 2026');

    expect(contentHash(bytes)).toBe(contentHash(new TextEncoder().encode('règlement 2026')));
  });

  it('distingue deux contenus qui ne diffèrent que d’un octet', () => {
    const a = new TextEncoder().encode('départ 04:00');
    const b = new TextEncoder().encode('départ 05:00');

    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

describe('provenance de capture — §9', () => {
  function capture(overrides: Record<string, unknown> = {}) {
    return {
      bytes: new TextEncoder().encode('<html>règlement</html>'),
      finalUrl: 'https://organisation.example/reglement-2026',
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
      ...overrides,
    };
  }

  it('retient l’URL finale, pas celle demandée', () => {
    // §11 étape 9 : c'est la destination réellement lue qui fait foi.
    expect(describeCapture(capture()).finalUrl).toBe('https://organisation.example/reglement-2026');
  });

  it('normalise le type de contenu sans ses paramètres', () => {
    // `charset` varie d'un serveur à l'autre sans changer la nature du contenu.
    expect(describeCapture(capture()).contentType).toBe('text/html');
  });

  it('mesure la taille en octets, pas en caractères', () => {
    // `<html>règlement</html>` fait 22 caractères mais 23 octets : le `è` en
    // occupe deux en UTF-8. C'est bien la taille de l'objet stocké qui doit
    // être enregistrée, celle que le stockage facturera et que le contrôle de
    // limite compare.
    const content = '<html>règlement</html>';
    const bytes = new TextEncoder().encode(content);

    expect(content).toHaveLength(22);
    expect(describeCapture(capture({ bytes })).sizeBytes).toBe(23);
    expect(describeCapture(capture({ bytes })).sizeBytes).toBe(bytes.byteLength);
  });

  it('accepte une capture sans métadonnée HTTP', () => {
    // Cas d'un fichier déposé plutôt que téléchargé.
    const provenance = describeCapture(
      capture({ finalUrl: null, httpStatus: null, contentType: null }),
    );

    expect(provenance.finalUrl).toBeNull();
    expect(provenance.contentType).toBeNull();
    expect(provenance.contentHash).toHaveLength(64);
  });
});

describe('déduplication — §10', () => {
  const hash = 'a'.repeat(64);

  it('crée le premier snapshot', () => {
    expect(decideSnapshot(hash, [])).toEqual({ kind: 'create', reason: 'first_capture' });
  });

  it('réutilise un contenu strictement identique', () => {
    // Le cas courant : un règlement relu chaque semaine et inchangé.
    expect(decideSnapshot(hash, [hash])).toEqual({ kind: 'reuse', reason: 'identical_content' });
  });

  it('crée un snapshot quand le contenu a changé', () => {
    // §36 fait de la détection de changement une fonctionnalité : elle repose
    // sur ce verdict.
    expect(decideSnapshot('b'.repeat(64), [hash])).toEqual({
      kind: 'create',
      reason: 'content_changed',
    });
  });

  it('reconnaît un contenu déjà vu, même s’il n’est plus le dernier', () => {
    // Une page revenue à son état antérieur ne crée pas un troisième snapshot.
    const older = 'c'.repeat(64);
    expect(decideSnapshot(older, [older, hash]).kind).toBe('reuse');
  });
});

describe('chemin de stockage', () => {
  it('adresse l’objet par son contenu', () => {
    // Deux captures identiques visent le même objet : le stockage devient
    // adressable par contenu, et le chemin reste reproductible.
    const path = snapshotStoragePath('source-1', 'a'.repeat(64));

    expect(path).toBe(`sources/source-1/${'a'.repeat(64)}`);
    expect(snapshotStoragePath('source-1', 'a'.repeat(64))).toBe(path);
  });

  it('range les objets par source', () => {
    // Une purge de source devient un préfixe à supprimer.
    expect(snapshotStoragePath('source-2', 'b'.repeat(64)).startsWith('sources/source-2/')).toBe(
      true,
    );
  });
});

describe('erreurs d’acquisition', () => {
  it('classe en permanent ce qui ne guérira pas', () => {
    expect(new AcquisitionError('URL_REJECTED', 'x').permanent).toBe(true);
    expect(new AcquisitionError('ADDRESS_BLOCKED', 'x').permanent).toBe(true);
    expect(new AcquisitionError('CONTENT_TOO_LARGE', 'x').permanent).toBe(true);
  });

  it('classe en transitoire ce qui peut réussir plus tard', () => {
    expect(new AcquisitionError('TIMEOUT', 'x').permanent).toBe(false);
    expect(new AcquisitionError('NETWORK', 'x').permanent).toBe(false);
    expect(new AcquisitionError('HTTP_ERROR', 'x').permanent).toBe(false);
  });
});
