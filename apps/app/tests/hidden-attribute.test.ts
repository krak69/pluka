import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `hidden` ne masque un élément que tant qu'aucune règle ne lui donne un
 * `display`. Le 2026-11-25, « Conditions particulières » ne se repliait plus :
 * `.nu-cond-panel { display: grid }` l'emportait sur `hidden`, et le clic
 * semblait ne rien faire. Tout élément masqué par `hidden` dont la classe
 * reçoit un `display` doit donc avoir sa règle `.classe[hidden]`.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(directory = ''): readonly string[] {
  return readdirSync(join(SRC, directory), { withFileTypes: true }).flatMap((entry) => {
    const child = directory === '' ? entry.name : posix.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return child.endsWith('.tsx') ? [child] : [];
  });
}

/** Les classes portées par un élément qui reçoit `hidden={…}`. */
function hiddenClasses(source: string): readonly string[] {
  const classes: string[] = [];
  for (const match of source.matchAll(/\shidden=\{/g)) {
    const tagStart = source.lastIndexOf('<', match.index);
    const tag = source.slice(tagStart, match.index);
    const className = /className="([^"]+)"/.exec(tag)?.[1];
    if (className !== undefined) classes.push(...className.split(/\s+/));
  }
  return classes;
}

const css = readFileSync(join(SRC, 'app', 'shell.css'), 'utf8');

/** La classe reçoit-elle un `display` autre que `none`, hors règle `[hidden]` ? */
function displayed(className: string): boolean {
  const rule = new RegExp(`\\.${className}(?![\\w-])[^{]*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(rule)].some(
    ([selector, body]) => !selector.includes('[hidden]') && /display:\s*(?!none)/.test(body ?? ''),
  );
}

function hiddenRule(className: string): boolean {
  return new RegExp(`\\.${className}\\[hidden\\][^{]*\\{[^}]*display:\\s*none`).test(css);
}

describe('hidden masque vraiment', () => {
  it('chaque classe masquée par hidden et qui reçoit un display a sa règle [hidden]', () => {
    const offenders = sourceFiles().flatMap((moduleId) =>
      hiddenClasses(readFileSync(join(SRC, moduleId), 'utf8'))
        .filter((className) => displayed(className) && !hiddenRule(className))
        .map((className) => `${moduleId} : .${className}`),
    );

    expect(offenders, 'élément qui resterait visible malgré hidden').toEqual([]);
  });

  it('repère bien le cas des conditions particulières', () => {
    // Le garde-fou lui-même : la classe du panneau est lue, et sa règle trouvée.
    expect(hiddenClasses('<div id={id} className="nu-cond-panel" hidden={!open}>')).toEqual([
      'nu-cond-panel',
    ]);
    expect(displayed('nu-cond-panel')).toBe(true);
    expect(hiddenRule('nu-cond-panel')).toBe(true);
  });
});
