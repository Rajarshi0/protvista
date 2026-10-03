/**
 * Local data files in the playground: a file the user picks or drops is read
 * in the browser, never uploaded, and stands in for a path the config names.
 *
 * The config keeps naming the file the way a hosted config would
 * (`data: ./hits.csv`), so the editor text — and with it the shareable
 * `#config=` hash — never carries the data. Only at render time does
 * {@link withLocalFiles} swap each such reference for a `blob:` URL holding a
 * snapshot of the file, so the preview reads it through the element's normal
 * fetch path: the same decoder, the same routed errors and warnings, as a
 * hosted copy would get.
 *
 * Two things the preview cannot do for the author are done here instead:
 *
 *   - {@link localDataDiagnostics} pre-flights each loaded file through the
 *     same `runPipeline` under its `./name`, so a malformed file is listed
 *     (and anchored in the gutter) naming the file the author has, with the
 *     delimiter hint's rename advice — the rendered track only knows a
 *     `blob:` URL.
 *   - {@link relabelRuntime} and {@link isPreflightDuplicate} read the
 *     preview's own `protvista-error` events: the first puts `./name` back
 *     where the event says `blob:…`, the second drops a failure the
 *     pre-flight already listed.
 *
 * DOM-free (URL creation is injectable) so it unit-tests under jsdom. It only
 * reads the viewer's events: no `console` call, no event of its own — the
 * element's router stays the one place a failure is logged or emitted.
 */
import type { DataFormat, ShapeName } from '../schema/types.js';
import {
  DATA_FORMATS,
  formatForPath,
  isDataFormat,
} from '../schema/file-formats.js';
import { SHAPES } from '../schema/shapes.js';
import { parseDelimited } from '../schema/adapters/dsv.js';
import { runPipeline, sourceLabel } from '../schema/adapters/pipeline.js';
import { normalizeConfig } from '../schema/normalize.js';
import { createRegistry } from '../schema/registry.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';
import type { ErrorContext } from '../errors/report.js';
import type { PlaygroundDiagnostic } from './lint.js';

/** The largest file the playground reads (the pre-flight decodes it twice). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** How much of a file {@link looksBinary} inspects before the full read. */
export const SNIFF_BYTES = 8192;

/** One file the user loaded, and the config reference it answers to. */
export interface LocalFile {
  /** The config reference it is registered under (`./hits.csv`). */
  ref: string;
  /** The file's own name, for display. */
  name: string;
  /** Size in bytes. */
  size: number;
  /** How its bytes are read. */
  format: DataFormat;
  /** The text read from disk — a snapshot, so later edits on disk need a reload. */
  text: string;
  /** The `blob:` URL the preview fetches. */
  url: string;
}

// ── File names and formats ────────────────────────────────────

/** The last path segment of a reference, without query or fragment. */
export function basename(value: string): string {
  const path = value.split(/[?#]/, 1)[0];
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A file name reduced to characters a plain YAML scalar and a URL path keep. */
export function sanitiseName(fileName: string): string {
  const cleaned = fileName.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
  return cleaned === '' || /^\.+$/.test(cleaned) ? 'data' : cleaned;
}

/**
 * The config reference a newly loaded file gets: `./<sanitised name>`.
 *
 * `taken` maps each registered reference to the name of the file behind it.
 * A *different* file whose name sanitises to the same reference gets a
 * `-2`, `-3`, … suffix before the extension, so loading `a b.csv` does not
 * replace an earlier `a(b.csv`. The same name maps to the same reference, so
 * loading a file again replaces it.
 */
export function referenceFor(
  fileName: string,
  taken: ReadonlyMap<string, string> = new Map()
): string {
  const clean = sanitiseName(fileName);
  const dot = clean.lastIndexOf('.');
  const [stem, ext] =
    dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
  for (let n = 1; ; n += 1) {
    const ref = `./${n === 1 ? clean : `${stem}-${n}${ext}`}`;
    const owner = taken.get(ref);
    if (owner === undefined || owner === fileName) return ref;
  }
}

/** The format a file name's extension implies, or `undefined`. */
export function inferFormat(fileName: string): DataFormat | undefined {
  return formatForPath(fileName)?.name;
}

/**
 * Whether a file's first bytes look binary or compressed: a NUL byte, or the
 * gzip / zip (`.xlsx`, `.docx`) signatures. Checked on a prefix before the
 * whole file is read, so a spreadsheet is refused rather than decoded as
 * mojibake.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return true; // gzip
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return true; // zip: .xlsx, .ods, .zip
  }
  return bytes.includes(0);
}

/**
 * Whether a data value is a path the playground could stand a loaded file in
 * for: not a URL (`https:`, `blob:`, any `scheme:`), not site-absolute
 * (`/protvista/…`), not a `{variable}` template, and a data file — by its
 * extension, or because the descriptor names a `format:`. A sources key
 * (`features`) is neither, so it is not one.
 *
 * Not the test for a `sequence:` value: `.fasta` is no data format.
 */
export function isLocalReference(value: unknown, format?: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  if (value.startsWith('/') || value.includes('{')) return false;
  return (
    formatForPath(value) !== undefined ||
    (typeof format === 'string' && isDataFormat(format))
  );
}

// ── The store ─────────────────────────────────────────────────

export interface LocalFileStore {
  /** Bumped on every change, so a cached render or result can tell it is stale. */
  readonly version: number;
  /**
   * Register a file under `ref`, replacing (and revoking) any file already
   * there. The text is snapshotted into a new `Blob`.
   */
  register(file: Omit<LocalFile, 'url'>): LocalFile;
  /** Forget the file under `ref` and revoke its URL. */
  remove(ref: string): boolean;
  get(ref: string): LocalFile | undefined;
  /** Every registered file, in load order. */
  list(): LocalFile[];
  clear(): void;
}

export interface StoreOptions {
  createURL?: (blob: Blob) => string;
  revokeURL?: (url: string) => void;
}

/**
 * The files loaded in this page. There is deliberately no unload handler:
 * the browser revokes object URLs when the document goes away, and revoking
 * on `pagehide` would break a page restored from the back/forward cache.
 */
export function createLocalFileStore(
  options: StoreOptions = {}
): LocalFileStore {
  const createURL = options.createURL ?? ((blob) => URL.createObjectURL(blob));
  const revokeURL = options.revokeURL ?? ((url) => URL.revokeObjectURL(url));
  const files = new Map<string, LocalFile>();
  let version = 0;

  const drop = (ref: string): boolean => {
    const old = files.get(ref);
    if (!old) return false;
    files.delete(ref);
    revokeURL(old.url);
    return true;
  };

  return {
    get version() {
      return version;
    },
    register(file) {
      drop(file.ref);
      const url = createURL(new Blob([file.text], { type: 'text/plain' }));
      const entry: LocalFile = { ...file, url };
      files.set(file.ref, entry);
      version += 1;
      return entry;
    },
    remove(ref) {
      const removed = drop(ref);
      if (removed) version += 1;
      return removed;
    },
    get: (ref) => files.get(ref),
    list: () => [...files.values()],
    clear() {
      for (const ref of [...files.keys()]) drop(ref);
      version += 1;
    },
  };
}

// ── Walking the config ────────────────────────────────────────

/** One place in the raw config where a track's data names a local path. */
export interface LocalReference {
  /** The path as the config resolves it (through `sources:` if need be). */
  value: string;
  /** The loader's key for the track: `<rowId>-<trackId>`. */
  trackKey: string;
  /** `GROUP/track`, or the row id for a standalone row. */
  trackPath: string;
  /** The `format:` the descriptor states, if any. */
  format?: DataFormat;
  /** Set when the descriptor pins an `adapter:` — it is no decoder. */
  adapter?: string;
  /**
   * Point this reference at `url`. Adds `format` unless the descriptor
   * already states one or pins an adapter (a descriptor carries one or the
   * other); a `blob:` URL has no extension to read the format from.
   */
  apply(url: string, format: DataFormat): void;
}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Every track data reference in a raw (un-normalised) config that names a
 * local path: string shorthand, a descriptor's `url` (or the first of a `url`
 * array — the loader decodes only the first body), a `source:` or shorthand
 * key whose `sources:` value is a path, and the first element of a descriptor
 * array. Covers group tracks and standalone rows.
 *
 * Works on the raw config, so it needs no normalisation and works for an
 * `extends:` child, whose tracks may only make sense after the merge.
 */
export function findLocalReferences(config: unknown): LocalReference[] {
  if (!isObj(config) || !Array.isArray(config.rows)) return [];
  const sources = isObj(config.sources) ? config.sources : {};
  const sourceValue = (key: unknown): string | undefined => {
    if (
      typeof key !== 'string' ||
      !Object.prototype.hasOwnProperty.call(sources, key)
    ) {
      return undefined;
    }
    const value = sources[key];
    return typeof value === 'string' ? value : undefined;
  };
  const found: LocalReference[] = [];

  const visit = (holder: Obj, trackKey: string, trackPath: string) => {
    // The first data entry and a setter that replaces it in place.
    let entry: unknown = holder.data;
    let replace = (value: unknown) => {
      holder.data = value;
    };
    if (Array.isArray(holder.data)) {
      const list = holder.data;
      entry = list[0];
      replace = (value) => {
        list[0] = value;
      };
    }
    const base = { trackKey, trackPath };

    if (typeof entry === 'string') {
      // A sources key wins over a path, as the normaliser resolves it.
      const resolved = sourceValue(entry) ?? entry;
      if (isLocalReference(resolved)) {
        found.push({
          ...base,
          value: resolved,
          apply: (url, format) => replace({ url, format }),
        });
      }
      return;
    }
    if (!isObj(entry)) return;
    const d = entry;
    if (
      d.from === 'inline' ||
      d.from === 'custom' ||
      d.inlineData !== undefined
    ) {
      return;
    }
    const format =
      typeof d.format === 'string' && isDataFormat(d.format)
        ? d.format
        : undefined;
    const adapter = typeof d.adapter === 'string' ? d.adapter : undefined;
    const extra = {
      ...(format ? { format } : {}),
      ...(adapter ? { adapter } : {}),
    };
    const setFormat = (fmt: DataFormat) => {
      if (adapter === undefined && format === undefined) d.format = fmt;
    };

    if (d.url !== undefined) {
      const urls = d.url;
      const first = Array.isArray(urls) ? urls[0] : urls;
      if (!isLocalReference(first, format)) return;
      found.push({
        ...base,
        ...extra,
        value: first as string,
        apply: (url, fmt) => {
          if (Array.isArray(urls)) urls[0] = url;
          else d.url = url;
          setFormat(fmt);
        },
      });
      return;
    }
    const key = Array.isArray(d.source) ? d.source[0] : d.source;
    const resolved = sourceValue(key);
    if (resolved !== undefined && isLocalReference(resolved, format)) {
      found.push({
        ...base,
        ...extra,
        value: resolved,
        apply: (url, fmt) => {
          // A `url` wins over `source`, but the key would still have to
          // resolve; dropping it keeps the descriptor single-sourced.
          delete d.source;
          d.url = url;
          setFormat(fmt);
        },
      });
    }
  };

  for (const row of config.rows) {
    if (!isObj(row) || typeof row.id !== 'string') continue;
    if (Array.isArray(row.tracks)) {
      for (const track of row.tracks) {
        if (isObj(track) && typeof track.id === 'string') {
          visit(track, `${row.id}-${track.id}`, `${row.id}/${track.id}`);
        }
      }
    } else if (row.data !== undefined) {
      // A standalone row is wrapped in a synthetic group of the same id.
      visit(row, `${row.id}-${row.id}`, row.id);
    }
  }
  return found;
}

/**
 * A copy of `config` with every reference to a loaded file pointed at that
 * file's `blob:` URL — what the preview is handed in place of the editor
 * text. Unrelated tracks are untouched, and `config` itself is not mutated.
 */
export function withLocalFiles(
  config: unknown,
  store: LocalFileStore
): unknown {
  if (!isObj(config)) return config;
  const copy = structuredClone(config);
  for (const ref of findLocalReferences(copy)) {
    const file = store.get(ref.value);
    if (file) ref.apply(file.url, ref.format ?? file.format);
  }
  return copy;
}

// ── Shapes ────────────────────────────────────────────────────

/** The built-in kind a new track gets for each record shape. */
export const KIND_FOR_SHAPE: Readonly<Record<ShapeName, string>> = {
  feature: 'features',
  point: 'linegraph',
  variation: 'variants',
};

/**
 * Which records a file seems to hold, from its header row (CSV/TSV) or its
 * first record's keys (JSON): the first shape whose required fields are all
 * present, checked most specific first. Defaults to `feature`, which BED
 * always is.
 */
export function guessShape(text: string, format: DataFormat): ShapeName {
  let fields: string[] = [];
  if (format === 'csv' || format === 'tsv') {
    const firstLine = text.slice(0, text.search(/\r?\n|$/));
    fields = (
      parseDelimited(firstLine, format === 'csv' ? ',' : '\t')[0] ?? []
    ).map((cell) => cell.trim());
  } else if (format === 'json') {
    try {
      const body = JSON.parse(text) as unknown;
      const first = Array.isArray(body) ? body[0] : undefined;
      if (isObj(first)) fields = Object.keys(first);
    } catch {
      // Malformed JSON: the pre-flight says so; any shape will do here.
    }
  }
  const order: ShapeName[] = ['variation', 'point', 'feature'];
  return (
    order.find((shape) =>
      SHAPES[shape].requiredFields.every((field) => fields.includes(field))
    ) ?? 'feature'
  );
}

/**
 * How many records a decoded payload holds, in the shape `runPipeline` built:
 * a feature array, a one-series line graph, or a `{ variants }` object.
 */
export function countRecords(shape: ShapeName, payload: unknown): number {
  switch (shape) {
    case 'feature':
      return Array.isArray(payload) ? payload.length : 0;
    case 'point': {
      const series = Array.isArray(payload)
        ? (payload[0] as { values?: unknown[] })
        : undefined;
      return series?.values?.length ?? 0;
    }
    case 'variation': {
      const variants = (payload as { variants?: unknown[] } | undefined)
        ?.variants;
      return Array.isArray(variants) ? variants.length : 0;
    }
  }
}

// ── Diagnostics ───────────────────────────────────────────────

/** A pre-flight's outcome for one (file, shape, format). */
interface Preflight {
  label: string;
  error?: string;
  count: number;
}

/**
 * Pre-flights keyed by file then `<shape>/<format>`. A re-registered file is a
 * new object, so a reloaded file is decoded afresh and the old entry is
 * collected with it.
 */
const preflightCache = new WeakMap<LocalFile, Map<string, Preflight>>();

async function preflight(
  file: LocalFile,
  shape: ShapeName,
  format: DataFormat
): Promise<Preflight> {
  let byKey = preflightCache.get(file);
  if (!byKey) {
    byKey = new Map();
    preflightCache.set(file, byKey);
  }
  const key = `${shape}/${format}`;
  const cached = byKey.get(key);
  if (cached) return cached;

  const label = sourceLabel(file.ref, format);
  let result: Preflight;
  try {
    // The body as the element's fetch closure reads it: JSON parsed, every
    // other format as text.
    const body =
      DATA_FORMATS[format].body === 'json' ? JSON.parse(file.text) : file.text;
    const payload = await runPipeline(shape, format, body, {
      source: file.ref,
    });
    result = { label, count: countRecords(shape, payload) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Decoder errors already name the source; a JSON syntax error or a
    // shape/format mismatch does not.
    result = {
      label,
      count: 0,
      error: message.startsWith(file.ref) ? message : `${label}: ${message}`,
    };
  }
  byKey.set(key, result);
  return result;
}

export interface LocalDataResult {
  diagnostics: PlaygroundDiagnostic[];
  /** Track keys (`<rowId>-<trackId>`) whose loaded file failed to decode. */
  preflightFailed: Set<string>;
  /** Records each loaded file decoded to, by reference (first track wins). */
  counts: Map<string, number>;
  /** References whose loaded file failed to decode. */
  failedRefs: Set<string>;
}

/** Where a reference first appears in the editor text, for the gutter marker. */
function locateReference(
  text: string,
  value: string
): { from: number; to: number } {
  const at = text.indexOf(value);
  return at === -1 ? { from: 0, to: 0 } : { from: at, to: at + value.length };
}

/**
 * Diagnostics about the config's local data, merged into the config's own:
 *
 *   - `local-file-missing` (warning) for a reference no loaded file answers —
 *     the playground cannot read the disk by path, and a shared link carries
 *     only the name;
 *   - `data-parse` (error) for a loaded file whose decode throws, with the
 *     decoder's own `./hits.csv (parsed as CSV): …` text;
 *   - `data-empty` (warning) for a non-empty file that decoded to no records.
 *
 * Data diagnostics never block Run: the preview renders the track empty, as
 * a hosted viewer would. The pre-flight passes no `coordinates` sink (the
 * bounds check needs the sequence, which the element has) and no `warnings`
 * sink (the element routes those; the playground lists the event).
 *
 * A track the pre-flight cannot place — one that exists only after an
 * `extends:` merge, or a config the normaliser rejects — gets no pre-flight,
 * and still renders.
 */
export async function localDataDiagnostics(
  text: string,
  parsed: unknown,
  store: LocalFileStore
): Promise<LocalDataResult> {
  const result: LocalDataResult = {
    diagnostics: [],
    preflightFailed: new Set(),
    counts: new Map(),
    failedRefs: new Set(),
  };
  const refs = findLocalReferences(parsed);
  if (refs.length === 0) return result;

  const missing = new Set<string>();
  const seen = new Set<string>();
  let tracks:
    Map<string, { shape?: ShapeName; format?: DataFormat }> | undefined;

  for (const ref of refs) {
    const file = store.get(ref.value);
    if (!file) {
      if (missing.has(ref.value)) continue;
      missing.add(ref.value);
      result.diagnostics.push({
        ...locateReference(text, ref.value),
        severity: 'warning',
        code: 'local-file-missing',
        path: ref.trackPath,
        message:
          `${ref.value} isn't loaded in this browser — press "Load data file…" ` +
          `and pick ${basename(ref.value)}.`,
      });
      continue;
    }
    if (ref.adapter !== undefined) continue;

    tracks ??= normalisedTracks(parsed);
    const track = tracks.get(ref.trackKey);
    if (!track) continue;
    const shape = track.shape ?? 'feature';
    const format = ref.format ?? track.format ?? file.format;
    const outcome = await preflight(file, shape, format);
    if (outcome.error !== undefined) result.failedRefs.add(file.ref);
    else if (!result.counts.has(file.ref))
      result.counts.set(file.ref, outcome.count);

    let message: string | undefined;
    let code: string | undefined;
    if (outcome.error !== undefined) {
      result.preflightFailed.add(ref.trackKey);
      [message, code] = [outcome.error, 'data-parse'];
    } else if (outcome.count === 0 && file.text.trim() !== '') {
      [message, code] = [
        `${outcome.label}: decoded 0 records — the file has no data rows the ` +
          `track can draw.`,
        'data-empty',
      ];
    }
    if (message === undefined || seen.has(message)) continue;
    seen.add(message);
    result.diagnostics.push({
      ...locateReference(text, ref.value),
      severity: code === 'data-parse' ? 'error' : 'warning',
      code,
      path: ref.trackPath,
      message,
    });
  }
  return result;
}

/**
 * Each track's first data source after normalisation, by track key, for the
 * shape and format the pre-flight decodes with. `extends:` is set aside — the
 * base is fetched by the element, not here — so a child-only track normalises
 * on its own and a track that needs the base is simply absent. A config the
 * normaliser rejects yields no tracks.
 */
function normalisedTracks(
  parsed: unknown
): Map<string, { shape?: ShapeName; format?: DataFormat }> {
  const tracks = new Map<string, { shape?: ShapeName; format?: DataFormat }>();
  if (!isObj(parsed)) return tracks;
  try {
    const normalised = normalizeConfig(
      { ...parsed, extends: undefined } as unknown as ProtvistaViewerConfig,
      { registry: createRegistry() }
    );
    for (const row of normalised.rows) {
      for (const track of row.tracks) {
        const first = track.data[0];
        if (first) {
          tracks.set(`${row.id}-${track.id}`, {
            shape: first.shape,
            format: first.format,
          });
        }
      }
    }
  } catch {
    // An `extends:` child or an invalid config: no pre-flight, still renders.
  }
  return tracks;
}

// ── The preview's events ──────────────────────────────────────

/** The `protvista-error` event's documented `detail`, as the playground reads it. */
export interface RuntimeDetail {
  phase?: string;
  severity?: 'error' | 'warning' | 'info';
  message?: string;
  source?: string;
  issues?: Array<{
    message: string;
    code?: string;
    severity?: 'error' | 'warning';
    path?: string;
  }>;
  context?: ErrorContext;
}

/**
 * The event's `detail` with every registered `blob:` URL replaced by the
 * reference it stands for — in `message`, `source`, `context.url` and each
 * issue's `message` — so a list row names `./hits.csv`. Returns a new object
 * (other listeners read the same `detail`); an event that names no
 * registered URL comes back unchanged.
 */
export function relabelRuntime<T extends RuntimeDetail>(
  detail: T,
  store: LocalFileStore
): T {
  const files = store.list();
  if (files.length === 0 || detail == null) return detail;
  // Plain string replacement: a blob URL is full of regex metacharacters.
  const relabel = (text: string): string =>
    files.reduce((out, file) => out.split(file.url).join(file.ref), text);
  const out: T = { ...detail };
  if (typeof detail.message === 'string') out.message = relabel(detail.message);
  if (typeof detail.source === 'string') out.source = relabel(detail.source);
  if (detail.context && typeof detail.context.url === 'string') {
    out.context = { ...detail.context, url: relabel(detail.context.url) };
  }
  if (Array.isArray(detail.issues)) {
    out.issues = detail.issues.map((issue) =>
      typeof issue?.message === 'string'
        ? { ...issue, message: relabel(issue.message) }
        : issue
    );
  }
  return out;
}

/**
 * Whether the event is the preview's own report of a decode failure the
 * pre-flight already listed for that track: a `track-fetch` with
 * `errorKind` `adapter` or `parse` on a key in `preflightFailed`. The
 * listener skips it, so a malformed file is listed once, by name.
 */
export function isPreflightDuplicate(
  detail: RuntimeDetail | undefined,
  preflightFailed: ReadonlySet<string>
): boolean {
  if (detail?.phase !== 'track-fetch') return false;
  const { errorKind, groupId, trackId } = detail.context ?? {};
  if (errorKind !== 'adapter' && errorKind !== 'parse') return false;
  return preflightFailed.has(`${groupId}-${trackId}`);
}
