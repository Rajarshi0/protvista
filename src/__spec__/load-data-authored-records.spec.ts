/**
 * The author-supplied record contract, across all three transports.
 *
 * A track's records are the same records whether they arrive over the network,
 * inline in the config, or through `setTrackData()`. Before this was true,
 * `from: inline` ran the record adapter only for the `linegraph` family and
 * `from: custom` never ran it at all, so a consumer following the published
 * `{ position, value }` contract got a `TypeError` out of the component — and
 * because the assignment walk was un-guarded, every track iterated after it
 * lost its data too.
 *
 * Pins, in order: the wrapping/non-wrapping split the rule is derived from,
 * the three transports agreeing, the pass-through for payloads already in the
 * renderer's representation, the blast-radius containment, and authored
 * point/variation coordinates held to whole numbers, with feature arrays
 * bypassing the validator. Then (#283) feature records from a file and the
 * same records inline coming out identical, and the decoder's warnings
 * returned on `trackWarnings` rather than logged.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { loadProtvistaData } from '../load-data.js';
import { createRegistry } from '../schema/registry.js';
import { normalizeConfig } from '../schema/normalize.js';
import { SHAPES, SHAPE_NAMES } from '../schema/shapes.js';
import type { DataFormat, ProtvistaViewerConfig } from '../schema/types.js';
import '../protvista-uniprot.js';

const registry = () => createRegistry();
const noFetch = async () => null;

const load = (config: ProtvistaViewerConfig) => {
  const r = registry();
  return loadProtvistaData(
    'P05067',
    normalizeConfig(config, { registry: r }),
    noFetch,
    (name) => r.getAdapter(name),
    {}
  );
};

const inlineConfig = (
  kind: string,
  inlineData: unknown
): ProtvistaViewerConfig => ({
  accession: 'P05067',
  rows: [
    {
      id: 'G',
      tracks: [{ id: 't', kind, data: { from: 'inline', inlineData } }],
    },
  ],
});

const customConfig = (kind: string): ProtvistaViewerConfig => ({
  accession: 'P05067',
  rows: [{ id: 'G', tracks: [{ id: 't', kind, data: { from: 'custom' } }] }],
});

const loadCustom = (kind: string, payload: unknown) => {
  const r = registry();
  return loadProtvistaData(
    'P05067',
    normalizeConfig(customConfig(kind), { registry: r }),
    noFetch,
    (name) => r.getAdapter(name),
    { 'G-t': payload }
  );
};

describe('a shape knows whether its records need wrapping', () => {
  // The rule the inline / setTrackData path turns on. `point` records are
  // wrapped into a series and `variation` into `{ variants }`, but a
  // `feature` array *is* what the track canvas renders — running records
  // through a validator there would only strip fields a `dataTooltip` may
  // reference.
  it('only the wrapping shapes are marked as wrapping', () => {
    expect(SHAPE_NAMES.filter((n) => SHAPES[n].wraps).sort()).toEqual([
      'point',
      'variation',
    ]);
  });
});

describe('inline and custom run the kind’s record adapter', () => {
  const series = (payload: unknown) =>
    (payload as Array<{ values: unknown[] }>)[0];

  it.each([
    ['variant-counts'],
    ['rna-editing-counts'],
    ['linegraph'],
  ])('%s: inline point records become a drawn series', async (kind) => {
    const { data } = await load(inlineConfig(kind, [{ position: 1, value: 412 }]));
    expect(series(data['G-t']).values).toEqual([{ position: 1, value: 412 }]);
    expect(series(data['G-t'])).toHaveProperty('range');
  });

  it.each([['variants'], ['rna-editing']])(
    '%s: inline variation records become a variants payload',
    async (kind) => {
      const { data } = await load(
        inlineConfig(kind, [{ position: 42, variant: 'K', wildType: 'E' }])
      );
      const payload = data['G-t'] as { variants: Array<{ start: number }> };
      expect(payload.variants).toHaveLength(1);
      expect(payload.variants[0].start).toBe(42);
    }
  );

  it('custom point records become a drawn series too', async () => {
    // The exact call the published contract invites:
    //   setTrackData('G-t', [{ position: 1, value: 412 }])
    const { data } = await loadCustom('linegraph', [
      { position: 1, value: 412 },
    ]);
    expect(series(data['G-t']).values).toEqual([{ position: 1, value: 412 }]);
  });

  it('custom variation records become a variants payload', async () => {
    const { data } = await loadCustom('variants', [
      { position: 7, variant: '*' },
    ]);
    expect((data['G-t'] as { variants: unknown[] }).variants).toHaveLength(1);
  });

  it('reports hasData for an inline record payload', async () => {
    // The empty-state gate must see through the wrapper, or a viewer built
    // solely from inline records parses correctly and still blanks out.
    const { hasData } = await load(
      inlineConfig('variants', [{ position: 1, variant: 'K' }])
    );
    expect(hasData).toBe(true);
  });

  it('surfaces a malformed inline record as a named error, not a blank track', async () => {
    // The loader records the failure rather than logging it: every failure in
    // the viewer is routed in one place (`src/errors/router.ts`), and the
    // component turns this record into the badge, the event and the console
    // line. The message itself is what matters here, and it is unchanged.
    const { data, trackFailures } = await load(
      inlineConfig('linegraph', [{ position: 1, value: '412' }])
    );
    expect(data['G-t']).toBeUndefined();
    expect(trackFailures['G-t'].severity).toBe('error');
    expect(trackFailures['G-t'].message).toMatch(
      /row 0: .*'value' is a string, not a number/
    );
  });
});

describe('payloads that need no adapting are left alone', () => {
  it('passes through data already in the renderer’s representation', async () => {
    // `setTrackData()`'s originally documented contract: inject exactly what
    // the component renders. Still honoured — the two shapes are disjoint.
    const rendered = [
      { name: 'value', color: '#3d4451', range: [0, 5], values: [{ position: 1, value: 5 }] },
    ];
    const { data } = await loadCustom('linegraph', rendered);
    // `toMatchObject`, not `toEqual`: the tooltip resolver annotates every
    // payload it can, pass-through included. What matters is that the series
    // was not re-wrapped or re-validated as records.
    expect(data['G-t']).toMatchObject([
      { name: 'value', range: [0, 5], values: [{ position: 1, value: 5 }] },
    ]);
  });

  it('passes through a rendered variation payload', async () => {
    const rendered = { sequence: 'MMM', variants: [{ start: 1, variant: 'K' }] };
    const { data } = await loadCustom('variants', rendered);
    expect(data['G-t']).toMatchObject({ sequence: 'MMM' });
  });

  it('does not run features-json over inline feature records', async () => {
    // Feature records are already the renderer's representation, so routing
    // them through the adapter would only strip fields — including any a
    // `dataTooltip` path references. `notes` must survive.
    const { data } = await load(
      inlineConfig('features', [
        { type: 'DOMAIN', start: 1, end: 9, notes: 'keep me' },
      ])
    );
    expect((data['G-t'] as Array<{ notes?: string }>)[0].notes).toBe('keep me');
  });

  it('leaves a provider-only kind’s custom payload untouched', async () => {
    const payload = [{ anything: true }];
    const { data } = await loadCustom('alphafold-confidence', payload);
    expect(data['G-t']).toMatchObject([{ anything: true }]);
  });
});

describe('inline text is read the way its format says', () => {
  // Inline text is the case `format:` exists for — there is no extension to
  // read an encoding off and no content sniffing. Ignoring it here made the
  // remedy the validator recommends a no-op: a wrapping shape failed with
  // "expected an array of records; got string", and a non-wrapping shape
  // handed the raw CSV *string* to the component with no error at all.
  const inlineText = (
    kind: string,
    inlineData: string,
    format: DataFormat
  ): ProtvistaViewerConfig => ({
    accession: 'P05067',
    rows: [
      {
        id: 'G',
        tracks: [
          { id: 't', kind, data: { from: 'inline', inlineData, format } },
        ],
      },
    ],
  });

  it('decodes inline CSV into the series a wrapping kind draws', async () => {
    const { data, hasData } = await load(
      inlineText('linegraph', 'position,value\n1,5\n2,7\n', 'csv')
    );
    const series = (data['G-t'] as Array<{ values: unknown[] }>)[0];
    expect(series.values).toEqual([
      { position: 1, value: 5 },
      { position: 2, value: 7 },
    ]);
    expect(hasData).toBe(true);
  });

  it('decodes inline CSV into records for a non-wrapping kind', async () => {
    const { data } = await load(
      inlineText(
        'features',
        'type,start,end,description\nDOMAIN,1,9,kinase\n',
        'csv'
      )
    );
    expect(data['G-t']).toMatchObject([
      { type: 'DOMAIN', start: 1, end: 9, description: 'kinase' },
    ]);
  });

  it('decodes inline TSV and inline BED the same way', async () => {
    const { data: tsv } = await load(
      inlineText('variants', 'position\tvariant\n42\tK\n', 'tsv')
    );
    expect((tsv['G-t'] as { variants: unknown[] }).variants).toHaveLength(1);

    const { data: bed } = await load(
      inlineText('features', 'chr1\t100\t200\tregion\n', 'bed')
    );
    expect(bed['G-t']).toMatchObject([{ start: 101, end: 200 }]);
  });

  it('names the inline body and its reading in a parse error', async () => {
    const { data, trackFailures } = await load(
      inlineText('linegraph', 'position,value\n1,abc\n', 'csv')
    );
    expect(data['G-t']).toBeUndefined();
    expect(trackFailures['G-t'].message).toMatch(/inline data \(parsed as CSV\)/);
  });

  it('reads a structured payload as records even under a text format', async () => {
    // `setTrackData()` with the published record contract keeps working on a
    // descriptor that also declares a text format — the payload is already
    // decoded, so there is nothing to parse.
    const r = registry();
    const { data } = await loadProtvistaData(
      'P05067',
      normalizeConfig(
        {
          accession: 'P05067',
          rows: [
            {
              id: 'G',
              tracks: [
                {
                  id: 't',
                  kind: 'linegraph',
                  data: { from: 'custom', format: 'csv' },
                },
              ],
            },
          ],
        },
        { registry: r }
      ),
      noFetch,
      (name) => r.getAdapter(name),
      { 'G-t': [{ position: 1, value: 412 }] }
    );
    expect(
      (data['G-t'] as Array<{ values: unknown[] }>)[0].values
    ).toEqual([{ position: 1, value: 412 }]);
  });
});

describe('a track that cannot render its data does not take the others down', () => {
  afterEach(() => vi.restoreAllMocks());

  it('contains a throwing data setter to the one track', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = document.createElement('protvista-uniprot') as never as {
      _assignComponentData: (e: unknown, p: unknown, k: string) => void;
    };
    const exploding = {
      set data(_v: unknown) {
        throw new TypeError('undefined is not iterable');
      },
    };
    const received: unknown[] = [];
    const healthy = {
      set data(v: unknown) {
        received.push(v);
      },
    };

    el._assignComponentData(exploding, [{ position: 1 }], 'G-bad');
    el._assignComponentData(healthy, [{ position: 2 }], 'G-good');

    // The healthy track still got its data — the walk was not aborted.
    expect(received).toEqual([[{ position: 2 }]]);
    expect(error.mock.calls.flat().join(' ')).toContain("track 'G-bad'");
  });
});

describe('authored coordinates must be whole numbers', () => {
  afterEach(() => vi.restoreAllMocks());

  const NOT_WHOLE =
    /inline data \(parsed as JSON\): row 0: .*'position' is not a whole number/;

  it('rejects a fractional position in inline point records', async () => {
    const { data, trackFailures } = await load(
      inlineConfig('linegraph', [{ position: 1.5, value: 2 }])
    );
    expect(data['G-t']).toBeUndefined();
    expect(trackFailures['G-t'].message).toMatch(NOT_WHOLE);
  });

  it('rejects a fractional position in inline variation records', async () => {
    const { data, trackFailures } = await load(
      inlineConfig('variants', [{ position: 4.5, variant: 'K' }])
    );
    expect(data['G-t']).toBeUndefined();
    expect(trackFailures['G-t'].message).toMatch(NOT_WHOLE);
  });

  it('rejects a fractional position in setTrackData() point records', async () => {
    const { data, trackFailures } = await loadCustom('linegraph', [
      { position: 1.5, value: 2 },
    ]);
    expect(data['G-t']).toBeUndefined();
    expect(trackFailures['G-t'].message).toMatch(NOT_WHOLE);
  });

  it('rejects a fractional position in setTrackData() variation records', async () => {
    const { data, trackFailures } = await loadCustom('variants', [
      { position: 4.5, variant: 'K' },
    ]);
    expect(data['G-t']).toBeUndefined();
    expect(trackFailures['G-t'].message).toMatch(NOT_WHOLE);
  });

  it('leaves inline feature arrays unchecked (they bypass the validator)', async () => {
    const { data } = await load(
      inlineConfig('features', [{ type: 'DOMAIN', start: 5, end: 4 }])
    );
    // `toMatchObject`, not `toEqual`: the tooltip resolver annotates the
    // payload. This pins the bypass `adaptAuthoredRecords` leaves in place.
    expect(data['G-t']).toMatchObject([{ type: 'DOMAIN', start: 5, end: 4 }]);
  });
});

describe('file and inline feature records are interchangeable (#283)', () => {
  // The same two features, written five ways. Every extra value is a
  // non-empty string in every form (CSV cells are strings, so the YAML/JSON
  // forms quote theirs), and the row with no colour omits the key in
  // YAML/JSON and leaves the cell blank in CSV/TSV — so the comparison is
  // about pass-through, not transport typing.
  const PMID_URL = 'https://pubmed.ncbi.nlm.nih.gov';
  const RECORDS = [
    {
      type: 'DOMAIN',
      start: 1,
      end: 9,
      description: 'Kinase',
      color: '#1f77b4',
      pmid: '12345',
      url: `${PMID_URL}/12345/`,
    },
    {
      type: 'SITE',
      start: 4,
      end: 4,
      description: 'Active',
      pmid: '67890',
      url: `${PMID_URL}/67890/`,
    },
  ];
  const HEADER = ['type', 'start', 'end', 'description', 'color', 'pmid', 'url'];
  const delimited = (sep: string) =>
    [
      HEADER,
      ['DOMAIN', '1', '9', 'Kinase', '#1f77b4', '12345', `${PMID_URL}/12345/`],
      ['SITE', '4', '4', 'Active', '', '67890', `${PMID_URL}/67890/`],
    ]
      .map((cells) => cells.join(sep))
      .join('\n');
  const FILES: Record<string, unknown> = {
    './hits.csv': delimited(','),
    './hits.tsv': delimited('\t'),
    './hits.json': RECORDS,
  };
  const TEMPLATE =
    'PMID {% $pmid %}: {% link href=$url %}PubMed{% /link %}';

  const loadTrack = (data: unknown) => {
    const r = registry();
    return loadProtvistaData(
      'P05067',
      normalizeConfig(
        {
          accession: 'P05067',
          rows: [
            {
              id: 'G',
              tracks: [
                {
                  id: 't',
                  kind: 'features',
                  rendering: { color: 'red' },
                  dataTooltip: { kind: 'markdown', template: TEMPLATE },
                  data,
                } as never,
              ],
            },
          ],
        },
        { registry: r }
      ),
      async (url) => FILES[url] ?? null,
      (name) => r.getAdapter(name),
      {}
    );
  };

  it('every form yields the same payload, tooltips included', async () => {
    const forms = await Promise.all([
      loadTrack('./hits.csv'),
      loadTrack('./hits.tsv'),
      loadTrack('./hits.json'),
      loadTrack({ from: 'inline', inlineData: RECORDS }),
      loadTrack({ from: 'inline', inlineData: delimited(','), format: 'csv' }),
    ]);
    const [csv, ...others] = forms;
    const payload = csv.data['G-t'] as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ color: '#1f77b4', pmid: '12345' });
    expect(payload[1]).not.toHaveProperty('color');
    expect(payload[0].tooltipContent).toBe(
      `<p>PMID 12345: <a href="${PMID_URL}/12345/">PubMed</a></p>`
    );
    for (const form of others) expect(form.data['G-t']).toStrictEqual(payload);
    for (const form of forms) {
      expect(form.trackWarnings).toEqual({});
      expect(form.trackFailures).toEqual({});
    }
  });

  it('a blank extra CSV cell becomes an empty string; YAML may omit the key', async () => {
    const body = 'type,start,end,description,pmid\nDOMAIN,1,9,x,\n';
    const { data } = await loadTrack({ from: 'inline', inlineData: body, format: 'csv' });
    expect((data['G-t'] as Array<Record<string, unknown>>)[0].pmid).toBe('');
    const yaml = await loadTrack({
      from: 'inline',
      inlineData: [{ type: 'DOMAIN', start: 1, end: 9, description: 'x' }],
    });
    expect((yaml.data['G-t'] as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'pmid'
    );
  });
});

describe('decoder warnings are returned, not logged (#283)', () => {
  const loadFile = (file: string, body: unknown) => {
    const r = registry();
    return loadProtvistaData(
      'P05067',
      normalizeConfig(
        {
          accession: 'P05067',
          rows: [
            { id: 'G', tracks: [{ id: 't', kind: 'features', data: file }] },
          ],
        },
        { registry: r }
      ),
      async () => body,
      (name) => r.getAdapter(name),
      {}
    );
  };

  const loadTracks = (
    tracks: Array<Record<string, unknown>>,
    files: Record<string, unknown>
  ) => {
    const r = registry();
    return loadProtvistaData(
      'P05067',
      normalizeConfig(
        { accession: 'P05067', rows: [{ id: 'G', tracks: tracks as never }] },
        { registry: r }
      ),
      async (url) => files[url] ?? null,
      (name) => r.getAdapter(name),
      {}
    );
  };

  afterEach(() => vi.restoreAllMocks());

  it('two tracks reading one file get a warning each, under their own keys', async () => {
    const { trackWarnings } = await loadTracks(
      [
        { id: 'a', kind: 'features', data: './hits.csv' },
        { id: 'b', kind: 'features', data: './hits.csv' },
      ],
      {
        './hits.csv':
          'type,start,end,description,tooltipContent\nDOMAIN,1,9,x,y\n',
      }
    );
    expect(Object.keys(trackWarnings).sort()).toEqual(['G-a', 'G-b']);
    for (const key of ['G-a', 'G-b']) {
      expect(trackWarnings[key].map((w) => w.code)).toEqual([
        'data-field-ignored',
      ]);
    }
  });

  it('counts every row, including those `filter:` then removes', async () => {
    const { data, trackWarnings } = await loadTracks(
      [{ id: 't', kind: 'features', filter: 'DOMAIN', data: './hits.csv' }],
      {
        './hits.csv': [
          'type,start,end,description,color',
          'DOMAIN,1,9,a,bleu',
          'DOMAIN,10,20,b,',
          'SITE,4,4,c,bleu',
        ].join('\n'),
      }
    );
    expect(trackWarnings['G-t'].map((w) => w.code)).toEqual([
      'unpaintable-color',
    ]);
    expect(trackWarnings['G-t'][0].message).toContain('2 row(s)');
    expect(data['G-t']).toHaveLength(2);
  });

  it('a Tag-shaped value in a JSON file renders as nothing in the tooltip', async () => {
    // A JSON file keeps object-valued fields; one shaped like a Markdoc Tag
    // must not become markup when a template references it.
    const body = JSON.stringify([
      {
        type: 'DOMAIN',
        start: 1,
        end: 9,
        note: {
          $$mdtype: 'Tag',
          name: 'img',
          attributes: { src: 'x', onerror: 'alert(1)' },
          children: [],
        },
      },
    ]);
    const { data } = await loadTracks(
      [
        {
          id: 't',
          kind: 'features',
          dataTooltip: { kind: 'markdown', template: 'Note: {% $note %}' },
          data: './hits.json',
        },
      ],
      { './hits.json': JSON.parse(body) }
    );
    const [record] = data['G-t'] as Array<{ tooltipContent: string }>;
    expect(record.tooltipContent).toBe('<p>Note: </p>');
    expect(record.tooltipContent).not.toContain('onerror');
  });

  it('a CSV file with a `tooltipContent` column returns one warning', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { data, trackWarnings, trackFailures } = await loadFile(
      './hits.csv',
      'type,start,end,description,tooltipContent\nDOMAIN,1,9,x,<b>hi</b>\n'
    );
    expect(trackWarnings).toEqual({
      'G-t': [
        {
          code: 'data-field-ignored',
          message: expect.stringMatching(
            /^\.\/hits\.csv \(parsed as CSV\): ignored column\(s\) "tooltipContent"/
          ),
        },
      ],
    });
    expect(trackFailures).toEqual({});
    // The resolver built the tooltip, not the file.
    const [record] = data['G-t'] as Array<{ tooltipContent: string }>;
    expect(record.tooltipContent).not.toContain('<b>hi</b>');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a JSON file reports an unpaintable colour', async () => {
    const { trackWarnings } = await loadFile('./hits.json', [
      { type: 'DOMAIN', start: 1, end: 9, color: 'bleu' },
    ]);
    expect(trackWarnings['G-t'].map((w) => w.code)).toEqual(['unpaintable-color']);
    expect(trackWarnings['G-t'][0].message).toMatch(/^\.\/hits\.json \(parsed as JSON\): /);
  });

  it('a JSON file reports a `shape` naming a JavaScript built-in, and drops it', async () => {
    const { data, trackWarnings } = await loadFile('./hits.json', [
      { type: 'DOMAIN', start: 1, end: 9, shape: 'valueOf' },
    ]);
    expect((data['G-t'] as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'shape'
    );
    expect(trackWarnings['G-t'].map((w) => w.code)).toEqual(['data-field-ignored']);
    expect(trackWarnings['G-t'][0].message).toMatch(
      /^\.\/hits\.json \(parsed as JSON\): ignored "shape" value\(s\)/
    );
  });

  it('inline CSV text names "inline data"', async () => {
    const { trackWarnings } = await load({
      accession: 'P05067',
      rows: [
        {
          id: 'G',
          tracks: [
            {
              id: 't',
              kind: 'features',
              data: {
                from: 'inline',
                format: 'csv',
                inlineData: 'type,start,end,description,locations\nDOMAIN,1,9,x,y\n',
              },
            },
          ],
        },
      ],
    });
    expect(trackWarnings['G-t'][0].message).toMatch(
      /^inline data \(parsed as CSV\): ignored column\(s\) "locations"/
    );
  });

  it('a setTrackData() text payload with a format warns like a file', async () => {
    const r = registry();
    const { trackWarnings } = await loadProtvistaData(
      'P05067',
      normalizeConfig(
        {
          accession: 'P05067',
          rows: [
            {
              id: 'G',
              tracks: [
                { id: 't', kind: 'features', data: { from: 'custom', format: 'csv' } },
              ],
            },
          ],
        },
        { registry: r }
      ),
      noFetch,
      (name) => r.getAdapter(name),
      { 'G-t': 'type,start,end,description,color\nDOMAIN,1,9,x,#catFace\n' }
    );
    expect(trackWarnings['G-t'].map((w) => w.code)).toEqual(['unpaintable-color']);
  });

  it('structured inline records keep the viewer fields, with no warning', async () => {
    const { data, trackWarnings } = await load(
      inlineConfig('features', [
        { type: 'DOMAIN', start: 1, end: 9, tooltipContent: 'trusted', color: 'bleu' },
      ])
    );
    expect(data['G-t']).toMatchObject([{ tooltipContent: 'trusted' }]);
    expect(trackWarnings).toEqual({});
  });

  it('a file that throws has a failure and no warnings', async () => {
    const { trackWarnings, trackFailures } = await loadFile(
      './hits.csv',
      'type,start,end,description,tooltipContent,opacity\nDOMAIN,1,9,x,y,abc\n'
    );
    expect(trackFailures['G-t'].message).toMatch(
      /row 2, column "opacity": expected a number from 0 to 1, got "abc"/
    );
    expect(trackWarnings).toEqual({});
  });

  it('a BED file has no warnings entry', async () => {
    const { data, trackWarnings } = await loadFile('./hits.bed', 'chr1\t0\t9\tx\n');
    expect(data['G-t']).toHaveLength(1);
    expect(trackWarnings).toEqual({});
  });
});
