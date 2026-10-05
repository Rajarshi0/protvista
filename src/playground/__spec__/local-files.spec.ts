/**
 * The DOM-free half of "load a local data file": naming, the store, the
 * render-time rewrite to `blob:` URLs, the pre-flight diagnostics, and the
 * two helpers the `protvista-error` listener runs every event through.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseConfigText } from '../../schema/parse.js';
import { createRegistry } from '../../schema/registry.js';
import { runPipeline } from '../../schema/adapters/pipeline.js';
import {
  isSequenceReference,
  parseSequenceText,
} from '../../schema/sequence.js';
import defaultConfigYaml from '../../default-config.yaml?raw';
import { PRESETS, DEV_PRESETS } from '../presets.js';
import { lintConfig } from '../lint.js';
import { appendTrack } from '../config-edit.js';
import {
  KIND_FOR_SHAPE,
  PRIVACY_NOTE,
  answersFor,
  basename,
  countRecords,
  createLocalFileStore,
  findLocalReferences,
  guessShape,
  inferFormat,
  inlineSequenceText,
  isFastaFile,
  isLocalReference,
  isLocalSequenceReference,
  isPreflightDuplicate,
  localDataDiagnostics,
  looksBinary,
  mayNameLocalFile,
  referenceFor,
  relabelRuntime,
  sniffFormat,
  withLocalFiles,
  type LocalFileStore,
  type RuntimeDetail,
} from '../local-files.js';
import type { DataFormat } from '../../schema/types.js';
import { DATA_FORMATS, DATA_FORMAT_NAMES } from '../../schema/file-formats.js';

// Wrap the real pipeline in a spy, so memoisation can be counted.
vi.mock('../../schema/adapters/pipeline.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../schema/adapters/pipeline.js')>();
  return { ...actual, runPipeline: vi.fn(actual.runPipeline) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(runPipeline).mockClear();
});

/** A store whose URLs are predictable `blob:` strings, and whose revokes are recorded. */
function makeStore() {
  const revoked: string[] = [];
  let n = 0;
  const store = createLocalFileStore({
    createURL: () => `blob:https://example.org/uuid-${(n += 1)}`,
    revokeURL: (url) => revoked.push(url),
  });
  return { store, revoked };
}

function load(
  store: LocalFileStore,
  ref: string,
  text: string,
  format: DataFormat = inferFormat(ref) ?? 'csv'
) {
  return store.register({
    ref,
    name: basename(ref),
    size: text.length,
    format,
    text,
  });
}

const GOOD_CSV =
  'type,start,end,description\nDOMAIN,10,25,Kinase\nSITE,30,30,x';
const BAD_CSV = 'type,start,end,description\nDOMAIN,abc,25,Kinase';
const OUT_OF_RANGE_CSV =
  'type,start,end,description\nDOMAIN,10,25,Kinase\nSITE,700,812,Tail';

const standalone = (data: unknown, extra: object = {}) => ({
  accession: 'P05067',
  rows: [{ id: 'hits', kind: 'features', data, ...extra }],
});

describe('naming a loaded file', () => {
  it('sanitises the name into a ./ reference', () => {
    expect(referenceFor('hits.csv')).toBe('./hits.csv');
    expect(referenceFor('hits.CSV')).toBe('./hits.CSV');
    expect(referenceFor('My Hits (v2).csv')).toBe('./My-Hits-v2-.csv');
    expect(referenceFor('')).toBe('./data');
  });

  it('suffixes a different file that sanitises to a taken reference', () => {
    const taken = new Map([['./a-b.csv', 'a(b.csv']]);
    expect(referenceFor('a b.csv', taken)).toBe('./a-b-2.csv');
    // The same file keeps its reference, so loading it again replaces it.
    expect(referenceFor('a(b.csv', taken)).toBe('./a-b.csv');
    taken.set('./a-b-2.csv', 'a b.csv');
    expect(referenceFor('a)b.csv', taken)).toBe('./a-b-3.csv');
  });

  it('infers the format from the extension, case-insensitively', () => {
    expect(inferFormat('hits.CSV')).toBe('csv');
    expect(inferFormat('hits.tsv?x=1')).toBe('tsv');
    expect(inferFormat('x.json')).toBe('json');
    expect(inferFormat('x.bed')).toBe('bed');
    expect(inferFormat('hits.txt')).toBeUndefined();
    expect(inferFormat('hits')).toBeUndefined();
  });

  it('takes the base name of a reference', () => {
    expect(basename('./data/hits.csv')).toBe('hits.csv');
    expect(basename('hits.csv?v=2')).toBe('hits.csv');
  });
});

describe('PRIVACY_NOTE', () => {
  it('is what the note by the Load button says, naming the file name going into the config', () => {
    const page = readFileSync('docs/src/pages/playground.astro', 'utf8');
    const note = /<span id="local-note"[^>]*>([\s\S]*?)<\/span/.exec(page);
    expect(note?.[1].replace(/\s+/g, ' ').trim()).toBe(PRIVACY_NOTE);
    expect(PRIVACY_NOTE).toMatch(
      /never uploaded.*file name goes into the config/
    );
  });
});

describe('looksBinary', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it('flags a NUL byte, gzip and zip signatures', () => {
    expect(looksBinary(bytes(0x61, 0x00, 0x62))).toBe(true);
    expect(looksBinary(bytes(0x1f, 0x8b, 0x08))).toBe(true);
    expect(looksBinary(bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
  });
  it('passes text, including UTF-8', () => {
    expect(looksBinary(new TextEncoder().encode('type,start\nDOMAIN,é'))).toBe(
      false
    );
    expect(looksBinary(bytes())).toBe(false);
  });
});

describe('isLocalReference', () => {
  it.each(['./x.csv', 'x.csv', '../d/x.tsv', 'data/x.JSON', './x.bed'])(
    'accepts %s',
    (value) => expect(isLocalReference(value)).toBe(true)
  );
  it.each([
    'https://example.org/x.csv',
    '/protvista/sample-data/hotspots.csv',
    'blob:https://example.org/uuid',
    'features',
    './x.txt',
    './{accession}.csv',
    '',
    42,
  ])('rejects %s', (value) => expect(isLocalReference(value)).toBe(false));
  it('accepts an extensionless path when a format is stated', () => {
    expect(isLocalReference('./hits.txt', 'csv')).toBe(true);
    expect(isLocalReference('./hits.txt', 'xls')).toBe(false);
  });
});

describe('createLocalFileStore', () => {
  it('registers, replaces (revoking the old URL), removes and clears', () => {
    const { store, revoked } = makeStore();
    expect(store.version).toBe(0);
    const first = load(store, './hits.csv', GOOD_CSV);
    expect(first.url).toBe('blob:https://example.org/uuid-1');
    expect(store.get('./hits.csv')).toBe(first);
    expect(store.version).toBe(1);

    const second = load(store, './hits.csv', BAD_CSV);
    expect(revoked).toEqual([first.url]);
    expect(store.list()).toEqual([second]);
    expect(store.version).toBe(2);

    load(store, './x.json', '[]');
    expect(store.remove('./nope.csv')).toBe(false);
    expect(store.version).toBe(3);
    expect(store.remove('./hits.csv')).toBe(true);
    expect(revoked).toContain(second.url);
    expect(store.list().map((f) => f.ref)).toEqual(['./x.json']);

    store.clear();
    expect(store.list()).toEqual([]);
    expect(revoked).toHaveLength(3);
  });

  it('defaults to the real object-URL functions', () => {
    // jsdom has neither, so install spies for the duration of the test.
    const real = {
      createObjectURL: URL.createObjectURL,
      revokeObjectURL: URL.revokeObjectURL,
    };
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    try {
      const store = createLocalFileStore();
      load(store, './hits.csv', GOOD_CSV);
      store.remove('./hits.csv');
      expect(create).toHaveBeenCalledOnce();
      expect(revoke).toHaveBeenCalledWith('blob:x');
    } finally {
      Object.assign(URL, real);
    }
  });
});

describe('findLocalReferences / withLocalFiles', () => {
  it('finds shorthand, descriptor, url array, descriptor array and sources references', () => {
    const config = {
      sources: { mine: './mine.tsv', remote: 'https://example.org/x.json' },
      rows: [
        { id: 'a', data: './a.csv' },
        {
          id: 'g',
          tracks: [
            { id: 'b', data: { url: './b.json' } },
            { id: 'c', data: { url: ['./c.csv', 'https://x/y.csv'] } },
            { id: 'd', data: [{ url: './d.bed' }] },
            { id: 'e', data: 'mine' },
            { id: 'f', data: { source: ['mine'] } },
            { id: 'h', data: 'remote' },
            { id: 'i', data: { from: 'inline', inlineData: [] } },
            { id: 'j', data: { url: './j.txt', format: 'csv' } },
          ],
        },
        { id: 'empty' },
      ],
    };
    const found = findLocalReferences(config).map((r) => [r.trackKey, r.value]);
    expect(found).toEqual([
      ['a-a', './a.csv'],
      ['g-b', './b.json'],
      ['g-c', './c.csv'],
      ['g-d', './d.bed'],
      ['g-e', './mine.tsv'],
      ['g-f', './mine.tsv'],
      ['g-j', './j.txt'],
    ]);
    expect(findLocalReferences(null)).toEqual([]);
    expect(findLocalReferences({ rows: 'x' })).toEqual([]);
  });

  it('rewrites every loaded reference to its blob URL, with a format', () => {
    const { store } = makeStore();
    const a = load(store, './a.csv', GOOD_CSV);
    const c = load(store, './c.csv', GOOD_CSV);
    const d = load(store, './d.bed', 'chr1\t0\t10');
    const m = load(store, './mine.tsv', 'x');
    const j = load(store, './j.txt', GOOD_CSV, 'csv');
    const config = {
      sources: { mine: './mine.tsv' },
      rows: [
        { id: 'a', data: './a.csv' },
        {
          id: 'g',
          tracks: [
            { id: 'c', data: { url: ['./c.csv', 'https://x/y.csv'] } },
            { id: 'd', data: [{ url: './d.bed' }] },
            { id: 'e', data: 'mine' },
            { id: 'f', data: { source: 'mine', kind: 'x' } },
            { id: 'j', data: { url: './j.txt', format: 'csv' } },
            { id: 'p', data: { url: './a.csv', adapter: 'mine' } },
            { id: 'u', data: './unloaded.csv' },
            { id: 'r', data: 'https://example.org/x.csv' },
          ],
        },
      ],
    };
    const before = structuredClone(config);
    const out = withLocalFiles(config, store) as typeof config;
    expect(config).toEqual(before); // not mutated
    expect(out.rows[0]).toEqual({
      id: 'a',
      data: { url: a.url, format: 'csv' },
    });
    const tracks = (out.rows[1] as { tracks: { data: unknown }[] }).tracks;
    expect(tracks[0].data).toEqual({
      url: [c.url, 'https://x/y.csv'],
      format: 'csv',
    });
    expect(tracks[1].data).toEqual([{ url: d.url, format: 'bed' }]);
    expect(tracks[2].data).toEqual({ url: m.url, format: 'tsv' });
    expect(tracks[3].data).toEqual({ url: m.url, kind: 'x', format: 'tsv' });
    // The author's own format is kept.
    expect(tracks[4].data).toEqual({ url: j.url, format: 'csv' });
    // A pinned adapter gets the URL and no format.
    expect(tracks[5].data).toEqual({ url: a.url, adapter: 'mine' });
    // Unloaded and remote references are untouched.
    expect(tracks[6]).toEqual(before.rows[1].tracks![6]);
    expect(tracks[7]).toEqual(before.rows[1].tracks![7]);
    expect(withLocalFiles('text', store)).toBe('text');
  });

  it('keeps an explicit format that differs from the file', () => {
    const { store } = makeStore();
    const f = load(store, './hits.csv', GOOD_CSV);
    const out = withLocalFiles(
      standalone({ url: './hits.csv', format: 'tsv' }),
      store
    ) as ReturnType<typeof standalone>;
    expect(out.rows[0].data).toEqual({ url: f.url, format: 'tsv' });
  });

  it('reads a shorthand by its extension, whatever the file was loaded as', () => {
    // The normaliser and the pre-flight read `./a/hits.csv` as CSV; the
    // preview must too, or it would disagree with the config it was given.
    const { store } = makeStore();
    const f = load(store, './a/hits.csv', 'type\tstart\tend', 'tsv');
    const out = withLocalFiles(standalone('./a/hits.csv'), store) as ReturnType<
      typeof standalone
    >;
    expect(out.rows[0].data).toEqual({ url: f.url, format: 'csv' });
  });
});

describe('guessShape / countRecords / KIND_FOR_SHAPE', () => {
  it('reads the header row or first JSON record', () => {
    expect(guessShape('type,start,end\nA,1,2', 'csv')).toBe('feature');
    expect(guessShape('position,value\n1,2', 'csv')).toBe('point');
    expect(guessShape('position\tvariant\n1\tA', 'tsv')).toBe('variation');
    expect(guessShape('[{"position":1,"value":2}]', 'json')).toBe('point');
    expect(guessShape('{not json', 'json')).toBe('feature');
    expect(guessShape('[]', 'json')).toBe('feature');
    expect(guessShape('chr1\t1\t2', 'bed')).toBe('feature');
  });

  it('gives a format that declares its records that shape, whatever its columns', () => {
    for (const name of DATA_FORMAT_NAMES) {
      const emits = DATA_FORMATS[name].emitsShape;
      if (emits) expect(guessShape('position,value\n1,2', name)).toBe(emits);
    }
    // BED declares `feature`, which is also the fallback: declare another
    // shape for a moment, so the declaration is seen to win.
    const bed = DATA_FORMATS.bed as { emitsShape?: string };
    const declared = bed.emitsShape;
    try {
      bed.emitsShape = 'variation';
      expect(guessShape('type,start,end\nA,1,2', 'bed')).toBe('variation');
    } finally {
      bed.emitsShape = declared;
    }
  });

  it('reads a header its extension misnames by the delimiter #276 suspects', () => {
    const tabDepth = 'position\tvalue\n1\t0.5\n2\t0.7\n';
    expect(guessShape(tabDepth, 'csv')).toBe('point');
    expect(guessShape('position,variant\n5,A', 'tsv')).toBe('variation');
    expect(guessShape('position;value\n1;0.5', 'csv')).toBe('point');
    // A one-column header no other delimiter splits stays as it is.
    expect(guessShape('position\n1', 'csv')).toBe('feature');
  });

  it('sniffs the format a misnamed delimited file should be read as', () => {
    const tabDepth = 'position\tvalue\n1\t0.5\n';
    expect(sniffFormat(tabDepth, 'csv')).toBe('tsv');
    expect(sniffFormat(tabDepth, 'tsv')).toBe('tsv');
    expect(sniffFormat('position,value\n1,0.5', 'tsv')).toBe('csv');
    expect(sniffFormat('position,value\n1,0.5', 'csv')).toBe('csv');
    // A semicolon header has no format of its own; the hint says what to do.
    expect(sniffFormat('position;value\n1;0.5', 'csv')).toBe('csv');
    expect(sniffFormat('[]', 'json')).toBe('json');
    expect(sniffFormat(tabDepth, undefined)).toBeUndefined();
  });

  it('switches whenever the declared reading misses a column, as the pre-flight hint does', () => {
    // A tab-separated hits.csv with a comma in a column name: the comma
    // splits the header in two, but neither half has the feature columns.
    const hits =
      'type\tstart\tend\tdescription\tnote, misc\nDOMAIN\t1\t5\tx\ty\n';
    const hint = (format: DataFormat) => {
      try {
        runPipeline('feature', format, hits, { source: './hits.csv' });
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(hint('csv')).toMatch(/looks tab-separated/);
    expect(sniffFormat(hits, 'csv')).toBe('tsv');
    expect(hint('tsv')).toBe('no error');
    expect(guessShape(hits, 'csv')).toBe('feature');

    const depth = 'position\tvalue\tnote, misc\n1\t0.5\tx\n';
    expect(sniffFormat(depth, 'csv')).toBe('tsv');
    expect(guessShape(depth, 'csv')).toBe('point');
    // And the other way: a comma header with a tab in a column name.
    const commas = 'position,value,note\tmisc\n1,0.5,x\n';
    expect(sniffFormat(commas, 'tsv')).toBe('csv');
    expect(guessShape(commas, 'tsv')).toBe('point');
    // A delimiter that gives a shape its columns beats one that only splits
    // the header into more cells.
    const both = 'position\tvalue\ta;b;c;d\n1\t0.5\tx\n';
    expect(sniffFormat(both, 'csv')).toBe('tsv');
    expect(guessShape(both, 'csv')).toBe('point');
    // A one-cell header another delimiter splits is still split, though
    // no shape gets all its columns.
    expect(sniffFormat('name\tscore\nA\t1\n', 'csv')).toBe('tsv');
    // A header with some shape's columns keeps its delimiter.
    expect(sniffFormat('position,value,a\tb\n1,0.5,x\n', 'csv')).toBe('csv');
  });

  it('makes a tab-separated depth.csv a line-graph track that reads cleanly', async () => {
    // As the playground adds a new track: the sniffed format is offered, and
    // written as `format:` because the extension says otherwise.
    const text = 'position\tvalue\n1\t0.5\n2\t0.7\n';
    const format = sniffFormat(text, inferFormat('depth.csv'))!;
    const config = 'accession: P05067\nrows:\n  - id: other\n    data: []\n';
    const edit = await appendTrack(config, await parseConfigText(config), {
      id: 'depth',
      label: 'depth.csv',
      kind: KIND_FOR_SHAPE[guessShape(text, format)],
      data: { url: './depth.csv', format },
    });
    if (!('text' in edit)) throw new Error(edit.error);
    expect(edit.text).toContain('kind: linegraph');
    expect(edit.text).toContain('data: { url: ./depth.csv, format: tsv }');

    const { store } = makeStore();
    load(store, './depth.csv', text, format);
    const result = await localDataDiagnostics(
      edit.text,
      await parseConfigText(edit.text),
      store
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.counts.get('./depth.csv')).toBe(2);
  });

  it('counts records in each built payload', () => {
    expect(countRecords('feature', [1, 2])).toBe(2);
    expect(countRecords('feature', {})).toBe(0);
    expect(countRecords('point', [{ values: [1, 2, 3] }])).toBe(3);
    expect(countRecords('point', [])).toBe(0);
    expect(countRecords('variation', { variants: [1] })).toBe(1);
    expect(countRecords('variation', undefined)).toBe(0);
  });

  it('names, for each shape, a built-in kind of that shape', () => {
    const registry = createRegistry();
    for (const [shape, kind] of Object.entries(KIND_FOR_SHAPE)) {
      expect(registry.getSemanticKind(kind)?.shape).toBe(shape);
    }
  });
});

describe('localDataDiagnostics', () => {
  const run = async (config: object, store: LocalFileStore) => {
    const text = JSON.stringify(config, null, 2);
    return localDataDiagnostics(text, await parseConfigText(text), store);
  };

  it('reports a malformed CSV once, as the decoder words it', async () => {
    const { store } = makeStore();
    load(store, './hits.csv', BAD_CSV);
    const { diagnostics, preflightFailed, failedRefs } = await run(
      standalone('./hits.csv'),
      store
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'data-parse',
      severity: 'error',
    });
    expect(diagnostics[0].message).toMatch(
      /^\.\/hits\.csv \(parsed as CSV\): row 2/
    );
    expect(diagnostics[0].from).toBeGreaterThan(0); // anchored on the reference
    expect([...preflightFailed]).toEqual(['hits-hits']);
    expect([...failedRefs]).toEqual(['./hits.csv']);
  });

  it('reports nothing for a valid CSV, and counts its records', async () => {
    const { store } = makeStore();
    load(store, './hits.csv', GOOD_CSV);
    const result = await run(standalone('./hits.csv'), store);
    expect(result.diagnostics).toEqual([]);
    expect(result.preflightFailed.size).toBe(0);
    expect(result.counts.get('./hits.csv')).toBe(2);
  });

  it('warns about a non-empty file with no records', async () => {
    const { store } = makeStore();
    load(store, './x.json', '[]');
    const { diagnostics } = await run(standalone('./x.json'), store);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'data-empty', severity: 'warning' }),
    ]);
    expect(diagnostics[0].message).toMatch(
      /^\.\/x\.json \(parsed as JSON\): decoded 0 records/
    );
  });

  it('rejects a top-level JSON object as the decoder does', async () => {
    const { store } = makeStore();
    load(store, './x.json', '{"type":"DOMAIN"}');
    const { diagnostics } = await run(standalone('./x.json'), store);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('data-parse');
    expect(diagnostics[0].message).toBe(
      './x.json (parsed as JSON): expected an array of feature records; got object.'
    );
  });

  it('names the file in a JSON syntax error', async () => {
    const { store } = makeStore();
    load(store, './x.json', '[{"type": ');
    const { diagnostics } = await run(standalone('./x.json'), store);
    expect(diagnostics[0].code).toBe('data-parse');
    expect(diagnostics[0].message).toMatch(/^\.\/x\.json \(parsed as JSON\): /);
  });

  it.each([
    [
      'an inverted interval',
      'type,start,end,description\nDOMAIN,25,10,x',
      /row 2/,
    ],
    [
      'a fractional start',
      'type,start,end,description\nDOMAIN,18.5,25,x',
      /row 2/,
    ],
  ])('reports %s as data-parse naming the row', async (_, csv, row) => {
    const { store } = makeStore();
    load(store, './hits.csv', csv);
    const { diagnostics } = await run(standalone('./hits.csv'), store);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('data-parse');
    expect(diagnostics[0].message).toMatch(row);
  });

  it('includes the delimiter hint with rename advice under the file name', async () => {
    const { store } = makeStore();
    load(store, './hits.csv', 'type\tstart\tend\tdescription\nDOMAIN\t1\t2\tx');
    const { diagnostics } = await run(standalone('./hits.csv'), store);
    expect(diagnostics[0].message).toMatch(
      /format: tsv`.*rename the file to \.tsv/
    );
  });

  it('collects the failed track keys of standalone and grouped tracks', async () => {
    const { store } = makeStore();
    load(store, './bad.csv', BAD_CSV);
    load(store, './good.csv', GOOD_CSV);
    const { preflightFailed, diagnostics } = await run(
      {
        rows: [
          { id: 'hits', kind: 'features', data: './bad.csv' },
          {
            id: 'g',
            tracks: [
              { id: 'hits', kind: 'features', data: './bad.csv' },
              { id: 'ok', kind: 'features', data: './good.csv' },
            ],
          },
        ],
      },
      store
    );
    expect([...preflightFailed].sort()).toEqual(['g-hits', 'hits-hits']);
    // The same message for the same file is listed once.
    expect(diagnostics).toHaveLength(1);
  });

  it('pre-flights with the shape the kind asks for', async () => {
    const { store } = makeStore();
    load(store, './depth.csv', 'position,value\n1,10\n2,20');
    const result = await run(
      { rows: [{ id: 'd', kind: 'linegraph', data: './depth.csv' }] },
      store
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.counts.get('./depth.csv')).toBe(2);
  });

  it('skips a descriptor that pins an adapter', async () => {
    const { store } = makeStore();
    load(store, './hits.csv', BAD_CSV);
    const result = await run(
      standalone({ url: './hits.csv', adapter: 'features-csv' }),
      store
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.preflightFailed.size).toBe(0);
  });

  it('makes no console call while pre-flighting a malformed file', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const { store } = makeStore();
    load(store, './hits.csv', BAD_CSV);
    load(store, './x.json', '{');
    await run(
      {
        rows: [
          { id: 'hits', kind: 'features', data: './hits.csv' },
          { id: 'x', kind: 'features', data: './x.json' },
        ],
      },
      store
    );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('warns about a reference no loaded file answers, once per path', async () => {
    const { store } = makeStore();
    const { diagnostics } = await run(
      {
        rows: [
          { id: 'a', data: './x.csv' },
          { id: 'b', data: './x.csv' },
        ],
      },
      store
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'local-file-missing',
        severity: 'warning',
        message: expect.stringContaining('./x.csv') as unknown,
      }),
    ]);
    expect(diagnostics[0].message).toMatch(/Load data file…" and pick x\.csv/);
  });

  describe('in an extends: child', () => {
    const child = (track: string[]) =>
      [
        'extends: /protvista/default-config.yaml',
        'rows:',
        '  - id: VARIATION',
        '    tracks:',
        '      - id: variation',
        ...track.map((line) => `        ${line}`),
      ].join('\n');
    const diagnose = async (text: string, store: LocalFileStore) =>
      localDataDiagnostics(text, await parseConfigText(text), store);

    it('warns about a reference no loaded file answers', async () => {
      const { store } = makeStore();
      const result = await diagnose(child(['data: ./v.csv']), store);
      expect(result.diagnostics.map((d) => d.code)).toEqual([
        'local-file-missing',
      ]);
    });

    it("gives no pre-flight to a track whose kind may come from the base, and leaves the preview's report alone", async () => {
      // The default config's VARIATION/variation is `kind: variants`. Read
      // without the base, this override would be decoded as feature records
      // and rejected for lacking a `type` column.
      const { store } = makeStore();
      load(store, './v.csv', 'position,variant\n5,A');
      const result = await diagnose(child(['data: ./v.csv']), store);
      expect(result.diagnostics).toEqual([]);
      expect(result.preflightFailed.size).toBe(0);
      expect(result.failedRefs.size).toBe(0);
      expect(vi.mocked(runPipeline)).not.toHaveBeenCalled();
      // So the preview's own decode failure on that track is listed.
      const runtime: RuntimeDetail = {
        phase: 'track-fetch',
        context: {
          groupId: 'VARIATION',
          trackId: 'variation',
          errorKind: 'parse',
        },
      };
      expect(isPreflightDuplicate(runtime, result.preflightFailed)).toBe(false);
    });

    it('pre-flights a track that states its own kind, with that shape', async () => {
      const { store } = makeStore();
      load(store, './v.csv', 'position,variant\n5,A');
      const good = await diagnose(
        child(['kind: variants', 'data: ./v.csv']),
        store
      );
      expect(good.diagnostics).toEqual([]);
      expect(good.counts.get('./v.csv')).toBe(1);

      load(store, './v.csv', BAD_CSV);
      const bad = await diagnose(
        child(['kind: features', 'data: ./v.csv']),
        store
      );
      expect(bad.diagnostics.map((d) => d.code)).toEqual(['data-parse']);
      expect([...bad.preflightFailed]).toEqual(['VARIATION-variation']);
    });
  });

  it('gives no pre-flight to a config the normaliser rejects', async () => {
    const { store } = makeStore();
    load(store, './x.csv', BAD_CSV);
    const result = await run(
      {
        rows: [
          { id: 'dup', data: './x.csv' },
          { id: 'dup', data: './x.csv' },
        ],
      },
      store
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores site-absolute paths', async () => {
    const { store } = makeStore();
    const result = await run(
      standalone('/protvista/sample-data/hotspots.csv'),
      store
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('finds no local data in any preset', async () => {
    const { store } = makeStore();
    for (const preset of [...PRESETS, ...DEV_PRESETS]) {
      const result = await localDataDiagnostics(
        preset.config,
        await parseConfigText(preset.config),
        store
      );
      expect(result.diagnostics, preset.id).toEqual([]);
    }
  });

  it('decodes a loaded file once across validations', async () => {
    const { store } = makeStore();
    load(store, './hits.csv', GOOD_CSV);
    await run(standalone('./hits.csv'), store);
    await run(standalone('./hits.csv'), store);
    expect(vi.mocked(runPipeline)).toHaveBeenCalledOnce();
    // A reload is a new file, decoded afresh.
    load(store, './hits.csv', GOOD_CSV);
    await run(standalone('./hits.csv'), store);
    expect(vi.mocked(runPipeline)).toHaveBeenCalledTimes(2);
  });
});

describe('relabelRuntime / isPreflightDuplicate', () => {
  const { store } = makeStore();
  const file = load(store, './hits.csv', BAD_CSV);
  const BLOB = file.url;

  /** Shaped like the details `error-surface.spec.ts` asserts on. */
  const adapterFailure: RuntimeDetail = {
    phase: 'track-fetch',
    severity: 'error',
    message: `${BLOB} (parsed as CSV): row 2, column "start": expected a number, got "abc"`,
    source: BLOB,
    issues: [],
    context: {
      groupId: 'hits',
      trackId: 'hits',
      url: BLOB,
      errorKind: 'adapter',
    },
  };
  const outOfRange: RuntimeDetail = {
    phase: 'track-data',
    severity: 'warning',
    message: `${BLOB} (parsed as CSV): 1 of 2 rows fall outside P05067`,
    source: BLOB,
    issues: [
      {
        path: 'hits/hits',
        message: `${BLOB} (parsed as CSV): 1 of 2 rows fall outside P05067`,
        code: 'coordinate-out-of-range',
        severity: 'warning',
      },
    ],
    context: { groupId: 'hits', trackId: 'hits', url: BLOB },
  };
  const ignoredColumns: RuntimeDetail = {
    phase: 'track-data',
    severity: 'warning',
    message: `${BLOB} (parsed as CSV): ignored column(s) "tooltipContent"`,
    source: BLOB,
    issues: [
      {
        path: 'hits/hits',
        message: `${BLOB} (parsed as CSV): ignored column(s) "tooltipContent"`,
        code: 'data-field-ignored',
        severity: 'warning',
      },
    ],
    context: { groupId: 'hits', trackId: 'hits', url: BLOB },
  };

  it('names the file wherever a track-fetch failure names its blob URL', () => {
    const before = structuredClone(adapterFailure);
    const out = relabelRuntime(adapterFailure, store.list());
    expect(out.message).toMatch(/^\.\/hits\.csv \(parsed as CSV\): row 2/);
    expect(out.source).toBe('./hits.csv');
    expect(out.context?.url).toBe('./hits.csv');
    expect(out.context?.errorKind).toBe('adapter');
    expect(adapterFailure).toEqual(before); // not mutated
  });

  it('relabels a track-data warning and its issue, keeping code and severity', () => {
    const out = relabelRuntime(outOfRange, store.list());
    expect(out.issues?.[0]).toEqual({
      path: 'hits/hits',
      message: './hits.csv (parsed as CSV): 1 of 2 rows fall outside P05067',
      code: 'coordinate-out-of-range',
      severity: 'warning',
    });
    expect(JSON.stringify(out)).not.toContain('blob:');
  });

  it("relabels #283's decoder warning in all four places, and never drops it", () => {
    const out = relabelRuntime(ignoredColumns, store.list());
    expect(out.message).toBe(
      './hits.csv (parsed as CSV): ignored column(s) "tooltipContent"'
    );
    expect(out.source).toBe('./hits.csv');
    expect(out.context?.url).toBe('./hits.csv');
    expect(out.issues?.[0]).toMatchObject({
      message: './hits.csv (parsed as CSV): ignored column(s) "tooltipContent"',
      code: 'data-field-ignored',
    });
    expect(isPreflightDuplicate(ignoredColumns, new Set(['hits-hits']))).toBe(
      false
    );
  });

  it('passes an event that names no loaded file through unchanged', () => {
    const config: RuntimeDetail = {
      phase: 'config',
      severity: 'warning',
      message: 'something',
      issues: [{ message: 'x', code: 'y' }],
      context: {},
    };
    const remote: RuntimeDetail = {
      ...adapterFailure,
      message: 'https://example.org/x.csv (parsed as CSV): bad',
      source: 'https://example.org/x.csv',
      context: { ...adapterFailure.context, url: 'https://example.org/x.csv' },
    };
    expect(relabelRuntime(config, store.list())).toEqual(config);
    expect(relabelRuntime(remote, store.list())).toEqual(remote);
    const empty = createLocalFileStore({ createURL: () => 'blob:x' });
    expect(relabelRuntime(adapterFailure, empty.list())).toBe(adapterFailure);
  });

  it('relabels every loaded file, not only the first', () => {
    const two = makeStore().store;
    load(two, './hits.csv', GOOD_CSV);
    const tail = load(two, './tail.csv', OUT_OF_RANGE_CSV);
    const message = `${tail.url} (parsed as CSV): 1 of 2 rows fall outside P05067`;
    const out = relabelRuntime(
      {
        ...outOfRange,
        message,
        source: tail.url,
        issues: [{ ...outOfRange.issues![0], message }],
        context: { groupId: 'tail', trackId: 'tail', url: tail.url },
      },
      two.list()
    );
    expect(out.source).toBe('./tail.csv');
    expect(out.context?.url).toBe('./tail.csv');
    expect(out.issues?.[0].message).toBe(
      './tail.csv (parsed as CSV): 1 of 2 rows fall outside P05067'
    );
    expect(JSON.stringify(out)).not.toContain('blob:');
  });

  it('relabels by the files it is given, so a file removed since the preview mounted is still named', () => {
    const own = makeStore().store;
    const gone = load(own, './gone.csv', GOOD_CSV);
    const atMount = own.list();
    own.remove('./gone.csv');
    const detail = { ...adapterFailure, source: gone.url };
    expect(relabelRuntime(detail, atMount).source).toBe('./gone.csv');
    expect(relabelRuntime(detail, own.list()).source).toBe(gone.url);
  });

  it('keys a grouped track as <groupId>-<trackId>, as the pre-flight does', () => {
    const grouped: RuntimeDetail = {
      ...adapterFailure,
      context: {
        ...adapterFailure.context,
        groupId: 'MY_LAB',
        trackId: 'hotspots',
      },
    };
    expect(isPreflightDuplicate(grouped, new Set(['MY_LAB-hotspots']))).toBe(
      true
    );
    expect(isPreflightDuplicate(grouped, new Set(['hotspots-MY_LAB']))).toBe(
      false
    );
    expect(isPreflightDuplicate(grouped, new Set(['hotspots-hotspots']))).toBe(
      false
    );
  });

  it('is a duplicate only for a pre-flighted track-fetch adapter / parse failure', () => {
    const failed = new Set(['hits-hits']);
    const withKind = (
      errorKind: string,
      phase = 'track-fetch'
    ): RuntimeDetail => ({
      ...adapterFailure,
      phase,
      context: {
        ...adapterFailure.context,
        errorKind,
      } as RuntimeDetail['context'],
    });
    expect(isPreflightDuplicate(adapterFailure, failed)).toBe(true);
    expect(isPreflightDuplicate(withKind('parse'), failed)).toBe(true);
    expect(isPreflightDuplicate(withKind('http'), failed)).toBe(false);
    expect(isPreflightDuplicate(withKind('network'), failed)).toBe(false);
    expect(
      isPreflightDuplicate(withKind('adapter', 'track-data'), failed)
    ).toBe(false);
    expect(
      isPreflightDuplicate(withKind('adapter', 'tooltip-field-miss'), failed)
    ).toBe(false);
    expect(isPreflightDuplicate(outOfRange, failed)).toBe(false);
    expect(isPreflightDuplicate(adapterFailure, new Set(['g-other']))).toBe(
      false
    );
    expect(isPreflightDuplicate(undefined, failed)).toBe(false);
  });
});

describe('answersFor', () => {
  it('answers a path with the file name, or its sanitised name, as its last segment', () => {
    const { store } = makeStore();
    const answers = answersFor({ name: 'a b.csv' }, store);
    expect(answers('./a b.csv')).toBe(true);
    expect(answers('./data/a-b.csv')).toBe(true);
    expect(answers('./other.csv')).toBe(false);
    expect(answers(undefined)).toBe(false);
    // Another file on a case-sensitive host.
    expect(answersFor({ name: 'SCORES.csv' }, store)('./scores.csv')).toBe(
      false
    );
  });

  it("leaves a reference registered to another file to that file, and takes back this file's own", () => {
    const { store } = makeStore();
    store.register({
      ref: './a-b.csv',
      name: 'a(b.csv',
      size: 1,
      format: 'csv',
      text: 'x',
    });
    store.register({
      ref: './a-b-2.csv',
      name: 'a b.csv',
      size: 1,
      format: 'csv',
      text: 'x',
    });
    const answers = answersFor({ name: 'a b.csv' }, store);
    expect(answers('./a-b.csv')).toBe(false);
    expect(answers('./a-b-2.csv')).toBe(true);
    expect(answersFor({ name: 'a(b.csv' }, store)('./a-b.csv')).toBe(true);
  });
});

describe('mayNameLocalFile', () => {
  /** The page's gate, given the config `lintConfig` parsed, as the page does. */
  async function gate(text: string): Promise<boolean> {
    const lint = await lintConfig(text, 'P05067');
    expect(lint.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    return mayNameLocalFile(text, lint.parsed);
  }

  it.each([
    [
      'a data path',
      'rows:\n  - id: a\n    kind: features\n    data: ./x.csv\n',
    ],
    [
      'a format: key',
      'rows:\n  - id: a\n    kind: features\n    data: { url: ./x.txt, format: csv }\n',
    ],
    [
      'a quoted data path',
      "rows:\n  - id: a\n    kind: features\n    data: 'my hits.tsv'\n",
    ],
    [
      'a JSON data path',
      '{ "rows": [{ "id": "a", "kind": "features", "data": ".\\/x.csv" }] }',
    ],
  ])('is true for %s', async (_, text) => expect(await gate(text)).toBe(true));

  // Each names a local sequence file that isn't loaded: the gate must open,
  // so the check it guards lists it and the preview is held back.
  it.each([
    ['a ./ sequence', 'sequence: ./p.txt\nrows: []\n'],
    ['a ../ sequence', "sequence: '../p.txt'\nrows: []\n"],
    ['a bare FASTA name', 'sequence: protein.fasta\nrows: []\n'],
    ['a JSON sequence path', '{ "sequence": "./p.txt", "rows": [] }'],
    ['a single-quoted key', "'sequence': ./private-construct.txt\nrows: []\n"],
    ['a JSON escaped slash', '{ "sequence": ".\\/q.txt", "rows": [] }'],
    [
      'a comment between key and value',
      'sequence: # a comment\n  ./construct\nrows: []\n',
    ],
    ['an extensionless path', 'sequence: ./construct\nrows: []\n'],
    ['a folded scalar', 'sequence: >-\n  ./construct\nrows: []\n'],
  ])('is true for %s, which the missing-file check lists', async (_, text) => {
    expect(await gate(text)).toBe(true);
    const local = await localDataDiagnostics(
      text,
      await parseConfigText(text),
      makeStore().store
    );
    expect(local.sequenceMissing).toBe(true);
    expect(local.diagnostics.map((d) => d.code)).toEqual([
      'local-file-missing',
    ]);
  });

  it.each([
    [
      'an inline-data config',
      'accession: P05067\nrows:\n  - id: a\n    kind: features\n    data:\n      from: inline\n      inlineData: []\n',
    ],
    ['inline residues', 'sequence: MKTAYIAKQR\nrows: []\n'],
    [
      'an inline FASTA block',
      'sequence: |\n  >my construct v2\n  MKTAYIAKQR\nrows: []\n',
    ],
    [
      'a hosted sequence and data',
      'sequence: https://lab.example/p.fasta\nrows:\n  - id: a\n    kind: features\n    data: /protvista/sample-data/x.csv\n',
    ],
    // Its `$schema:` URL ends in `.json`, which names no local file.
    ['the shipped default-config.yaml', defaultConfigYaml],
  ])('is false for %s', async (_, text) =>
    expect(await gate(text)).toBe(false)
  );
});

// ── Sequence files ────────────────────────────────────────────

/** Parse `text` as the element would from `ref`, and register it as the sequence. */
function loadSequence(store: LocalFileStore, ref: string, text: string) {
  const parsed = parseSequenceText(text, ref);
  if (!parsed.ok) throw new Error(parsed.message);
  return store.register({
    kind: 'sequence',
    ref,
    name: basename(ref),
    size: text.length,
    text,
    sequence: parsed.value,
  });
}

describe('isFastaFile', () => {
  it.each([
    ['p.fasta', '>h\nMK'],
    // Raw residues, so only the extension can say so.
    ['P.FA', 'MKTAYIAKQR'],
    ['x.faa', '>h\nMK'],
    ['x.fas', '>h\nMK'],
    // The extension wins over the content: a headerless FASTA is still one.
    ['raw.fa', 'MKTAYIAKQR'],
    ['seq.txt', '\uFEFF>my construct\nMK'],
    ['blank-first.txt', '\n  \r\n>my construct\nMK'],
    ['protein', '>h\nMK'],
  ])('reads %s as FASTA', (name, text) =>
    expect(isFastaFile(name, text)).toBe(true)
  );

  it.each([
    // A data extension wins over a leading '>'.
    ['hits.csv', '>h\nMK'],
    ['notes.txt', 'type,start,end\nDOMAIN,1,2'],
    ['raw.txt', 'MKTAYIAKQR'],
    ['empty.txt', ''],
  ])('reads %s as data', (name, text) =>
    expect(isFastaFile(name, text)).toBe(false)
  );
});

describe('isLocalSequenceReference', () => {
  it.each(['./p.fasta', '../p.txt', 'protein.fasta', ' ./p.fa '])(
    'accepts %s',
    (value) => expect(isLocalSequenceReference(value)).toBe(true)
  );
  it.each([
    '/protvista/p.fasta',
    'https://example.org/p.fasta',
    'blob:https://example.org/uuid.fasta',
    './{name}.fasta',
    'MKTAYIAKQR',
    '>h\nMK',
    'protein.txt',
    42,
  ])('rejects %s', (value) =>
    expect(isLocalSequenceReference(value)).toBe(false)
  );
});

describe('the store holds sequence files', () => {
  it('refuses, by type, a sequence entry without its parsed sequence', () => {
    const { store } = makeStore();
    const unparsed = {
      kind: 'sequence' as const,
      ref: './p.fasta',
      name: 'p.fasta',
      size: 2,
      text: '>h',
    };
    // @ts-expect-error -- a sequence entry needs `sequence` (`pnpm test:types`).
    store.register(unparsed);
    expect(loadSequence(store, './p.fasta', '>h\nMK').kind).toBe('sequence');
  });
});

describe('withLocalFiles and a sequence file', () => {
  it('swaps a loaded sequence: in as canonical inline FASTA', () => {
    const { store } = makeStore();
    loadSequence(store, './p.fasta', '\uFEFF>my hdr \r\nmktay\r\niakqr*\r\n');
    const config = { sequence: ' ./p.fasta ', rows: [] };
    const before = structuredClone(config);

    const out = withLocalFiles(config, store) as { sequence: string };
    expect(out.sequence).toBe('>my hdr\nMKTAYIAKQR');
    expect(config).toEqual(before);
  });

  it('swaps a headerless file in as residues the element parses identically', () => {
    const { store } = makeStore();
    const file = loadSequence(store, './p.fa', 'mktay\niakqr\n');
    const out = (
      withLocalFiles({ sequence: './p.fa', rows: [] }, store) as {
        sequence: string;
      }
    ).sequence;
    expect(out).toBe('MKTAYIAKQR');
    expect(isSequenceReference(out)).toBe(false);
    expect(parseSequenceText(out, undefined)).toEqual({
      ok: true,
      value: file.kind === 'sequence' && file.sequence,
    });
    expect(inlineSequenceText({ residues: 'MK', header: 'h' })).toBe('>h\nMK');
  });

  it.each([
    '/abs.fasta',
    'https://example.org/p.fasta',
    'MKTAYIAKQR',
    './{name}.fasta',
  ])('leaves a sequence: of %s as written', (value) => {
    const { store } = makeStore();
    // Even with a sequence registered under that very value.
    loadSequence(store, value, '>h\nMK');
    const out = withLocalFiles({ sequence: value, rows: [] }, store) as {
      sequence: string;
    };
    expect(out.sequence).toBe(value);
  });

  it('swaps in neither a data file under the sequence reference nor a sequence file under a track reference', () => {
    const { store } = makeStore();
    load(store, './p.txt', '>h\nMK', 'csv');
    loadSequence(store, './x.fasta', '>h\nMK');
    const out = withLocalFiles(
      {
        sequence: './p.txt',
        rows: [{ id: 'a', data: { url: './x.fasta', format: 'csv' } }],
      },
      store
    ) as { sequence: string; rows: { data: { url: string } }[] };
    expect(out.sequence).toBe('./p.txt');
    expect(out.rows[0].data.url).toBe('./x.fasta');
  });
});

describe('localDataDiagnostics and a sequence: reference', () => {
  const TEXT = '# ./p.fasta is our construct\nsequence: ./p.fasta\nrows: []\n';

  it('warns once, at /sequence on its value, when the file is not loaded — in a config with no track references', async () => {
    const { store } = makeStore();
    const result = await localDataDiagnostics(
      TEXT,
      await parseConfigText(TEXT),
      store
    );
    const from = TEXT.indexOf('./p.fasta', TEXT.indexOf('sequence:'));
    expect(result.diagnostics).toEqual([
      {
        from,
        to: from + './p.fasta'.length,
        severity: 'warning',
        code: 'local-file-missing',
        path: '/sequence',
        message:
          './p.fasta isn\'t loaded in this browser — press "Load data file…" and pick p.fasta.',
      },
    ]);
    expect(result.sequenceMissing).toBe(true);
  });

  it('warns for a JSON config too, anchored on the value', async () => {
    const { store } = makeStore();
    const text = '{\n  "sequence": "./p.txt",\n  "rows": []\n}';
    const result = await localDataDiagnostics(
      text,
      await parseConfigText(text),
      store
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'local-file-missing',
        path: '/sequence',
        from: text.indexOf('./p.txt'),
      }),
    ]);
    expect(result.sequenceMissing).toBe(true);
  });

  it('says nothing once the file is loaded', async () => {
    const { store } = makeStore();
    loadSequence(store, './p.fasta', '>h\nMK');
    const result = await localDataDiagnostics(
      TEXT,
      await parseConfigText(TEXT),
      store
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.sequenceMissing).toBe(false);
  });

  it.each(['MKTAYIAKQR', 'https://example.org/p.fasta', '/protvista/p.fasta'])(
    'says nothing for a sequence: of %s',
    async (value) => {
      const { store } = makeStore();
      const result = await localDataDiagnostics(
        '',
        { sequence: value, rows: [] },
        store
      );
      expect(result.diagnostics).toEqual([]);
      expect(result.sequenceMissing).toBe(false);
    }
  );

  it('says which file is loaded as the wrong thing', async () => {
    const { store } = makeStore();
    load(store, './p.txt', 'type,start,end\nDOMAIN,1,2', 'csv');
    loadSequence(store, './x.txt', '>h\nMK');
    const result = await localDataDiagnostics(
      '',
      {
        sequence: './p.txt',
        rows: [{ id: 'a', data: { url: './x.txt', format: 'csv' } }],
      },
      store
    );
    expect(
      result.diagnostics.map((d) => [d.severity, d.code, d.path, d.message])
    ).toEqual([
      [
        'warning',
        'local-file-missing',
        '/sequence',
        './p.txt is loaded as track data, not as the sequence — load p.txt again to use it as the sequence.',
      ],
      [
        'error',
        'data-parse',
        'a',
        './x.txt is loaded as the protein sequence, not as track data.',
      ],
    ]);
    expect(result.sequenceMissing).toBe(true);
  });
});
