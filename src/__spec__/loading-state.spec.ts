/**
 * The initial loading state of `<protvista-uniprot>`.
 *
 * The element's longest wait is its first one — config, then the sequence
 * fetch, then every track's data. The spinner used to sit *behind* the
 * readiness gate (`if (!this.sequence || !this.config) return html``;`), and
 * the sequence is exactly what that gate waits for, so the spinner could only
 * appear in the narrow window after the sequence landed and before the track
 * fetches finished — often never. What a user on a slow connection saw was a
 * blank region, which reads as "broken".
 *
 * These tests pin the spinner across the whole initial load, the error panel's
 * precedence over it, and the polite announcement that makes the wait
 * perceivable without vision.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Registers <protvista-uniprot>; nightingale packages are stubbed globally
// via `src/__spec__/nightingale-mocks.ts` (setupFiles).
import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';

const LOADER = '.protvista-loader';
const PANEL = `.${CSS_PREFIX}-error-panel`;
const LIVE = `.${CSS_PREFIX}-live-region`;
const LOADING_TEXT = 'Loading protein data…';

/**
 * A raw, valid config with one http-URL feature track. The URL is the
 * author's own `.json` file, so its body is the bare record array the
 * `features-json` decoder reads.
 */
const VALID_CONFIG = {
  rows: [
    {
      id: 'g',
      tracks: [
        { id: 'y', kind: 'features', data: 'https://example.org/x.json' },
      ],
    },
  ],
};

type El = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  sequence?: string;
  updateComplete: Promise<boolean>;
};

const appended: El[] = [];
function mountEl(props: Partial<El>): El {
  const el = document.createElement('protvista-uniprot') as unknown as El;
  Object.assign(el, props);
  document.body.append(el);
  appended.push(el);
  return el;
}

/** A `fetch` that never settles — the slow connection, held still. */
function stubHungFetch() {
  const fn = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Let the element settle: Lit's update cycle plus any already-resolved
 * promises the load chain is waiting on.
 */
async function settle(el: El): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await el.updateComplete;
    await Promise.resolve();
  }
  await el.updateComplete;
}

/**
 * Wait out the delay the element puts between mounting the live region and
 * filling it (`LIVE_REGION_SETTLE_MS`), then for the render that follows.
 */
async function announced(el: El): Promise<void> {
  await vi.waitFor(() => {
    if (!el.querySelector(LIVE)?.textContent?.includes(LOADING_TEXT)) {
      throw new Error('not announced yet');
    }
  });
}

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initial loading state', () => {
  it('shows the spinner while the sequence fetch is still in flight', async () => {
    stubHungFetch();
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    await settle(el);

    // The window the old gating missed entirely: config resolved, sequence
    // still pending, so `this.sequence` is unset and the readiness gate would
    // have returned an empty template.
    expect(el.sequence).toBeUndefined();
    expect(el.querySelector(LOADER)).not.toBeNull();
  });

  it('keeps the spinner up until the track fetches finish', async () => {
    // Sequence resolves, track data hangs. The element is now "ready" by the
    // readiness gate's reckoning but has nothing to draw, so the spinner has
    // to cover this stretch too.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('/proteins/api/proteins/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        return new Promise<Response>(() => undefined);
      })
    );
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    await settle(el);

    expect(el.sequence).toBe('MSEQENCE');
    expect(el.querySelector(LOADER)).not.toBeNull();
    expect(el.querySelector('nightingale-manager')).toBeNull();
  });

  it('hands the region over to content once the load completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        const body = url.includes('/proteins/api/proteins/')
          ? { sequence: { sequence: 'MSEQENCE' } }
          : [{ type: 'DOMAIN', start: 1, end: 5 }];
        return {
          ok: true,
          status: 200,
          json: async () => body,
        } as unknown as Response;
      })
    );
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) {
        throw new Error('viewer not ready');
      }
    });
    expect(el.querySelector(LOADER)).toBeNull();
  });

  it('keeps the spinner up when the tracks land before the sequence', async () => {
    // The reverse order. Inline tracks, or an endpoint that fails fast, settle
    // in a few microtasks while the sequence is still on the wire. Clearing
    // the spinner on the tracks alone fell through to the readiness gate,
    // which renders nothing until the sequence arrives — the blank region the
    // spinner exists to replace.
    let releaseSequence!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('/proteins/api/proteins/')) {
          await new Promise<void>((resolve) => (releaseSequence = resolve));
          return {
            ok: true,
            status: 200,
            json: async () => ({ sequence: { sequence: 'MSEQENCE' } }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => [{ type: 'DOMAIN', start: 1, end: 5 }],
        } as unknown as Response;
      })
    );
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    const data = () => (el as unknown as { data: Record<string, unknown> }).data;

    // The track batch has finished: its payload is in.
    await vi.waitFor(() => {
      if (!data()['g-y']) throw new Error('tracks not loaded yet');
    });
    await settle(el);

    expect(el.sequence).toBeUndefined();
    expect(el.querySelector(LOADER)).not.toBeNull();
    await announced(el);

    releaseSequence();
    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) {
        throw new Error('viewer not ready');
      }
    });
    expect(el.querySelector(LOADER)).toBeNull();
  });

  it('lets an error panel replace the spinner rather than sit under it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/proteins/api/proteins/')
          ? ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
          : ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
      )
    );
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });
    // The panel is checked before `loading` in `render()`, so there is never a
    // frame with both.
    expect(el.querySelector(LOADER)).toBeNull();
  });

  it('shows no spinner for a config failure (the panel stands alone)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const el = mountEl({
      viewerConfig: {
        rows: [{ id: 'FOO', tracks: [{ id: 'bar', kind: 'features', data: 'missingKey' }] }],
      },
      accession: 'P05067',
    });

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });
    expect(el.querySelector(LOADER)).toBeNull();
  });

  it('does not spin forever for an element with no accession', async () => {
    // Nothing was asked for, so there is nothing to wait on. A spinner here
    // would read as "working on it" rather than "no protein set". Nor is the
    // element left blank, which says nothing at all: the loader rejects a
    // mount with neither an accession nor a `sequence:` (`missing-protein`),
    // and the config panel says so — what the troubleshooting page's "Nothing
    // renders at all" now tells the reader to expect.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubHungFetch();
    const el = mountEl({
      viewerConfig: VALID_CONFIG,
      // no `accession`
    });

    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('panel not ready');
    });

    expect(el.querySelector(LOADER)).toBeNull();
    expect(el.querySelector('nightingale-manager')).toBeNull();
    expect(el.querySelector(PANEL)?.textContent).toContain(
      'Config validation failed (1 issue)'
    );
  });

  it('sequence mode never waits on a sequence fetch', async () => {
    // The sequence is in the config, so the spinner covers only the track
    // data — and no Proteins API URL is ever requested.
    let releaseTrack!: () => void;
    const fetchFn = vi.fn(async (url: string) => {
      await new Promise<void>((resolve) => (releaseTrack = resolve));
      expect(url).toBe('./y.csv');
      return {
        ok: true,
        status: 200,
        text: async () => 'type,start,end\nDOMAIN,1,5\n',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchFn);
    const el = mountEl({
      viewerConfig: {
        sequence: 'MSEQENCEKR',
        rows: [
          { id: 'g', tracks: [{ id: 'y', kind: 'features', data: './y.csv' }] },
        ],
      },
    });

    await vi.waitFor(() => {
      if (fetchFn.mock.calls.length === 0)
        throw new Error('no track fetch yet');
    });
    await settle(el);
    // The sequence is already known, but the track is still on the wire.
    expect(el.sequence).toBe('MSEQENCEKR');
    expect(el.querySelector(LOADER)).not.toBeNull();

    releaseTrack();
    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) {
        throw new Error('viewer not ready');
      }
    });
    expect(el.querySelector(LOADER)).toBeNull();
    expect(fetchFn.mock.calls.map(([url]) => String(url))).toEqual(['./y.csv']);
  });

  it('renders nothing while suspended, spinner included', async () => {
    stubHungFetch();
    const el = mountEl({
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
      suspend: true,
    } as Partial<El>);

    await settle(el);

    // `suspend` means "not loading yet", so a spinner would be a lie.
    expect(el.querySelector(LOADER)).toBeNull();
  });
});

describe('a sequence fetch superseded by an accession change', () => {
  /**
   * Hold each accession's sequence response until the test releases it, so a
   * superseded fetch can be made to land at the worst moment. Track data
   * resolves immediately.
   */
  function stubHeldSequences() {
    const release = new Map<string, (res: Response) => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        const m = url.match(/\/proteins\/api\/proteins\/(\w+)/);
        if (m) {
          return new Promise<Response>((resolve) => release.set(m[1], resolve));
        }
        return {
          ok: true,
          status: 200,
          json: async () => [{ type: 'DOMAIN', start: 1, end: 5 }],
        } as unknown as Response;
      })
    );
    const ok = (sequence: string) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ sequence: { sequence } }),
      }) as unknown as Response;
    const missing = { ok: false, status: 404 } as unknown as Response;
    const held = async (accession: string) => {
      await vi.waitFor(() => {
        if (!release.has(accession)) throw new Error(`${accession} not requested`);
      });
      return release.get(accession)!;
    };
    return { held, ok, missing };
  }

  it('ignores the old sequence landing while the new one is still in flight', async () => {
    const { held, ok } = stubHeldSequences();
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'AAAAAA' });
    const releaseA = await held('AAAAAA');

    el.accession = 'BBBBBB';
    const releaseB = await held('BBBBBB');
    releaseA(ok('OLDSEQ'));
    await settle(el);

    // B's tracks have landed, but B's sequence has not: the spinner stays, and
    // nothing of A's is drawn under B's name.
    expect(el.sequence).not.toBe('OLDSEQ');
    expect(el.querySelector(LOADER)).not.toBeNull();

    releaseB(ok('NEWSEQ'));
    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) throw new Error('not ready');
    });
    expect(el.sequence).toBe('NEWSEQ');
  });

  it('raises no panel when the old accession 404s after the new one loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { held, ok, missing } = stubHeldSequences();
    const events: Event[] = [];
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'TYPO01' });
    el.addEventListener('protvista-error', (e) => events.push(e));
    const releaseTypo = await held('TYPO01');

    el.accession = 'P05067';
    (await held('P05067'))(ok('MSEQENCE'));
    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) throw new Error('not ready');
    });

    releaseTypo(missing);
    await settle(el);

    // The late 404 is for an accession nobody is looking at any more. Routed,
    // it would have said "No UniProt entry found for 'P05067'" over a viewer
    // that is working.
    expect(el.querySelector(PANEL)).toBeNull();
    expect(events).toHaveLength(0);
    expect(el.querySelector('nightingale-manager')).not.toBeNull();
  });
});

describe('initial loading announcement', () => {
  it('announces the wait politely in a live region that is already mounted', async () => {
    stubHungFetch();
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    await settle(el);

    const region = el.querySelector(LIVE)!;
    expect(region).not.toBeNull();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // Mounted empty: text that arrived with the region would go unannounced.
    expect(region.textContent!.trim()).toBe('');

    await announced(el);
    // The same node, now changed — which is what a live region announces.
    expect(el.querySelector(LIVE)).toBe(region);
  });

  it('drops a pending announcement when the load finishes first', async () => {
    const proto = customElements.get('protvista-uniprot')!.prototype as {
      _announce(message: string): void;
    };
    const announce = vi.spyOn(proto, '_announce');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const body = String(input).includes('/proteins/api/proteins/')
          ? { sequence: { sequence: 'MSEQENCE' } }
          : [{ type: 'DOMAIN', start: 1, end: 5 }];
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      })
    );
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) {
        throw new Error('viewer not ready');
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    // A load quicker than the settle delay has nothing left to announce.
    expect(announce.mock.calls.filter(([m]) => m === LOADING_TEXT)).toEqual([]);
  });

  it('announces once, not on every re-render', async () => {
    stubHungFetch();
    const proto = customElements.get('protvista-uniprot')!.prototype as {
      _announce(message: string): void;
    };
    const announce = vi.spyOn(proto, '_announce');

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    await announced(el);

    const before = announce.mock.calls.length;
    // Churn the update cycle the way unrelated reactive state does.
    for (let i = 0; i < 3; i += 1) {
      (el as unknown as { requestUpdate(): void }).requestUpdate();
      await el.updateComplete;
    }

    expect(announce.mock.calls.filter(([m]) => m === LOADING_TEXT)).toHaveLength(
      1
    );
    expect(announce.mock.calls.length).toBe(before);
  });

  it('waits for a suspended element to mount its region before announcing', async () => {
    // `updated()` runs while suspended even though `render()` draws nothing.
    // Latching the announcement then put the text into the region in the same
    // render that created it — the "arrives with its text already in it" case
    // screen readers stay silent on — and the latch blocked a second go.
    stubHungFetch();
    const proto = customElements.get('protvista-uniprot')!.prototype as {
      _announce(message: string): void;
    };
    const original = proto._announce;
    const regionAtAnnounce: Array<string | null> = [];
    vi.spyOn(proto, '_announce').mockImplementation(function (
      this: HTMLElement,
      message: string
    ) {
      if (message === LOADING_TEXT) {
        regionAtAnnounce.push(
          this.querySelector(LIVE)?.textContent?.trim() ?? null
        );
      }
      original.call(this, message);
    });

    const el = mountEl({
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
      suspend: true,
    } as Partial<El>);
    await settle(el);
    expect(regionAtAnnounce).toEqual([]);

    (el as unknown as { suspend: boolean }).suspend = false;
    await settle(el);
    await announced(el);

    // Announced exactly once, into a region that was already in the tree and
    // still empty — so the text lands as a change to it.
    expect(regionAtAnnounce).toEqual(['']);
    expect(el.querySelector(LIVE)!.textContent).toContain(LOADING_TEXT);
  });

  it('clears the announcement when the load settles, leaving the region free', async () => {
    // The region is shared with the layout announcements ("Domains moved to
    // position 2 of 12"). A stale "Loading…" left in it would be the text the
    // next announcement has to differ from.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        const body = url.includes('/proteins/api/proteins/')
          ? { sequence: { sequence: 'MSEQENCE' } }
          : [{ type: 'DOMAIN', start: 1, end: 5 }];
        return {
          ok: true,
          status: 200,
          json: async () => body,
        } as unknown as Response;
      })
    );
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) {
        throw new Error('viewer not ready');
      }
    });
    await settle(el);

    expect(el.querySelector(LIVE)!.textContent?.trim()).toBe('');
  });
});
