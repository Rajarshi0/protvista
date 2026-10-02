/**
 * Which non-canonical fields a decoded feature record may carry.
 *
 * The CSV/TSV and JSON feature decoders keep every column or key an author
 * adds beyond `type, start, end, description, score`, so a file and the same
 * records written inline render the same way (see "Unrecognised fields" in
 * `specs/config-approach.md`). One rule, shared by both decoders, sorts each
 * extra name into a group:
 *
 *   - **render** — `color`, `shape`, `fill`, `opacity`. Nightingale reads these
 *     per record ahead of the track's `rendering:`, so they are trimmed,
 *     type-checked, and left off when blank (a blank cell must not override the
 *     track's colour, and a blank `opacity` would paint the feature invisible).
 *   - **blocked** — names decoded data must never set: `tooltipContent` (the
 *     popover inserts it as raw HTML), `locations` / `residuesToHighlight` (the
 *     canvas iterates them and crashes on a string), and every name on
 *     `Object.prototype` (`__proto__` would replace the record's prototype;
 *     `toString` & co. would shadow methods downstream code calls). Dropped,
 *     and named in one warning per decode.
 *   - **skip** — the empty name a trailing delimiter leaves in a header.
 *     Dropped silently, as it always was.
 *   - **extra** — everything else, kept verbatim for `dataTooltip`.
 *
 * Structured inline records and `setTrackData()` payloads never pass through
 * here: they are trusted config and may still set the viewer fields.
 *
 * Nothing here logs. A decoder pushes the warnings below into the sink its
 * caller passed (`PipelineOptions.warnings`); the loader returns them and the
 * element routes each one as a `track-data` warning (`src/errors/router.ts`).
 */

import { isPaintableColor } from '../feature-vocabulary.js';

/**
 * The fields with rules of their own (`./dsv`, `./features-json`), validated
 * exactly as before pass-through and never copied as extras.
 */
export const FEATURE_CANONICAL_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'start',
  'end',
  'description',
  'score',
]);

/** Per-record styling fields Nightingale reads ahead of the track's own. */
export const FEATURE_RENDER_FIELDS = [
  'color',
  'shape',
  'fill',
  'opacity',
] as const;

/** Fields the viewer sets or iterates, never taken from decoded data. */
export const FEATURE_VIEWER_FIELDS = [
  'tooltipContent',
  'locations',
  'residuesToHighlight',
] as const;

const RENDER = new Set<string>(FEATURE_RENDER_FIELDS);
const VIEWER = new Set<string>(FEATURE_VIEWER_FIELDS);

/**
 * Sort a non-canonical field name into its group. Matching is
 * case-sensitive: `Color` is a plain extra, not a render field.
 *
 * `name in Object.prototype` covers `__proto__` as well as the methods, which
 * is what makes plain assignment of every name that is not blocked safe.
 */
export function classifyExtraField(
  name: string
): 'render' | 'blocked' | 'skip' | 'extra' {
  if (name === '') return 'skip';
  if (VIEWER.has(name) || name in Object.prototype) return 'blocked';
  return RENDER.has(name) ? 'render' : 'extra';
}

/**
 * A finding a decoder reports rather than logs. `code` is the runtime
 * `ValidationIssueCode` the element puts on the routed event's issue;
 * `message` starts with the source label and carries no console prefix.
 */
export type DecodeWarning = {
  code: 'data-field-ignored' | 'unpaintable-color';
  message: string;
};

/** The names a warning lists: quoted, comma-separated. */
const quoteList = (names: readonly string[]): string =>
  names.map((n) => JSON.stringify(n)).join(', ');

/** One warning naming every blocked field a decode dropped. */
export function ignoredFieldsWarning(
  formatLabel: string,
  names: readonly string[]
): DecodeWarning {
  return {
    code: 'data-field-ignored',
    message:
      `${formatLabel}: ignored column(s) ${quoteList(names)} — these names ` +
      `are reserved by the viewer or by JavaScript and cannot come from a ` +
      `data file.`,
  };
}

/** At most this many offending colours are named in the warning. */
const MAX_LISTED_COLORS = 3;

/**
 * One warning for every row whose `color` / `fill` a browser will not paint.
 *
 * The values are kept on their records — `isPaintableColor` does not know
 * every modern CSS colour (`oklch()`, `lab()`, …), and dropping those would
 * discard colours that work. But a genuinely bad one (`#catFace`, `bleu`)
 * makes the canvas silently reuse the previous feature's colour, so the
 * author needs to hear about it.
 *
 * `rows` is how many records carry at least one such value; `values` are the
 * offending values in the order met, of which the first few distinct ones are
 * named.
 */
export function unpaintableColorWarning(
  formatLabel: string,
  rows: number,
  values: readonly string[]
): DecodeWarning {
  const distinct = [...new Set(values)];
  const shown = quoteList(distinct.slice(0, MAX_LISTED_COLORS));
  const more = distinct.length > MAX_LISTED_COLORS ? ', …' : '';
  return {
    code: 'unpaintable-color',
    message:
      `${formatLabel}: ${rows} row(s) have a colour the canvas cannot paint ` +
      `(${shown}${more}); those features are drawn in the previous ` +
      `feature's colour.`,
  };
}

/**
 * Whether a trimmed render-field value is a colour the canvas would not
 * paint. Only `color` and `fill` are checked: `shape` is not, matching the
 * track-level `rendering.shape` (Nightingale draws `?` and warns).
 */
export function isUnpaintable(name: string, value: string): boolean {
  return (name === 'color' || name === 'fill') && !isPaintableColor(value);
}
