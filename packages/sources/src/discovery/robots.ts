/**
 * robots.txt — SOURCES_EXTRACTION §11.1.
 *
 * Le strict nécessaire : les groupes `User-agent: *` et `User-agent: PLUKA`,
 * leurs `Disallow` et `Allow` par préfixe, la règle la plus longue gagnant.
 * Les jokers `*` et `$` sont compris, parce que les sites de course les
 * emploient souvent (« Disallow: /*.pdf$ »).
 *
 * Un robots.txt absent ou illisible n'interdit rien : c'est la convention du
 * fichier, pas une tolérance de PLUKA.
 */

export const DISCOVERY_USER_AGENT = 'PLUKA';

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
}

export interface RobotsPolicy {
  isAllowed(url: string): boolean;
}

const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true };

export function parseRobots(text: string | null): RobotsPolicy {
  if (text === null) return ALLOW_ALL;

  const ours: Rule[] = [];
  const anyone: Rule[] = [];

  let agents: string[] = [];
  let inRules = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // Une suite de `User-agent` partage le groupe qui suit ; une nouvelle
      // après des règles ouvre un groupe neuf.
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }

    if (field !== 'allow' && field !== 'disallow') continue;
    inRules = true;

    // `Disallow:` vide n'interdit rien.
    if (value === '') continue;

    const rule = { allow: field === 'allow', pattern: value };
    if (agents.includes(DISCOVERY_USER_AGENT.toLowerCase())) ours.push(rule);
    if (agents.includes('*')) anyone.push(rule);
  }

  // Un groupe nommé pour nous remplace le groupe générique.
  const rules = ours.length > 0 ? ours : anyone;
  if (rules.length === 0) return ALLOW_ALL;

  return {
    isAllowed(url: string): boolean {
      let path: string;
      try {
        const parsed = new URL(url);
        path = parsed.pathname + parsed.search;
      } catch {
        return false;
      }

      let best: Rule | null = null;
      for (const rule of rules) {
        if (!matches(rule.pattern, path)) continue;
        if (
          best === null ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }

      return best === null || best.allow;
    },
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}
