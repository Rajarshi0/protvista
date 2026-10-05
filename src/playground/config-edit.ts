/**
 * Edits the playground's config text to point a track at a loaded file.
 *
 * JSON configs are edited as data and re-serialised: JSON has no comments, so
 * nothing is lost but the author's whitespace. YAML configs are *spliced* —
 * the text around the edit is kept byte for byte, comments included — and
 * every splice is verified by parsing the result and comparing it with the
 * object the edit should produce. A layout the heuristics don't handle (a
 * flow-style `rows: [...]`, a `data:` inside a flow mapping) fails that check
 * and comes back as a snippet the user can paste. Never a silent corruption.
 *
 * DOM-free, so it unit-tests under jsdom.
 */
import type { DataFormat } from '../schema/types.js';
import { parseConfigText, yamlReader } from '../schema/parse.js';
import { createRegistry } from '../schema/registry.js';
import { isPlainObject } from '../schema/shape.js';
import { detectFormat } from './format.js';
import {
  findLocalReferences,
  firstFree,
  sanitizeName,
  splitName,
} from './local-files.js';

/** What a track's `data:` becomes: the shorthand path, or a descriptor. */
export type DataValue = string | { url: string; format: DataFormat };

/** A new standalone row, as {@link appendTrack} writes it. */
export interface NewRow {
  id: string;
  label: string;
  kind: string;
  data: DataValue;
}

/** An existing track a loaded file can be attached to. */
export interface TrackTarget {
  /** `GROUP/track` for a group's track, the row id for a standalone row. */
  path: string;
  /** What the picker shows. */
  label: string;
  rowIndex: number;
  /** Absent for a standalone row. */
  trackIndex?: number;
  /** The local path the track's data names today, if it names one. */
  ref?: string;
}

export type EditResult = { text: string } | { error: string; snippet: string };

type Obj = Record<string, unknown>;

/**
 * The tracks a file can be attached to: those with no `kind` (a file there is
 * read as feature records) and those whose kind declares a record shape. A
 * provider-only kind cannot read a file, so it is not offered. For an
 * `extends:` config only the child's own tracks are listed.
 */
export function listTargetTracks(parsed: unknown): TrackTarget[] {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.rows)) return [];
  const registry = createRegistry();
  const refs = new Map(
    findLocalReferences(parsed).map((r) => [r.trackPath, r.value])
  );
  const accepts = (track: Obj) =>
    track.kind === undefined ||
    (typeof track.kind === 'string' &&
      registry.getSemanticKind(track.kind)?.shape !== undefined);
  const named = (path: string, track: Obj) =>
    typeof track.label === 'string' && track.label !== path
      ? `${path} (${track.label})`
      : path;

  const targets: TrackTarget[] = [];
  parsed.rows.forEach((row, rowIndex) => {
    if (!isPlainObject(row) || typeof row.id !== 'string') return;
    if (Array.isArray(row.tracks)) {
      row.tracks.forEach((track, trackIndex) => {
        if (
          !isPlainObject(track) ||
          typeof track.id !== 'string' ||
          !accepts(track)
        ) {
          return;
        }
        const path = `${row.id}/${track.id}`;
        const ref = refs.get(path);
        targets.push({
          path,
          label: named(path, track),
          rowIndex,
          trackIndex,
          ...(ref ? { ref } : {}),
        });
      });
    } else if (row.data !== undefined && accepts(row)) {
      const ref = refs.get(row.id);
      targets.push({
        path: row.id,
        label: named(row.id, row),
        rowIndex,
        ...(ref ? { ref } : {}),
      });
    }
  });
  return targets;
}

/**
 * A row id for a file that no top-level row already uses: the file name's
 * stem, sanitised, with a `-2`, `-3`, … suffix on a collision.
 *
 * In an `extends:` child the base's rows are not here to check against, and
 * a new standalone row whose id a base group has would replace that whole
 * group in the merge. So the id gets a `-local` suffix there: `PTM.csv`
 * becomes `PTM-local`, not the default config's `PTM`.
 */
export function rowIdFor(fileName: string, parsed: unknown): string {
  const stem = splitName(fileName).stem.replace(/\./g, '-');
  const extending = isPlainObject(parsed) && parsed.extends !== undefined;
  const taken = new Set(
    isPlainObject(parsed) && Array.isArray(parsed.rows)
      ? parsed.rows.map((r) => (isPlainObject(r) ? r.id : undefined))
      : []
  );
  return firstFree(
    extending ? `${stem}-local` : stem,
    '',
    (id) => !taken.has(id)
  );
}

/**
 * A label for a new row: the file's own name, unless it holds characters
 * the label's Markdoc would read as markup, in which case the sanitised
 * name.
 */
export function rowLabelFor(fileName: string): string {
  return /[*`[\]{}<>\\]/.test(fileName) ? sanitizeName(fileName) : fileName;
}

// ── YAML text helpers ─────────────────────────────────────────

/** Whether a string can be written as a plain (unquoted) YAML scalar. */
type IsPlain = (value: string) => boolean;

/**
 * Characters a plain scalar may hold here: no indicator (`:`, `#`, `,`,
 * `[`, …) a block or flow context would read as syntax.
 */
const SAFE_PLAIN = /^[A-Za-z_./][A-Za-z0-9_./-]*$/;

/**
 * Words YAML 1.1 readers (PyYAML, older tools) take as booleans. The parser
 * reads them as strings, but quoting them keeps a copied config portable.
 */
const YAML11_BOOLEANS = /^(?:yes|no|on|off)$/i;

/**
 * The plain-scalar test, asking the parser the config is read with how it
 * reads the value rather than restating its schema: plain only when it reads
 * back as the same string (`.5`, `.inf`, `null` do not).
 */
async function plainTest(): Promise<IsPlain> {
  const read = await yamlReader();
  return (value) => {
    if (!SAFE_PLAIN.test(value) || YAML11_BOOLEANS.test(value)) return false;
    try {
      return read(value) === value;
    } catch {
      return false;
    }
  };
}

/** A scalar as YAML: plain when that reads back as the same string, else quoted. */
function yamlScalar(value: string, plain: IsPlain): string {
  return plain(value) ? value : JSON.stringify(value);
}

function yamlValue(value: DataValue, plain: IsPlain): string {
  return typeof value === 'string'
    ? yamlScalar(value, plain)
    : `{ url: ${yamlScalar(value.url, plain)}, format: ${value.format} }`;
}

function rowYaml(row: NewRow, indent: string, plain: IsPlain): string[] {
  return [
    `${indent}- id: ${yamlScalar(row.id, plain)}`,
    `${indent}  label: ${yamlScalar(row.label, plain)}`,
    `${indent}  kind: ${yamlScalar(row.kind, plain)}`,
    `${indent}  data: ${yamlValue(row.data, plain)}`,
  ];
}

const indentOf = (line: string): number =>
  line.length - line.trimStart().length;

/**
 * Deep equality over parsed config data, ignoring key order. A YAML `.nan`
 * equals itself (`Object.is`), and `0` still equals `-0` (`===`).
 */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b) || a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameData(item, b[i]))
    );
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && sameData(a[k], b[k])
    )
  );
}

/** The first candidate text that parses to `expected`, if any. */
async function firstVerified(
  candidates: Iterable<string>,
  expected: unknown
): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      if (sameData(await parseConfigText(candidate), expected))
        return candidate;
    } catch {
      // Not even parseable: try the next candidate.
    }
  }
  return undefined;
}

const asJson = (text: string, value: unknown): string =>
  JSON.stringify(value, null, 2) + (text.endsWith('\n') ? '\n' : '');

// ── Attach to an existing track ───────────────────────────────

/**
 * Every way of replacing one `data:` entry's value in `text` with `written`
 * (the new value as YAML): the key's own line plus any deeper-indented block
 * below it (or a sequence at the key's own indentation, which YAML allows
 * under a mapping key).
 */
function* dataSplices(text: string, written: string): Generator<string> {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)(-\s+)?data:(?=\s|$)/.exec(lines[i]);
    if (!match) continue;
    const keyCol = match[1].length + (match[2]?.length ?? 0);
    const inlineValue = lines[i]
      .slice(match[0].length)
      .replace(/#.*$/, '')
      .trim();
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') continue;
      const deeper = indentOf(line) > keyCol;
      const sameColSequence =
        inlineValue === '' &&
        indentOf(line) === keyCol &&
        /^-(?:\s|$)/.test(line.trimStart());
      if (!deeper && !sameColSequence) break;
      end = j;
    }
    const replaced = `${match[1]}${match[2] ?? ''}data: ${written}`;
    yield [...lines.slice(0, i), replaced, ...lines.slice(end + 1)].join('\n');
  }
}

/**
 * Point an existing track's `data:` at `value`. Returns the new text, or —
 * when no splice verifies — an error and the line to paste.
 */
export async function attachToTrack(
  text: string,
  parsed: unknown,
  target: Pick<TrackTarget, 'rowIndex' | 'trackIndex' | 'path'>,
  value: DataValue
): Promise<EditResult> {
  const written = yamlValue(value, await plainTest());
  const snippet = `data: ${written}`;
  const expected = structuredClone(parsed);
  const rows =
    isPlainObject(expected) && Array.isArray(expected.rows)
      ? expected.rows
      : [];
  const row = rows[target.rowIndex];
  const track =
    target.trackIndex === undefined
      ? row
      : isPlainObject(row) && Array.isArray(row.tracks)
        ? row.tracks[target.trackIndex]
        : undefined;
  if (!isPlainObject(track)) {
    return { error: `Track ${target.path} is not in the config.`, snippet };
  }
  track.data = value;

  if (detectFormat(text) === 'json') return { text: asJson(text, expected) };
  const spliced = await firstVerified(dataSplices(text, written), expected);
  return spliced !== undefined
    ? { text: spliced }
    : {
        error: `Couldn't edit track ${target.path} automatically — set its data by hand:`,
        snippet,
      };
}

// ── Append a new track ────────────────────────────────────────

/**
 * The text with a new row added as the last top-level `rows:` entry; `entry`
 * writes the row's lines at an indent.
 */
function appendSplice(
  text: string,
  entry: (indent: string) => string[]
): string | undefined {
  const lines = text.split('\n');
  const rowsAt = lines.findIndex((line) => /^rows:/.test(line));
  if (rowsAt === -1) {
    // No `rows:` at all: start one at the end.
    const body = text === '' || text.endsWith('\n') ? text : `${text}\n`;
    return `${body}rows:\n${entry('  ').join('\n')}\n`;
  }
  // `rows: [...]` or any other inline value: leave it to the snippet.
  if (!/^rows:\s*(?:#.*)?$/.test(lines[rowsAt])) return undefined;

  // The block runs to the next top-level key. A sequence may sit at column 0
  // under its key, and comments may sit anywhere.
  let end = rowsAt;
  for (let j = rowsAt + 1; j < lines.length; j += 1) {
    const line = lines[j];
    if (line.trim() === '' || /^[\s#-]/.test(line)) {
      end = j;
      continue;
    }
    break;
  }
  // Insert after the block's last content line, not after trailing blank
  // lines or a top-level comment that introduces whatever comes next.
  let last = end;
  while (
    last > rowsAt &&
    (lines[last].trim() === '' || /^#/.test(lines[last]))
  ) {
    last -= 1;
  }
  const item = lines
    .slice(rowsAt + 1, last + 1)
    .map((line) => /^(\s*)-(?:\s|$)/.exec(line))
    .find((m) => m !== null);
  const indent = item ? item[1] : '  ';
  return [
    ...lines.slice(0, last + 1),
    ...entry(indent),
    ...lines.slice(last + 1),
  ].join('\n');
}

/**
 * Add `row` as a new standalone track at the end of `rows:`. Returns the new
 * text, or — when the splice does not verify — an error and the entry to
 * paste.
 */
export async function appendTrack(
  text: string,
  parsed: unknown,
  row: NewRow
): Promise<EditResult> {
  const isJson = detectFormat(text) === 'json';
  const plain = await plainTest();
  const entry = (indent: string) => rowYaml(row, indent, plain);
  const snippet = isJson ? JSON.stringify(row, null, 2) : entry('').join('\n');
  // Re-serialising JSON would keep only what parsed; with nothing parsed, it
  // would replace the whole config with the new row. (A YAML splice is
  // verified below, and a comments-only YAML document still gets `rows:`.)
  if (isJson && parsed === undefined) {
    return {
      error:
        "The config doesn't parse, so the track can't be added automatically — " +
        'fix it, or add this under rows: by hand:',
      snippet,
    };
  }
  if (parsed !== undefined && !isPlainObject(parsed)) {
    return {
      error: 'The config is not a mapping, so no track can be added:',
      snippet,
    };
  }
  const expected: Obj = structuredClone(parsed ?? {}) as Obj;
  if (expected.rows !== undefined && !Array.isArray(expected.rows)) {
    return {
      error: "The config's rows: is not a list — add this entry by hand:",
      snippet,
    };
  }
  expected.rows = [...((expected.rows as unknown[]) ?? []), { ...row }];

  if (isJson) return { text: asJson(text, expected) };
  const spliced = appendSplice(text, entry);
  const verified =
    spliced === undefined
      ? undefined
      : await firstVerified([spliced], expected);
  return verified !== undefined
    ? { text: verified }
    : {
        error:
          "Couldn't add the track automatically — add this under rows: by hand:",
        snippet,
      };
}
