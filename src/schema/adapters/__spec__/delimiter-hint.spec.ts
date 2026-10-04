/**
 * Delimiter hints on a missing-header-column error (#276).
 *
 * The format alone picks the delimiter, so a semicolon "CSV" from Excel, a
 * tab file read as CSV or a comma file read as TSV all read as one giant
 * column and fail with `missing required header column "type"`. That is true
 * but sends the author hunting for a typo. These pin that the message now
 * names the delimiter the header seems to use and the fix, that a genuinely
 * missing column keeps its message byte for byte, and that parsing itself
 * never changes.
 */

import { describe, it, expect } from 'vitest';
import { runPipeline, type PipelineOptions } from '../pipeline.js';
import {
  MissingHeaderColumnError,
  REQUIRED_COLUMNS,
  suspectDelimiter,
  VARIATION_COLUMNS,
} from '../dsv.js';
import type { CoordinateRow } from '../coordinates.js';
import type { DecodeWarning } from '../feature-fields.js';
import type { DataFormat, ShapeName } from '../../types.js';

const FEATURE_HEADER =
  'Header must contain type, start, end, description[, score].';

/** A feature-shape body written with `delimiter`. */
const featureBody = (delimiter: string) =>
  ['type', 'start', 'end', 'description'].join(delimiter) +
  '\n' +
  ['DOMAIN', '1', '9', 'kinase'].join(delimiter) +
  '\n';

/** Run the pipeline and return what it threw (failing if it did not throw). */
function thrown(
  shape: ShapeName,
  format: DataFormat,
  body: string,
  opts: PipelineOptions = {}
): MissingHeaderColumnError {
  try {
    runPipeline(shape, format, body, opts);
  } catch (err) {
    return err as MissingHeaderColumnError;
  }
  throw new Error('expected runPipeline to throw');
}

const CONTENT = [
  { name: 'comma', delimiter: ',' },
  { name: 'tab', delimiter: '\t' },
  { name: 'semicolon', delimiter: ';' },
] as const;
const FORMATS = ['csv', 'tsv'] as const;

/** Content delimiter × declared format, every cell of the matrix. */
const MATRIX = CONTENT.flatMap((content) =>
  FORMATS.map((format) => ({ ...content, format }))
);
const MATCHING = MATRIX.filter(
  (c) =>
    (c.delimiter === ',' && c.format === 'csv') ||
    (c.delimiter === '\t' && c.format === 'tsv')
);
const MISMATCHED = MATRIX.filter((c) => !MATCHING.includes(c));

/** The `format:` value each mismatched cell's hint names. */
const FIX: Record<string, string> = {
  comma: '`format: csv`',
  tab: '`format: tsv`',
  semicolon: '`format: tsv`',
};

/** The rename advice each mismatched cell's hint gives for a `./hits.<format>` file. */
const RENAME: Record<string, string> = {
  'comma-tsv': '(or rename the file to .csv)',
  'tab-csv': '(or rename the file to .tsv)',
  'semicolon-csv': 'or a .tsv name',
  'semicolon-tsv': '(or rename the file to .csv)',
};

describe('delimiter hints across {comma, tab, semicolon} × {CSV, TSV}', () => {
  it.each(MATCHING)(
    'reads $name content declared $format as usual',
    ({ delimiter, format }) => {
      expect(
        runPipeline('feature', format, featureBody(delimiter), {
          source: `./hits.${format}`,
        })
      ).toEqual([{ type: 'DOMAIN', start: 1, end: 9, description: 'kinase' }]);
    }
  );

  describe('from a file', () => {
    it.each(MISMATCHED)(
      'names $name separation in $format with the fix',
      ({ name, delimiter, format }) => {
        const err = thrown('feature', format, featureBody(delimiter), {
          source: `./hits.${format}`,
        });
        expect(err).toBeInstanceOf(MissingHeaderColumnError);
        expect(
          err.message.startsWith(
            `./hits.${format} (parsed as ${format.toUpperCase()}): ` +
              `missing required header column "type". ${FEATURE_HEADER} `
          )
        ).toBe(true);
        expect(err.message).toContain(`The header looks ${name}-separated`);
        expect(err.message).toContain(FIX[name]);
        expect(err.message).toContain(RENAME[`${name}-${format}`]);
        // `format:` is the first remedy everywhere; a rename comes after it.
        expect(err.message.indexOf(FIX[name])).toBeLessThan(
          err.message.indexOf(RENAME[`${name}-${format}`])
        );
        expect(err.message).not.toContain('\n');
        expect(err.suspectedDelimiter).toBe(delimiter);
        expect(err.column).toBe('type');
        expect(err.required).toEqual(REQUIRED_COLUMNS);
      }
    );
  });

  describe('from inline data', () => {
    it.each(MISMATCHED)(
      'names $name separation in $format, with format: advice only',
      ({ name, delimiter, format }) => {
        const err = thrown('feature', format, featureBody(delimiter));
        expect(
          err.message.startsWith(
            `inline data (parsed as ${format.toUpperCase()}): ` +
              `missing required header column "type". ${FEATURE_HEADER} `
          )
        ).toBe(true);
        expect(err.message).toContain(`The header looks ${name}-separated`);
        expect(err.message).toContain(FIX[name]);
        expect(err.message).not.toMatch(/rename|\.tsv name/);
        expect(err.suspectedDelimiter).toBe(delimiter);
      }
    );
  });

  it('spells out the tab hint for a .csv file in full', () => {
    expect(
      thrown('feature', 'csv', featureBody('\t'), { source: './hits.csv' })
        .message
    ).toBe(
      './hits.csv (parsed as CSV): missing required header column "type". ' +
        `${FEATURE_HEADER} The header looks tab-separated — read it as TSV: ` +
        'set `format: tsv` (or rename the file to .tsv).'
    );
  });

  it('spells out the comma hint for inline TSV in full', () => {
    expect(thrown('feature', 'tsv', featureBody(',')).message).toBe(
      'inline data (parsed as TSV): missing required header column "type". ' +
        `${FEATURE_HEADER} The header looks comma-separated — read it as CSV: ` +
        'set `format: csv`.'
    );
  });

  it('spells out the semicolon hint for a .csv file in full', () => {
    expect(
      thrown('feature', 'csv', featureBody(';'), { source: './hits.csv' })
        .message
    ).toBe(
      './hits.csv (parsed as CSV): missing required header column "type". ' +
        `${FEATURE_HEADER} The header looks semicolon-separated, which ` +
        'ProtVista does not read. If it came from Excel, save it as "Text ' +
        '(Tab delimited)" and read it as TSV (`format: tsv` or a .tsv name — ' +
        'Excel names that export .txt), or re-export it comma-separated.'
    );
  });

  it('spells out the semicolon hint for a .tsv file in full', () => {
    expect(
      thrown('feature', 'tsv', featureBody(';'), { source: './hits.tsv' })
        .message
    ).toBe(
      './hits.tsv (parsed as TSV): missing required header column "type". ' +
        `${FEATURE_HEADER} The header looks semicolon-separated, which ` +
        'ProtVista does not read. If it came from Excel, save it again as ' +
        '"Text (Tab delimited)" and keep reading it as TSV (`format: tsv`), ' +
        'or re-export it comma-separated and read it as CSV: set ' +
        '`format: csv` (or rename the file to .csv).'
    );
  });

  it('spells out the semicolon hint for inline TSV in full', () => {
    expect(thrown('feature', 'tsv', featureBody(';')).message).toBe(
      'inline data (parsed as TSV): missing required header column "type". ' +
        `${FEATURE_HEADER} The header looks semicolon-separated, which ` +
        'ProtVista does not read. If it came from Excel, save it again as ' +
        '"Text (Tab delimited)" and keep reading it as TSV (`format: tsv`), ' +
        'or re-export it comma-separated and read it as CSV: set ' +
        '`format: csv`.'
    );
  });

  it('never recommends a format: value for semicolons, since none exists', () => {
    const { message } = thrown('feature', 'csv', featureBody(';'));
    expect(message).not.toContain('`format: csv`');
    expect(message).toContain('read it as TSV (`format: tsv`)');
  });
});

describe('rename advice only where a rename changes the reading', () => {
  it('gives an extensionless URL format: advice only', () => {
    const { message } = thrown('feature', 'csv', featureBody('\t'), {
      source: 'https://example.org/api/hits',
    });
    expect(message).toMatch(
      /^https:\/\/example\.org\/api\/hits \(parsed as CSV\): /
    );
    expect(message).toContain('set `format: tsv`.');
    expect(message).not.toContain('rename');
  });

  it('gives an unrecognised extension format: advice only', () => {
    const { message } = thrown('feature', 'csv', featureBody('\t'), {
      source: './hits.txt',
    });
    expect(message).toContain('set `format: tsv`.');
    expect(message).not.toContain('rename');
  });

  it('gives no rename advice when the extension already disagrees with the reading', () => {
    // `./hits.tsv` read as CSV means an explicit `format: csv` overrode the
    // extension, so renaming the file to .tsv would change nothing.
    const { message } = thrown('feature', 'csv', featureBody('\t'), {
      source: './hits.tsv',
    });
    expect(message).toContain('set `format: tsv`.');
    expect(message).not.toContain('rename');
  });

  it('treats an empty source as inline, as the label does', () => {
    const { message } = thrown('feature', 'csv', featureBody('\t'), {
      source: '',
    });
    expect(message).toMatch(/^inline data \(parsed as CSV\): /);
    expect(message).not.toContain('rename');
  });

  it('honours a query string on a recognised extension', () => {
    const { message } = thrown('feature', 'csv', featureBody('\t'), {
      source: 'https://example.org/hits.csv?v=2',
    });
    expect(message).toContain('(or rename the file to .tsv)');
  });

  it('appends the hint after a custom formatLabel', () => {
    const { message } = thrown('feature', 'csv', featureBody(';'), {
      formatLabel: 'my-label',
      source: './hits.csv',
    });
    expect(message).toMatch(
      /^my-label: missing required header column "type"\. .* The header looks semicolon-separated/
    );
  });
});

describe('the point and variation shapes get the same hint', () => {
  it('names "position" for a semicolon line-graph CSV', () => {
    const err = thrown('point', 'csv', 'position;value\n1;5\n', {
      source: './depth.csv',
    });
    expect(err.message).toMatch(
      /^\.\/depth\.csv \(parsed as CSV\): missing required header column "position"\. Header must contain position, value\. The header looks semicolon-separated/
    );
    expect(err.suspectedDelimiter).toBe(';');
    expect(err.required).toEqual(['position', 'value']);
  });

  it('names "position" for a semicolon variation CSV', () => {
    const err = thrown('variation', 'csv', 'position;variant\n42;K\n', {
      source: './variants.csv',
    });
    expect(err.message).toMatch(
      /^\.\/variants\.csv \(parsed as CSV\): missing required header column "position"\. Header must contain position, variant\. The header looks semicolon-separated/
    );
    expect(err.suspectedDelimiter).toBe(';');
    expect(err.required).toEqual(VARIATION_COLUMNS);
  });

  it('names a comma line-graph file read as TSV', () => {
    const err = thrown('point', 'tsv', 'position,value\n1,5\n', {
      source: './depth.tsv',
    });
    expect(err.message).toContain('The header looks comma-separated');
    expect(err.message).toContain('`format: csv`');
  });
});

describe('no hint when nothing points to a delimiter mismatch', () => {
  // Exact equality, not `toThrow(string)` or an unanchored regex: those are
  // substring matches and would still pass with a hint appended.
  const GUARDS: Array<{
    what: string;
    shape: ShapeName;
    format: DataFormat;
    body: string;
    message: string;
  }> = [
    {
      what: 'a genuinely missing column under the right delimiter',
      shape: 'feature',
      format: 'csv',
      body: 'type,start,description\nDOMAIN,1,kinase\n',
      message:
        './hits.csv (parsed as CSV): missing required header column "end". ' +
        FEATURE_HEADER,
    },
    {
      what: 'a one-cell header no other delimiter splits',
      shape: 'feature',
      format: 'csv',
      body: 'type\nDOMAIN\n',
      message:
        './hits.csv (parsed as CSV): missing required header column "start". ' +
        FEATURE_HEADER,
    },
    {
      what: 'a semicolon inside one of several comma cells',
      shape: 'feature',
      format: 'csv',
      body: 'type,start,end,desc;notes\nDOMAIN,1,9,x\n',
      message:
        './hits.csv (parsed as CSV): missing required header column ' +
        `"description". ${FEATURE_HEADER}`,
    },
    {
      what: 'a semicolon header with a comma in it (an accepted miss)',
      shape: 'feature',
      format: 'csv',
      body: 'type;start;end;description,notes\n',
      message:
        './hits.csv (parsed as CSV): missing required header column "type". ' +
        FEATURE_HEADER,
    },
    {
      what: 'a leading blank line before the header',
      shape: 'feature',
      format: 'csv',
      body: '\ntype,start,end,description\nDOMAIN,1,9,x\n',
      message:
        './hits.csv (parsed as CSV): missing required header column "type". ' +
        FEATURE_HEADER,
    },
    {
      what: 'a genuinely missing variation column under the right delimiter',
      shape: 'variation',
      format: 'csv',
      body: 'position,foo\n42,K\n',
      message:
        './hits.csv (parsed as CSV): missing required header column ' +
        '"variant". Header must contain position, variant.',
    },
    {
      what: 'a trailing tab on a TSV line-graph header',
      shape: 'point',
      format: 'tsv',
      body: 'position\t\n1\t\n',
      message:
        './hits.tsv (parsed as TSV): missing required header column "value". ' +
        'Header must contain position, value.',
    },
  ];

  it.each(GUARDS)('$what', ({ shape, format, body, message }) => {
    const err = thrown(shape, format, body, { source: `./hits.${format}` });
    expect(err).toBeInstanceOf(MissingHeaderColumnError);
    expect(err.message).toBe(message);
    expect(err.suspectedDelimiter).toBeUndefined();
  });

  it('leaves a data-row error alone when the header is fine', () => {
    const err = thrown(
      'feature',
      'csv',
      'type,start,end,description\nDOMAIN;1;9;kinase\n',
      { source: './hits.csv' }
    );
    expect(err).not.toBeInstanceOf(MissingHeaderColumnError);
    expect(err.message).toBe(
      './hits.csv (parsed as CSV): row 2 is ragged — expected 4 columns, got 1.'
    );
  });

  it('leaves the other header and row errors as plain errors', () => {
    const duplicate = thrown('feature', 'csv', 'type,type\n');
    expect(duplicate).not.toBeInstanceOf(MissingHeaderColumnError);
    expect(duplicate.message).toBe(
      'inline data (parsed as CSV): duplicate header column "type". ' +
        'Each column name must be unique.'
    );

    const fractional = thrown(
      'feature',
      'csv',
      'type,start,end,description\nDOMAIN,18.5,20,x\n'
    );
    expect(fractional).not.toBeInstanceOf(MissingHeaderColumnError);
    expect(fractional.message).not.toContain('separated');
  });
});

describe('a hinted failure leaves the sinks empty', () => {
  it('collects no coordinates and no warnings', () => {
    const coordinates: CoordinateRow[] = [];
    const warnings: DecodeWarning[] = [];
    expect(() =>
      runPipeline('feature', 'csv', featureBody(';') + 'X;1;2;y;extra\n', {
        source: './hits.csv',
        coordinates,
        warnings,
      })
    ).toThrow(/semicolon-separated/);
    expect(coordinates).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('suspectDelimiter', () => {
  it('honours quoting, as in an Excel export', () => {
    expect(
      suspectDelimiter(
        '"type";"start";"end";"description"\n"DOMAIN";1;9;"kinase"\n',
        ',',
        REQUIRED_COLUMNS
      )
    ).toBe(';');
    // A quoted comma makes the declared parse two cells, so rule (b) cannot
    // fire: only a quote-aware re-tokenise finds every required column.
    expect(
      suspectDelimiter(
        '"type";"start";"end";"description";"a,b"\n',
        ',',
        REQUIRED_COLUMNS
      )
    ).toBe(';');
  });

  it('trims candidate cells, as the header check does', () => {
    // The declared parse gives two cells (split on the comma in "a,b"), so
    // rule (b) cannot fire; only trimmed `;` cells match the required names.
    expect(
      suspectDelimiter(
        'type; start; end; description; a,b\n',
        ',',
        REQUIRED_COLUMNS
      )
    ).toBe(';');
  });

  it('sees through a BOM and capitalised names (rule b)', () => {
    expect(
      suspectDelimiter(
        '\uFEFFType;Start;End;Description\nDOMAIN;1;9;x\n',
        ',',
        REQUIRED_COLUMNS
      )
    ).toBe(';');
  });

  it('prefers a candidate with every required column over one with more cells', () => {
    // Under `;` the header splits into six cells but lacks the required
    // names; under a tab it splits into five that include all of them.
    expect(
      suspectDelimiter(
        'a;b;c;d;e;f\ttype\tstart\tend\tdescription\n',
        ',',
        REQUIRED_COLUMNS
      )
    ).toBe('\t');
  });

  it('prefers a complete candidate even when it comes later in order', () => {
    // Comma comes first and gives six cells, none of them required.
    expect(
      suspectDelimiter(
        'a,b,c,d,e,f;type;start;end;description\n',
        '\t',
        REQUIRED_COLUMNS
      )
    ).toBe(';');
    // Tab comes first and splits the one-cell header (rule b), but only
    // `;` gives every required column (rule a).
    expect(
      suspectDelimiter(
        'a\tb;type;start;end;description\n',
        ',',
        REQUIRED_COLUMNS
      )
    ).toBe(';');
  });

  it('then prefers more cells, then candidate order', () => {
    expect(suspectDelimiter('a;b;c\td\n', ',', REQUIRED_COLUMNS)).toBe(';');
    expect(suspectDelimiter('a;b\tc\n', ',', REQUIRED_COLUMNS)).toBe('\t');
  });

  it('never suggests the delimiter already in use', () => {
    expect(
      suspectDelimiter('type;start;end;description\n', ';', REQUIRED_COLUMNS)
    ).toBeUndefined();
  });

  it('suspects nothing when no candidate qualifies', () => {
    expect(
      suspectDelimiter('type,start,description\n', ',', REQUIRED_COLUMNS)
    ).toBeUndefined();
    expect(suspectDelimiter('type\n', ',', REQUIRED_COLUMNS)).toBeUndefined();
    expect(suspectDelimiter('', ',', REQUIRED_COLUMNS)).toBeUndefined();
  });
});
