/**
 * Editing the config to point a track at a loaded file: YAML is spliced
 * (comments survive) and every splice is verified by re-parsing; JSON is
 * re-serialised; anything the splice can't verify becomes a snippet.
 */
import { describe, it, expect } from 'vitest';
import { parseConfigText } from '../../schema/parse.js';
import { computeDiagnostics } from '../lint.js';
import { PRESETS, getPreset } from '../presets.js';
import {
  appendTrack,
  attachToTrack,
  listTargetTracks,
  rowIdFor,
  rowLabelFor,
  type NewRow,
} from '../config-edit.js';

const ROW: NewRow = {
  id: 'hits',
  label: 'hits.csv',
  kind: 'features',
  data: './hits.csv',
};

const parse = (text: string) => parseConfigText(text);
const comments = (text: string) =>
  text.split('\n').filter((line) => line.trimStart().startsWith('#'));

describe('appendTrack', () => {
  it.each(PRESETS.map((p) => [p.id, p.config]))(
    'adds a verified track to the %s preset, keeping its comments and diagnostics',
    async (_, config) => {
      const parsed = (await parse(config)) as { rows: unknown[] };
      const row = { ...ROW, id: rowIdFor('hits.csv', parsed) };
      const result = await appendTrack(config, parsed, row);
      if (!('text' in result)) throw new Error(result.error);

      const reparsed = (await parse(result.text)) as { rows: unknown[] };
      expect(reparsed.rows).toEqual([...parsed.rows, row]);
      expect(comments(result.text)).toEqual(comments(config));
      // The edit adds no problem the preset did not already have.
      const strip = (ds: { code?: string; message: string }[]) =>
        ds.map((d) => [d.code, d.message]);
      expect(strip(await computeDiagnostics(result.text, 'P05067'))).toEqual(
        strip(await computeDiagnostics(config, 'P05067'))
      );
    }
  );

  it('writes a descriptor with format: for an extension that says nothing', async () => {
    const text = 'rows:\n  - id: a\n    data: ./a.csv\n';
    const result = await appendTrack(text, await parse(text), {
      ...ROW,
      data: { url: './hits.txt', format: 'csv' },
    });
    expect('text' in result && result.text).toContain(
      '    data: { url: ./hits.txt, format: csv }'
    );
  });

  it('matches a sequence written at its key’s own indentation', async () => {
    const text =
      'rows:\n- id: a\n  data: ./a.csv\n# trailing\nversion: "1.0"\n';
    const result = await appendTrack(text, await parse(text), ROW);
    if (!('text' in result)) throw new Error(result.error);
    expect(result.text).toBe(
      'rows:\n- id: a\n  data: ./a.csv\n- id: hits\n  label: hits.csv\n' +
        '  kind: features\n  data: ./hits.csv\n# trailing\nversion: "1.0"\n'
    );
  });

  it('starts a rows: list when there is none', async () => {
    const text = 'accession: P05067';
    const result = await appendTrack(text, await parse(text), ROW);
    if (!('text' in result)) throw new Error(result.error);
    expect(await parse(result.text)).toEqual({
      accession: 'P05067',
      rows: [ROW],
    });
    const blank = await appendTrack('', undefined, ROW);
    expect('text' in blank && (await parse(blank.text))).toEqual({
      rows: [ROW],
    });
  });

  it('quotes a label YAML would not read back as written', async () => {
    const text = 'rows: []\n';
    const json = '{ "rows": [] }';
    const row = { ...ROW, label: 'My Hits (v2): true' };
    const result = await appendTrack(text, await parse(text), row);
    // Flow-style rows: cannot be spliced.
    expect(result).toEqual({
      error: expect.stringContaining('by hand') as unknown,
      snippet: expect.stringContaining(
        'label: "My Hits (v2): true"'
      ) as unknown,
    });
    const fromJson = await appendTrack(json, await parse(json), row);
    if (!('text' in fromJson)) throw new Error(fromJson.error);
    expect(JSON.parse(fromJson.text)).toEqual({ rows: [row] });
  });

  it('round-trips a JSON config', async () => {
    const text =
      JSON.stringify(
        { accession: 'P05067', rows: [{ id: 'a', data: './a.csv' }] },
        null,
        2
      ) + '\n';
    const result = await appendTrack(text, await parse(text), ROW);
    if (!('text' in result)) throw new Error(result.error);
    expect(result.text.endsWith('\n')).toBe(true);
    expect(JSON.parse(result.text).rows).toEqual([
      { id: 'a', data: './a.csv' },
      ROW,
    ]);
  });

  it('returns a snippet, not a config of only the new row, for JSON that does not parse', async () => {
    const text =
      '{"accession":"P05067","rows":[{"id":"a","kind":"features","data":"./a.csv",}]}';
    await expect(parse(text)).rejects.toThrow();
    const result = await appendTrack(text, undefined, ROW);
    expect(result).toEqual({
      error: expect.stringContaining("doesn't parse") as unknown,
      snippet: JSON.stringify(ROW, null, 2),
    });
  });

  it('refuses a config that is not a mapping, or whose rows is not a list', async () => {
    expect(await appendTrack('- a', ['a'], ROW)).toMatchObject({
      error: expect.any(String),
    });
    expect(await appendTrack('rows: 3', { rows: 3 }, ROW)).toMatchObject({
      snippet: expect.stringContaining('- id: hits') as unknown,
    });
  });

  it('suffixes a duplicate id', async () => {
    const parsed = { rows: [{ id: 'hits' }, { id: 'hits-2' }] };
    expect(rowIdFor('hits.csv', parsed)).toBe('hits-3');
    expect(rowIdFor('my.hits.csv', parsed)).toBe('my-hits');
    expect(rowIdFor('hits.csv', undefined)).toBe('hits');
  });

  it('keeps the file name as the label unless Markdoc would read it', () => {
    expect(rowLabelFor('My Hits (v2).csv')).toBe('My Hits (v2).csv');
    expect(rowLabelFor('hits_v2.csv')).toBe('hits_v2.csv');
    expect(rowLabelFor('*hits*.csv')).toBe('-hits-.csv');
  });
});

describe('attachToTrack', () => {
  it("replaces the csv preset's data path and nothing else", async () => {
    const config = getPreset('csv')!.config;
    const parsed = await parse(config);
    const [target] = listTargetTracks(parsed);
    expect(target).toMatchObject({ path: 'hotspots', rowIndex: 0 });
    const result = await attachToTrack(config, parsed, target, './hits.csv');
    if (!('text' in result)) throw new Error(result.error);
    expect(result.text).toBe(
      config.replace(
        'data: /protvista/sample-data/hotspots.csv',
        'data: ./hits.csv'
      )
    );
  });

  it("replaces the inline-data preset's block-mapping data", async () => {
    const config = getPreset('inline-data')!.config;
    const parsed = await parse(config);
    const target = listTargetTracks(parsed).find(
      (t) => t.path === 'MY_ANNOTATIONS/binding_sites'
    )!;
    const result = await attachToTrack(config, parsed, target, {
      url: './sites.txt',
      format: 'tsv',
    });
    if (!('text' in result)) throw new Error(result.error);
    const reparsed = (await parse(result.text)) as {
      rows: { tracks: { data: unknown; description: string }[] }[];
    };
    expect(reparsed.rows[0].tracks[0].data).toEqual({
      url: './sites.txt',
      format: 'tsv',
    });
    expect(reparsed.rows[0].tracks[0].description).toBe(
      'Binding sites predicted by my pipeline'
    );
    expect(comments(result.text)).toEqual(comments(config));
    expect(result.text).not.toContain('inlineData');
  });

  it('skips a data: key that belongs to another track', async () => {
    const text = [
      'rows:',
      '  - id: g',
      '    tracks:',
      '      - id: a',
      '        data: ./a.csv',
      '      - data: ./b.csv',
      '        id: b',
    ].join('\n');
    const parsed = await parse(text);
    const target = listTargetTracks(parsed).find((t) => t.path === 'g/b')!;
    const result = await attachToTrack(text, parsed, target, './hits.csv');
    if (!('text' in result)) throw new Error(result.error);
    expect(result.text).toContain('      - data: ./hits.csv\n        id: b');
    expect(result.text).toContain('        data: ./a.csv');
  });

  it('re-serialises a JSON config', async () => {
    const text = JSON.stringify({ rows: [{ id: 'a', data: './a.csv' }] });
    const parsed = await parse(text);
    const result = await attachToTrack(
      text,
      parsed,
      { path: 'a', rowIndex: 0 },
      './hits.csv'
    );
    if (!('text' in result)) throw new Error(result.error);
    expect(JSON.parse(result.text)).toEqual({
      rows: [{ id: 'a', data: './hits.csv' }],
    });
  });

  it('returns a snippet when no splice verifies', async () => {
    const text = 'rows: [{ id: a, data: ./a.csv }]\n';
    const parsed = await parse(text);
    const result = await attachToTrack(
      text,
      parsed,
      { path: 'a', rowIndex: 0 },
      './hits.csv'
    );
    expect(result).toEqual({
      error: expect.stringContaining('by hand') as unknown,
      snippet: 'data: ./hits.csv',
    });
  });

  it('reports a track that is not in the config', async () => {
    const result = await attachToTrack(
      'rows: []',
      { rows: [] },
      { path: 'g/x', rowIndex: 0, trackIndex: 0 },
      './hits.csv'
    );
    expect(result).toMatchObject({ error: 'Track g/x is not in the config.' });
  });
});

describe('listTargetTracks', () => {
  it('offers kindless and shape-backed tracks, with the local path they name', async () => {
    const parsed = {
      sources: { f: 'https://example.org/{accession}' },
      rows: [
        { id: 'solo', data: './solo.csv' },
        {
          id: 'G',
          tracks: [
            {
              id: 'mine',
              label: 'Mine',
              kind: 'features',
              data: './data/hits.csv',
            },
            { id: 'provider', kind: 'alphafold-confidence', data: 'f' },
            {
              id: 'depth',
              kind: 'linegraph',
              data: { from: 'inline', inlineData: [] },
            },
            'junk',
          ],
        },
        { id: 'override-only' },
      ],
    };
    expect(listTargetTracks(parsed)).toEqual([
      { path: 'solo', label: 'solo', rowIndex: 0, ref: './solo.csv' },
      {
        path: 'G/mine',
        label: 'G/mine (Mine)',
        rowIndex: 1,
        trackIndex: 0,
        ref: './data/hits.csv',
      },
      { path: 'G/depth', label: 'G/depth', rowIndex: 1, trackIndex: 2 },
    ]);
    expect(listTargetTracks('x')).toEqual([]);
  });
});
