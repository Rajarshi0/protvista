/**
 * The top-bar ⓘ beside real Nightingale. Every other browser spec stubs
 * Nightingale (`src/__browser__/setup.ts`), so the navigation ruler and the
 * sequence there are empty boxes and cannot show the ⓘ crowding them. This
 * file unmocks the four components the top bar and a feature track draw, so
 * the label column, the ruler beside it and the track rows below have their
 * real sizes. The structure viewer (Mol*, WebGL) stays stubbed: the config has
 * no structure.
 *
 * Network-free: a `sequence:` config with inline CSV, and a URL whose
 * variable is undefined, which is never fetched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { page } from 'vitest/browser';

// `vi.unmock` cannot lift a setup file's mock in browser mode ("mock
// wasn't registered"), so each mock is replaced by the real module.
vi.mock('@nightingale-elements/nightingale-manager', (real) => real());
vi.mock('@nightingale-elements/nightingale-navigation', (real) => real());
vi.mock('@nightingale-elements/nightingale-sequence', (real) => real());
vi.mock('@nightingale-elements/nightingale-track-canvas', (real) => real());

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { track, unmountAll } from './mount.js';

const RESIDUES = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV';
const TOP_BAR = `.${CSS_PREFIX}-nav-track-label`;
const TOP_NOTE = `${TOP_BAR} .${CSS_PREFIX}-note`;

type El = HTMLElement & {
  viewerConfig?: unknown;
  updateComplete: Promise<unknown>;
};

/** Lab hits draws; Partner data is skipped, so the top bar gets an ⓘ. */
const CONFIG = {
  sequence: RESIDUES,
  rows: [
    {
      id: 'lab',
      label: 'Lab hits',
      kind: 'features',
      data: {
        from: 'inline',
        format: 'csv',
        inlineData: 'type,start,end,description\nDOMAIN,5,20,a',
      },
    },
    {
      id: 'partner',
      label: 'Partner data',
      kind: 'features',
      data: 'https://example.org/{dataset}/hits.csv',
    },
  ],
};

afterEach(async () => {
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await page.viewport(1280, 720);
});

/** Mount, and wait until the real ruler has drawn its axis. */
async function mountViewer(attrs: string[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Not Found', { status: 404 }))
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const el = document.createElement('protvista-uniprot') as unknown as El;
  for (const a of attrs) el.setAttribute(a, '');
  el.viewerConfig = CONFIG;
  track(el);
  await vi.waitFor(
    () => {
      if (!el.querySelector(`#${CSS_PREFIX}-group_lab`)) {
        throw new Error('no rows yet');
      }
      if (!el.querySelector('nightingale-navigation svg .tick')) {
        throw new Error('the ruler has not drawn');
      }
      if (!attrs.includes('quiet-notices') && !el.querySelector(TOP_NOTE)) {
        throw new Error('no top-bar notice yet');
      }
    },
    { timeout: 10000 }
  );
  await el.updateComplete;
  await new Promise((r) => requestAnimationFrame(r));
  return el;
}

const rect = (el: Element) => el.getBoundingClientRect();
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('the top-bar ⓘ beside real Nightingale', () => {
  for (const [width, height] of [
    [390, 844],
    [320, 640],
  ] as const) {
    it(`wraps under Customize at ${width}px without covering or pushing anything`, async () => {
      await page.viewport(width, height);
      // The same viewer without notices: what the ⓘ must not disturb.
      const quiet = await mountViewer(['quiet-notices']);
      const quietRuler = rect(quiet.querySelector('nightingale-navigation')!);
      const quietTrack = rect(
        quiet.querySelector(
          `#${CSS_PREFIX}-group_lab .${CSS_PREFIX}-track-content`
        )!
      );
      unmountAll();

      const el = await mountViewer();
      const button = el.querySelector<HTMLElement>(TOP_NOTE)!;
      const customize = el.querySelector(`.${CSS_PREFIX}-customize-toggle`)!;
      const ruler = el.querySelector('nightingale-navigation')!;
      const b = rect(button);
      const column = rect(el.querySelector(TOP_BAR)!);

      // It wrapped: below Customize, inside the label column.
      expect(b.top).toBeGreaterThanOrEqual(rect(customize).bottom - 0.5);
      expect(b.left).toBeGreaterThanOrEqual(column.left - 0.5);
      expect(b.right).toBeLessThanOrEqual(column.right + 0.5);
      // Nothing covers it, and it covers nothing.
      const hit = document.elementFromPoint(
        b.left + b.width / 2,
        b.top + b.height / 2
      );
      expect(button.contains(hit), 'the ⓘ is on top at its centre').toBe(true);
      expect(overlaps(b, rect(customize))).toBe(false);
      expect(overlaps(b, rect(ruler))).toBe(false);

      // The ruler and the track keep their place and width, all on screen.
      expect(rect(ruler).left).toBeCloseTo(quietRuler.left, 0);
      expect(rect(ruler).width).toBeCloseTo(quietRuler.width, 0);
      expect(rect(ruler).right).toBeLessThanOrEqual(width);
      const lab = rect(
        el.querySelector(
          `#${CSS_PREFIX}-group_lab .${CSS_PREFIX}-track-content`
        )!
      );
      expect(lab.left).toBeCloseTo(quietTrack.left, 0);
      expect(lab.width).toBeCloseTo(quietTrack.width, 0);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      // The top bar grows by one row of 24px targets and its gap, no more
      // (about 28px), so the tracks below step down by that alone.
      expect(lab.top - quietTrack.top).toBeLessThanOrEqual(32);
    });
  }
});
