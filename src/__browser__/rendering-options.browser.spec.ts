/**
 * `rendering.height` and `rendering.layout` as the real canvas track honours
 * them. Every other browser spec stubs Nightingale (`src/__browser__/setup.ts`),
 * so an attribute there is only markup; here `nightingale-track-canvas` (and
 * the manager that hands it the coordinates) are real, so the assertions are
 * on the size the track takes on the page and on where its layout puts the
 * features.
 *
 * Network-free: a `sequence:` config with inline CSV.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// `vi.unmock` cannot lift a setup file's mock in browser mode, so each mock
// is replaced by the real module (as in `feature-render.browser.spec.ts`).
vi.mock('@nightingale-elements/nightingale-manager', (real) => real());
vi.mock('@nightingale-elements/nightingale-navigation', (real) => real());
vi.mock('@nightingale-elements/nightingale-sequence', (real) => real());
vi.mock('@nightingale-elements/nightingale-track-canvas', (real) => real());

import '../protvista-uniprot.js';
import type { RenderingOptions } from '../schema/types.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { track, unmountAll } from './mount.js';

type El = HTMLElement & {
  viewerConfig?: unknown;
  updateComplete: Promise<unknown>;
};

/** The parts of the real canvas track these assertions read. */
type TrackCanvas = HTMLElement & {
  height: number;
  layout?: string;
  layoutObj?: {
    getFeatureHeight(): number;
    getFeatureYPos(f: unknown): number;
  };
  data: unknown[];
};

/**
 * Ten features over the same residues — the isoform case: the
 * non-overlapping layout stacks them in ten rows inside the track's height.
 */
const OVERLAPPING = [
  'type,start,end,description',
  ...Array.from(
    { length: 10 },
    (_, i) => `DOMAIN,5,${30 + i},isoform ${i + 1}`
  ),
].join('\n');

/** A standalone features track over `OVERLAPPING`, with `rendering`. */
const config = (rendering?: RenderingOptions) => ({
  sequence: 'M'.repeat(60),
  rows: [
    {
      id: 'isoforms',
      label: 'Isoforms',
      kind: 'features',
      data: { from: 'inline', format: 'csv', inlineData: OVERLAPPING },
      ...(rendering ? { rendering } : {}),
    },
  ],
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

/** Mount the viewer and wait until the track holds its ten features. */
async function mountTrack(rendering?: RenderingOptions): Promise<TrackCanvas> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.viewerConfig = config(rendering);
  track(el);
  const canvas = await vi.waitFor(
    () => {
      const t = el.querySelector<TrackCanvas>(
        `#${CSS_PREFIX}-group_isoforms nightingale-track-canvas`
      );
      if (!t || !t.layoutObj || (t.data?.length ?? 0) < 10) {
        throw new Error('track not drawn yet');
      }
      return t;
    },
    { timeout: 10000 }
  );
  await el.updateComplete;
  await new Promise((r) => requestAnimationFrame(r));
  return canvas;
}

describe('rendering.height on a features track', () => {
  it('keeps the 40 px default when unset', async () => {
    const canvas = await mountTrack();
    expect(canvas.height).toBe(40);
    expect(canvas.getBoundingClientRect().height).toBeCloseTo(40, 0);
  });

  it('sizes the track, and the rows inside it, to the configured height', async () => {
    const short = (await mountTrack()).layoutObj!.getFeatureHeight();
    unmountAll();

    const canvas = await mountTrack({ height: 120 });
    expect(canvas.height).toBe(120);
    expect(canvas.getBoundingClientRect().height).toBeCloseTo(120, 0);
    // Ten stacked rows share the height: three times the room, taller rows.
    expect(canvas.layoutObj!.getFeatureHeight()).toBeGreaterThan(short * 2);
  });
});

describe('rendering.layout on a features track', () => {
  const rows = (canvas: TrackCanvas) =>
    new Set(canvas.data.map((f) => canvas.layoutObj!.getFeatureYPos(f))).size;

  it('stacks overlapping features in their own rows by default', async () => {
    const canvas = await mountTrack();
    expect(canvas.layout).toBe('non-overlapping');
    expect(rows(canvas)).toBe(10);
  });

  it("draws overlapping features on one row with layout: 'default'", async () => {
    const canvas = await mountTrack({ layout: 'default' });
    expect(canvas.layout).toBe('default');
    expect(rows(canvas)).toBe(1);
  });
});

describe('rendering.height on a group', () => {
  const CSV = 'type,start,end,description\nDOMAIN,5,30,a\nDOMAIN,10,40,b';
  const inline = { from: 'inline', format: 'csv', inlineData: CSV };

  /** Mount a two-track group with `rendering`, measure, expand, measure. */
  async function expandGroup(rendering: RenderingOptions) {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = document.createElement('protvista-uniprot') as unknown as El;
    el.viewerConfig = {
      sequence: 'M'.repeat(60),
      rows: [
        {
          id: 'g',
          label: 'Group',
          rendering,
          tracks: [
            { id: 't1', kind: 'features', data: inline },
            { id: 't2', kind: 'features', data: inline },
          ],
        },
      ],
    };
    track(el);
    const toggle = await vi.waitFor(
      () => {
        const t = el.querySelector<HTMLElement>('[data-group-toggle="g"]');
        if (!t || !el.querySelector(`#${CSS_PREFIX}-track-g`)) {
          throw new Error('group not drawn yet');
        }
        return t;
      },
      { timeout: 10000 }
    );
    await el.updateComplete;
    await new Promise((r) => requestAnimationFrame(r));
    const height = (selector: string) =>
      el.querySelector<HTMLElement>(selector)!.getBoundingClientRect().height;
    const collapsed = height(`#${CSS_PREFIX}-group_g`);
    toggle.click();
    await vi.waitFor(
      () => {
        if (!el.querySelector(`#${CSS_PREFIX}-track-g-t1`)) {
          throw new Error('group not expanded yet');
        }
      },
      { timeout: 10000 }
    );
    await el.updateComplete;
    await new Promise((r) => requestAnimationFrame(r));
    return {
      collapsed,
      header: height(`#${CSS_PREFIX}-group_g`),
      row: height(`#${CSS_PREFIX}-track_t1`),
    };
  }

  it('sizes the collapsed row, then the tracks but not the hidden aggregate', async () => {
    const { collapsed, header, row } = await expandGroup({ height: 150 });
    expect(collapsed).toBeGreaterThanOrEqual(150);
    expect(row).toBeGreaterThanOrEqual(150);
    // The aggregate is invisible while expanded: no 150 px blank band.
    expect(header).toBeLessThan(60);
  });
});
