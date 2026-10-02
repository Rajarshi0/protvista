/**
 * Template variables for data URLs.
 *
 * Every `{name}` in a data URL template resolves against one merged
 * dictionary, fed by three sources (lowest precedence first — later
 * sources override earlier ones):
 *
 *   1. `variables:` — the config's top-level block; baseline values
 *      shared by every mount of that config.
 *   2. `data-*` attributes on the host element — per-mount values.
 *      Read through `element.dataset`, so `data-dataset-id` reaches URLs
 *      as `{datasetId}` (the DOM's own kebab → camelCase rule).
 *   3. The named `accession` attribute — an alias for `data-accession`
 *      that wins on conflict, keeping `<protvista-uniprot
 *      accession="P05067">` the zero-learning-curve path. The element
 *      always has one (it won't load without it), so inside the element
 *      `data-accession` never reaches a URL; only direct
 *      `loadProtvistaData` callers see it.
 *
 * Tokens match `{[A-Za-z][A-Za-z0-9_]*}` and are case-sensitive. Braces
 * that don't match the grammar (`{foo-bar}`, `{1x}`) are literal text.
 *
 * Substituted values are URL-encoded (`encodeURIComponent`), so a value
 * can't add a path segment, query string, or fragment. Two kinds of value
 * are refused outright, because encoding can't make them safe: exactly
 * `.` or `..` (a dot-segment the URL parser collapses — `%2E%2E` too — so
 * the request would climb out of the template's path), and malformed
 * Unicode (a lone surrogate, which `encodeURIComponent` throws on).
 * `{accession}` is instead gated by {@link ACCESSION_PATTERN}, as it
 * always has been.
 *
 * Pure: no DOM, no `this`. The element supplies `dataset`; the loader
 * substitutes; the validator scans tokens.
 */

import type { NormalizedConfig } from './normalize.js';

/** A merged variables dictionary: token name → raw (unencoded) value. */
export type Variables = Record<string, string>;

/**
 * One `{token}`. Global, so callers must go through `matchAll` /
 * `replace` (which reset `lastIndex`) rather than `test` / `exec`.
 */
const TOKEN_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * Constrains the characters `accession` can carry before we interpolate
 * it into URL templates. Upstream UniProt accessions match
 * `[OPQ][0-9][A-Z0-9]{3}[0-9]` (six-char) or `[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9]`
 * (ten-char) — both comfortably ASCII. We accept the superset
 * `[A-Za-z0-9_-]{1,32}` so integration tests can use shapes like
 * `TEST-01` without loosening the gate for real-world input.
 *
 * Anything outside this character class (path separators, `?`, `#`,
 * `&`, `%`, whitespace, newline, control chars) is treated as
 * attacker-controlled and collapsed to an empty substitution. Other
 * variables have no domain grammar to check against, so they rely on
 * encoding plus the dot-segment / malformed-Unicode refusal.
 */
export const ACCESSION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Unique `{token}` names in `template`, in order of first appearance. */
export function templateTokens(template: string): string[] {
  return [...new Set([...template.matchAll(TOKEN_PATTERN)].map((m) => m[1]))];
}

/**
 * Merge the three variable sources. Precedence, lowest first:
 * `configVariables` < `dataset` < `accession`.
 *
 * `undefined` values are skipped, so an unset `accession` attribute
 * doesn't shadow `data-accession`. An empty string is a value — an
 * author who writes `data-species=""` gets an empty substitution.
 *
 * The result has a null prototype: a `{constructor}` token must not
 * resolve to `Object.prototype.constructor`.
 */
export function mergeVariables(sources: {
  configVariables?: Readonly<Record<string, string>>;
  dataset?: Readonly<Record<string, string | undefined>>;
  accession?: string;
}): Variables {
  const vars: Variables = Object.create(null);
  const assign = (from?: Readonly<Record<string, string | undefined>>) => {
    if (!from) return;
    for (const [key, value] of Object.entries(from)) {
      if (value !== undefined) vars[key] = value;
    }
  };
  assign(sources.configVariables);
  assign(sources.dataset);
  if (sources.accession !== undefined) vars.accession = sources.accession;
  return vars;
}

/**
 * The `data-*` attribute that supplies `token` — the inverse of the DOM's
 * `dataset` rule, so `{datasetId}` → `data-dataset-id`. HTML lowercases
 * attribute names, so `data-datasetId` would only ever supply `datasetid`.
 */
export function dataAttributeFor(token: string): string {
  return `data-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * `value` URL-encoded, or `null` when it can't safely fill a token: a
 * dot-segment (`.` / `..`) or malformed Unicode.
 */
function encodeValue(value: string): string | null {
  if (value === '.' || value === '..') return null;
  try {
    return encodeURIComponent(value);
  } catch {
    // URIError: a lone surrogate.
    return null;
  }
}

/**
 * Substitute every `{token}` in `template` from `vars`.
 *
 * Returns the substituted URL; or, when any token has no value, the names
 * that didn't resolve; or, when any value is refused (see the module
 * comment), the names whose values were invalid. Either way the caller
 * skips the fetch rather than request a half-built or unsafe URL.
 * Unresolved tokens are reported first.
 */
export function substituteTemplate(
  template: string,
  vars: Readonly<Variables>
): { url: string } | { unresolved: string[] } | { invalid: string[] } {
  const tokens = templateTokens(template);
  const unresolved = tokens.filter(
    (name) => !Object.prototype.hasOwnProperty.call(vars, name)
  );
  if (unresolved.length > 0) return { unresolved };
  const encoded = new Map<string, string>();
  const invalid: string[] = [];
  for (const name of tokens) {
    const value = vars[name];
    if (name === 'accession') {
      encoded.set(name, ACCESSION_PATTERN.test(value) ? value : '');
      continue;
    }
    const safe = encodeValue(value);
    if (safe === null) invalid.push(name);
    else encoded.set(name, safe);
  }
  if (invalid.length > 0) return { invalid };
  return {
    url: template.replace(TOKEN_PATTERN, (_, name: string) =>
      encoded.get(name)!
    ),
  };
}

/**
 * Every token any track's data URL references. The element uses it to
 * tell a `data-*` change that can alter a fetch from one that can't
 * (`data-testid`, say), so the latter doesn't refetch every track.
 */
export function referencedTokens(config: NormalizedConfig): Set<string> {
  const tokens = new Set<string>();
  for (const row of config.rows) {
    for (const track of row.tracks) {
      const url = track.data[0]?.url;
      if (url === undefined) continue;
      for (const u of Array.isArray(url) ? url : [url]) {
        for (const name of templateTokens(u)) tokens.add(name);
      }
    }
  }
  return tokens;
}
