/**
 * Sequence-only mode on the mounted element: a config that sets `sequence:`
 * instead of `accession:` shows a protein that isn't in UniProt.
 *
 * What is pinned here, end to end through `connectedCallback → _init()`:
 *   - the viewer makes no request of its own — no Proteins API entry, no
 *     structure panel — so inline forms fetch nothing at all, and a FASTA
 *     path fetches exactly that path;
 *   - the FASTA header (or "your sequence") stands in wherever the accession
 *     was shown, escaped, and no literal `{accession}` reaches the DOM;
 *   - every sequence-mode config problem reaches the existing routed config
 *     report (`phase: 'config'`, panel, one console line, no Retry);
 *   - the authored-coordinate check still runs, naming the header;
 *   - `setConfig()` between the modes leaves no stale state.
 *
 * Conventions follow `error-surface.spec.ts`: `fetch` is stubbed, a
 * `protvista-error` listener collects events, and console spies only assert
 * the one routed line (and keep the output quiet).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Registers <protvista-uniprot>; nightingale packages are stubbed globally
// via `src/__spec__/nightingale-mocks.ts` (setupFiles).
import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import type { ValidationIssue } from '../schema/errors.js';
import type { NormalizedConfig } from '../schema/normalize.js';

const PANEL = `.${CSS_PREFIX}-error-panel`;
const ISSUES = `.${CSS_PREFIX}-error-issues`;
const BADGE = `.${CSS_PREFIX}-error-badge`;
const LOADER = '.protvista-loader';
const ENTRY = '/proteins/api/proteins/';

type ErrorEvent = CustomEvent<{
  phase: string;
  severity: 'error' | 'warning';
  message: string;
  issues: ValidationIssue[];
  context: Record<string, unknown>;
}>;

type El = HTMLElement & {
  config?: NormalizedConfig;
  viewerConfig?: unknown;
  accession?: string;
  sequence?: string;
  nostructure?: boolean;
  loading: boolean;
  openGroups: string[];
  _customizeMode: boolean;
  _sequenceAccession?: string;
  setConfig(config: unknown): Promise<void>;
  setTrackData(groupId: string, trackId: string, data: unknown): void;
  updateComplete: Promise<boolean>;
};

/** 240 residues under a FASTA header, as inline text. */
const RESIDUES = 'MKTAYIAKQR'.repeat(24);
const FASTA = `>my construct v2\n${RESIDUES.slice(0, 120)}\n${RESIDUES.slice(120)}\n`;

const inlineTrack = (id: string, inlineData: unknown, extra = {}) => ({
  id,
  kind: 'features',
  data: { from: 'inline', inlineData },
  ...extra,
});

/** A sequence config with one labelled group over an inline feature track. */
const seqConfig = (extra: Record<string, unknown> = {}) => ({
  sequence: FASTA,
  rows: [
    {
      id: 'g',
      label: 'Hotspots on {accession}',
      tracks: [
        inlineTrack('y', [{ type: 'DOMAIN', start: 1, end: 5 }], {
          label: 'Sites of {accession}',
        }),
      ],
    },
  ],
  ...extra,
});

/** The same rows, as an accession-mode config. */
const accConfig = () => ({
  accession: 'P05067',
  rows: [
    {
      id: 'g',
      tracks: [inlineTrack('y', [{ type: 'DOMAIN', start: 1, end: 5 }])],
    },
  ],
});

const ok = (body: { json?: unknown; text?: string }) =>
  ({
    ok: true,
    status: 200,
    json: async () => body.json ?? {},
    text: async () => body.text ?? '',
  }) as unknown as Response;

/** An entry route serving a 770-residue protein; anything else is empty. */
function stubEntry() {
  const fn = vi.fn(async (input: unknown) =>
    String(input).includes(ENTRY)
      ? ok({ json: { sequence: { sequence: 'A'.repeat(770) } } })
      : ok({})
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const appended: El[] = [];
function mountEl(props: Partial<El>): El {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  Object.assign(el, props);
  document.body.append(el);
  appended.push(el);
  return el;
}

function collect(el: El) {
  const events: ErrorEvent[] = [];
  el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));
  return events;
}

async function ready(el: El) {
  await vi.waitFor(() => {
    if (!el.querySelector('nightingale-manager')) {
      throw new Error('viewer not ready');
    }
  });
  await el.updateComplete;
}

/** Let every pending fetch and promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

const fetchedUrls = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.map(([url]) => String(url));

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sequence mode — rendering', () => {
  it('renders an inline FASTA sequence and makes no request at all', async () => {
    const fetchFn = stubEntry();
    const el = mountEl({ viewerConfig: seqConfig(), openGroups: ['g'] });
    await ready(el);

    const seq = el.querySelector('nightingale-sequence');
    expect(seq?.getAttribute('length')).toBe('240');
    expect(seq?.getAttribute('sequence')).toBe(RESIDUES);
    expect(el.accession).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('renders raw residues the same way', async () => {
    const fetchFn = stubEntry();
    const el = mountEl({
      viewerConfig: seqConfig({ sequence: 'mkt ayi\nakq*' }),
    });
    await ready(el);

    expect(
      el.querySelector('nightingale-sequence')?.getAttribute('sequence')
    ).toBe('MKTAYIAKQ');
    // No header: "your sequence" stands in for the accession.
    expect(el.textContent).toContain('Hotspots on your sequence');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('shows the header wherever the accession was, and never {accession}', async () => {
    stubEntry();
    const el = mountEl({ viewerConfig: seqConfig(), openGroups: ['g'] });
    await ready(el);

    expect(el.textContent).toContain('Hotspots on my construct v2');
    expect(el.textContent).toContain('Sites of my construct v2');
    expect(el.innerHTML).not.toContain('{accession}');

    // Customize mode names rows through `_labelText` in its aria-labels.
    el._customizeMode = true;
    await el.updateComplete;
    const labels = [...el.querySelectorAll('[aria-label]')].map((n) =>
      n.getAttribute('aria-label')
    );
    expect(labels).toContain('Collapse Hotspots on my construct v2');
    expect(el.innerHTML).not.toContain('{accession}');
  });

  it('names the header in the no-results message', async () => {
    stubEntry();
    const el = mountEl({
      viewerConfig: { sequence: FASTA, rows: [inlineTrack('empty', [])] },
    });
    await vi.waitFor(() => {
      if (!el.querySelector('.protvista-no-results')) {
        throw new Error('not rendered');
      }
    });
    expect(el.querySelector('.protvista-no-results')?.textContent).toContain(
      'No feature data available for my construct v2'
    );
  });

  it('escapes a header that looks like markup', async () => {
    stubEntry();
    const el = mountEl({
      viewerConfig: seqConfig({
        sequence: `>[x](javascript:alert(1)) *y*\n${RESIDUES}\n`,
      }),
    });
    await ready(el);

    const label = el.querySelector(`#${CSS_PREFIX}-group_g`);
    expect(label?.textContent).toContain(
      'Hotspots on [x](javascript:alert(1)) *y*'
    );
    expect(label?.querySelector('a, em')).toBeNull();
  });

  it('omits the structure panel', async () => {
    stubEntry();
    const el = mountEl({ viewerConfig: seqConfig() });
    await ready(el);
    expect(el.querySelector('protvista-uniprot-structure')).toBeNull();
  });

  it('fetches a FASTA path exactly once, and nothing else', async () => {
    const fetchFn = vi.fn(async (input: unknown) =>
      String(input) === './protein.fasta' ? ok({ text: FASTA }) : ok({})
    );
    vi.stubGlobal('fetch', fetchFn);
    const el = mountEl({
      viewerConfig: seqConfig({ sequence: './protein.fasta' }),
    });
    await ready(el);

    expect(fetchedUrls(fetchFn)).toEqual(['./protein.fasta']);
    expect(el.sequence).toBe(RESIDUES);
    expect(el.textContent).toContain('Hotspots on my construct v2');
  });

  it('renders from: custom tracks once setTrackData supplies them', async () => {
    stubEntry();
    const el = mountEl({
      viewerConfig: {
        sequence: RESIDUES,
        rows: [
          {
            id: 'g',
            tracks: [{ id: 'c', kind: 'features', data: { from: 'custom' } }],
          },
        ],
      },
    });
    el.setTrackData('g', 'c', [{ type: 'DOMAIN', start: 1, end: 3 }]);
    await ready(el);
    expect(el.querySelector('.protvista-no-results')).toBeNull();
  });
});

describe('sequence mode — config failures reach the routed config report', () => {
  it.each([
    [
      'multi-record FASTA',
      { ...seqConfig(), sequence: '>a\nMKT\n>b\nMKT\n' },
      {},
      ['invalid-sequence'],
    ],
    [
      'accession: and sequence:',
      { ...seqConfig(), accession: 'P05067' },
      {},
      ['accession-and-sequence'],
    ],
    [
      'the accession attribute and sequence:',
      seqConfig(),
      { accession: 'P05067' },
      ['accession-and-sequence'],
    ],
    [
      'neither accession nor sequence',
      { rows: accConfig().rows },
      {},
      ['missing-protein'],
    ],
    [
      'a track whose data URL uses {accession}',
      seqConfig({
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'u',
                kind: 'features',
                data: 'https://x.example/{accession}.json',
              },
            ],
          },
        ],
      }),
      {},
      ['needs-accession'],
    ],
  ])('%s', async (_name, viewerConfig, props, codes) => {
    const fetchFn = stubEntry();
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const el = mountEl({ viewerConfig, ...props });
    const events = collect(el);

    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });
    await settle();

    const config = events.filter((e) => e.detail.phase === 'config');
    expect(config).toHaveLength(1);
    expect(config[0].detail.severity).toBe('error');
    expect(config[0].detail.message).toBe('Config validation failed (1 issue)');
    expect(config[0].detail.issues.map((i) => i.code)).toEqual(codes);
    expect(el.querySelector(PANEL)?.textContent).toContain(codes[0]);
    // A config problem is fixed in the config, not by re-running it.
    const buttons = [...el.querySelectorAll(`${PANEL} button`)];
    expect(buttons.some((b) => b.textContent?.includes('Retry'))).toBe(false);
    // The one routed console line.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe(
      '[protvista-uniprot] Failed to load config.'
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports a missing FASTA file as cannot-resolve-sequence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({ ok: false, status: 404, statusText: 'Not Found' }) as Response
      )
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mountEl({
      viewerConfig: seqConfig({ sequence: './missing.fasta' }),
    });
    const events = collect(el);

    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });
    const [ev] = events.filter((e) => e.detail.phase === 'config');
    expect(ev.detail.issues.map((i) => [i.code, i.message])).toEqual([
      [
        'cannot-resolve-sequence',
        "Could not load the sequence file './missing.fasta': HTTP 404 Not Found.",
      ],
    ]);
  });

  it('re-resolves when an accession is set after a sequence-mode mount', async () => {
    stubEntry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mountEl({ viewerConfig: seqConfig() });
    const events = collect(el);
    await ready(el);

    el.accession = 'P05067';
    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });
    const [ev] = events.filter((e) => e.detail.phase === 'config');
    expect(ev.detail.issues.map((i) => i.code)).toEqual([
      'accession-and-sequence',
    ]);
    expect(ev.detail.issues[0].message).toContain(
      "An accession ('P05067') was supplied by the host"
    );
  });

  it('rejects an accession set while a sequence config is still resolving', async () => {
    const fetchFn = stubEntry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mountEl({ viewerConfig: seqConfig() });
    const events = collect(el);
    // Right after append: `_init()` has already handed the loader no
    // accession, and `updated()` ignores `undefined → value`.
    el.accession = 'P05067';

    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });
    await settle();
    const config = events.filter((e) => e.detail.phase === 'config');
    expect(config).toHaveLength(1);
    expect(config[0].detail.issues.map((i) => i.code)).toEqual([
      'accession-and-sequence',
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('loads the entry for an accession set while an accession-less config resolves', async () => {
    const fetchFn = stubEntry();
    const el = mountEl({ viewerConfig: { rows: accConfig().rows } });
    const events = collect(el);
    el.accession = 'P05067';

    await ready(el);
    await vi.waitFor(() => expect(el.sequence).toHaveLength(770));
    expect(fetchedUrls(fetchFn).some((u) => u.includes(ENTRY))).toBe(true);
    expect(events.filter((e) => e.detail.phase === 'config')).toEqual([]);
  });

  it('raises accession-and-sequence after a suspended setConfig to a sequence config', async () => {
    stubEntry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mountEl({ viewerConfig: accConfig() });
    const events = collect(el);
    await ready(el);
    expect(el.accession).toBe('P05067');

    // `suspend` short-circuits `updated()`; the clear `setConfig()` makes
    // must still not swallow the later, real accession change.
    (el as unknown as { suspend: boolean }).suspend = true;
    await el.setConfig(seqConfig());
    await el.updateComplete;
    (el as unknown as { suspend: boolean }).suspend = false;
    await el.updateComplete;
    await settle();
    await el.updateComplete;

    el.accession = 'P05067';
    await vi.waitFor(() => {
      const codes = events
        .filter((e) => e.detail.phase === 'config')
        .flatMap((e) => e.detail.issues.map((i) => i.code));
      expect(codes).toEqual(['accession-and-sequence']);
    });
  });

  it('withholds a data-accession or variables accession from the variables', async () => {
    stubEntry();
    const el = document.createElement('protvista-uniprot') as unknown as El;
    el.dataset.accession = 'P05067';
    el.viewerConfig = seqConfig({ variables: { accession: 'Q1' } });
    const events = collect(el);
    document.body.append(el);
    appended.push(el);
    await ready(el);

    const variables = (
      el as unknown as { _variables(): Record<string, string> }
    )._variables();
    expect(Object.prototype.hasOwnProperty.call(variables, 'accession')).toBe(
      false
    );
    expect(events.filter((e) => e.detail.phase === 'config')).toEqual([]);
  });
});

describe('sequence mode — authored coordinates', () => {
  const OUT_OF_RANGE = {
    from: 'inline',
    format: 'csv',
    inlineData: 'type,start,end,description\nDOMAIN,1,10,a\nDOMAIN,5,812,b\n',
  };

  it.each([false, true])(
    'warns on phase:track-data naming the header, with no badge or panel (strict: %s)',
    async (strict) => {
      stubEntry();
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const el = mountEl({
        viewerConfig: {
          sequence: FASTA,
          ...(strict ? { strict: true } : {}),
          rows: [
            {
              id: 'g',
              tracks: [{ id: 'y', kind: 'features', data: OUT_OF_RANGE }],
            },
          ],
        },
        openGroups: ['g'],
      });
      const events = collect(el);
      await ready(el);
      await vi.waitFor(() =>
        expect(
          events.filter((e) => e.detail.phase === 'track-data')
        ).toHaveLength(1)
      );

      const [ev] = events.filter((e) => e.detail.phase === 'track-data');
      expect(ev.detail.severity).toBe('warning');
      expect(ev.detail.issues.map((i) => i.code)).toEqual([
        'coordinate-out-of-range',
      ]);
      expect(ev.detail.message).toContain(
        '1 of 2 rows fall outside my construct v2 (240 residues); first: row 3, end 812.'
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(el.querySelector(BADGE)).toBeNull();
      expect(el.querySelector(PANEL)).toBeNull();
    }
  );
});

describe('sequence mode — setConfig between the modes', () => {
  it('switches accession → sequence → accession with one _init each and no stale state', async () => {
    const fetchFn = stubEntry();
    const proto = customElements.get('protvista-uniprot')!.prototype as {
      _init(): Promise<void>;
    };
    const init = vi.spyOn(proto, '_init');
    const el = mountEl({ viewerConfig: accConfig() });
    const events = collect(el);
    await ready(el);
    expect(el.accession).toBe('P05067');
    expect(el.sequence).toHaveLength(770);
    expect(el._sequenceAccession).toBe('P05067');
    expect(init).toHaveBeenCalledTimes(1);

    // → sequence: the backfilled accession is the old config's, not the
    // host's, so it is cleared rather than reported as "both".
    await el.setConfig(seqConfig());
    await settle();
    await ready(el);
    expect(init).toHaveBeenCalledTimes(2);
    expect(el.accession).toBeUndefined();
    expect(el.sequence).toBe(RESIDUES);
    expect(el._sequenceAccession).toBe('\u0000sequence');
    expect(el.querySelector('protvista-uniprot-structure')).toBeNull();
    const entryFetches = () =>
      fetchedUrls(fetchFn).filter((u) => u.includes(ENTRY)).length;
    expect(entryFetches()).toBe(1);

    // → accession: the entry is fetched again, and the structure is back.
    await el.setConfig(accConfig());
    await settle();
    await ready(el);
    await vi.waitFor(() => expect(el.sequence).toHaveLength(770));
    expect(init).toHaveBeenCalledTimes(3);
    expect(el.accession).toBe('P05067');
    expect(entryFetches()).toBe(2);
    expect(el.querySelector('protvista-uniprot-structure')).not.toBeNull();

    expect(events.filter((e) => e.detail.phase === 'config')).toEqual([]);
  });

  it('clears the spinner when a sequence config replaces a hung entry fetch', async () => {
    // The entry never answers. The sequence-mode `_init` must reset the
    // flag the superseded fetch would have cleared, or the spinner stays.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        String(input).includes(ENTRY)
          ? new Promise<Response>(() => undefined)
          : Promise.resolve(ok({}))
      )
    );
    const el = mountEl({ viewerConfig: accConfig() });
    await settle();
    await el.updateComplete;
    expect(el.querySelector(LOADER)).not.toBeNull();

    await el.setConfig(seqConfig());
    await ready(el);
    expect(el.querySelector(LOADER)).toBeNull();
    expect(el.sequence).toBe(RESIDUES);
  });

  it('drops the config sequence while the entry for the switch back is on the wire', async () => {
    // The entry for the switch back never answers.
    let entryCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        if (!String(input).includes(ENTRY)) return Promise.resolve(ok({}));
        entryCalls += 1;
        return new Promise<Response>(() => undefined);
      })
    );
    const el = mountEl({ viewerConfig: seqConfig() });
    await ready(el);
    expect(el._sequenceAccession).toBe('\u0000sequence');

    void el.setConfig(accConfig());
    await settle();
    await el.updateComplete;
    expect(entryCalls).toBe(1);
    // The config's residues are not this accession's: nothing stale renders
    // while the entry loads.
    expect(el.sequence).toBeUndefined();
    expect(el._sequenceAccession).toBeUndefined();
  });
});
