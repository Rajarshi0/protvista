/**
 * ProtVista config loader.
 *
 * Orchestrates the parse → validate → normalize pipeline that takes
 * author input (a JSON string, a YAML string, or an already-parsed
 * object) and returns the `NormalizedConfig` shape that
 * `<protvista-uniprot>` can mount directly.
 *
 *   author input  →  parse  →  validate  →  normalize  →  render
 *                    ^         ^            ^
 *                    this     this         this file
 *
 * The split between `loadConfig` (this file) and `validateConfig`
 * (`validate.ts`) exists so that editor tooling, linters, and CI
 * scripts can run the validator without paying for the YAML parser
 * and without committing to the normalize step's shape mutation.
 *
 *
 * ## YAML handling
 *
 * `js-yaml` is lazy-loaded via `import()` — JSON-only adopters never
 * download it. Detection is content-based rather than filename-based
 * so consumers can read a `.yaml` file and pass its contents through
 * the same entry point they use for JSON strings. A string that
 * starts with `{` or `[` (after trimming whitespace) is treated as
 * JSON; anything else is treated as YAML.
 *
 *
 * ## Error contract
 *
 * Two failure modes:
 *
 *   - `SyntaxError` (standard): the input is not a legal JSON or
 *     YAML document. We let the underlying parser's error propagate
 *     so the caller sees the line/column information that parser
 *     surfaces.
 *
 *   - `ConfigValidationError`: the parsed object violates the schema
 *     or the semantic rules. Carries a `.issues[]` array with every
 *     problem (not just the first), so a web UI can render a full
 *     checklist rather than forcing a whack-a-mole edit cycle.
 *
 * `loadConfig` is `async` because of the YAML lazy-load; for
 * JSON-only inputs, the resolved promise is available on the
 * microtask queue and the cost is negligible.
 *
 *
 * ## Sequence-only mode
 *
 * A config that sets `sequence:` instead of `accession:` is resolved here,
 * the way `extends:` is: between parse and render, with an injectable
 * fetcher. After the config validates, an inline sequence is parsed and a
 * file reference is fetched (`sequenceFetcher`, default `globalThis.fetch`
 * with the 2 MiB ceiling `extends:` uses) and parsed; the result reaches the
 * renderer as `NormalizedConfig.sequence`. A fetch or parse failure is a
 * `ConfigValidationError` at `/sequence` (`cannot-resolve-sequence` /
 * `invalid-sequence`), never a raw `TypeError`.
 *
 * The loader also adds the checks only it can make, because only it knows
 * the caller's accession, whether the config was extended, and whether a
 * protein is required: a host accession plus `sequence:`
 * (`accession-and-sequence`), an `extends:` summary when inherited tracks
 * need UniProt (`needs-accession` at `/extends`), and a viewer with no
 * protein at all (`missing-protein`, with `requireProtein`). This module
 * logs nothing and dispatches nothing — every failure is thrown.
 */

import type { ProtvistaViewerConfig } from './types.js';
import { type Registry, createRegistry } from './registry.js';
import { ACCESSION_OR_SEQUENCE_GUIDANCE, validateConfig } from './validate.js';
import { isPlainObject } from './shape.js';
import { normalizeConfig, type NormalizedConfig } from './normalize.js';
import {
  ConfigValidationError,
  isError,
  type ValidationIssue,
} from './errors.js';
import { parseConfigText, type ParseFormat } from './parse.js';
import {
  mergeExtends,
  type ExtendsResolver,
  type ExtendsFetcher,
} from './extends.js';
import {
  isSequenceReference,
  parseSequenceText,
  type ResolvedSequence,
} from './sequence.js';
import {
  fetchTextCapped,
  FetchTextError,
  MAX_FETCH_TEXT_BYTES,
} from './fetch-text.js';

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export interface LoadConfigOptions {
  /**
   * Registry used for semantic validation and normalize-time kind
   * resolution. Defaults to a fresh registry with only built-ins
   * seeded (`createRegistry()`); pass your own when you have custom
   * adapters / kinds / themes registered.
   */
  registry?: Registry;

  /**
   * Force a particular parser. Useful for tests or when the input
   * string's content-based detection would misfire (e.g. a YAML
   * document whose first line happens to be `{}`). Defaults to
   * `'auto'` which detects from the leading character.
   */
  format?: ParseFormat;

  /**
   * Resolver invoked for each `extends` name before falling back to
   * URL / file fetching. Accept a function for dynamic lookups or a
   * plain object keyed by preset name for fixed tables.
   *
   * Used to wire the (deferred-in-spec) preset registry without
   * baking the namespace into the loader itself.
   */
  extendsResolver?:
    | ExtendsResolver
    | Record<string, ProtvistaViewerConfig | string>;

  /**
   * Fetch implementation for URL / file-path `extends` entries.
   * Defaults to `globalThis.fetch`. Provide a stub in tests or a
   * filesystem-backed fetcher in Node environments without fetch.
   */
  extendsFetcher?: ExtendsFetcher;

  /**
   * UniProt accession supplied by the mounting code (for
   * `<protvista-uniprot>`, this is the `accession` HTML attribute).
   *
   * The default config is a template: its URLs and label URLs carry
   * `{accession}` placeholders that the element resolves at fetch
   * time. The `missing-accession` validator rule refuses to accept
   * such a template without a declared accession — this option lets
   * the caller answer "an accession *will* be supplied at runtime,
   * here it is" without mutating the template itself.
   *
   * When set, and the parsed config does not already declare its own
   * `accession`, `loadConfig` injects this value into the config
   * before validation runs. A config that already carries an
   * accession is left untouched (authors opt in to per-config
   * accessions, and the HTML attribute must not silently override
   * them).
   *
   * Passing it for a config that declares `sequence:` is an error
   * (`accession-and-sequence`): a viewer shows a UniProt entry or your own
   * protein, never both. It is not injected into such a config.
   */
  accession?: string;

  /**
   * Fetch implementation for a `sequence:` that names a FASTA file.
   * Defaults to `globalThis.fetch` with a 2 MiB ceiling, the same as
   * `extendsFetcher`. Provide a stub in tests or a filesystem-backed
   * fetcher under Node, where a relative path can't be fetched.
   */
  sequenceFetcher?: (url: string) => Promise<string>;

  /**
   * Require a protein: with neither an accession (this option or the
   * config's) nor a `sequence:`, fail with `missing-protein` rather than
   * accepting a protein-less template. `<protvista-uniprot>` sets it, since
   * a mounted viewer with nothing to show would otherwise render blank.
   * Editor tooling leaves it off: the default config is such a template.
   */
  requireProtein?: boolean;

  /**
   * Template variables the mounting code will supply at runtime (for
   * `<protvista-uniprot>`, the host's `data-*` attributes). Only the
   * *names* are used, so the `missing-variable` validator rule accepts a
   * `{token}` the host provides; nothing is injected into the config —
   * values are read at fetch time, so a later attribute change applies.
   */
  variables?: Record<string, string | undefined>;
}

/**
 * Parse, validate, and normalize a ProtVista viewer config.
 *
 * Accepts three input forms:
 *
 *   - An **object** — skips the parse step and runs straight into
 *     validation. Use this form when you already have a JSON module
 *     in hand (e.g. `import config from './config.json'`).
 *   - A **JSON string** — parsed via `JSON.parse`.
 *   - A **YAML string** — parsed via `js-yaml` (lazy-loaded).
 *
 * Warnings — issues on a config that still validates — are dropped by this
 * entry point. Use `loadConfigWithSource` to see them.
 *
 * @throws `SyntaxError` if the string cannot be parsed.
 * @throws `ConfigValidationError` if the parsed object does not
 *   validate. The error carries a full `issues[]` array.
 */
export async function loadConfig(
  input: unknown,
  opts: LoadConfigOptions = {}
): Promise<NormalizedConfig> {
  return (await loadConfigWithSource(input, opts)).config;
}

/**
 * The result of `loadConfigWithSource`: the normalized config the renderer
 * consumes, paired with the authored object it came from.
 */
export interface LoadedConfig {
  config: NormalizedConfig;
  /**
   * The validated authored config, after `extends` resolution and accession
   * injection but *before* normalization — so it still reads the way an
   * author would write it, without the resolved rendering cascade, the
   * synthetic standalone wrappers, or the filled-in labels.
   *
   * The viewer keeps this as the baseline for `getConfig()`, so a config
   * exported after the user rearranges the layout stays close to the input
   * rather than ballooning into a fully-explicit dump.
   */
  authored: ProtvistaViewerConfig;
  /**
   * Issues the validator raised on a config it nonetheless accepted — the
   * warnings, since an error would have thrown.
   *
   * Returned rather than logged because a warning that only reaches the
   * console reaches nothing that matters: not the `protvista-error` event,
   * not the ⚠ badge, not CI. The caller decides which of those to feed; the
   * element feeds all three through its own reporter.
   */
  issues: ValidationIssue[];
}

/**
 * `loadConfig`, but also returning the authored config the normalized one was
 * derived from. Separate entry point so the common case keeps the simpler
 * return type and only the viewer (which needs to export edited configs)
 * pays attention to the source object.
 */
export async function loadConfigWithSource(
  input: unknown,
  opts: LoadConfigOptions = {}
): Promise<LoadedConfig> {
  const registry = opts.registry ?? createRegistry();

  const parsed = await parseInput(input, opts.format ?? 'auto');

  // `extends` resolution runs BETWEEN parse and validate so partial
  // child configs (e.g. `extends: "./base-config.yaml"` plus one
  // tiny override) merge against their bases before the required-
  // fields check fires. `mergeExtends` is a no-op (sans the
  // unconditional strip of `extends`) for configs that don't use the
  // feature, so JSON-only adopters pay nothing extra for its
  // presence in the pipeline.
  // `mergeExtends` strips `extends`, so note now whether the config used it.
  const extended = isPlainObject(parsed) && parsed.extends !== undefined;
  const merged = await resolveExtends(parsed, opts);
  const declaresSequence =
    isPlainObject(merged) && merged.sequence !== undefined;

  // Inject the caller-supplied accession *before* validation so the
  // `missing-accession` rule sees it. We only inject when the config
  // doesn't already declare one — otherwise an HTML-attribute
  // accession would silently override an accession the author
  // deliberately hard-coded, which would be more surprising than
  // helpful. Never into a `sequence:` config, where a host accession
  // is an error of its own (below) rather than a fill-in.
  const withAccession = declaresSequence
    ? merged
    : injectAccession(merged, opts.accession);

  const result = validateConfig(withAccession, registry, {
    runtimeVariables: Object.keys(opts.variables ?? {}),
  });
  const issues = [
    ...result.issues,
    ...contextIssues(withAccession, result.issues, opts, extended),
  ];
  if (opts.requireProtein && issues.some((i) => i.code === 'missing-protein')) {
    // One problem, one issue: "no protein" already explains every
    // unfilled `{accession}`.
    removeWhere(issues, (i) => i.code === 'missing-accession');
  }
  if (!result.valid || issues.some(isError)) {
    throw new ConfigValidationError(issues);
  }
  // `validateConfig` has proven `withAccession` conforms to the
  // schema, so the cast below is sound. TypeScript's inability to
  // narrow from `ValidationResult` to the config type is expected.
  const authored = withAccession as ProtvistaViewerConfig;
  // Resolved only now, so a broken config never triggers a request. The
  // authored config keeps the path, so `getConfig()` still exports it.
  const sequence =
    authored.sequence === undefined
      ? undefined
      : await resolveSequence(authored.sequence, opts);
  return {
    config: normalizeConfig(authored, { registry, sequence }),
    authored,
    issues,
  };
}

/**
 * The issues only the loader can raise, from what it knows beyond the config
 * text: the caller's accession, whether `extends:` was used, and whether a
 * protein is required.
 */
function contextIssues(
  config: unknown,
  validatorIssues: readonly ValidationIssue[],
  opts: LoadConfigOptions,
  extended: boolean
): ValidationIssue[] {
  if (!isPlainObject(config)) return [];
  const out: ValidationIssue[] = [];
  const hostAccession = opts.accession;

  if (config.sequence !== undefined) {
    // The config-level form (`accession:` beside `sequence:`) is the
    // validator's; this is the same conflict arriving from the host.
    if (hostAccession && config.accession === undefined) {
      out.push({
        path: '/',
        message:
          `An accession ('${hostAccession}') was supplied by the host (the element's accession attribute), ` +
          `but this config declares 'sequence:'. ${ACCESSION_OR_SEQUENCE_GUIDANCE} ` +
          "Remove the attribute, or the 'sequence:'.",
        code: 'accession-and-sequence',
      });
    }
    const needs = validatorIssues.filter(
      (i) => i.code === 'needs-accession'
    ).length;
    if (extended && needs > 0) {
      out.push({
        path: '/extends',
        message:
          `${needs} track${needs === 1 ? '' : 's'} inherited through 'extends:' ` +
          `need${needs === 1 ? 's' : ''} UniProt data. 'sequence:' can't build on the ` +
          'UniProt default config — start from a blank config instead.',
        code: 'needs-accession',
      });
    }
  } else if (opts.requireProtein && config.accession === undefined) {
    out.push({
      path: '/',
      message:
        "Nothing to show: set 'accession:' (a UniProt entry) or 'sequence:' (your own protein), " +
        "or the element's accession attribute.",
      code: 'missing-protein',
    });
  }
  return out;
}

/**
 * Turn a validated `sequence:` into residues: parse it in place, or fetch the
 * FASTA file it names and parse that. Every failure is a
 * `ConfigValidationError` at `/sequence`.
 */
async function resolveSequence(
  value: string,
  opts: LoadConfigOptions
): Promise<ResolvedSequence> {
  const reference = isSequenceReference(value) ? value.trim() : undefined;
  let text = value;
  if (reference !== undefined) {
    const fetcher = opts.sequenceFetcher ?? fetchTextCapped;
    try {
      text = await fetcher(reference);
    } catch (err) {
      throw new ConfigValidationError([
        {
          path: '/sequence',
          message: `Could not load the sequence file '${reference}': ${describeFetchFailure(err)}.`,
          code: 'cannot-resolve-sequence',
        },
      ]);
    }
  }
  const parsed = parseSequenceText(text, reference);
  if (!parsed.ok) {
    throw new ConfigValidationError([
      { path: '/sequence', message: parsed.message, code: 'invalid-sequence' },
    ]);
  }
  return parsed.value;
}

/** Why a sequence fetch failed, in a few words. */
function describeFetchFailure(err: unknown): string {
  if (err instanceof FetchTextError) {
    const f = err.failure;
    switch (f.reason) {
      case 'http':
        return `HTTP ${f.status}${f.statusText ? ` ${f.statusText}` : ''}`;
      case 'too-large':
        return `the file is ${f.bytes} bytes, over the ${MAX_FETCH_TEXT_BYTES}-byte ceiling`;
      case 'no-fetch':
        return 'no fetch implementation is available — pass sequenceFetcher';
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\.$/, '');
}

function removeWhere<T>(items: T[], drop: (item: T) => boolean): void {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (drop(items[i])) items.splice(i, 1);
  }
}

/**
 * Return a shallow clone of `parsed` with `accession` set, when the
 * caller supplied one and the config didn't already declare its own.
 * Non-object inputs pass through unchanged; the validator will
 * surface a readable schema error for them.
 */
function injectAccession(parsed: unknown, accession: string | undefined) {
  if (accession === undefined) return parsed;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }
  const cfg = parsed as ProtvistaViewerConfig;
  if (cfg.accession !== undefined) return parsed;
  return { ...cfg, accession };
}

async function resolveExtends(
  parsed: unknown,
  opts: LoadConfigOptions
): Promise<unknown> {
  // Non-object inputs (null, array, primitive) skip the merger; the
  // validator will reject them with a readable schema error.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }
  const cfg = parsed as ProtvistaViewerConfig;
  if (cfg.extends === undefined) return cfg;
  return mergeExtends(cfg, {
    resolver: opts.extendsResolver,
    fetcher: opts.extendsFetcher,
  });
}

// ─────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────

async function parseInput(
  input: unknown,
  format: ParseFormat
): Promise<unknown> {
  // Object input — nothing to parse.
  if (input !== null && typeof input === 'object') {
    return input;
  }

  if (typeof input !== 'string') {
    throw new TypeError(
      `loadConfig expects an object, JSON string, or YAML string; received ${typeof input}.`
    );
  }

  return parseConfigText(input, format);
}
