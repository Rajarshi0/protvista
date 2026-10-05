/**
 * `<protvista-uniprot>` — `data-*` template variables, end to end.
 *
 * The host's `data-*` attributes feed `{token}` substitution in data URLs
 * (precedence: config `variables:` < `data-*` < named `accession`). A
 * `MutationObserver` re-runs the loader when one changes. This drives the
 * real mount lifecycle (`viewerConfig` → `_init()` → `_loadData()`) with a
 * stubbed `fetch` and a hand-cranked `requestAnimationFrame`, and pins:
 *
 *   • the first load reads `data-*` at fetch time, and the mount-time
 *     validation knows about them (no spurious `missing-variable`);
 *   • a post-mount change re-runs the loader exactly once, against the
 *     new URL, aborting the superseded batch;
 *   • a burst of changes in one tick coalesces to a single load;
 *   • changes that can't affect any URL don't reload — an unrelated
 *     `data-testid`, a same-value write, a value the config's baseline
 *     already had, or a `data-accession` shadowed by the named attribute;
 *   • the named `accession` attribute keeps its own `_init()` path (the
 *     observer doesn't double-load it);
 *   • removing an attribute the URL needs skips the fetch with a warning;
 *   • a detached element schedules nothing and loads nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import '../protvista-uniprot.js';
import type { NormalizedConfig } from '../schema/normalize.js';
import type { ValidationIssue } from '../schema/errors.js';

type El = HTMLElement & {
  config?: NormalizedConfig;
  viewerConfig?: unknown;
  accession?: string;
  suspend?: boolean;
  loading: boolean;
  _init(): Promise<void>;
  _loadData(only?: Set<string>): Promise<void>;
  /** Pending variables-reload frame handle (private; read for assertions). */
  _variablesFrame?: number;
  _onVariablesChanged(): void;
};

const TEMPLATE =
  'https://api.example.org/{species}/{build}/features/{accession}';
const urlFor = (species: string, build = 'v2024.12', accession = 'P05067') =>
  `https://api.example.org/${species}/${build}/features/${accession}`;

const viewerConfig = {
  variables: { build: 'v2024.12' },
  sources: { features: TEMPLATE },
  rows: [
    { id: 'G', tracks: [{ id: 't', kind: 'features', data: 'features' }] },
  ],
};

// ── Hand-cranked requestAnimationFrame ─────────────────────────
// Other code on the page schedules frames too (`timing-functions`'
// `frame()`), so assertions about *this* feature read the element's own
// `_variablesFrame` handle rather than counting global rAF calls.
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const rafSpy = vi.fn((cb: FrameRequestCallback) => {
  const id = nextFrame++;
  frames.set(id, cb);
  return id;
});
const cafSpy = vi.fn((id: number) => {
  frames.delete(id);
});
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(performance.now());
}
/** Let MutationObserver records (microtasks) deliver. */
const settle = () => new Promise((r) => setTimeout(r, 0));

// ── Fetch stub ─────────────────────────────────────────────────
type FetchCall = { url: string; signal?: AbortSignal };
let calls: FetchCall[];
/** URLs whose response is held until `release()` (to observe aborts). */
let hang: Set<string>;
let held: Array<() => void>;
/** Answer every held request (an aborted batch's answer is dropped). */
function release() {
  for (const answer of held.splice(0)) answer();
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, signal: init?.signal ?? undefined });
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'MSEQENCE' } }
        : { features: [{ type: 'DOMAIN', start: 1, end: 2 }] };
      const response = {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
      if (hang.has(url)) {
        return new Promise((resolve) => held.push(() => resolve(response)));
      }
      return Promise.resolve(response);
    })
  );
}
const featureUrls = () =>
  calls
    .map((c) => c.url)
    .filter((u) => u.startsWith('https://api.example.org/'));

// ── Mount helpers ──────────────────────────────────────────────
const mounted: HTMLElement[] = [];
let errorIssues: ValidationIssue[];

function mount(
  attrs: Record<string, string> = { 'data-species': 'human' },
  {
    config = viewerConfig as object,
    accession = 'P05067' as string | null,
  } = {}
): El {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  if (accession !== null) el.setAttribute('accession', accession);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.viewerConfig = config;
  el.addEventListener('protvista-error', (e) => {
    errorIssues.push(...((e as CustomEvent).detail.issues ?? []));
  });
  document.body.append(el);
  mounted.push(el);
  return el;
}

/** Mount and wait for the first track-data load to have fetched. */
async function mountLoaded(
  attrs?: Record<string, string>,
  options?: Parameters<typeof mount>[1]
) {
  const el = mount(attrs, options);
  const load = vi.spyOn(el, '_loadData');
  await vi.waitFor(() => expect(el.config).toBeDefined());
  await vi.waitFor(() => expect(el.loading).toBe(false));
  load.mockClear();
  calls.length = 0;
  return { el, load };
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  calls = [];
  hang = new Set();
  held = [];
  errorIssues = [];
  rafSpy.mockClear();
  cafSpy.mockClear();
  vi.stubGlobal('requestAnimationFrame', rafSpy);
  vi.stubGlobal('cancelAnimationFrame', cafSpy);
  stubFetch();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<protvista-uniprot> data-* variables — first load', () => {
  it('substitutes data-*, config variables and accession into the URL', async () => {
    mount();
    await vi.waitFor(() => expect(featureUrls()).toEqual([urlFor('human')]));
  });

  it('does not report missing-variable for a token supplied via data-*', async () => {
    const el = mount();
    await vi.waitFor(() => expect(el.loading).toBe(false));
    expect(errorIssues.filter((i) => i.code === 'missing-variable')).toEqual(
      []
    );
  });

  it('reports missing-variable (as a warning) and skips the fetch when nothing supplies it', async () => {
    const el = mount({});
    await vi.waitFor(() => expect(el.loading).toBe(false));
    const missing = errorIssues.filter((i) => i.code === 'missing-variable');
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe('warning');
    expect(missing[0].message).toContain('data-species');
    expect(featureUrls()).toEqual([]);
  });

  it('a data-* value overrides the config variables baseline', async () => {
    mount({ 'data-species': 'human', 'data-build': 'v2025.01' });
    await vi.waitFor(() =>
      expect(featureUrls()).toEqual([urlFor('human', 'v2025.01')])
    );
  });

  it('reads a data-* set before the config finished loading at fetch time', async () => {
    const el = mount();
    // `_init()` is still resolving the config: no reload can run yet, but
    // the eventual first load must see the new value.
    expect(el.config).toBeUndefined();
    el.setAttribute('data-species', 'mouse');
    await settle();
    flushFrames();
    await vi.waitFor(() => expect(el.loading).toBe(false));
    expect(featureUrls()).toEqual([urlFor('mouse')]);
  });
});

describe('<protvista-uniprot> data-accession inside the element', () => {
  // `{accession}` always comes from the named attribute (or the config's
  // `accession:`); `data-accession` is honoured only by direct
  // `loadProtvistaData` callers.
  it('data-accession alone mounts nothing and fetches no feature URL', async () => {
    const el = mount(
      { 'data-species': 'human', 'data-accession': 'P05067' },
      { accession: null }
    );
    // With no protein at all the mount reports `missing-protein`, which
    // stands in for the `missing-accession` the `{accession}` URLs would
    // otherwise add: one problem, one issue.
    await vi.waitFor(() =>
      expect(errorIssues.some((i) => i.code === 'missing-protein')).toBe(true)
    );
    expect(errorIssues.some((i) => i.code === 'missing-accession')).toBe(false);
    await settle();
    expect(el.accession).toBeFalsy();
    expect(featureUrls()).toEqual([]);
  });

  it("the config's accession: wins over data-accession", async () => {
    mount(
      { 'data-species': 'human', 'data-accession': 'Q99999' },
      { accession: null, config: { ...viewerConfig, accession: 'P05067' } }
    );
    await vi.waitFor(() => expect(featureUrls()).toEqual([urlFor('human')]));
  });
});

describe('<protvista-uniprot> data-* variables — reactivity', () => {
  it('re-runs the loader once with the new URL when a data-* attribute changes', async () => {
    const { el, load } = await mountLoaded();
    el.setAttribute('data-species', 'mouse');
    await settle();
    expect(load).not.toHaveBeenCalled(); // deferred to the next frame
    flushFrames();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith();
    await vi.waitFor(() => expect(featureUrls()).toEqual([urlFor('mouse')]));
  });

  it('reloads a sequence-mode element too, which has no accession', async () => {
    // The gate is "a protein to load for", not "an accession".
    const { el, load } = await mountLoaded(
      { 'data-species': 'human' },
      {
        config: {
          sequence: 'MKTAYIAKQRMKTAYIAKQR',
          rows: [
            {
              id: 'G',
              tracks: [
                {
                  id: 't',
                  kind: 'features',
                  data: 'https://api.example.org/{species}/feed',
                },
              ],
            },
          ],
        },
        accession: null,
      }
    );
    expect(el.accession).toBeFalsy();
    el.setAttribute('data-species', 'mouse');
    await settle();
    flushFrames();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(featureUrls()).toEqual(['https://api.example.org/mouse/feed'])
    );
  });

  it('coalesces a burst of attribute changes into one load', async () => {
    const { el, load } = await mountLoaded();
    el.setAttribute('data-species', 'rat');
    el.setAttribute('data-build', 'v2025.01');
    el.setAttribute('data-species', 'mouse');
    const changed = vi.spyOn(el, '_onVariablesChanged');
    await settle();
    expect(el._variablesFrame).toBeDefined();
    flushFrames();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(featureUrls()).toEqual([urlFor('mouse', 'v2025.01')])
    );
  });

  it('aborts the superseded in-flight batch', async () => {
    hang.add(urlFor('human'));
    const el = mount();
    await vi.waitFor(() => expect(featureUrls()).toEqual([urlFor('human')]));
    const first = calls.find((c) => c.url === urlFor('human'))!;
    expect(first.signal?.aborted).toBe(false);

    el.setAttribute('data-species', 'mouse');
    await settle();
    flushFrames();
    expect(first.signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(el.loading).toBe(false));
    expect(featureUrls()).toContain(urlFor('mouse'));
  });

  it('a later burst after a load schedules a fresh frame', async () => {
    const { el, load } = await mountLoaded();
    el.setAttribute('data-species', 'mouse');
    await settle();
    flushFrames();
    el.setAttribute('data-species', 'rat');
    await settle();
    flushFrames();
    expect(load).toHaveBeenCalledTimes(2);
  });

  describe('a targeted retry during a full data-* reload', () => {
    const OTHER = 'https://api.example.org/{species}/other/{accession}';
    const otherFor = (species: string) =>
      `https://api.example.org/${species}/other/P05067`;
    const twoTracks = {
      ...viewerConfig,
      sources: { features: TEMPLATE, other: OTHER },
      rows: [
        {
          id: 'G',
          tracks: [
            { id: 't', kind: 'features', data: 'features' },
            { id: 't2', kind: 'features', data: 'other' },
          ],
        },
      ],
    };

    it('defers to the in-flight full load, so no track keeps the old values', async () => {
      const { el } = await mountLoaded(undefined, { config: twoTracks });
      hang.add(urlFor('mouse'));
      hang.add(otherFor('mouse'));
      el.setAttribute('data-species', 'mouse');
      await settle();
      flushFrames();
      await vi.waitFor(() => expect(held).toHaveLength(2));
      const fullLoad = calls.find((c) => c.url === urlFor('mouse'))!;

      // Retry one track while the full load is still in flight. Left
      // targeted, it would abort the full load and refetch only `G-t2`,
      // leaving `G-t` on the `human` data while the relevance key
      // already says `mouse`. The full load already covers `G-t2`, so
      // the retry is a no-op and the full load runs to completion.
      calls.length = 0;
      hang.clear();
      await el._loadData(new Set(['G-t2']));
      expect(fullLoad.signal?.aborted).toBe(false);
      expect(featureUrls()).toEqual([]);
      release();
    });

    it('stays targeted when no full load is in flight', async () => {
      const { el } = await mountLoaded(undefined, { config: twoTracks });
      await el._loadData(new Set(['G-t2']));
      expect(featureUrls()).toEqual([otherFor('human')]);
    });
  });

  it('removing a needed attribute reloads, skipping the fetch with a warning', async () => {
    const { el, load } = await mountLoaded();
    el.removeAttribute('data-species');
    await settle();
    flushFrames();
    expect(load).toHaveBeenCalledTimes(1);
    // Routed once the batch settles, so wait for it rather than `loading`.
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('undefined variable')
      )
    );
    expect(featureUrls()).toEqual([]);
  });

  describe('changes that cannot affect a URL do not reload', () => {
    it('an unrelated data-* attribute', async () => {
      const { el, load } = await mountLoaded();
      el.setAttribute('data-testid', 'viewer');
      await settle();
      flushFrames();
      expect(load).not.toHaveBeenCalled();
    });

    it('re-setting the same value', async () => {
      const { el, load } = await mountLoaded();
      el.setAttribute('data-species', 'human');
      await settle();
      flushFrames();
      expect(load).not.toHaveBeenCalled();
    });

    it('a data-* equal to the config baseline it overrides', async () => {
      const { el, load } = await mountLoaded();
      el.setAttribute('data-build', 'v2024.12');
      await settle();
      flushFrames();
      expect(load).not.toHaveBeenCalled();
    });

    it('a change followed by a revert within the same frame', async () => {
      const { el, load } = await mountLoaded();
      el.setAttribute('data-species', 'mouse');
      el.setAttribute('data-species', 'human');
      await settle();
      flushFrames();
      expect(load).not.toHaveBeenCalled();
    });

    it('data-accession while the named accession attribute is set', async () => {
      const { el, load } = await mountLoaded();
      el.setAttribute('data-accession', 'Q99999');
      await settle();
      flushFrames();
      expect(load).not.toHaveBeenCalled();
    });

    it('a non-data attribute (no frame is even scheduled)', async () => {
      const { el, load } = await mountLoaded();
      const changed = vi.spyOn(el, '_onVariablesChanged');
      el.setAttribute('title', 'x');
      el.setAttribute('notooltip', '');
      await settle();
      expect(el._variablesFrame).toBeUndefined();
      flushFrames();
      expect(changed).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });
  });

  it('leaves named accession changes to the existing _init() path', async () => {
    const { el, load } = await mountLoaded();
    const init = vi.spyOn(el, '_init');
    el.setAttribute('accession', 'Q99999');
    await settle();
    // The observer only reacts to data-*: no frame, so no second load.
    expect(el._variablesFrame).toBeUndefined();
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(featureUrls()).toEqual([urlFor('human', 'v2024.12', 'Q99999')])
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not reload while suspended', async () => {
    const { el, load } = await mountLoaded();
    el.suspend = true;
    await settle();
    el.setAttribute('data-species', 'mouse');
    await settle();
    flushFrames();
    expect(load).not.toHaveBeenCalled();
  });

  it('cancels a pending frame and stops observing once detached', async () => {
    const { el, load } = await mountLoaded();
    el.setAttribute('data-species', 'mouse');
    await settle();
    const pending = el._variablesFrame;
    expect(pending).toBeDefined();
    el.remove();
    expect(cafSpy).toHaveBeenCalledWith(pending);
    expect(frames.has(pending!)).toBe(false);
    expect(el._variablesFrame).toBeUndefined();

    el.setAttribute('data-species', 'rat');
    await settle();
    expect(el._variablesFrame).toBeUndefined();
    flushFrames();
    expect(load).not.toHaveBeenCalled();
  });
});
