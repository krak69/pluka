import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Frontières du paquet — SOURCES_EXTRACTION §56, 01_ARCHITECTURE §4.5.
 *
 * Deux règles, et elles se vérifient sur les sources plutôt que sur une
 * intention :
 *
 * - `packages/sources` **ne définit aucune interface de fournisseur** :
 *   `AIProvider` appartient à `packages/contracts` et n'est qu'importé ;
 * - `packages/sources` **ne connaît le nom d'aucun fournisseur**. Un `if
 *   (provider.name === …)` glissé ici ferait entrer une dépendance de fait
 *   qu'aucun typage ne signalerait.
 *
 * S'y ajoute la pureté d'ensemble : ni réseau, ni base, ni Next. Elle date des
 * étapes 1 et 2 et l'extraction ne la relâche pas — le fournisseur est injecté,
 * jamais construit ici.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sources(directory: string = SRC): readonly { path: string; text: string }[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) return sources(path);
    if (!path.endsWith('.ts')) return [];

    return [{ path: path.slice(SRC.length + 1), text: readFileSync(path, 'utf8') }];
  });
}

const FILES = sources();

/** Le corps du fichier, commentaires retirés : une mention en prose ne compte pas. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('frontières du paquet', () => {
  it('lit bien tous ses fichiers', () => {
    expect(FILES.length).toBeGreaterThan(8);
  });

  it('ne définit aucune interface de fournisseur', () => {
    // §56 : « `packages/sources` importe `AIProvider` depuis
    // `packages/contracts` et n'y définit aucune interface de fournisseur. »
    const offenders = FILES.filter(({ text }) =>
      /(?:export\s+)?(?:interface|type)\s+\w*(?:AI|Weather|Email|Billing)?Provider\b/.test(
        code(text),
      ),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('importe AIProvider de packages/contracts, et de nulle part ailleurs', () => {
    const importing = FILES.filter(({ text }) => /\bAIProvider\b/.test(code(text)));

    expect(importing.length).toBeGreaterThan(0);

    for (const file of importing) {
      expect(code(file.text)).toMatch(
        /import type \{[^}]*AIProvider[^}]*\} from '@pluka\/contracts'/,
      );
    }
  });

  it('ne connaît le nom d’aucun fournisseur', () => {
    // Le paquet reçoit `provider.name`, le journalise, ne le teste jamais.
    const vendors = /\b(anthropic|openai|claude|gpt-|mistral|gemini|vertex|bedrock|azure)\b/i;
    const offenders = FILES.filter(({ text }) => vendors.test(code(text)));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('ne fait ni réseau, ni base, ni Next', () => {
    // La pureté des étapes 1 et 2, que l'extraction ne relâche pas : le
    // fournisseur est injecté par l'appelant, jamais construit ici.
    const forbidden = /from '(?:next|@supabase|node:https?|undici)|\bfetch\s*\(|createClient\s*\(/;
    const offenders = FILES.filter(({ text }) => forbidden.test(code(text)));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});
