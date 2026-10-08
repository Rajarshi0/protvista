/**
 * Real-DOM accessibility + interaction coverage for the error surfaces
 * of `<protvista-uniprot>` (light DOM): the mount-level alert panel and
 * the per-track ⚠ badge, plus their Retry affordances.
 *
 * The jsdom suite (`src/__spec__/error-surface.spec.ts`) already proves
 * the wiring; here we additionally verify the surfaces are accessible
 * (axe-core) and that Retry recovers under *real* clicks and focus in a
 * browser. Nightingale is stubbed via the browser setup file, so mounting
 * the element is cheap.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { mount, unmountAll } from './mount.js';
import { expectNoA11yViolations } from './axe.js';

const PANEL = `.${CSS_PREFIX}-error-panel`;
const RETRY = `.${CSS_PREFIX}-error-retry`;
const BADGE = `.${CSS_PREFIX}-error-badge`;

/**
 * A raw config whose single top-level `rows:` entry declares no `tracks:` —
 * the *standalone* shape the normalizer wraps in a synthetic one-track row,
 * and the default in the starter kits.
 */
const STANDALONE_CONFIG = {
  rows: [{ id: 'solo', kind: 'features', data: 'https://example.org/x.json' }],
};

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
  data: Record<string, unknown>;
};

/** Route fetch by URL substring; default 200 with an empty body. */
function stubFetch(handler: (url: string) => { ok: boolean; status: number; body?: unknown }) {
  const fn = vi.fn(async (input: unknown) => {
    const { ok, status, body } = handler(String(input));
    return { ok, status, json: async () => body ?? {} } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  // Unmount before restoring `fetch`: hooks run last-registered-first,
  // so mount.js's own teardown would otherwise leave live components
  // able to reach the real network.
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mount-level error panel — accessibility & retry', () => {
  it('a broken (5xx) sequence raises an accessible alert panel with Retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch((url) =>
      url.includes('/proteins/api/proteins/')
        ? { ok: false, status: 503 }
        : { ok: true, status: 200 }
    );

    const el = mount<El>('protvista-uniprot', {
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
    });

    const panel = await vi.waitFor(() => {
      const p = el.querySelector<HTMLElement>(PANEL);
      if (!p) throw new Error('panel not ready');
      return p;
    });

    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.textContent).toMatch(/unreachable or failing/);
    expect(panel.querySelector(RETRY)).not.toBeNull();

    // Focus is moved into the panel when it appears.
    expect(document.activeElement).toBe(panel);

    // The alert panel itself is accessible.
    await expectNoA11yViolations(panel);
  });

  it('clicking Retry re-fetches and tears the panel down once the service recovers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let sequenceCalls = 0;
    stubFetch((url) => {
      if (url.includes('/proteins/api/proteins/')) {
        sequenceCalls += 1;
        return sequenceCalls === 1
          ? { ok: false, status: 503 }
          : { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } };
      }
      return { ok: true, status: 200 };
    });

    const el = mount<El>('protvista-uniprot', {
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
    });

    const retry = await vi.waitFor(() => {
      const btn = el.querySelector<HTMLButtonElement>(`${PANEL} ${RETRY}`);
      if (!btn) throw new Error('retry not ready');
      return btn;
    });

    await userEvent.click(retry);

    await vi.waitFor(() => {
      if (el.querySelector(PANEL)) throw new Error('panel still present');
    });
    expect(sequenceCalls).toBe(2);
    expect(el.sequence).toBe('MSEQENCE');
  });
});

describe('per-track error badge — accessibility & retry', () => {
  it('a broken (5xx) track shows an accessible ⚠ badge whose Retry recovers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let trackCalls = 0;
    stubFetch((url) => {
      if (url.includes('/proteins/api/proteins/')) {
        return { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } };
      }
      if (url.includes('/x.json')) {
        trackCalls += 1;
        return trackCalls === 1
          ? { ok: false, status: 500 }
          : { ok: true, status: 200, body: [{ type: 'DOMAIN', start: 1, end: 5 }] };
      }
      return { ok: true, status: 200 };
    });

    const el = mount<El>('protvista-uniprot', {
      viewerConfig: VALID_CONFIG,
      accession: 'P05067',
    });

    const badge = await vi.waitFor(() => {
      const b = el.querySelector<HTMLElement>(BADGE);
      if (!b) throw new Error('badge not ready');
      return b;
    });

    // Badge semantics: a labelled button, like the ⓘ, controlling its note.
    expect(badge.tagName).toBe('BUTTON');
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    const popId = badge.getAttribute('aria-controls')!;
    expect(el.querySelector(`#${CSS.escape(popId)}`)).not.toBeNull();

    await expectNoA11yViolations(el.querySelector(`.${CSS_PREFIX}-group`)!);

    const retry = el.querySelector<HTMLButtonElement>(RETRY)!;
    expect(retry).not.toBeNull();
    await userEvent.click(retry);

    // After recovery the badge is gone.
    await vi.waitFor(() => {
      if (el.querySelector(BADGE)) throw new Error('badge still present');
    });
    expect(trackCalls).toBe(2);
  });
});

describe('the ⚠ badge opens its note like the ⓘ', () => {
  /**
   * A collapsed group with one working and one failing (5xx) track: the
   * badge sits inside the group label, which is itself the collapse toggle.
   */
  async function brokenGroup(labelWidth?: string) {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let failing = 0;
    stubFetch((url) => {
      if (url.includes('/proteins/api/proteins/')) {
        return { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } };
      }
      if (url.includes('/x.json')) {
        failing += 1;
        return { ok: false, status: 500 };
      }
      if (url.includes('/ok.json')) {
        return { ok: true, status: 200, body: [{ type: 'DOMAIN', start: 1, end: 5 }] };
      }
      return { ok: true, status: 200 };
    });
    const el = mount<El>('protvista-uniprot', {
      viewerConfig: {
        rows: [
          {
            id: 'g',
            tracks: [
              { id: 'y', kind: 'features', data: 'https://example.org/x.json' },
              { id: 'z', kind: 'features', data: 'https://example.org/ok.json' },
            ],
          },
        ],
      },
      accession: 'P05067',
    });
    if (labelWidth) el.style.setProperty('--protvista-label-width', labelWidth);
    const badge = await vi.waitFor(() => {
      const b = el.querySelector<HTMLButtonElement>(BADGE);
      if (!b) throw new Error('badge not ready');
      return b;
    });
    const popover = () =>
      el.querySelector<HTMLElement>(
        `#${CSS.escape(badge.getAttribute('aria-controls')!)}`
      )!;
    const group = el.querySelector<HTMLElement>('[data-group-toggle="g"]')!;
    /** Requests for the failing track's data so far. */
    const calls = () => failing;
    return { el, badge, popover, group, calls };
  }

  it('opens on click with the error text, and Escape closes it', async () => {
    const { badge, popover, group } = await brokenGroup();
    expect(popover().hidden).toBe(true);
    const expanded = group.getAttribute('aria-expanded');

    await userEvent.click(badge);
    await vi.waitFor(() => expect(popover().hidden).toBe(false));
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    expect(popover().textContent).toContain('failed to load');
    // Opening the note is not a click on the group's collapse toggle.
    expect(group.getAttribute('aria-expanded')).toBe(expanded);

    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(popover().hidden).toBe(true));
    expect(document.activeElement).toBe(badge);
  });

  it('opens from the keyboard inside the group label without toggling the group', async () => {
    const { badge, popover, group } = await brokenGroup();
    const expanded = group.getAttribute('aria-expanded');
    badge.focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(popover().hidden).toBe(false));
    expect(group.getAttribute('aria-expanded')).toBe(expanded);
  });

  it('opens on Space too', async () => {
    const { badge, popover, group } = await brokenGroup();
    const expanded = group.getAttribute('aria-expanded');
    badge.focus();
    await userEvent.keyboard(' ');
    await vi.waitFor(() => expect(popover().hidden).toBe(false));
    expect(group.getAttribute('aria-expanded')).toBe(expanded);
  });

  it('keeps keys pressed inside the open note from toggling the group', async () => {
    const { badge, popover, group } = await brokenGroup();
    const expanded = group.getAttribute('aria-expanded');
    await userEvent.click(badge);
    await vi.waitFor(() => expect(popover().hidden).toBe(false));
    popover().focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Enter}');
    expect(group.getAttribute('aria-expanded')).toBe(expanded);
    expect(popover().hidden).toBe(false);
  });

  it('lets Enter on Retry retry, without toggling the group', async () => {
    const { el, group, calls } = await brokenGroup();
    const expanded = group.getAttribute('aria-expanded');
    const before = calls();
    el.querySelector<HTMLButtonElement>(RETRY)!.focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(calls()).toBeGreaterThan(before));
    expect(group.getAttribute('aria-expanded')).toBe(expanded);
  });

  it('never covers its Retry, even in a narrow label column', async () => {
    const { el, badge, popover, calls } = await brokenGroup('80px');
    await userEvent.click(badge);
    await vi.waitFor(() => expect(popover().hidden).toBe(false));
    const retry = el.querySelector<HTMLButtonElement>(RETRY)!;
    // Badge and Retry share a line, and the note opens below it.
    const b = badge.getBoundingClientRect();
    const r = retry.getBoundingClientRect();
    expect(Math.abs(r.top + r.height / 2 - (b.top + b.height / 2))).toBeLessThan(
      b.height / 2
    );
    const centre = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    expect(retry.contains(centre)).toBe(true);
    const before = calls();
    await userEvent.click(retry);
    await vi.waitFor(() => expect(calls()).toBeGreaterThan(before));
  });

  it('takes the ⓘ hover: a pointer and a border', async () => {
    const { badge } = await brokenGroup();
    // The last test's click may have left the pointer where this badge is.
    await userEvent.unhover(badge);
    const before = getComputedStyle(badge).borderTopColor;
    expect(getComputedStyle(badge).cursor).toBe('pointer');
    await userEvent.hover(badge);
    await vi.waitFor(() =>
      expect(getComputedStyle(badge).borderTopColor).not.toBe(before)
    );
  });
});

describe('standalone row error badge — accessibility & retry', () => {
  it('a broken standalone row keeps an accessible badge instead of vanishing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let trackCalls = 0;
    stubFetch((url) => {
      if (url.includes('/proteins/api/proteins/')) {
        return { ok: true, status: 200, body: { sequence: { sequence: 'MSEQENCE' } } };
      }
      if (url.includes('/x.json')) {
        trackCalls += 1;
        return trackCalls === 1
          ? { ok: false, status: 500 }
          : { ok: true, status: 200, body: [{ type: 'DOMAIN', start: 1, end: 5 }] };
      }
      return { ok: true, status: 200 };
    });

    const el = mount<El>('protvista-uniprot', {
      viewerConfig: STANDALONE_CONFIG,
      accession: 'P05067',
    });

    const badge = await vi.waitFor(() => {
      const b = el.querySelector<HTMLElement>(BADGE);
      if (!b) throw new Error('badge not ready');
      return b;
    });

    // The row survived the failure, with the same badge semantics a grouped
    // track gets — and no "All tracks are hidden" notice standing in for it.
    expect(badge.tagName).toBe('BUTTON');
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector(`.${CSS_PREFIX}-all-hidden`)).toBeNull();
    const descId = badge.getAttribute('aria-describedby')!;
    expect(el.querySelector(`#${CSS.escape(descId)}`)).not.toBeNull();

    const row = el.querySelector<HTMLElement>(
      `.${CSS_PREFIX}-group--standalone`
    )!;
    expect(row).not.toBeNull();
    await expectNoA11yViolations(row);

    // The badge is reachable by keyboard, and its Retry recovers the row.
    badge.focus();
    expect(document.activeElement).toBe(badge);

    await userEvent.click(el.querySelector<HTMLButtonElement>(RETRY)!);
    await vi.waitFor(() => {
      if (el.querySelector(BADGE)) throw new Error('badge still present');
    });
    expect(trackCalls).toBe(2);
  });
});
