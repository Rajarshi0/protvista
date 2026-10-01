/**
 * What `<protvista-uniprot>` adds to a track's `change` event before anyone
 * else sees it (`_onChangeCapture`):
 *
 *   - `detail.track` — the row and track the event came from, with the
 *     track's kind *after* `extends` merging, and for a collapsed group the
 *     clicked feature's own source track;
 *   - one spelling of the event type (`nightingale-linegraph-track` sends a
 *     lowercase `eventtype`);
 *   - a feature and coordinates for a line-graph click, so the built-in
 *     popover opens.
 *
 * Mounted over the real `connectedCallback → _init()` lifecycle with a
 * stubbed `fetch`. The Nightingale tracks are plain `HTMLElement` stubs
 * (`nightingale-mocks.ts`), so events are dispatched from the rendered track
 * elements by hand, the way the real tracks dispatch them.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import type { ProtvistaChangeEventDetail } from '../events.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';

const BASE_URL = 'https://example.org/base.json';

/** The base an authored config `extends`: it is where `t`'s kind comes from. */
const BASE: ProtvistaViewerConfig = {
  rows: [
    {
      id: 'G',
      tracks: [
        { id: 't', kind: 'features', data: { from: 'inline', inlineData: [] } },
      ],
    },
  ],
};

const CONFIG: ProtvistaViewerConfig = {
  extends: BASE_URL,
  rows: [
    {
      id: 'G',
      tracks: [
        {
          id: 't',
          data: {
            from: 'inline',
            inlineData: [{ type: 'DOMAIN', start: 1, end: 5 }],
          },
        },
      ],
    },
    {
      id: 'DOMAINS',
      tracks: [
        {
          id: 'domain',
          kind: 'features',
          data: {
            from: 'inline',
            inlineData: [{ type: 'DOMAIN', start: 1, end: 5 }],
          },
        },
        {
          id: 'interpro',
          kind: 'interpro-features',
          data: {
            from: 'inline',
            inlineData: [
              { type: 'InterPro Representative Domain', start: 8, end: 12 },
            ],
          },
        },
      ],
    },
    {
      id: 'depth',
      kind: 'linegraph',
      label: 'Depth',
      data: {
        from: 'inline',
        inlineData: [
          { position: 4, value: 2 },
          { position: 5, value: 7 },
        ],
      },
    },
  ],
};

type El = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  openGroups: string[];
  noPersistLayout?: boolean;
  notooltip?: boolean;
  adapters?: Record<string, (...raw: unknown[]) => unknown>;
  data: Record<string, unknown>;
  updateComplete: Promise<boolean>;
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body =
        url === BASE_URL
          ? BASE
          : { sequence: { sequence: 'MSEQENCEMSEQENCE' }, features: [] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    })
  );
}

const appended: HTMLElement[] = [];

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(
  config: ProtvistaViewerConfig = CONFIG,
  readyKeys = ['G-t', 'DOMAINS']
): Promise<El> {
  stubFetch();
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.accession = 'P05067';
  el.noPersistLayout = true;
  el.viewerConfig = config;
  el.openGroups = ['G', 'DOMAINS'];
  document.body.append(el);
  appended.push(el);
  await vi.waitFor(() => {
    for (const key of readyKeys) {
      expect(el.querySelector(`#${CSS_PREFIX}-track-${key}`)).not.toBeNull();
    }
  });
  return el;
}

const trackEl = (el: El, key: string) =>
  el.querySelector(`#${CSS_PREFIX}-track-${key}`) as HTMLElement;

/** Dispatch a Nightingale-style `change` from `from`; return its detail as seen above the host. */
function fire(
  from: HTMLElement,
  detail: Record<string, unknown>
): ProtvistaChangeEventDetail {
  let seen: ProtvistaChangeEventDetail | undefined;
  const listener = (e: Event) => {
    seen = (e as CustomEvent<ProtvistaChangeEventDetail>).detail;
  };
  document.addEventListener('change', listener);
  from.dispatchEvent(
    new CustomEvent('change', { detail, bubbles: true, cancelable: true })
  );
  document.removeEventListener('change', listener);
  if (!seen) throw new Error('change event did not bubble');
  return seen;
}

describe('detail.track', () => {
  it('names the row and track, with the kind inherited through extends, on the first click', async () => {
    const el = await mount();
    const [feature] = el.data['G-t'] as object[];

    const detail = fire(trackEl(el, 'G-t'), { eventType: 'click', feature });

    expect(detail.track).toEqual({
      rowId: 'G',
      trackId: 't',
      kind: 'features',
      sourceTrackId: 't',
      sourceKind: 'features',
    });
  });

  it('reports a collapsed aggregate with trackId null and the feature’s own source', async () => {
    const el = await mount();
    const [domain, interpro] = el.data.DOMAINS as object[];
    const aggregate = trackEl(el, 'DOMAINS');

    expect(
      fire(aggregate, { eventType: 'click', feature: interpro }).track
    ).toEqual({
      rowId: 'DOMAINS',
      trackId: null,
      kind: null,
      sourceTrackId: 'interpro',
      sourceKind: 'interpro-features',
    });
    expect(
      fire(aggregate, { eventType: 'click', feature: domain }).track?.sourceKind
    ).toBe('features');
  });

  it('keys a standalone track by its own id', async () => {
    const el = await mount();
    const detail = fire(trackEl(el, 'depth-depth'), { eventType: 'mouseout' });
    expect(detail.track).toMatchObject({
      rowId: 'depth',
      trackId: 'depth',
      kind: 'linegraph',
    });
  });

  it('is already set for a bubble listener on the host itself', async () => {
    const el = await mount();
    let track: unknown;
    el.addEventListener('change', (e) => {
      track = (e as CustomEvent<ProtvistaChangeEventDetail>).detail.track;
    });
    fire(trackEl(el, 'G-t'), { eventType: 'mouseover' });
    expect(track).toMatchObject({ rowId: 'G', trackId: 't' });
  });

  it('leaves events from outside a track alone', async () => {
    const el = await mount();
    const detail = fire(el, { 'display-start': 2, 'display-end': 9 });
    expect(detail.track).toBeUndefined();
  });
});

describe('detail.track for a collapsed graph group', () => {
  // A line graph (or coloured sequence) plus a `detailOnly` track, like the
  // default VARIATION group: the aggregate draws only the graph.
  const detailOnly = {
    id: 'detail',
    kind: 'features',
    detailOnly: true,
    data: {
      from: 'inline',
      inlineData: [{ type: 'DOMAIN', start: 1, end: 5 }],
    },
  } as const;
  const GRAPHS: ProtvistaViewerConfig = {
    rows: [
      {
        id: 'VAR',
        tracks: [
          {
            id: 'counts',
            kind: 'linegraph',
            data: {
              from: 'inline',
              inlineData: [
                { position: 4, value: 2 },
                { position: 5, value: 7 },
              ],
            },
          },
          detailOnly,
        ],
      },
      {
        id: 'CONF',
        tracks: [
          {
            id: 'plddt',
            kind: 'features',
            component: 'nightingale-colored-sequence',
            data: {
              from: 'inline',
              inlineData: [{ type: 'PLDDT', start: 1, end: 1, score: 90 }],
            },
          },
          detailOnly,
        ],
      },
    ],
  };
  const graphGroup = (
    rowId: string,
    sourceTrackId: string,
    sourceKind: string
  ) => ({
    rowId,
    trackId: null,
    kind: null,
    sourceTrackId,
    sourceKind,
  });

  it('names the line graph on a click', async () => {
    const el = await mount(GRAPHS, ['VAR']);
    const detail = fire(trackEl(el, 'VAR'), {
      eventtype: 'click',
      feature: undefined,
      highlight: '5:5',
      parentEvent: new MouseEvent('click'),
    });
    expect(detail.feature).toBeDefined();
    expect(detail.track).toEqual(graphGroup('VAR', 'counts', 'linegraph'));
  });

  it('names the line graph on a hover, whose points Nightingale builds', async () => {
    const el = await mount(GRAPHS, ['VAR']);
    const [series] = el.data.VAR as Array<{ name: string }>;
    const detail = fire(trackEl(el, 'VAR'), {
      eventtype: 'mouseover',
      feature: { [series.name]: { position: 5, value: 7 } },
    });
    expect(detail.track).toEqual(graphGroup('VAR', 'counts', 'linegraph'));
  });

  it('names the coloured sequence', async () => {
    const el = await mount(GRAPHS, ['CONF']);
    expect(trackEl(el, 'CONF').localName).toBe('nightingale-colored-sequence');
    const detail = fire(trackEl(el, 'CONF'), { eventType: 'mouseover' });
    expect(detail.track).toEqual(graphGroup('CONF', 'plddt', 'features'));
  });
});

describe('zoom and pan', () => {
  it('records the display range Nightingale sends', async () => {
    const el = await mount();
    // The detail nightingale-new-core's `withZoom` dispatches.
    fire(trackEl(el, 'G-t'), { 'display-start': 10, 'display-end': 50 });
    expect(
      (el as unknown as { displayCoordinates: unknown }).displayCoordinates
    ).toEqual({ start: 10, end: 50 });
  });
});

describe('event type spelling', () => {
  it('copies a lowercase eventtype to eventType', async () => {
    const el = await mount();
    const detail = fire(trackEl(el, 'depth-depth'), { eventtype: 'mouseout' });
    expect(detail.eventType).toBe('mouseout');
  });

  it('leaves an existing eventType alone', async () => {
    const el = await mount();
    const detail = fire(trackEl(el, 'G-t'), { eventType: 'click' });
    expect(detail.eventType).toBe('click');
  });
});

describe('line-graph click', () => {
  // What nightingale-linegraph-track sends for a click at position 5 when
  // rendered with `highlight-on-click`.
  const linegraphClick = () => ({
    eventtype: 'click',
    feature: undefined,
    highlight: '5:5',
    parentEvent: new MouseEvent('click', { clientX: 30, clientY: 40 }),
  });

  it('gets the points at the clicked position, a tooltip and coords', async () => {
    const el = await mount();
    const series = el.data['depth-depth'] as Array<{ name: string }>;

    const detail = fire(trackEl(el, 'depth-depth'), linegraphClick());

    expect(detail.eventType).toBe('click');
    expect(detail.feature).toMatchObject({
      [series[0].name]: { position: 5, value: 7 },
    });
    expect(detail.feature?.tooltipContent).toContain('<p>5</p>');
    expect(detail.feature?.tooltipContent).toContain('<p>7</p>');
    expect(detail.coords).toEqual([30, 40]);
  });

  it('opens the built-in popover', async () => {
    const el = await mount();
    fire(trackEl(el, 'depth-depth'), linegraphClick());

    const popover = el.querySelector('.protvista-tooltip') as HTMLElement;
    expect(popover.hidden).toBe(false);
    expect(popover.textContent).toContain('Position');
  });

  it('adds nothing when the position has no point', async () => {
    const el = await mount();
    const detail = fire(trackEl(el, 'depth-depth'), {
      ...linegraphClick(),
      highlight: '99:99',
    });
    expect(detail.feature).toBeUndefined();
  });
});

describe('adapters property', () => {
  it('can be set again with the same functions (StrictMode) but not different ones', () => {
    const el = document.createElement('protvista-uniprot') as unknown as El;
    const fn = () => [];
    el.adapters = { 'uniprot-proteomics-json': fn };
    expect(() => {
      el.adapters = { 'uniprot-proteomics-json': fn };
    }).not.toThrow();
    expect(() => {
      el.adapters = { 'uniprot-proteomics-json': () => [] };
    }).toThrow();
  });
});
