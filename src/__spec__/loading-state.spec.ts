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

/** A raw, valid config with one http-URL feature track. */
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
          : { features: [{ type: 'DOMAIN', begin: '1', end: '5' }] };
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
    // Nothing was asked for, so there is nothing to wait on. `_init()` returns
    // before `_loadData()` here, and `_loadData()` is the only other place
    // `loading` is cleared — so the spinner that now covers the whole initial
    // load would otherwise run forever on a misconfigured element, which reads
    // as "working on it" rather than "no accession set".
    stubHungFetch();
    const el = mountEl({
      viewerConfig: VALID_CONFIG,
      // no `accession`
    });

    await settle(el);

    expect(el.querySelector(LOADER)).toBeNull();
    expect(el.querySelector('nightingale-manager')).toBeNull();
    // Blank, which is what the troubleshooting page tells the reader a missing
    // `accession` looks like. A spinner would contradict it.
    expect(el.textContent?.trim()).toBe('');
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

describe('initial loading announcement', () => {
  it('announces the wait politely in a live region that is already mounted', async () => {
    stubHungFetch();
    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });

    await settle(el);

    const region = el.querySelector(LIVE)!;
    expect(region).not.toBeNull();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain(LOADING_TEXT);
  });

  it('announces once, not on every re-render', async () => {
    stubHungFetch();
    const proto = customElements.get('protvista-uniprot')!.prototype as {
      _announce(message: string): void;
    };
    const announce = vi.spyOn(proto, '_announce');

    const el = mountEl({ viewerConfig: VALID_CONFIG, accession: 'P05067' });
    await settle(el);

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
          : { features: [{ type: 'DOMAIN', begin: '1', end: '5' }] };
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
