/**
 * Unit tests for the delimited generic-format adapters and their shared
 * parser core.
 *
 * Covers:
 *   - the RFC-4180 tokenizer (`parseDelimited`): quoted delimiters,
 *     escaped quotes, embedded newlines, CRLF, trailing newline;
 *   - `features-csv` / `features-tsv` happy path → feature records
 *     (`type`, `start`, `end`, optional `description` / `score`);
 *   - strict, row/column-named errors on malformed input (missing
 *     header column, non-numeric coordinate, ragged row);
 *   - the non-string guard returning `[]`;
 *   - extra columns kept on the record (#283), with the render fields
 *     trimmed/coerced and the blocked names dropped into a warnings sink.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseDelimited, rowsToFeatureRecords } from '../adapters/dsv.js';
import type { DecodeWarning } from '../adapters/feature-fields.js';
import type { CoordinateRow } from '../adapters/coordinates.js';

import { runPipeline } from '../adapters/pipeline.js';

/**
 * The grid adapters these tests were written against are gone: a source now
 * resolves to a (shape, format) pair and `runPipeline` composes it. The
 * assertions below are unchanged — same parsers, same messages — so they are
 * re-pointed rather than rewritten, with the source name the loader would
 * pass so the error text is what an author actually sees.
 */
const featuresCsv = (body: unknown) =>
  runPipeline('feature', 'csv', body, { source: './hits.csv' });
const featuresTsv = (body: unknown) =>
  runPipeline('feature', 'tsv', body, { source: './hits.tsv' });

// ─────────────────────────────────────────────────────────────
// parseDelimited — RFC-4180 tokenizer
// ─────────────────────────────────────────────────────────────

describe('parseDelimited', () => {
  it('splits simple comma rows', () => {
    expect(parseDelimited('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a delimiter inside a quoted field', () => {
    expect(parseDelimited('type,description\nDOMAIN,"a, b, c"', ',')).toEqual([
      ['type', 'description'],
      ['DOMAIN', 'a, b, c'],
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseDelimited('x\n"she said ""hi"""', ',')).toEqual([
      ['x'],
      ['she said "hi"'],
    ]);
  });

  it('keeps an embedded newline inside a quoted field', () => {
    expect(parseDelimited('x\n"line1\nline2"', ',')).toEqual([
      ['x'],
      ['line1\nline2'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('tokenizes tabs for the TSV case', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns no rows for empty input', () => {
    expect(parseDelimited('', ',')).toEqual([]);
  });

  it('does not append a spurious empty row for a trailing newline', () => {
    expect(parseDelimited('a\n', ',')).toEqual([['a']]);
  });

  it('preserves a final quoted-empty field as its own row', () => {
    // Regression guard for the flush condition: a trailing `""` row must
    // not be dropped (matters for the reusable headerless case).
    expect(parseDelimited('a\n""', ',')).toEqual([['a'], ['']]);
  });
});

// ─────────────────────────────────────────────────────────────
// features-csv — happy path
// ─────────────────────────────────────────────────────────────

describe('features-csv adapter', () => {
  it('parses the documented header into feature records', () => {
    const csv =
      'type,start,end,description,score\n' +
      'DOMAIN,10,25,Kinase domain,0.9\n' +
      'SITE,42,42,Active site,0.5';
    expect(featuresCsv(csv)).toEqual([
      {
        type: 'DOMAIN',
        start: 10,
        end: 25,
        description: 'Kinase domain',
        score: 0.9,
      },
      { type: 'SITE', start: 42, end: 42, description: 'Active site', score: 0.5 },
    ]);
  });

  it('omits description/score when absent or empty', () => {
    const csv = 'type,start,end,description\nDOMAIN,1,5,';
    expect(featuresCsv(csv)).toEqual([{ type: 'DOMAIN', start: 1, end: 5 }]);
  });

  it('accepts a quoted comma in the description', () => {
    const csv =
      'type,start,end,description\nDOMAIN,1,5,"binds ATP, Mg2+"';
    expect(featuresCsv(csv)).toEqual([
      { type: 'DOMAIN', start: 1, end: 5, description: 'binds ATP, Mg2+' },
    ]);
  });

  it('throws a row+column-named error on a non-numeric start', () => {
    const csv = 'type,start,end,description\nDOMAIN,abc,5,x';
    expect(() => featuresCsv(csv)).toThrow(
      /\.\/hits\.csv \(parsed as CSV\): row 2, column "start": expected a number, got "abc"/
    );
  });

  it('throws naming the missing required header column', () => {
    const csv = 'type,start,description\nDOMAIN,1,x';
    expect(() => featuresCsv(csv)).toThrow(
      /\.\/hits\.csv \(parsed as CSV\): missing required header column "end"/
    );
  });

  it('throws on a ragged row', () => {
    const csv = 'type,start,end,description\nDOMAIN,1,5';
    expect(() => featuresCsv(csv)).toThrow(
      /\.\/hits\.csv \(parsed as CSV\): row 2 is ragged — expected 4 columns, got 3/
    );
  });

  it('numbers rows by record even when a quoted field spans physical lines', () => {
    // Row 2 is valid but its description contains an embedded newline; the
    // malformed row 3 must still be reported as "row 3" (record-based, not
    // physical-line-based).
    const csv =
      'type,start,end,description\n' +
      'DOMAIN,1,5,"multi\nline note"\n' +
      'SITE,x,9,bad';
    expect(() => featuresCsv(csv)).toThrow(
      /\.\/hits\.csv \(parsed as CSV\): row 3, column "start": expected a number, got "x"/
    );
  });

  it('rejects a non-decimal numeric literal (hex) rather than coercing it', () => {
    // Number('0x10') is 16; the adapter must not silently accept it.
    const csv = 'type,start,end,description\nDOMAIN,0x10,25,x';
    expect(() => featuresCsv(csv)).toThrow(
      /\.\/hits\.csv \(parsed as CSV\): row 2, column "start": expected a number, got "0x10"/
    );
  });

  it('throws on a duplicate header column', () => {
    const csv = 'type,start,end,start,description\nDOMAIN,1,5,2,x';
    expect(() => featuresCsv(csv)).toThrow(
      /\.\/hits\.csv \(parsed as CSV\): duplicate header column "start"/
    );
  });

  it('returns [] and warns with a descriptive message on a non-string body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(featuresCsv({ not: 'text' })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('expected a text body')
    );
    warn.mockRestore();
  });

  it('throws a row-named error when end is before start', () => {
    const csv = 'type,start,end,description\nDOMAIN,1,5,a\nDOMAIN,5,4,b';
    expect(() => featuresCsv(csv)).toThrow(
      new Error(
        './hits.csv (parsed as CSV): row 3: end (4) is before start (5).'
      )
    );
  });

  it('accepts a single-residue feature (start === end)', () => {
    const csv = 'type,start,end,description\nDOMAIN,7,7,x';
    expect(featuresCsv(csv)).toEqual([
      { type: 'DOMAIN', start: 7, end: 7, description: 'x' },
    ]);
  });

  it('rejects a fractional start with a row+column-named error', () => {
    const csv = 'type,start,end,description\nDOMAIN,18.5,20,x';
    expect(() => featuresCsv(csv)).toThrow(
      new Error(
        './hits.csv (parsed as CSV): row 2, column "start": expected a whole number, got "18.5".'
      )
    );
  });

  it('rejects a fractional end', () => {
    const csv = 'type,start,end,description\nDOMAIN,18,20.25,x';
    expect(() => featuresCsv(csv)).toThrow(
      new Error(
        './hits.csv (parsed as CSV): row 2, column "end": expected a whole number, got "20.25".'
      )
    );
  });

  it('reports a non-number before a fraction, and a fraction before an inverted interval', () => {
    expect(() =>
      featuresCsv('type,start,end,description\nDOMAIN,1.5,abc,x')
    ).toThrow(/column "end": expected a number, got "abc"/);
    expect(() =>
      featuresCsv('type,start,end,description\nDOMAIN,9.5,3,x')
    ).toThrow(/column "start": expected a whole number/);
  });

  it('accepts an integer written with an exponent', () => {
    const csv = 'type,start,end,description\nDOMAIN,1e1,1e2,x';
    expect(featuresCsv(csv)).toEqual([
      { type: 'DOMAIN', start: 10, end: 100, description: 'x' },
    ]);
  });

  it('accepts zero and negative integer coordinates (bounds are checked later)', () => {
    expect(featuresCsv('type,start,end,description\nDOMAIN,0,5,x')).toEqual([
      { type: 'DOMAIN', start: 0, end: 5, description: 'x' },
    ]);
    expect(featuresCsv('type,start,end,description\nDOMAIN,-3,5,x')).toEqual([
      { type: 'DOMAIN', start: -3, end: 5, description: 'x' },
    ]);
  });

  it('keeps a fractional score', () => {
    const csv = 'type,start,end,description,score\nDOMAIN,1,5,x,0.87';
    expect(featuresCsv(csv)).toEqual([
      { type: 'DOMAIN', start: 1, end: 5, description: 'x', score: 0.87 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// features-tsv — same behaviour, tab-delimited
// ─────────────────────────────────────────────────────────────

describe('features-tsv adapter', () => {
  it('parses tab-separated rows into feature records', () => {
    const tsv = 'type\tstart\tend\tdescription\nDOMAIN\t10\t25\tKinase domain';
    expect(featuresTsv(tsv)).toEqual([
      { type: 'DOMAIN', start: 10, end: 25, description: 'Kinase domain' },
    ]);
  });

  it('throws a row+column-named error on a non-numeric end', () => {
    const tsv = 'type\tstart\tend\tdescription\nDOMAIN\t1\tzz\tx';
    expect(() => featuresTsv(tsv)).toThrow(
      /\.\/hits\.tsv \(parsed as TSV\): row 2, column "end": expected a number, got "zz"/
    );
  });

  it('keeps a tab-free description with commas verbatim (no CSV quoting rules)', () => {
    const tsv = 'type\tstart\tend\tdescription\nDOMAIN\t1\t5\tbinds ATP, Mg2+';
    expect(featuresTsv(tsv)).toEqual([
      { type: 'DOMAIN', start: 1, end: 5, description: 'binds ATP, Mg2+' },
    ]);
  });

  it('returns [] and warns with a descriptive message on a non-string body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(featuresTsv(42)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('expected a text body')
    );
    warn.mockRestore();
  });

  it('throws a row-named error when end is before start', () => {
    const tsv = 'type\tstart\tend\tdescription\nDOMAIN\t5\t4\tb';
    expect(() => featuresTsv(tsv)).toThrow(
      new Error(
        './hits.tsv (parsed as TSV): row 2: end (4) is before start (5).'
      )
    );
  });
});

// ─────────────────────────────────────────────────────────────
// rowsToFeatureRecords — shared edge cases
// ─────────────────────────────────────────────────────────────

describe('rowsToFeatureRecords', () => {
  it('returns [] for no rows', () => {
    expect(rowsToFeatureRecords([], { formatLabel: 'features-csv' })).toEqual([]);
  });

  it('rejects a non-numeric score', () => {
    const rows = [
      ['type', 'start', 'end', 'description', 'score'],
      ['DOMAIN', '1', '5', 'x', 'high'],
    ];
    expect(() =>
      rowsToFeatureRecords(rows, { formatLabel: 'features-csv' })
    ).toThrow(/row 2, column "score": expected a number, got "high"/);
  });

  it('accepts a trailing blank line and a prototype-named column', () => {
    // The same two defects the point parser had, in the parser it inherited
    // them from: a spreadsheet export's trailing blank line was read as a
    // ragged row, and a column named `toString` collided with
    // `Object.prototype` in the header index. Since #283 other columns are
    // kept, but `toString` is a blocked name, so the record still equals the
    // canonical one (the warning it raises is pinned below).
    const base = featuresCsv('type,start,end,description\nDOMAIN,1,9,x\n');
    expect(featuresCsv('type,start,end,description\nDOMAIN,1,9,x\n\n')).toEqual(
      base
    );
    expect(
      featuresCsv('type,start,end,description,toString\nDOMAIN,1,9,x,y\n')
    ).toEqual(base);
  });
});

// ─────────────────────────────────────────────────────────────
// Extra columns (#283)
// ─────────────────────────────────────────────────────────────

describe.each([
  { format: 'csv' as const, sep: ',', source: './hits.csv', label: './hits.csv (parsed as CSV)' },
  { format: 'tsv' as const, sep: '\t', source: './hits.tsv', label: './hits.tsv (parsed as TSV)' },
])('extra columns ($format)', ({ format, sep, source, label }) => {
  const file = (...lines: string[][]) =>
    lines.map((cells) => cells.join(sep)).join('\n');
  const decode = (body: string) => {
    const warnings: DecodeWarning[] = [];
    const coordinates: CoordinateRow[] = [];
    const out = runPipeline('feature', format, body, {
      source,
      warnings,
      coordinates,
    }) as Array<Record<string, unknown>>;
    return { out, warnings, coordinates };
  };

  it('keeps an unknown column verbatim, keyed by the trimmed header name', () => {
    const { out, warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', ' pmid ', 'note'],
        ['DOMAIN', '1', '9', 'x', ' 123 ', ''],
        ['DOMAIN', '2', '8', 'y', '456', 'n']
      )
    );
    expect(out).toStrictEqual([
      { type: 'DOMAIN', start: 1, end: 9, description: 'x', pmid: ' 123 ', note: '' },
      { type: 'DOMAIN', start: 2, end: 8, description: 'y', pmid: '456', note: 'n' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('puts canonical fields first, then the rest in header order', () => {
    const { out } = decode(
      file(
        ['gene', 'color', 'end', 'type', 'url', 'start', 'description'],
        ['g', 'red', '9', 'DOMAIN', 'https://x.org', '1', 'x']
      )
    );
    expect(Object.keys(out[0])).toEqual([
      'type',
      'start',
      'end',
      'description',
      'gene',
      'color',
      'url',
    ]);
  });

  it('trims `color` / `shape` / `fill` and leaves them off when blank', () => {
    const { out } = decode(
      file(
        ['type', 'start', 'end', 'description', 'color', 'shape', 'fill'],
        ['DOMAIN', '1', '9', 'x', ' #1f77b4 ', ' diamond ', 'navy'],
        ['DOMAIN', '2', '8', 'y', '', '  ', '']
      )
    );
    expect(out).toStrictEqual([
      {
        type: 'DOMAIN',
        start: 1,
        end: 9,
        description: 'x',
        color: '#1f77b4',
        shape: 'diamond',
        fill: 'navy',
      },
      { type: 'DOMAIN', start: 2, end: 8, description: 'y' },
    ]);
  });

  it('passes an unknown `shape` through, and treats `Color` as a plain extra', () => {
    const { out, warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', 'shape', 'Color'],
        ['DOMAIN', '1', '9', 'x', 'blob', 'bleu']
      )
    );
    expect(out[0]).toMatchObject({ shape: 'blob', Color: 'bleu' });
    expect(out[0].color).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('drops a `shape` that names an Object.prototype property, with one warning', () => {
    // The canvas looks shapes up on plain object literals, so `valueOf`
    // would find an inherited method and throw mid-draw.
    const { out, warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', 'shape'],
        ['DOMAIN', '1', '9', 'x', 'valueOf'],
        ['DOMAIN', '2', '9', 'x', ' hasOwnProperty '],
        ['DOMAIN', '3', '9', 'x', 'constructor'],
        ['DOMAIN', '4', '9', 'x', '__proto__'],
        ['DOMAIN', '5', '9', 'x', 'valueOf'],
        ['DOMAIN', '6', '9', 'x', 'diamond']
      )
    );
    expect(out.map((r) => r.shape)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'diamond',
    ]);
    expect('shape' in out[0]).toBe(false);
    expect(Object.getPrototypeOf(out[3])).toBe(Object.prototype);
    expect(warnings).toEqual([
      {
        code: 'data-field-ignored',
        message:
          `${label}: ignored "shape" value(s) in 5 row(s) ("valueOf", ` +
          `"hasOwnProperty", "constructor", …) — these names are reserved ` +
          `by JavaScript, so those features take the track's shape.`,
      },
    ]);
  });

  it('parses `opacity` as a number from 0 to 1, leaving a blank cell off', () => {
    const { out } = decode(
      file(
        ['type', 'start', 'end', 'description', 'opacity'],
        ['DOMAIN', '1', '9', 'x', ' 0.5 '],
        ['DOMAIN', '1', '9', 'x', '1'],
        ['DOMAIN', '1', '9', 'x', '']
      )
    );
    expect(out.map((r) => r.opacity)).toEqual([0.5, 1, undefined]);
    expect('opacity' in out[2]).toBe(false);
  });

  it.each(['abc', '1.5', '-0.1'])('rejects an `opacity` of %j', (bad) => {
    expect(() =>
      decode(
        file(
          ['type', 'start', 'end', 'description', 'opacity'],
          ['DOMAIN', '1', '9', 'x', '0.5'],
          ['DOMAIN', '1', '9', 'x', bad]
        )
      )
    ).toThrow(
      `${label}: row 3, column "opacity": expected a number from 0 to 1, got "${bad}".`
    );
  });

  it('reports a coordinate error before looking at the extras', () => {
    expect(() =>
      decode(
        file(
          ['type', 'start', 'end', 'description', 'opacity'],
          ['DOMAIN', '1.5', '9', 'x', 'abc']
        )
      )
    ).toThrow(/row 2, column "start": expected a whole number/);
  });

  it('keeps an unpaintable colour and warns once, naming it', () => {
    const { out, warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', 'color', 'fill'],
        ['DOMAIN', '1', '9', 'x', 'bleu', ''],
        ['DOMAIN', '1', '9', 'x', '#1f77b4', 'rgb(0 0 0)'],
        ['DOMAIN', '1', '9', 'x', 'bleu', '#catFace'],
        ['DOMAIN', '1', '9', 'x', 'grren', 'reed']
      )
    );
    expect(out[0].color).toBe('bleu');
    expect(warnings).toEqual([
      {
        code: 'unpaintable-color',
        message:
          `${label}: 3 row(s) have a colour the canvas cannot paint ` +
          `("bleu", "#catFace", "grren", …); those features are drawn in ` +
          `the previous feature's colour.`,
      },
    ]);
  });

  it('pushes no warning for paintable colours', () => {
    const { warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', 'color', 'fill'],
        ['DOMAIN', '1', '9', 'x', 'SteelBlue', '#abc'],
        ['DOMAIN', '1', '9', 'x', 'hsl(10 50% 50%)', 'transparent']
      )
    );
    expect(warnings).toEqual([]);
  });

  it('drops the viewer fields with exactly one warning naming them', () => {
    const { out, warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', 'tooltipContent', 'locations', 'residuesToHighlight', 'pmid'],
        ['DOMAIN', '1', '9', 'x', '<img src=x onerror=alert(1)>', 'a', 'b', '1'],
        ['DOMAIN', '2', '8', 'y', '<b>', 'c', 'd', '2']
      )
    );
    expect(out).toStrictEqual([
      { type: 'DOMAIN', start: 1, end: 9, description: 'x', pmid: '1' },
      { type: 'DOMAIN', start: 2, end: 8, description: 'y', pmid: '2' },
    ]);
    expect(warnings).toEqual([
      {
        code: 'data-field-ignored',
        message:
          `${label}: ignored column(s) "tooltipContent", "locations", ` +
          `"residuesToHighlight" — these names are reserved by the viewer ` +
          `or by JavaScript and cannot come from a data file.`,
      },
    ]);
  });

  it('drops `Object.prototype` names without touching the prototype', () => {
    const { out, warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', 'toString', '__proto__', 'constructor'],
        ['DOMAIN', '1', '9', 'x', 'a', 'b', 'c']
      )
    );
    expect(Object.getPrototypeOf(out[0])).toBe(Object.prototype);
    expect(out[0]).toStrictEqual({ type: 'DOMAIN', start: 1, end: 9, description: 'x' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"toString", "__proto__", "constructor"');
  });

  it('drops an empty header name silently', () => {
    const { out, warnings } = decode(
      file(['type', 'start', 'end', 'description', ''], ['DOMAIN', '1', '9', 'x', ''])
    );
    expect(out).toStrictEqual([{ type: 'DOMAIN', start: 1, end: 9, description: 'x' }]);
    expect(warnings).toEqual([]);
  });

  it('passes a `begin` column through as a plain extra (no alias in CSV)', () => {
    const { out } = decode(
      file(['type', 'start', 'end', 'description', 'begin'], ['DOMAIN', '1', '9', 'x', '4'])
    );
    expect(out[0]).toStrictEqual({ type: 'DOMAIN', start: 1, end: 9, description: 'x', begin: '4' });
  });

  it('two warnings for a file with a blocked column and an unpaintable colour', () => {
    const { warnings } = decode(
      file(
        ['type', 'start', 'end', 'description', 'color', 'tooltipContent'],
        ['DOMAIN', '1', '9', 'x', 'bleu', 'y']
      )
    );
    expect(warnings.map((w) => w.code)).toEqual(['data-field-ignored', 'unpaintable-color']);
  });

  it('a record without extras is unchanged, and the sink stays empty', () => {
    const { out, warnings } = decode(
      file(['type', 'start', 'end', 'description', 'score'], ['DOMAIN', '1', '9', 'x', '0.5'])
    );
    expect(out).toStrictEqual([{ type: 'DOMAIN', start: 1, end: 9, description: 'x', score: 0.5 }]);
    expect(warnings).toEqual([]);
  });

  it('leaves row numbers and coordinates unchanged by extra columns', () => {
    const canonical = decode(
      file(['type', 'start', 'end', 'description'], ['DOMAIN', '1', '9', 'x'], ['', '', '', ''], ['SITE', '4', '4', 'y'])
    );
    const extended = decode(
      file(
        ['type', 'start', 'end', 'description', 'color', 'pmid'],
        ['DOMAIN', '1', '9', 'x', 'red', '1'],
        ['', '', '', '', '', ''],
        ['SITE', '4', '4', 'y', '', '2']
      )
    );
    expect(extended.coordinates).toEqual(canonical.coordinates);
    expect(extended.coordinates.map((c) => c.row)).toEqual([2, 4]);
    // Row numbers ride beside the payload, never on a record.
    for (const record of extended.out) {
      expect(Object.keys(record)).not.toContain('row');
    }
  });

  it('pushes no warnings when the decode throws', () => {
    const warnings: DecodeWarning[] = [];
    expect(() =>
      runPipeline(
        'feature',
        format,
        file(
          ['type', 'start', 'end', 'description', 'tooltipContent', 'color', 'opacity'],
          ['DOMAIN', '1', '9', 'x', 'y', 'bleu', '0.5'],
          ['DOMAIN', '1', '9', 'x', 'y', 'bleu', '7']
        ),
        { source, warnings }
      )
    ).toThrow(/opacity/);
    expect(warnings).toEqual([]);
  });

  it('never logs, with or without a sink', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const body = file(
        ['type', 'start', 'end', 'description', 'tooltipContent', 'color'],
        ['DOMAIN', '1', '9', 'x', 'y', 'bleu']
      );
      runPipeline('feature', format, body, { source });
      decode(body);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('rowsToFeatureRecords — the warnings sink', () => {
  it('reports the blocked `toString` column when a sink is passed', () => {
    const warnings: DecodeWarning[] = [];
    rowsToFeatureRecords(
      [
        ['type', 'start', 'end', 'description', 'toString'],
        ['DOMAIN', '1', '9', 'x', 'y'],
      ],
      { formatLabel: 'features-csv', warnings }
    );
    expect(warnings).toEqual([
      {
        code: 'data-field-ignored',
        message:
          'features-csv: ignored column(s) "toString" — these names are ' +
          'reserved by the viewer or by JavaScript and cannot come from a ' +
          'data file.',
      },
    ]);
  });
});
