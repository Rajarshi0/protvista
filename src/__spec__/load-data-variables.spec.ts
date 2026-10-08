/**
 * `loadProtvistaData` — generic `{token}` substitution.
 *
 * The loader used to hard-code a single `{accession}` replacement. It now
 * walks every `{name}` in every URL template and resolves it against a
 * merged variables dictionary (config `variables:` < host `data-*` <
 * named `accession`; see `src/schema/variables.ts`). This pins:
 *
 *   • backwards compatibility — a bare accession string still works, and
 *     `{accession}` resolves end-to-end exactly as before;
 *   • multi-token URLs and the merge precedence as the loader sees it;
 *   • injection safety — substituted values reach the fetcher encoded;
 *   • an unresolved token skips the fetch (with one returned warning) instead of
 *     requesting a half-built URL, leaving sibling tracks untouched;
 *   • per-template dedup and the `trackUrls` record of substituted URLs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadProtvistaData } from '../load-data.js';
import { mergeVariables } from '../schema/variables.js';
import type {
  NormalizedConfig,
  NormalizedDataSource,
} from '../schema/normalize.js';

/** Return the raw payload's `features` array (or nothing). */
const features = (raw: unknown) =>
  ((raw as { features?: unknown[] } | null)?.features ?? []) as unknown[];
const resolveAdapter = (name: string) =>
  name === 'test-features' ? features : undefined;

/** One group, one track per descriptor. Track ids are `a`, `b`, `c`, … */
function configWith(
  sources: NormalizedDataSource[],
  extra: Partial<NormalizedConfig> = {}
): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    ...extra,
    rows: [
      {
        id: 'G',
        label: 'G',
        component: 'nightingale-track-canvas',
        rendering: {},
        tracks: sources.map((data, i) => ({
          id: String.fromCharCode(97 + i),
          label: `track ${i}`,
          kind: 'features',
          component: 'nightingale-track-canvas',
          rendering: {},
          data: [data],
        })),
      },
    ],
  };
}

const urlSource = (url: string | string[]): NormalizedDataSource => ({
  from: 'url',
  url,
  adapter: 'test-features' as NormalizedDataSource['adapter'],
});

/** Fetcher that answers every URL with one feature tagged by the URL. */
const echoFetch = () =>
  vi.fn(async (url: string) => ({
    features: [{ type: 'DOMAIN', start: 1, end: 2, description: url }],
  }));

describe('loadProtvistaData — template variables', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  describe('backwards compatibility', () => {
    it('still accepts a bare accession string', async () => {
      const fetchOne = echoFetch();
      const result = await loadProtvistaData(
        'P05067',
        configWith([urlSource('https://e.org/features/{accession}')]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith(
        'https://e.org/features/P05067',
        'json'
      );
      expect(result.trackUrls['G-a']).toEqual([
        'https://e.org/features/P05067',
      ]);
    });

    it('still collapses an invalid accession to an empty substitution', async () => {
      const fetchOne = echoFetch();
      await loadProtvistaData(
        'P05067/../admin',
        configWith([urlSource('https://e.org/features/{accession}')]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith('https://e.org/features/', 'json');
    });

    it('replaces every {accession} occurrence, not just the first', async () => {
      const fetchOne = echoFetch();
      await loadProtvistaData(
        'P05067',
        configWith([urlSource('https://e.org/{accession}/x/{accession}.json')]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith(
        'https://e.org/P05067/x/P05067.json',
        'json'
      );
    });

    it('keys rawData by the template, not the substituted URL', async () => {
      const template = 'https://e.org/features/{accession}';
      const result = await loadProtvistaData(
        'P05067',
        configWith([urlSource(template)]),
        echoFetch(),
        resolveAdapter
      );
      expect(Object.keys(result.rawData)).toEqual([template]);
    });
  });

  describe('variables dictionary', () => {
    it('substitutes every token in a multi-variable URL', async () => {
      const fetchOne = echoFetch();
      const result = await loadProtvistaData(
        { species: 'human', build: 'v2024.12', accession: 'P05067' },
        configWith([
          urlSource(
            'https://api.example.org/{species}/{build}/features/{accession}'
          ),
        ]),
        fetchOne,
        resolveAdapter
      );
      const expected = 'https://api.example.org/human/v2024.12/features/P05067';
      expect(fetchOne).toHaveBeenCalledWith(expected, 'json');
      expect(result.trackUrls['G-a']).toEqual([expected]);
      expect(result.data['G-a']).toHaveLength(1);
    });

    it('a data-* value overrides the config variables baseline', async () => {
      const fetchOne = echoFetch();
      await loadProtvistaData(
        mergeVariables({
          configVariables: { species: 'human', build: 'v2024.12' },
          dataset: { species: 'mouse' },
          accession: 'P05067',
        }),
        configWith([urlSource('https://e.org/{species}/{build}/{accession}')]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith(
        'https://e.org/mouse/v2024.12/P05067',
        'json'
      );
    });

    it('the named accession wins over data-accession', async () => {
      const fetchOne = echoFetch();
      await loadProtvistaData(
        mergeVariables({
          dataset: { accession: 'Q99999' },
          accession: 'P05067',
        }),
        configWith([urlSource('https://e.org/{accession}')]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith('https://e.org/P05067', 'json');
    });

    it('data-accession alone feeds {accession}', async () => {
      const fetchOne = echoFetch();
      await loadProtvistaData(
        mergeVariables({ dataset: { accession: 'Q99999' } }),
        configWith([urlSource('https://e.org/{accession}')]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith('https://e.org/Q99999', 'json');
    });

    it('substitutes tokens in every URL of a multi-URL descriptor', async () => {
      const fetchOne = echoFetch();
      const result = await loadProtvistaData(
        { species: 'human', accession: 'P05067' },
        configWith([
          urlSource([
            'https://e.org/{species}/a',
            'https://e.org/{accession}/b',
          ]),
        ]),
        fetchOne,
        resolveAdapter
      );
      expect(result.trackUrls['G-a']).toEqual([
        'https://e.org/human/a',
        'https://e.org/P05067/b',
      ]);
    });

    it('passes the merged accession to the tooltip context', async () => {
      // The tooltip resolver's `ctx.accession` comes from the same dict —
      // here supplied only through `data-accession`, so a loader that
      // wired the tooltip to anything else would render a different id.
      const config = configWith([urlSource('https://e.org/{accession}')]);
      config.rows[0].tracks[0].dataTooltip = {
        kind: 'markdown',
        template: 'acc {% $ctx.accession %}',
      };
      const result = await loadProtvistaData(
        mergeVariables({ dataset: { accession: 'Q11111' } }),
        config,
        echoFetch(),
        resolveAdapter
      );
      const [item] = result.data['G-a'] as Array<{ tooltipContent: string }>;
      expect(item.tooltipContent).toContain('acc Q11111');
      // `$ctx.accession` reads the context, which always has it.
      expect(result.tooltipFieldMisses).toEqual([]);
    });
  });

  describe('injection safety', () => {
    it('reaches the fetcher URL-encoded', async () => {
      const fetchOne = echoFetch();
      await loadProtvistaData(
        { species: 'human/../admin?x=1#frag', accession: 'P05067' },
        configWith([urlSource('https://e.org/{species}/features')]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith(
        'https://e.org/human%2F..%2Fadmin%3Fx%3D1%23frag/features',
        'json'
      );
    });
  });

  describe('invalid values', () => {
    it.each(['.', '..'])(
      'never fetches a URL whose value is %j, warns once, and leaves siblings loading',
      async (value) => {
        const fetchOne = echoFetch();
        const result = await loadProtvistaData(
          mergeVariables({ dataset: { dataset: value }, accession: 'P05067' }),
          configWith([
            urlSource('https://e.org/public/{dataset}/data'),
            urlSource('https://e.org/ok/{accession}'),
          ]),
          fetchOne,
          resolveAdapter
        );
        expect(fetchOne).toHaveBeenCalledTimes(1);
        expect(fetchOne).toHaveBeenCalledWith(
          'https://e.org/ok/P05067',
          'json'
        );

        const invalid = result.skipWarnings.filter((w) =>
          w.message.includes('invalid value')
        );
        expect(invalid).toHaveLength(1);
        expect(invalid[0].message).toContain(
          'https://e.org/public/{dataset}/data'
        );
        expect(invalid[0].message).toContain('G/a');
        expect(invalid[0].message).toContain('{dataset}');

        expect(result.trackUrls['G-a']).toBeUndefined();
        expect(result.data['G-a'] ?? []).toEqual([]);
        expect(result.data['G-b']).toHaveLength(1);
      }
    );

    it('a malformed-Unicode value skips only its own URL instead of rejecting the load', async () => {
      // `encodeURIComponent` throws URIError on a lone surrogate; before the
      // fix that escaped the per-track isolation and rejected everything.
      const fetchOne = echoFetch();
      const result = await loadProtvistaData(
        { species: 'ab\uD83D', accession: 'P05067' },
        configWith([
          urlSource('https://e.org/{species}/{accession}'),
          urlSource('https://e.org/ok/{accession}'),
        ]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledTimes(1);
      expect(fetchOne).toHaveBeenCalledWith('https://e.org/ok/P05067', 'json');
      expect(result.data['G-b']).toHaveLength(1);
      expect(
        result.skipWarnings.filter((w) => w.message.includes('invalid value'))
      ).toHaveLength(1);
    });
  });

  describe('unresolved tokens', () => {
    it('skips the fetch, warns once, and leaves sibling tracks loading', async () => {
      const fetchOne = echoFetch();
      const result = await loadProtvistaData(
        { accession: 'P05067' },
        configWith([
          urlSource('https://e.org/{species}/{build}/{accession}'),
          urlSource('https://e.org/ok/{accession}'),
        ]),
        fetchOne,
        resolveAdapter
      );

      // Only the resolvable URL is requested.
      expect(fetchOne).toHaveBeenCalledTimes(1);
      expect(fetchOne).toHaveBeenCalledWith('https://e.org/ok/P05067', 'json');

      // One warning naming the template, the track, and both tokens.
      const unresolved = result.skipWarnings.filter((w) =>
        w.message.includes('undefined variable')
      );
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].message).toContain(
        'https://e.org/{species}/{build}/{accession}'
      );
      expect(unresolved[0].message).toContain('G/a');
      expect(unresolved[0].message).toContain('{species}');
      expect(unresolved[0].message).toContain('{build}');

      // No substituted URL recorded for the skipped track, so the element
      // can't correlate a phantom fetch error against it.
      expect(result.trackUrls['G-a']).toBeUndefined();
      expect(result.trackUrls['G-b']).toEqual(['https://e.org/ok/P05067']);

      // The skipped track renders empty; its sibling has data.
      expect(result.data['G-a'] ?? []).toEqual([]);
      expect(result.data['G-b']).toHaveLength(1);
    });

    it('warns once per template even when several tracks share it', async () => {
      const fetchOne = echoFetch();
      const result = await loadProtvistaData(
        { accession: 'P05067' },
        configWith([
          urlSource('https://e.org/{species}'),
          urlSource('https://e.org/{species}'),
        ]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).not.toHaveBeenCalled();
      const unresolved = result.skipWarnings.filter((w) =>
        w.message.includes('undefined variable')
      );
      expect(unresolved).toHaveLength(1);
    });

    it('lists every track that references a skipped template', async () => {
      // The second track reaches the template after it was already skipped,
      // which is the early return that must still record it.
      const result = await loadProtvistaData(
        { accession: 'P05067' },
        configWith([
          urlSource('https://e.org/{species}'),
          urlSource('https://e.org/{species}'),
        ]),
        echoFetch(),
        resolveAdapter
      );
      expect(result.skipWarnings).toHaveLength(1);
      expect(result.skipWarnings[0].tracks).toEqual(['G-a', 'G-b']);
    });

    it('lists a partly skipped track, whose other URL is still fetched', async () => {
      const result = await loadProtvistaData(
        { accession: 'P05067' },
        configWith([
          urlSource(['https://e.org/{accession}', 'https://e.org/{species}']),
          urlSource('https://e.org/{species}'),
        ]),
        echoFetch(),
        resolveAdapter
      );
      expect(result.skipWarnings).toHaveLength(1);
      expect(result.skipWarnings[0].tracks).toEqual(['G-a', 'G-b']);
      // What tells the two apart for the element: only G-a fetched anything.
      expect(result.trackUrls['G-a']).toEqual(['https://e.org/P05067']);
      expect(result.trackUrls['G-b']).toBeUndefined();
    });

    it('fetches the resolvable URLs of a multi-URL descriptor', async () => {
      const fetchOne = echoFetch();
      const result = await loadProtvistaData(
        { accession: 'P05067' },
        configWith([
          urlSource(['https://e.org/{accession}', 'https://e.org/{species}']),
        ]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledTimes(1);
      expect(result.trackUrls['G-a']).toEqual(['https://e.org/P05067']);
    });
  });

  describe('dedup', () => {
    it('fetches a template shared by several tracks exactly once', async () => {
      const fetchOne = echoFetch();
      await loadProtvistaData(
        { species: 'human', accession: 'P05067' },
        configWith([
          urlSource('https://e.org/{species}/{accession}'),
          urlSource('https://e.org/{species}/{accession}'),
        ]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('format sources', () => {
    it('a skipped file track logs only the "Not fetching" warning', async () => {
      // Without a body there is nothing to parse; the pipeline must not add
      // a second warning blaming the (never-fetched) response.
      const fetchOne = vi.fn(async () => 'type,start,end\nDOMAIN,1,2');
      const result = await loadProtvistaData(
        { accession: 'P05067' },
        configWith([
          {
            from: 'file',
            url: './{ds}/x.csv',
            shape: 'feature',
            format: 'csv',
          },
        ]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).not.toHaveBeenCalled();
      expect(result.skipWarnings).toHaveLength(1);
      expect(result.skipWarnings[0].message).toContain(
        "Not fetching './{ds}/x.csv'"
      );
      expect(result.trackFailures).toEqual({});
      expect(warn).not.toHaveBeenCalled();
      expect(result.data['G-a']).toBeUndefined();
    });

    it('names the substituted path in a parse error', async () => {
      const fetchOne = vi.fn(async () => 'type,start\nDOMAIN,abc');
      const result = await loadProtvistaData(
        { dataset: 'ds1', accession: 'P05067' },
        configWith([
          {
            from: 'file',
            url: './{dataset}.csv',
            shape: 'feature',
            format: 'csv',
          },
        ]),
        fetchOne,
        resolveAdapter
      );
      expect(fetchOne).toHaveBeenCalledWith('./ds1.csv', 'text');
      expect(result.trackFailures['G-a']?.severity).toBe('error');
      expect(result.trackFailures['G-a']?.message).toContain('./ds1.csv');
    });
  });
});
