/**
 * Coverage for the user-facing error-surfacing layer.
 *
 * Three surfaces sit on top of the unchanged `console.*` developer
 * channel: the mount-level alert panel (config / sequence failures),
 * the per-track `⚠` badge for *broken* data (network / 5xx / parse — a
 * 4xx is "missing", hidden like an empty response), and the bubbling
 * `protvista-error` event. This file exercises each, plus `strict`
 * promotion, focus management, and the lazy `errors/format` helper.
 *
 * Two harness styles, mirroring the existing specs:
 *   - Mount-panel + focus tests append the element and let the real
 *     `connectedCallback → _init()` lifecycle run (fetch is stubbed).
 *   - Badge / strict tests drive `_loadData()` directly and render the
 *     template into a detached target (as `render-target.spec.ts` does),
 *     avoiding the `loadEntry()` → real-API path.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'lit';

// Registers <protvista-uniprot>; nightingale packages are stubbed
// globally via `src/__spec__/nightingale-mocks.ts` (setupFiles).
import '../protvista-uniprot.js';
import { loadProtvistaData, type AdapterMap } from '../load-data.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { formatValidationIssues } from '../errors/format.js';
import type { ValidationIssue } from '../schema/errors.js';
import type { NormalizedConfig, NormalizedTrack } from '../schema/normalize.js';

const PANEL = `.${CSS_PREFIX}-error-panel`;
const BADGE = `.${CSS_PREFIX}-error-badge`;
const ISSUES = `.${CSS_PREFIX}-error-issues`;

type ErrorEvent = CustomEvent<{
  phase: string;
  /** The same one-liner the console and the visible surface carry. */
  message: string;
  /** The URL or path the failure came from, when it had one. */
  source?: string;
  issues: ValidationIssue[];
  context: Record<string, unknown>;
}>;

type El = HTMLElement & {
  config?: NormalizedConfig;
  viewerConfig?: unknown;
  accession?: string;
  sequence?: string;
  data: Record<string, unknown>;
  customTrackData: Record<string, unknown>;
  loading: boolean;
  hasData: boolean;
  openGroups: string[];
  _mountError: { phase: string; summary: string } | null;
  _trackErrors: Map<
    string,
    { status: number; url: string; message?: string; kind?: string; trackId?: string | null }
  >;
  _assignComponentData(element: unknown, payload: unknown, key: string): void;
  _groupErrors: Set<string>;
  _init(): Promise<void>;
  _loadData(only?: Set<string>): Promise<void>;
  setTrackData(groupId: string, trackId: string, data: unknown): void;
  render(): unknown;
  updateComplete: Promise<boolean>;
};

// ── config-object builders ────────────────────────────────────────

/** A raw (un-normalized) config with a single bad source-key reference. */
const INVALID_CONFIG = {
  rows: [{ id: 'FOO', tracks: [{ id: 'bar', kind: 'features', data: 'missingKey' }] }],
};

/** A raw, valid config with one http-URL feature track. */
const VALID_CONFIG = {
  rows: [
    { id: 'g', tracks: [{ id: 'y', kind: 'features', data: 'https://example.org/x.json' }] },
  ],
};

const urlTrack = (id: string, url: string): NormalizedTrack => ({
  id,
  label: id,
  kind: 'features',
  component: 'nightingale-track-canvas',
  rendering: {},
  data: [{ from: 'url', url, adapter: 'uniprot-features-json' }],
});

/**
 * A `from: file` CSV track — what `data: "./hits.csv"` normalises to. The
 * author wrote that path themselves and the extension states the encoding, so
 * the loader runs the computed decode → validate pipeline over the body.
 */
const fileTrack = (id: string, url: string): NormalizedTrack => ({
  id,
  label: id,
  kind: 'features',
  component: 'nightingale-track-canvas',
  rendering: {},
  data: [{ from: 'file', url, format: 'csv', shape: 'feature' }],
});

const customTrack = (id: string): NormalizedTrack => ({
  id,
  label: id,
  kind: 'features',
  component: 'nightingale-track-canvas',
  rendering: {},
  data: [{ from: 'custom' }],
});

function normConfig(
  tracks: NormalizedTrack[],
  opts: { strict?: boolean } = {}
): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
    rows: [
      {
        id: 'g',
        label: 'G',
        component: 'nightingale-track-canvas',
        rendering: {},
        tracks,
      },
    ],
  };
}

/**
 * A single *standalone* row — the shape the normalizer produces for a
 * top-level `rows:` entry with no `tracks:`, and the default in the starter
 * kits. Its one track is wrapped in a synthetic row flagged `standalone`, and
 * the row id matches the track id as the normalizer sets it.
 */
function standaloneConfig(
  track: NormalizedTrack,
  opts: { strict?: boolean } = {}
): NormalizedConfig {
  return {
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
    rows: [
      {
        id: track.id,
        label: track.label,
        component: track.component,
        rendering: {},
        standalone: true,
        tracks: [track],
      },
    ],
  };
}

/** Detached element with the state `_loadData()` needs, ready to render. */
function buildLoaded(
  config: NormalizedConfig,
  overrides: Partial<El> = {}
): El {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.config = config;
  el.accession = 'P05067';
  el.sequence = 'MSEQENCE';
  el.data = {};
  el.customTrackData = {};
  el.loading = false;
  el.hasData = false;
  el.openGroups = [];
  Object.assign(el, overrides);
  return el;
}

function renderTarget(el: El): HTMLElement {
  const target = document.createElement('div');
  render(el.render(), target);
  return target;
}

/**
 * Route fetch by URL substring; default 200 with an empty body. `body` is
 * served from both `.json()` and `.text()`, so one route covers a provider
 * endpoint and a delimited `from: file` source alike.
 */
function stubFetch(
  routes: Array<
    [
      match: string,
      res: {
        ok: boolean;
        status: number;
        body?: unknown;
        /** Fail the body read, producing a `parse` classification. */
        unreadable?: boolean;
      },
    ]
  >
) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    const hit = routes.find(([m]) => url.includes(m));
    const res = hit ? hit[1] : { ok: true, status: 200 };
    const { ok, status, body, unreadable } = res;
    const read = async () => {
      if (unreadable) throw new SyntaxError('Unexpected token < in JSON');
      return body;
    };
    return {
      ok,
      status,
      json: async () => (await read()) ?? {},
      text: async () => {
        const v = await read();
        return typeof v === 'string' ? v : '';
      },
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const appended: HTMLElement[] = [];
function mountEl(props: Partial<El>): El {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  Object.assign(el, props);
  document.body.append(el);
  appended.push(el);
  return el;
}

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Mount-level panel: config validation ──────────────────────────

describe('mount-level error panel — config validation', () => {
  it('renders the alert panel, lists issues, and fires phase:config', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = mountEl({ viewerConfig: INVALID_CONFIG, accession: 'P05067' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.textContent).toMatch(/Config validation failed \(\d+ issue/);
    expect(panel.textContent).toMatch(/unknown-source-key/);

    // Developer channel preserved verbatim.
    expect(errorSpy).toHaveBeenCalledWith(
      '[protvista-uniprot] Failed to load config.',
      expect.anything()
    );

    const cfg = events.find((e) => e.detail.phase === 'config');
    expect(cfg).toBeDefined();
    expect(cfg!.detail.issues.length).toBeGreaterThan(0);
    expect(cfg!.bubbles).toBe(true);
  });

  it('surfaces a config warning without blocking the mount', async () => {
    // A warning names something legal, so the viewer loads — but it still has
    // to reach a user. Dropped on the valid path, it reached nothing: not the
    // console, not this event, not the ⚠ badge, not CI. That is the whole
    // reason warnings are issues rather than `console.warn` calls.
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = mountEl({
      viewerConfig: {
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { from: 'file', url: './hits.tsv', format: 'csv' },
              },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!events.some((e) => e.detail.phase === 'config')) {
        throw new Error('no config event yet');
      }
    });

    const cfg = events.find((e) => e.detail.phase === 'config')!;
    expect(cfg.detail.issues.map((i: { code: string }) => i.code)).toEqual([
      'format-overrides-extension',
    ]);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('1 warning');
    // Not a mount failure: no panel, and the config is in place.
    expect(el.querySelector(PANEL)).toBeNull();
    expect(el.config).toBeDefined();
  });

  it('keeps a config warning off the panel under strict', async () => {
    // `strict` makes broken states fail loudly. A warning names something
    // legal that loads as written, so raising the panel would hide a working
    // viewer. The event still fires, marked by each issue's severity.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Spy on every raise rather than reading `_mountError` afterwards: the
    // stubbed sequence fetch raises its own panel and would mask this one.
    const proto = customElements.get('protvista-uniprot')!.prototype as {
      _setMountError(phase: string): void;
    };
    const raise = vi.spyOn(proto, '_setMountError');
    const events: ErrorEvent[] = [];
    const el = mountEl({
      viewerConfig: {
        strict: true,
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { from: 'file', url: './hits.tsv', format: 'csv' },
              },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!events.some((e) => e.detail.phase === 'config')) {
        throw new Error('no config event yet');
      }
    });

    const cfg = events.find((e) => e.detail.phase === 'config')!;
    expect(cfg.detail.issues.map((i) => i.severity)).toEqual(['warning']);
    expect(el.config?.strict).toBe(true);
    expect(raise.mock.calls.map(([phase]) => phase)).not.toContain('config');
  });

  it('offers no dismiss control for a fatal config error (nothing to reveal)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mountEl({ viewerConfig: INVALID_CONFIG, accession: 'P05067' });
    await vi.waitFor(() => {
      if (!el.querySelector(ISSUES)) throw new Error('panel not ready');
    });

    const buttons = [
      ...el.querySelectorAll<HTMLButtonElement>(`${PANEL} button`),
    ];
    // No Copy button anywhere, and no Dismiss for an unrenderable component.
    expect(buttons.some((b) => b.textContent?.trim() === 'Copy')).toBe(false);
    expect(
      el.querySelector(`${PANEL} button[aria-label="Dismiss error"]`)
    ).toBeNull();
  });
});

// ── Mount-level panel: sequence ───────────────────────────────────

describe('mount-level error panel — sequence', () => {
  it('a 4xx sequence (missing accession) shows the "no entry" panel, no Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A 404 on the sequence endpoint = "this accession has no entry".
    stubFetch([['/proteins/api/proteins/', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067X' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    expect(panel.getAttribute('role')).toBe('alert');
    // "Missing" wording points at the identifier, not the service…
    expect(panel.textContent).toMatch(
      /No UniProt entry found for 'P05067X'/
    );
    // …and a 404 is deterministic, so no Retry is offered.
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();

    const seq = events.find((e) => e.detail.phase === 'sequence');
    expect(seq).toBeDefined();
    expect(seq!.detail.context.accession).toBe('P05067X');
    expect(seq!.detail.context.errorKind).toBe('http');
    expect(seq!.detail.context.status).toBe(404);
  });

  it('a broken (5xx) sequence fetch shows the "unreachable" panel with Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/proteins/api/proteins/', { ok: false, status: 503 }]]);
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    // "Broken" wording blames the service, not the identifier…
    expect(panel.textContent).toMatch(/data service is unreachable or failing/);
    // …and a transient failure offers Retry.
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();

    const seq = events.find((e) => e.detail.phase === 'sequence');
    expect(seq!.detail.context.errorKind).toBe('http');
    expect(seq!.detail.context.status).toBe(503);
  });

  it('a network-error sequence fetch is broken (unreachable panel + Retry)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });

    const panel = el.querySelector(PANEL)!;
    expect(panel.textContent).toMatch(/data service is unreachable or failing/);
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();
    expect(
      events.find((e) => e.detail.phase === 'sequence')!.detail.context.errorKind
    ).toBe('network');
  });

  it('Retry re-fetches the sequence and recovers once the service is back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Fail the sequence once (503), then succeed on the retry.
    let sequenceCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          sequenceCalls += 1;
          if (sequenceCalls === 1) {
            return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // Tracks: return empty-but-ok so the viewer mounts cleanly.
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      })
    );

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    const retry = await vi.waitFor(() => {
      const btn = el.querySelector<HTMLButtonElement>(`${PANEL} .${CSS_PREFIX}-error-retry`);
      if (!btn) throw new Error('retry not ready');
      return btn;
    });

    retry.click();

    // After the retry the sequence loads, so the panel is gone.
    await vi.waitFor(() => {
      if (el.querySelector(PANEL)) throw new Error('panel still present');
    });
    expect(sequenceCalls).toBe(2);
    expect(el.sequence).toBe('MSEQENCE');
  });
});

// ── Focus management ──────────────────────────────────────────────

describe('mount panel — focus management', () => {
  it('captures focus on appear and restores it on dismiss (dismissible panel)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A strict-mode track failure: config + sequence load fine, so the
    // panel is dismissible and dismissing reveals the working viewer.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // A "broken" (5xx) track failure so the strict panel is raised.
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      })
    );

    const sibling = document.createElement('button');
    document.body.append(sibling);
    appended.push(sibling);
    sibling.focus();
    expect(document.activeElement).toBe(sibling);

    const el = mountEl({
      viewerConfig: {
        strict: true,
        rows: [
          { id: 'g', tracks: [{ id: 'bad', kind: 'features', data: 'https://example.org/bad.json' }] },
        ],
      },
      accession: 'P05067',
    });

    // Wait until the panel is present AND dismissible (both config and
    // sequence have loaded and the strict panel has been raised).
    await vi.waitFor(() => {
      if (!el.querySelector(`${PANEL} button[aria-label="Dismiss error"]`)) {
        throw new Error('dismissible panel not ready');
      }
    });
    await el.updateComplete;

    const panel = el.querySelector<HTMLElement>(PANEL)!;
    expect(document.activeElement).toBe(panel);

    const dismiss = panel.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss error"]'
    )!;
    dismiss.click();
    await el.updateComplete;

    expect(document.activeElement).toBe(sibling);
  });

  it('preserves the focus-restore target across a re-entrant strict re-raise', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // Persistently-broken (5xx) track so the strict panel stays up.
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      })
    );

    const sibling = document.createElement('button');
    document.body.append(sibling);
    appended.push(sibling);
    sibling.focus();
    expect(document.activeElement).toBe(sibling);

    const el = mountEl({
      viewerConfig: {
        strict: true,
        rows: [
          { id: 'g', tracks: [{ id: 'bad', kind: 'features', data: 'https://example.org/bad.json' }] },
        ],
      },
      accession: 'P05067',
    });

    await vi.waitFor(() => {
      if (!el.querySelector(`${PANEL} button[aria-label="Dismiss error"]`)) {
        throw new Error('dismissible panel not ready');
      }
    });
    await el.updateComplete;

    // Focus has moved into the panel on appear.
    const panel = el.querySelector<HTMLElement>(PANEL)!;
    expect(document.activeElement).toBe(panel);

    // Re-entrant load while the panel is open and still failing: strict
    // re-raises the aggregated panel via `_setMountError`. This must NOT
    // re-capture the focus-restore target — which is now the panel itself.
    await el._loadData();
    await el.updateComplete;

    // Dismiss and confirm focus returns to the ORIGINAL pre-error element,
    // not lost to <body> because `_prevFocus` was clobbered to the (now
    // removed) panel.
    const dismiss = el.querySelector<HTMLButtonElement>(
      `${PANEL} button[aria-label="Dismiss error"]`
    )!;
    dismiss.click();
    await el.updateComplete;

    expect(document.activeElement).toBe(sibling);
  });
});

// ── Per-track badges ──────────────────────────────────────────────

describe('per-track error badge', () => {
  it('shows a ⚠ badge + fires an event for a broken (5xx) track', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig([customTrack('ok'), urlTrack('bad', 'https://example.org/bad.json')]),
      {
        customTrackData: { 'g-ok': [{ type: 'DOMAIN', start: 1, end: 10 }] },
        hasData: true,
        openGroups: ['g'],
      }
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const badges = target.querySelectorAll(BADGE);
    expect(badges.length).toBe(1);
    const badge = badges[0];
    expect(badge.getAttribute('tabindex')).toBe('0');
    expect(badge.getAttribute('role')).toBe('img');

    const descId = badge.getAttribute('aria-describedby')!;
    const desc = target.querySelector(`[id="${descId}"]`)!;
    expect(desc.textContent).toMatch(/HTTP 500/);
    expect(desc.textContent).toMatch(/example\.org\/bad/);

    const tf = events.find((e) => e.detail.phase === 'track-fetch');
    expect(tf).toBeDefined();
    expect(tf!.detail.context.status).toBe(500);
    expect(tf!.detail.context.trackId).toBe('bad');

    // The developer channel still carries it, exactly once — the router makes
    // the only console call, so there is no second line from the fetch
    // closure to double it.
    const httpWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('HTTP 500')
    );
    expect(httpWarns.length).toBe(1);
  });

  it('hides a 4xx track (missing, not broken) with no badge and no event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(normConfig([urlTrack('bad', 'https://example.org/bad.json')]), {
      openGroups: ['g'],
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
    // A 4xx is "no data", not an error — the event does NOT fire.
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
    expect(el._trackErrors.has('g-bad')).toBe(false);
  });

  it('shows a group-level badge when every track in the group fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 500 }],
      ['/b.json', { ok: false, status: 500 }],
    ]);

    const el = buildLoaded(
      normConfig([
        urlTrack('a', 'https://example.org/a.json'),
        urlTrack('b', 'https://example.org/b.json'),
      ])
    );

    await el._loadData();
    const target = renderTarget(el);

    expect(el._groupErrors.has('g')).toBe(true);
    expect(target.querySelector(BADGE)).not.toBeNull();
  });

  it('sanitizes the badge id so ids with whitespace keep a valid aria-describedby', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    // Schema permits any non-empty id string, including spaces.
    const el = buildLoaded(
      normConfig([customTrack('ok'), urlTrack('bad track', 'https://example.org/bad.json')]),
      {
        customTrackData: { 'g-ok': [{ type: 'DOMAIN', start: 1, end: 10 }] },
        hasData: true,
        openGroups: ['g'],
      }
    );

    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    const descId = badge.getAttribute('aria-describedby')!;
    expect(descId).not.toMatch(/\s/); // no whitespace → valid HTML id / token
    // The referenced description element actually exists under that id.
    expect(target.querySelector(`[id="${descId}"]`)).not.toBeNull();
  });
});

// ── malformed data files and wrong file paths ─────────────────────

describe('parse / adapter failures on screen', () => {
  // A CSV whose `start` cell is not a number. The decoder names the author's
  // own path and the offending row, which is the whole value of surfacing it.
  const BAD_CSV = 'type,start,end,description\nDOMAIN,abc,25,Kinase domain';
  const BAD_ROW = /row 2, column "start": expected a number, got "abc"/;

  it('shows the row-named parse message as badge text and on the event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    const detail = target.querySelector(`[id="${descId}"]`)!.textContent!;
    expect(detail).toMatch(BAD_ROW);
    expect(detail).toContain('./hits.csv');

    // The event carries the identical text, so an embedder's listener sees
    // exactly what the badge says. Asserting the *event* matters: the internal
    // map holding the same string is not a channel anyone outside can read.
    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf).toBeDefined();
    expect(tf.detail.message).toBe(detail);
    expect(tf.detail.message).toMatch(BAD_ROW);
    expect(tf.detail.source).toBe('./hits.csv');
    expect(tf.detail.context.errorKind).toBe('adapter');
    expect(tf.detail.context.trackId).toBe('hits');
    expect(el._trackErrors.get('g-hits')!.message).toBe(detail);
  });

  it('offers no Retry for a parse failure (re-running is deterministic)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).not.toBeNull();
    expect(target.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();
  });

  it('surfaces a parse failure on a standalone row too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);

    const el = buildLoaded(standaloneConfig(fileTrack('hits', './hits.csv')));
    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toMatch(
      BAD_ROW
    );
  });

  it('promotes a parse failure to the panel under strict', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]]);

    const el = buildLoaded(
      normConfig([fileTrack('hits', './hits.csv')], { strict: true })
    );
    await el._loadData();

    expect(el._mountError?.phase).toBe('track-fetch');
    expect(el._mountError?.summary).toMatch(BAD_ROW);
  });

  it('reads an empty file as no data, not as an error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A served-but-empty file parses to zero records. That is "nothing to
    // draw", which the viewer already has a surface for — not a failure.
    stubFetch([['/hits.csv', { ok: true, status: 200, body: '' }]]);

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    await el._loadData();
    const target = renderTarget(el);

    expect(el._trackErrors.size).toBe(0);
    expect(target.querySelector(BADGE)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
  });

  it('lets a failed fetch explain itself rather than the adapter throw it caused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A 404 on a provider endpoint is deliberately silent. The empty body it
    // leaves behind can make the adapter throw, and that throw must not
    // resurrect the failure the classification just decided to swallow.
    stubFetch([['/bad.json', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const config = normConfig([urlTrack('bad', 'https://example.org/bad.json')]);
    config.rows[0].tracks[0].data[0].adapter = 'nope-not-registered';
    const el = buildLoaded(config, { openGroups: ['g'] });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();

    expect(el._trackErrors.size).toBe(0);
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
  });
});

describe('file-source 404s on screen', () => {
  const PATH_HINT = /could not be found \(HTTP 404\) — check the path is relative to the page/;

  it('names the path and the gotcha for a from: file 404', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    const detail = target.querySelector(`[id="${descId}"]`)!.textContent!;
    expect(detail).toContain('./hits.csv');
    expect(detail).toMatch(PATH_HINT);

    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.status).toBe(404);
    expect(tf.detail.context.errorKind).toBe('http');
    // Deterministic: the path is wrong, and refetching it stays wrong.
    expect(target.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();
  });

  it('keeps an API-source 404 silent (missing, not broken)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad.json', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
      { openGroups: ['g'] }
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).toBeNull();
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
  });

  it('surfaces a from: file 404 on a standalone row too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: false, status: 404 }]]);

    const el = buildLoaded(standaloneConfig(fileTrack('hits', './hits.csv')));
    await el._loadData();
    const target = renderTarget(el);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toMatch(
      PATH_HINT
    );
  });

  it('still reports a from: file 5xx as a server failure, with Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/hits.csv', { ok: false, status: 503 }]]);

    const el = buildLoaded(normConfig([fileTrack('hits', './hits.csv')]), {
      openGroups: ['g'],
    });
    await el._loadData();
    const target = renderTarget(el);

    const descId = target
      .querySelector(BADGE)!
      .getAttribute('aria-describedby')!;
    const detail = target.querySelector(`[id="${descId}"]`)!.textContent!;
    expect(detail).toMatch(/HTTP 503/);
    expect(detail).not.toMatch(PATH_HINT);
    expect(target.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();
  });
});

// ── standalone rows ───────────────────────────────────────────────

describe('standalone row error badge', () => {
  const ALL_HIDDEN = `.${CSS_PREFIX}-all-hidden`;

  it('keeps a broken standalone row on the canvas with a badge and Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // The row is still here, carrying the same badge a grouped track gets…
    expect(target.querySelector(`#${CSS_PREFIX}-group_solo`)).not.toBeNull();
    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    expect(badge.getAttribute('role')).toBe('img');
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toMatch(
      /HTTP 500/
    );
    // …a 5xx is transient, so Retry is offered here too…
    expect(
      target.querySelector(`.${CSS_PREFIX}-error-retry`)
    ).not.toBeNull();
    // …and the event fires naming the standalone track.
    const tf = events.find((e) => e.detail.phase === 'track-fetch');
    expect(tf!.detail.context.trackId).toBe('solo');
  });

  it('does not claim "All tracks are hidden" for a failed standalone row', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    await el._loadData();
    const target = renderTarget(el);

    // The notice (and its Reset layout button, which would fix nothing) is
    // for a canvas the *user* emptied — not for a load failure.
    expect(target.querySelector(ALL_HIDDEN)).toBeNull();
  });

  it('still shows the hidden notice when the row is genuinely hidden', async () => {
    const config = standaloneConfig(customTrack('solo'));
    config.rows[0].hidden = true;
    config.rows[0].tracks[0].hidden = true;
    const el = buildLoaded(config, {
      customTrackData: { 'solo-solo': [{ type: 'DOMAIN', start: 1, end: 10 }] },
      hasData: true,
    });

    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(ALL_HIDDEN)).not.toBeNull();
  });

  it('drops a 4xx standalone row silently (missing, not broken)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 404 }]]);

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    await el._loadData();
    const target = renderTarget(el);

    expect(target.querySelector(BADGE)).toBeNull();
    expect(target.querySelector('.protvista-no-results')).not.toBeNull();
  });

  it('renders no content cell under the badge (no empty canvas to mislead)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      standaloneConfig(urlTrack('solo', 'https://example.org/bad.json'))
    );
    await el._loadData();
    const target = renderTarget(el);

    const row = target.querySelector(`#${CSS_PREFIX}-group_solo`)!;
    expect(
      row.querySelector(`[data-id="${CSS_PREFIX}-track_solo"]`)
    ).toBeNull();
  });
});

// ── default visibility of transport / server errors ───────────────

describe('broken vs missing', () => {
  function loadedWith(badUrl: string, failer: () => Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/bad')
          ? failer()
          : ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
      )
    );
    return buildLoaded(
      normConfig([customTrack('ok'), urlTrack('bad', badUrl)]),
      {
        customTrackData: { 'g-ok': [{ type: 'DOMAIN', start: 1, end: 10 }] },
        hasData: true,
        openGroups: ['g'],
      }
    );
  }

  it('surfaces a network (blocked/offline) failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = loadedWith('https://example.org/bad.json', () => {
      throw new TypeError('Failed to fetch'); // what a blocked/offline fetch throws
    });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // A transport failure is "broken" → surfaced.
    expect(target.querySelector(BADGE)).not.toBeNull();
    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.errorKind).toBe('network');
    expect(tf.detail.context.status).toBeUndefined();
  });

  it('surfaces a 5xx server error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = loadedWith(
      'https://example.org/bad.json',
      () => ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
    );
    await el._loadData();
    const target = renderTarget(el);
    expect(target.querySelector(BADGE)).not.toBeNull();
  });

  it('treats a 4xx as missing — hidden, with no badge and no event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = loadedWith(
      'https://example.org/bad.json',
      () => ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response)
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // 4xx ≈ "no data for this entity": no badge, and no track-fetch event.
    expect(target.querySelector(BADGE)).toBeNull();
    expect(events.some((e) => e.detail.phase === 'track-fetch')).toBe(false);
  });
});

// ── retry ─────────────────────────────────────────────────────────

describe('retry affordance', () => {
  it('re-runs the data load when the badge Retry button is clicked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')])
    );

    await el._loadData();
    const target = renderTarget(el);

    const retry = target.querySelector<HTMLButtonElement>(`.${CSS_PREFIX}-error-retry`)!;
    expect(retry).not.toBeNull();

    const loadSpy = vi
      .spyOn(el, '_loadData')
      .mockImplementation(() => Promise.resolve());
    retry.click();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    // Targeted: reloads only the failed track, not the whole viewer.
    const arg = loadSpy.mock.calls[0][0] as Set<string> | undefined;
    expect(arg).toBeInstanceOf(Set);
    expect([...(arg as Set<string>)]).toEqual(['g-bad']);
  });

  it('re-fetches only the target track, not its siblings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      return url.includes('/bad')
        ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
          } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },

      rows: [
        {
          id: 'g1',
          label: 'G1',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('a', 'https://example.org/a.json')],
        },
        {
          id: 'g2',
          label: 'G2',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('bad', 'https://example.org/bad.json')],
        },
      ],
    };
    const el = buildLoaded(config, { hasData: true });
    await el._loadData();
    expect(el._trackErrors.has('g2-bad')).toBe(true);

    fetchMock.mockClear();
    await el._loadData(new Set(['g2-bad']));

    const fetched = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetched.some((u) => u.includes('/bad.json'))).toBe(true);
    expect(fetched.some((u) => u.includes('/a.json'))).toBe(false); // sibling untouched
  });

  it('clears a track error when a retry succeeds, leaving other errors intact', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let badAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/bad')) {
          badAttempts += 1;
          return badAttempts === 1
            ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
            : ({
                ok: true,
                status: 200,
                json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
              } as unknown as Response);
        }
        // a second, independently-failing track
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      })
    );

    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },

      rows: [
        {
          id: 'g1',
          label: 'G1',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('bad', 'https://example.org/bad.json')],
        },
        {
          id: 'g2',
          label: 'G2',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('down', 'https://example.org/down.json')],
        },
      ],
    };
    const el = buildLoaded(config, { hasData: false });
    await el._loadData();
    expect(el._trackErrors.has('g1-bad')).toBe(true);
    expect(el._trackErrors.has('g2-down')).toBe(true);

    await el._loadData(new Set(['g1-bad']));
    // Retried track cleared; the untouched track's error survives.
    expect(el._trackErrors.has('g1-bad')).toBe(false);
    expect(el._trackErrors.has('g2-down')).toBe(true);
  });

  it('clears stale track data when a reload produces none (no ghost data under a badge)', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A `from: custom` track: has data initially, then the injected data
    // is removed. On reload the loader early-returns without writing
    // `data[key]` — the merge must NOT keep the previous value.
    const el = buildLoaded(normConfig([customTrack('c')]), {
      customTrackData: { 'g-c': [{ type: 'DOMAIN', start: 1, end: 10 }] },
      hasData: true,
    });
    await el._loadData();
    expect(el.data['g-c']).toBeDefined();

    el.customTrackData = {};
    await el._loadData(new Set(['g-c'])); // targeted reload
    expect(el.data['g-c']).toBeUndefined();
  });

  it('a full reload also drops a track that no longer produces data', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('c')]), {
      customTrackData: { 'g-c': [{ type: 'DOMAIN', start: 1, end: 10 }] },
      hasData: true,
    });
    await el._loadData();
    expect(el.data['g-c']).toBeDefined();

    el.customTrackData = {};
    await el._loadData(); // full reload
    expect(el.data['g-c']).toBeUndefined();
  });

  it('offers Retry only for recoverable failures (network / 5xx), not 4xx', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/gone')) {
          return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
        }
        if (url.includes('/down')) {
          return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
        }
        if (url.includes('/blocked')) {
          throw new TypeError('Failed to fetch');
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      })
    );

    const el = buildLoaded(
      normConfig([
        urlTrack('gone', 'https://example.org/gone.json'), // 404 → missing, hidden entirely
        urlTrack('down', 'https://example.org/down.json'), // 503 → broken, recoverable
        urlTrack('blocked', 'https://example.org/blocked.json'), // network → broken, recoverable
      ]),
      { openGroups: ['g'] }
    );

    await el._loadData();
    const target = renderTarget(el);

    // The 404 is "missing" → no badge; only the two "broken" tracks surface…
    expect(target.querySelectorAll(BADGE).length).toBe(2);
    // …and both the 503 and network failures offer a Retry button.
    expect(
      target.querySelectorAll(`.${CSS_PREFIX}-error-retry`).length
    ).toBe(2);
  });

  it('two disjoint targeted retries do not cancel each other', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        healthy
          ? ({
              ok: true,
              status: 200,
              json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
            } as unknown as Response)
          : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
      )
    );

    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },
      rows: [
        {
          id: 'g1',
          label: 'G1',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('a', 'https://example.org/a.json')],
        },
        {
          id: 'g2',
          label: 'G2',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [urlTrack('b', 'https://example.org/b.json')],
        },
      ],
    };
    const el = buildLoaded(config, { hasData: true });

    await el._loadData();
    expect(el._trackErrors.has('g1-a')).toBe(true);
    expect(el._trackErrors.has('g2-b')).toBe(true);

    // Service recovers, then fire two targeted retries for tracks in
    // different groups "simultaneously" (no await between). A single
    // shared AbortController would abort the first before it committed —
    // its badge would silently stay stale. Disjoint key-sets must run
    // concurrently instead.
    healthy = true;
    const p1 = el._loadData(new Set(['g1-a']));
    const p2 = el._loadData(new Set(['g2-b']));
    await Promise.all([p1, p2]);

    // Neither retry was dropped: both errors cleared and both tracks
    // committed their data.
    expect(el._trackErrors.has('g1-a')).toBe(false);
    expect(el._trackErrors.has('g2-b')).toBe(false);
    expect(el.data['g1-a']).toBeDefined();
    expect(el.data['g2-b']).toBeDefined();
  });

  it('two concurrent per-track retries in the SAME group keep both in the aggregate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (!healthy) {
          return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
        }
        // Distinct feature per track so we can tell them apart in the aggregate.
        const type = url.includes('/a.json') ? 'A' : 'B';
        return {
          ok: true,
          status: 200,
          json: async () => ({ features: [{ type, begin: '1', end: '2' }] }),
        } as unknown as Response;
      })
    );

    // ONE group with TWO url tracks. Their per-track retry keys (g-a, g-b)
    // are disjoint, so the two retries run concurrently — but they share a
    // group aggregate `data['g']`.
    const el = buildLoaded(
      normConfig([
        urlTrack('a', 'https://example.org/a.json'),
        urlTrack('b', 'https://example.org/b.json'),
      ]),
      { hasData: true }
    );

    await el._loadData();
    expect(el._trackErrors.has('g-a')).toBe(true);
    expect(el._trackErrors.has('g-b')).toBe(true);

    // Both recover; fire both per-track retries with no await between. Each
    // snapshots `this.data` before the other commits, so a snapshot-derived
    // group aggregate would clobber to the last writer, dropping one track.
    healthy = true;
    await Promise.all([
      el._loadData(new Set(['g-a'])),
      el._loadData(new Set(['g-b'])),
    ]);

    // Per-track keys correct AND the group aggregate holds BOTH tracks.
    expect(el.data['g-a']).toBeDefined();
    expect(el.data['g-b']).toBeDefined();
    const aggregate = el.data['g'] as Array<{ type?: string }>;
    expect(Array.isArray(aggregate)).toBe(true);
    const types = aggregate.map((f) => f.type).sort();
    expect(types).toEqual(['A', 'B']);
  });
});

// ── strict mode ───────────────────────────────────────────────────

describe('strict mode', () => {
  it('promotes a per-track fetch failure to the mount panel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], { strict: true })
    );

    await el._loadData();
    const target = renderTarget(el);

    const panel = target.querySelector(PANEL)!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('alert');
  });

  it('aggregates multiple failures into a single panel (no last-writer-wins)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 502 }],
      ['/b.json', { ok: false, status: 500 }],
    ]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig(
        [urlTrack('a', 'https://example.org/a.json'), urlTrack('b', 'https://example.org/b.json')],
        { strict: true }
      )
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    // One panel summarising both, not just the last track's message.
    const panels = target.querySelectorAll(PANEL);
    expect(panels.length).toBe(1);
    expect(panels[0].textContent).toMatch(/2 tracks failed to load/);
    // But still one event per failed track for embedders.
    expect(events.filter((e) => e.detail.phase === 'track-fetch').length).toBe(2);
  });

  it('offers Retry on the aggregated panel for a recoverable (5xx) failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 503 }]]);

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], {
        strict: true,
      })
    );

    await el._loadData();
    const target = renderTarget(el);

    // A transient failure is retryable everywhere else — the strict panel
    // must offer the same affordance rather than only Dismiss.
    const panel = target.querySelector(PANEL)!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();
  });

  it('omits Retry on the aggregated panel when every failure is non-recoverable (parse)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 200 OK but an unparseable body → `parse` kind: deterministic, so no
    // Retry (re-parsing the same bytes changes nothing).
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('bad json');
            },
          }) as unknown as Response
      )
    );

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], {
        strict: true,
      })
    );

    await el._loadData();
    const target = renderTarget(el);

    const panel = target.querySelector(PANEL)!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();
  });

  it('clicking the aggregated-panel Retry re-runs the load and tears the panel down on recovery', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let trackHealthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // The one track: 5xx until the service recovers.
        return trackHealthy
          ? ({
              ok: true,
              status: 200,
              json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
            } as unknown as Response)
          : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
      })
    );

    const el = mountEl({
      viewerConfig: {
        strict: true,
        rows: [
          { id: 'g', tracks: [{ id: 'bad', kind: 'features', data: 'https://example.org/bad.json' }] },
        ],
      },
      accession: 'P05067',
    });

    // Strict raises the aggregated panel with a Retry (5xx is recoverable).
    const retry = await vi.waitFor(() => {
      const btn = el.querySelector<HTMLButtonElement>(
        `${PANEL} .${CSS_PREFIX}-error-retry`
      );
      if (!btn) throw new Error('strict retry not ready');
      return btn;
    });

    // Service recovers, then the user clicks Retry → _retryMount re-runs the
    // whole load; the track succeeds, so the strict panel is cleared.
    trackHealthy = true;
    retry.click();

    await vi.waitFor(() => {
      if (el.querySelector(PANEL)) throw new Error('panel still present');
    });
    expect((el as unknown as El)._mountError).toBeNull();
    expect((el as unknown as El)._trackErrors.size).toBe(0);
    expect(el.data['g-bad']).toBeDefined();
  });

  it('a successful reload clears a previously-raised aggregated panel (track-fetch clear branch)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let healthy = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        healthy
          ? ({
              ok: true,
              status: 200,
              json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
            } as unknown as Response)
          : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
      )
    );

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')], {
        strict: true,
      }),
      { hasData: true }
    );

    await el._loadData();
    // Panel is up under strict while the track is failing.
    expect(el._mountError).not.toBeNull();
    expect(el._mountError!.phase).toBe('track-fetch');

    // A subsequent successful reload must clear the aggregated panel via the
    // `phase === 'track-fetch'` clear branch in _collectTrackErrors.
    healthy = true;
    await el._loadData();
    expect(el._mountError).toBeNull();
  });
});

// ── collapsed / partial-failure surfacing ─────────────────────────

describe('collapsed group surfacing', () => {
  it('shows a group badge for a partial failure on a collapsed, dataless group (no blank viewer)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // One track 5xx-fails (visible), the other returns 200-but-empty
    // (not a failure) → group is NOT "all failed", and it's collapsed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/bad')
          ? ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
      )
    );

    const el = buildLoaded(
      normConfig([
        urlTrack('bad', 'https://example.org/bad.json'),
        urlTrack('empty', 'https://example.org/empty.json'),
      ]),
      { hasData: false, openGroups: [] } // collapsed
    );

    await el._loadData();
    const target = renderTarget(el);

    expect(el._groupErrors.has('g')).toBe(false); // not all failed
    // …but the failure is still surfaced, and not as the blank no-results.
    expect(target.querySelector(BADGE)).not.toBeNull();
    expect(target.querySelector('.protvista-no-results')).toBeNull();
  });
});

// ── aggregate data hygiene ────────────────────────────────────────

describe('aggregate data hygiene', () => {
  it('an all-failed canvas group renders the minimal error row, not an aggregate over holes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    // A standard (canvas) group whose only track 5xx-fails. Its flattened
    // aggregate is `[undefined]` before filtering — truthy-but-holey.
    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
      { hasData: false, openGroups: [] }
    );

    await el._loadData();

    // The aggregate is a clean empty array — no `undefined` slot leaks to
    // Nightingale's `.data` setter.
    expect(el.data['g']).toEqual([]);

    const target = renderTarget(el);
    // Routed through `renderGroupErrorRow`: header + ⚠ badge, and crucially
    // NO aggregate content track (which the normal path would render).
    expect(target.querySelector(BADGE)).not.toBeNull();
    expect(
      target.querySelector(`.${CSS_PREFIX}-aggregate-track-content`)
    ).toBeNull();
  });

  it('a partial canvas-group failure leaves the surviving features but no holes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      return url.includes('/bad')
        ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ features: [{ type: 'X', begin: '1', end: '2' }] }),
          } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    // One group, two tracks: one succeeds, one 5xx-fails. The aggregate
    // used to be `[...features, undefined]`.
    const el = buildLoaded(
      normConfig([
        urlTrack('ok', 'https://example.org/ok.json'),
        urlTrack('bad', 'https://example.org/bad.json'),
      ]),
      { hasData: true }
    );

    await el._loadData();

    const aggregate = el.data['g'] as unknown[];
    expect(Array.isArray(aggregate)).toBe(true);
    expect(aggregate).not.toContain(undefined);
    expect(aggregate.length).toBeGreaterThan(0);
  });

  it('an EXPANDED all-failed group shows per-track badges and no populated aggregate track', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([
      ['/a.json', { ok: false, status: 500 }],
      ['/b.json', { ok: false, status: 500 }],
    ]);

    // Expanded (openGroups) all-failed group: falls through to the normal
    // per-track render, not the collapsed error row. Its aggregate is `[]`.
    const el = buildLoaded(
      normConfig([
        urlTrack('a', 'https://example.org/a.json'),
        urlTrack('b', 'https://example.org/b.json'),
      ]),
      { hasData: false, openGroups: ['g'] }
    );

    await el._loadData();
    expect(el.data['g']).toEqual([]);

    const target = renderTarget(el);
    // Per-track rows each carry a ⚠ badge (the group badge is suppressed
    // while expanded).
    expect(target.querySelectorAll(BADGE).length).toBe(2);
    // The aggregate content div is present but renders NO inner track over
    // the empty `[]` (the gate is `hasRenderableData`, not a bare truthy
    // check — an empty array is truthy but has nothing to draw).
    const aggregate = target.querySelector(
      `.${CSS_PREFIX}-aggregate-track-content`
    );
    expect(aggregate).not.toBeNull();
    expect(aggregate!.querySelector('*')).toBeNull();
  });
});

// ── per-instance id uniqueness ────────────────────────────────────

describe('badge id uniqueness across instances', () => {
  it('gives two viewers distinct aria-describedby ids for the same track', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad', { ok: false, status: 500 }]]);

    const describedById = async () => {
      const el = buildLoaded(
        normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
        { openGroups: [] }
      );
      await el._loadData();
      const target = renderTarget(el);
      return target.querySelector(BADGE)!.getAttribute('aria-describedby')!;
    };

    const [id1, id2] = [await describedById(), await describedById()];
    expect(id1).not.toBe(id2);
    expect(id1).not.toMatch(/\s/);
  });
});

// ── setTrackData misuse ───────────────────────────────────────────

describe('setTrackData misuse', () => {
  it('fires phase:set-track-data for an unknown track', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('ok')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'does-not-exist', [{ type: 'X' }]);

    const ev = events.find((e) => e.detail.phase === 'set-track-data');
    expect(ev).toBeDefined();
    expect(ev!.detail.context.trackId).toBe('does-not-exist');
  });

  it('fires phase:set-track-data for a primitive value', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('ok')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'ok', 42);

    expect(events.some((e) => e.detail.phase === 'set-track-data')).toBe(true);
  });
});

// ── render handover ───────────────────────────────────────────────

describe('a component rejecting its payload', () => {
  /** An element whose `data` setter throws, like a real mismatched track. */
  const exploding = () => ({
    set data(_v: unknown) {
      throw new TypeError('undefined is not iterable');
    },
  });

  it('badges the row and fires the event, not just a console line', async () => {
    // The last step of the pipeline, and the one that used to be console-only:
    // the payload was built fine and the Nightingale element could not read
    // it. The message ends with advice for whoever wrote the data, which is
    // exactly the audience a console-only report misses.
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // An expanded group with an aggregate: the group badge stands down there,
    // so the badge under test is unambiguously the track's own.
    const el = buildLoaded(normConfig([customTrack('t')]), {
      openGroups: ['g'],
      hasData: true,
      data: { g: [{ type: 'DOMAIN' }], 'g-t': [{ type: 'DOMAIN' }] },
    });
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g-t');
    const target = renderTarget(el);

    const badges = target.querySelectorAll(BADGE);
    expect(badges).toHaveLength(1);
    const badge = badges[0];
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toContain(
      "track 'g-t' could not render the data it was given"
    );
    // Deterministic — the same payload will not read better on a second go.
    expect(target.querySelector(`.${CSS_PREFIX}-error-retry`)).toBeNull();

    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.errorKind).toBe('render');
    expect(tf.detail.context.trackId).toBe('t');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('does not take the other tracks down with it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(
      normConfig([customTrack('bad'), customTrack('good')])
    );
    const received: unknown[] = [];
    const healthy = {
      set data(v: unknown) {
        received.push(v);
      },
    };

    el._assignComponentData(exploding(), [{ position: 1 }], 'g-bad');
    el._assignComponentData(healthy, [{ position: 2 }], 'g-good');

    expect(received).toEqual([[{ position: 2 }]]);
    expect(el._trackErrors.has('g-bad')).toBe(true);
    expect(el._trackErrors.has('g-good')).toBe(false);
  });

  it('reports once, not on every re-push', async () => {
    // The push walk re-runs whenever a group expands or data changes, and the
    // same payload fails the same way each time. Re-firing the event on every
    // expand would be noise over a badge that is already up.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    for (let i = 0; i < 3; i += 1) {
      el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g-t');
    }

    expect(events).toHaveLength(1);
  });

  it('promotes to the panel under strict', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')], { strict: true }));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g-t');

    expect(el._mountError?.phase).toBe('track-fetch');
    expect(el._mountError?.summary).toContain("Track 'g/t' failed to load");
  });

  it("attributes a collapsed group's aggregate to the row, not to a track", async () => {
    // The push walk hands over two key shapes. A bare row id is the aggregate
    // a collapsed group draws every track from — there is no one track to
    // blame, so the group badge carries the message and the event omits
    // `trackId` rather than reporting it as null.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]), {
      data: { g: [{ type: 'DOMAIN' }] },
      hasData: true,
    });
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'g');
    const target = renderTarget(el);

    expect(el._trackErrors.get('g')!.trackId).toBeNull();
    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    expect(tf.detail.context.groupId).toBe('g');
    expect('trackId' in tf.detail.context).toBe(false);

    const badge = target.querySelector(BADGE)!;
    expect(badge).not.toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    // The aggregate's own message, not the generic "Some tracks…" count.
    expect(target.querySelector(`[id="${descId}"]`)!.textContent).toContain(
      'could not render the data it was given'
    );
  });

  it('still reports a key that matches no row, without promising a badge', async () => {
    // The walk and the config disagreeing should not happen — and if it does,
    // going unreported is the one outcome worse than having no row to badge.
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')]));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el._assignComponentData(exploding(), [{ type: 'DOMAIN' }], 'nonexistent');

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(el._trackErrors.has('nonexistent')).toBe(false);
    expect(el._mountError).toBeNull();
  });
});

// ── what the event itself carries ─────────────────────────────────

describe('the protvista-error payload', () => {
  it('carries the message on every phase, matching the visible surface', async () => {
    // One listener covers every flavour — so every flavour has to say what
    // happened, not just which bucket it fell into. The badge, the panel, the
    // console line and this field all come from one string.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/bad.json', { ok: false, status: 503 }]]);
    const events: ErrorEvent[] = [];

    const el = buildLoaded(
      normConfig([urlTrack('bad', 'https://example.org/bad.json')]),
      { openGroups: ['g'] }
    );
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await el._loadData();
    const target = renderTarget(el);

    const tf = events.find((e) => e.detail.phase === 'track-fetch')!;
    const descId = target
      .querySelector(BADGE)!
      .getAttribute('aria-describedby')!;
    expect(tf.detail.message).toBe(
      target.querySelector(`[id="${descId}"]`)!.textContent
    );
    expect(tf.detail.source).toBe('https://example.org/bad.json');
  });

  it('carries the sequence-panel wording an embedder would otherwise re-invent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch([['/proteins/api/proteins/', { ok: false, status: 404 }]]);
    const events: ErrorEvent[] = [];

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067X' });
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    await vi.waitFor(() => {
      if (!events.some((e) => e.detail.phase === 'sequence')) {
        throw new Error('no sequence event yet');
      }
    });

    const seq = events.find((e) => e.detail.phase === 'sequence')!;
    expect(seq.detail.message).toContain('P05067X');
    expect(typeof seq.detail.message).toBe('string');
  });

  it('omits source when the failure had no URL or path to name', async () => {
    // An adapter failure on an inline / custom source has nowhere to point.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: ErrorEvent[] = [];
    const el = buildLoaded(normConfig([customTrack('t')]));
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'nope', [{ type: 'DOMAIN' }]);

    expect(events[0].detail.message).toContain('setTrackData');
    expect('source' in events[0].detail).toBe(false);
  });
});

// ── routing matrix ────────────────────────────────────────────────

/**
 * Every failure class the viewer has, and the channels each one reaches.
 *
 * This is the test the old ad-hoc routing could not have: routing lived as a
 * conditional at each failure site, so "which failures reach a user" was only
 * answerable by reading eight call sites and hoping. Several of them answered
 * "none" — a 4xx reaching nothing, an adapter throw reaching only the console,
 * a badge appearing on grouped rows but not standalone ones. Now one table in
 * `src/errors/router.ts` decides, and this walks every class through it.
 *
 * `src/errors/__spec__/router.spec.ts` pins the table itself (totality, the
 * published documentation, the one place `strict` is read). This pins that the
 * failures actually get there. The two classes that cannot be driven through
 * `_loadData` have their own blocks: the render handover above, and the
 * viewer-scoped config / sequence / `setTrackData` failures below.
 */

/** The channels a class is expected to reach, lax and under `strict`. */
type Expected = {
  /** `protvista-error` phase, or `null` for a class that deliberately fires none. */
  phase: string | null;
  /** The `⚠` badge, when there is a viewer to draw it in (see below). */
  badge: boolean;
  retry: boolean;
  /** Panel without `strict`, and with it. */
  panel: [lax: boolean, strict: boolean];
  consoleLevel: 'error' | 'warn' | 'info';
  /** The routed console line, which must appear exactly once at that level. */
  consoleMatch: RegExp;
};

describe('routing matrix — track-scoped failures', () => {
  const BAD_CSV = 'type,start,end,description\nDOMAIN,abc,25,Kinase domain';

  const cases: Array<{
    name: string;
    config: (strict: boolean) => NormalizedConfig;
    routes: Parameters<typeof stubFetch>[0];
    expected: Expected;
  }> = [
    {
      name: 'network error (unreachable, blocked, CORS)',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      // No route matches, so the stub resolves 200 — overridden below.
      routes: [],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /Couldn't reach https:\/\/example\.org\/x\.json/,
      },
    },
    {
      name: 'HTTP 5xx (server failing)',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      routes: [['/x.json', { ok: false, status: 503 }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: true,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /HTTP 503 — https:\/\/example\.org\/x\.json/,
      },
    },
    {
      name: 'HTTP 4xx from a provider endpoint (missing, not broken)',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      routes: [['/x.json', { ok: false, status: 404 }]],
      expected: {
        phase: null,
        badge: false,
        retry: false,
        panel: [false, false],
        consoleLevel: 'info',
        consoleMatch: /track g\/t: no data \(HTTP 404\)/,
      },
    },
    {
      name: 'HTTP 4xx from a from: file path (broken path)',
      config: (strict) =>
        normConfig([fileTrack('t', './hits.csv')], { strict }),
      routes: [['/hits.csv', { ok: false, status: 404 }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /\.\/hits\.csv could not be found \(HTTP 404\)/,
      },
    },
    {
      name: 'unparseable body',
      config: (strict) =>
        normConfig([urlTrack('t', 'https://example.org/x.json')], { strict }),
      routes: [['/x.json', { ok: true, status: 200, unreadable: true }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /Unparseable response from https:\/\/example\.org\/x\.json/,
      },
    },
    {
      name: 'malformed file the decoder rejected',
      config: (strict) =>
        normConfig([fileTrack('t', './hits.csv')], { strict }),
      routes: [['/hits.csv', { ok: true, status: 200, body: BAD_CSV }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /row 2, column "start": expected a number, got "abc"/,
      },
    },
    {
      name: 'unregistered adapter name',
      config: (strict) => {
        const config = normConfig(
          [urlTrack('t', 'https://example.org/x.json')],
          { strict }
        );
        config.rows[0].tracks[0].data[0].adapter = 'nope-not-registered';
        return config;
      },
      routes: [['/x.json', { ok: true, status: 200, body: { features: [] } }]],
      expected: {
        phase: 'track-fetch',
        badge: true,
        retry: false,
        panel: [false, true],
        consoleLevel: 'warn',
        consoleMatch: /No adapter registered for 'nope-not-registered'/,
      },
    },
    {
      name: 'from: custom with nothing injected',
      config: (strict) => normConfig([customTrack('t')], { strict }),
      routes: [],
      expected: {
        phase: null,
        badge: false,
        retry: false,
        panel: [false, false],
        consoleLevel: 'info',
        consoleMatch: /Track g\/t is 'from: custom' but no data was provided/,
      },
    },
  ];

  for (const { name, config, routes, expected } of cases) {
    for (const strict of [false, true]) {
      const label = strict ? `${name} [strict]` : name;
      it(`routes ${label}`, async () => {
        const spies = {
          error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
          warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
          info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
        };
        if (name.startsWith('network')) {
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
              throw new TypeError('Failed to fetch');
            })
          );
        } else {
          stubFetch(routes);
        }
        const events: ErrorEvent[] = [];

        const el = buildLoaded(config(strict), { openGroups: ['g'] });
        el.addEventListener('protvista-error', (e) =>
          events.push(e as ErrorEvent)
        );

        await el._loadData();
        const target = renderTarget(el);

        // Event channel.
        const fired = events.filter((e) => e.detail.phase === 'track-fetch');
        if (expected.phase === null) {
          expect(fired, 'should fire no event').toHaveLength(0);
        } else {
          expect(fired, 'should fire one event').toHaveLength(1);
          expect(fired[0].detail.context.trackId).toBe('t');
        }

        // Panel channel — the only one `strict` moves.
        const panelUp = expected.panel[strict ? 1 : 0];
        expect(el._mountError?.phase === 'track-fetch', 'panel').toBe(panelUp);

        // Badge + Retry channels. The panel *replaces* the viewer, so when
        // one is up there is no row to carry a badge — that is the panel's
        // whole job. Assert the badge where the viewer renders, and the
        // viewer's absence where it does not.
        if (panelUp) {
          expect(target.querySelector(BADGE), 'panel replaces the row').toBeNull();
          expect(target.querySelector(PANEL)).not.toBeNull();
        } else {
          expect(!!target.querySelector(BADGE), 'badge').toBe(expected.badge);
          expect(
            !!target.querySelector(`.${CSS_PREFIX}-error-retry`),
            'retry'
          ).toBe(expected.retry);
        }

        // Developer channel: the routed line appears exactly once, at the
        // routed level, and at no other level. Two copies would mean a site
        // still reporting for itself beside the router.
        //
        // Counting *all* console calls would be wrong here: the generic-format
        // decoders emit their own per-body diagnostics on the way to returning
        // empty (`specs/generic-format-adapters.md` — "diagnostic
        // console.warns, not exceptions"). Those degrade a row rather than
        // failing a track and are not part of this pipeline, so the assertion
        // is about the routed line specifically.
        const atLevel = (level: 'error' | 'warn' | 'info') =>
          spies[level].mock.calls.filter((c) =>
            expected.consoleMatch.test(String(c[0]))
          );
        for (const level of ['error', 'warn', 'info'] as const) {
          expect(atLevel(level), `routed line at console.${level}`).toHaveLength(
            level === expected.consoleLevel ? 1 : 0
          );
        }
      });
    }
  }
});

describe('routing matrix — viewer-scoped failures', () => {
  /** Mount, wait for the first `protvista-error`, and report what happened. */
  async function observe(props: Partial<El>): Promise<{
    el: El;
    events: ErrorEvent[];
  }> {
    const el = mountEl(props);
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));
    await vi.waitFor(() => {
      if (events.length === 0) throw new Error('no event yet');
    });
    return { el, events };
  }

  it('routes a config validation failure to the panel (always, strict or not)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { el, events } = await observe({
      viewerConfig: INVALID_CONFIG,
      accession: 'P05067',
    });
    expect(events[0].detail.phase).toBe('config');
    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });
  });

  it('routes a config warning to the event only, never the panel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const raise = vi.spyOn(
      customElements.get('protvista-uniprot')!.prototype as {
        _setMountError(phase: string): void;
      },
      '_setMountError'
    );
    const { events } = await observe({
      viewerConfig: {
        strict: true,
        rows: [
          {
            id: 'g',
            tracks: [
              {
                id: 'y',
                kind: 'features',
                data: { from: 'file', url: './hits.tsv', format: 'csv' },
              },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    expect(events[0].detail.phase).toBe('config');
    expect(events[0].detail.issues.map((i) => i.severity)).toEqual(['warning']);
    expect(raise.mock.calls.map(([phase]) => phase)).not.toContain('config');
  });

  it('routes an unresolvable theme field to the event only', async () => {
    // Previously console-only, which made it the one config problem an
    // embedder's single listener could not see.
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { events } = await observe({
      viewerConfig: {
        theme: { accentColor: 'not-a-colour' },
        rows: [
          {
            id: 'g',
            tracks: [
              { id: 'y', kind: 'features', data: 'https://example.org/x.json' },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    const cfg = events.find((e) => e.detail.phase === 'config')!;
    expect(cfg).toBeDefined();
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('Ignoring theme.accentColor')
      )
    ).toBe(true);
  });

  it('routes a setTrackData misuse to the event only, never the panel', async () => {
    // A misused escape hatch is the embedder's bug, not a broken config: the
    // viewer still renders everything it was given, so `strict` has nothing
    // to promote. The event names the track so the embedder can act on it.
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const el = buildLoaded(normConfig([customTrack('t')], { strict: true }));
    const events: ErrorEvent[] = [];
    el.addEventListener('protvista-error', (e) => events.push(e as ErrorEvent));

    el.setTrackData('g', 'nope', [{ type: 'DOMAIN' }]);

    expect(events.map((e) => e.detail.phase)).toEqual(['set-track-data']);
    expect(el._mountError).toBeNull();
    expect(warn.mock.calls.length).toBe(1);
  });
});

// ── format helper ─────────────────────────────────────────────────

describe('formatValidationIssues', () => {
  it('groups issues by path in first-seen order', () => {
    const issues: ValidationIssue[] = [
      { path: 'g/y', message: 'bad kind', code: 'unknown-semantic-kind' },
      { path: 'g/z', message: 'no source', code: 'unknown-source-key' },
      { path: 'g/y', message: 'also bad', code: 'schema' },
    ];
    const f = formatValidationIssues(issues);
    expect(f.summary).toBe('Config validation failed (3 issues):');
    expect(f.groups.map((g) => g.path)).toEqual(['g/y', 'g/z']);
    expect(f.groups[0].items).toHaveLength(2);
    expect(f.raw).toBe(issues);
  });

  it('uses the singular summary for a single issue', () => {
    const f = formatValidationIssues([{ path: 'a', message: 'm', code: 'schema' }]);
    expect(f.summary).toBe('Config validation failed (1 issue):');
  });
});

// ── adapter-throw resilience ──────────────────────────────────────

describe('adapter throw resilience', () => {
  it('a throwing adapter degrades only its own track — the load completes so errors still surface', async () => {
    const config: NormalizedConfig = {
      version: '1.0',
      sources: {},
      defaults: { rendering: {} },
      rows: [
        {
          id: 'GOOD',
          label: 'Good',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [
            {
              id: 'ok',
              label: 'ok',
              kind: 'features',
              component: 'nightingale-track-canvas',
              rendering: {},
              data: [{ from: 'url', url: 'https://x/ok.json', adapter: 'good' }],
            },
          ],
        },
        {
          id: 'BOOM',
          label: 'Boom',
          component: 'nightingale-track-canvas',
          rendering: {},
          tracks: [
            {
              id: 'bang',
              label: 'bang',
              kind: 'features',
              component: 'nightingale-track-canvas',
              rendering: {},
              data: [{ from: 'url', url: 'https://x/boom.json', adapter: 'boom' }],
            },
          ],
        },
      ],
    };

    const fetchOne = vi.fn(async () => ({ features: [{ type: 'X' }] }));
    const adapters: AdapterMap = {
      good: (d: { features?: unknown[] }) => d.features ?? [],
      boom: () => {
        throw new Error('adapter blew up');
      },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Must NOT reject even though the `boom` adapter throws.
    const res = await loadProtvistaData(
      'P05067',
      config,
      fetchOne,
      (name) => adapters[name]
    );

    expect(res.data['GOOD-ok']).toBeDefined(); // healthy track loaded
    expect(res.data['BOOM-bang']).toBeUndefined(); // throwing track degraded to empty
  });
});

// ── full-config integration: a blocked track surfaces, doesn't vanish ──

describe('blocked track in the bundled default config', () => {
  it('keeps the group present with an error badge (canvas + linegraph groups)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // No viewerConfig → the element loads the bundled default-config.yaml.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        // Block the two tracks the user reported vanishing.
        if (url.includes('/antigen/') || url.includes('/variation/')) {
          throw new TypeError('Failed to fetch');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [{ type: 'DOMAIN', begin: '1', end: '5' }],
            sequence: 'MSEQENCE',
          }),
        } as unknown as Response;
      })
    );

    // Broken (network) failures surface by default — no opt-in needed.
    // The accession attribute MUST be set before the element connects, or
    // `_init()` runs without an accession.
    const el = document.createElement('protvista-uniprot');
    el.setAttribute('accession', 'P05067');
    document.body.append(el);
    appended.push(el);

    await vi.waitFor(
      () => {
        if (el.querySelectorAll(BADGE).length < 2) {
          throw new Error('badges not ready');
        }
      },
      { timeout: 3000 }
    );

    // ANTIGEN (single features track → canvas group) stays present…
    const antigen = el.querySelector<HTMLElement>(
      `#${CSS_PREFIX}-group_ANTIGEN`
    );
    // …and VARIATION (a linegraph group whose aggregate is undefined when
    // blocked) is rendered via the group-error row rather than vanishing.
    const variation = el.querySelector<HTMLElement>(
      `#${CSS_PREFIX}-group_VARIATION`
    );
    expect(antigen).not.toBeNull();
    expect(variation).not.toBeNull();
    // Both carry a ⚠ badge.
    expect(el.querySelectorAll(BADGE).length).toBeGreaterThanOrEqual(2);

    // Critically: groups are `display: none` by default and revealed
    // imperatively; an error-only group must be revealed too, or its
    // badge is in the DOM but invisible (the "it disappeared" bug).
    await vi.waitFor(
      () => {
        if (
          antigen!.style.display !== 'flex' ||
          variation!.style.display !== 'flex'
        ) {
          throw new Error('error groups not revealed yet');
        }
      },
      { timeout: 3000 }
    );
  });
});
