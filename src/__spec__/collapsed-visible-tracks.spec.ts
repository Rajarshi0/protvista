/**
 * A group's collapsed view draws only the tracks the user can see.
 *
 * The aggregate a collapsed group renders (`data[groupId]`) is built from its
 * feeding tracks — not `detailOnly` — and must also leave out `hidden` ones,
 * whether the author shipped them hidden or the user hid them in customize
 * mode. A hidden track is "absent from the canvas" (customize-layout.md), so it
 * can't still show up when its group is collapsed. A graph group (line graph,
 * coloured sequence) draws one track: the first visible feeding track in the
 * current order, which is also the track a `change` event names as its source.
 *
 * Mounted over the real `connectedCallback → _init()` lifecycle with inline
 * data. The Nightingale tracks are plain `HTMLElement` stubs
 * (`nightingale-mocks.ts`), so the test reads the `.data` each one was given.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import type { ProtvistaChangeEventDetail } from '../events.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';

const features = (type: string, start: number, end: number) => ({
  from: 'inline' as const,
  inlineData: [{ type, start, end }],
});
const points = (value: number) => ({
  from: 'inline' as const,
  inlineData: [
    { position: 4, value },
    { position: 5, value: value + 1 },
  ],
});

/** G: two feature tracks. VAR: two line graphs. Both collapsed. */
const config = (hidden: { b?: boolean } = {}): ProtvistaViewerConfig => ({
  rows: [
    {
      id: 'G',
      tracks: [
        { id: 'a', kind: 'features', data: features('DOMAIN', 1, 5) },
        {
          id: 'b',
          kind: 'features',
          data: features('REGION', 8, 12),
          ...(hidden.b ? { hidden: true } : {}),
        },
      ],
    },
    {
      id: 'VAR',
      tracks: [
        { id: 'first', kind: 'linegraph', data: points(2) },
        { id: 'second', kind: 'linegraph', data: points(20) },
      ],
    },
  ],
});

type El = HTMLElement & {
  viewerConfig?: unknown;
  accession?: string;
  openGroups: string[];
  noPersistLayout?: boolean;
  data: Record<string, unknown>;
  updateComplete: Promise<boolean>;
  setTrackVisibility(groupId: string, trackId: string, visible: boolean): void;
  setTrackOrder(rowId: string, order: string[]): void;
};

const appended: HTMLElement[] = [];

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(viewerConfig = config()): Promise<El> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = { sequence: { sequence: 'MSEQENCEMSEQENCE' }, features: [] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    })
  );
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.accession = 'P05067';
  el.noPersistLayout = true;
  el.viewerConfig = viewerConfig;
  el.openGroups = [];
  document.body.append(el);
  appended.push(el);
  await vi.waitFor(() => {
    expect(aggregate(el, 'G').data).toBeDefined();
    expect(aggregate(el, 'VAR').data).toBeDefined();
  });
  return el;
}

/** The collapsed view's element, with the `.data` it was last given. */
const aggregate = (el: El, rowId: string) =>
  el.querySelector(`#${CSS_PREFIX}-track-${rowId}`) as HTMLElement & {
    data?: unknown;
  };

const types = (data: unknown) =>
  (data as Array<{ type: string }>).map((item) => item.type);

describe('a collapsed group draws only its visible tracks', () => {
  it('drops a track the user hides, and brings it back when shown', async () => {
    const el = await mount();
    expect(types(aggregate(el, 'G').data)).toEqual(['DOMAIN', 'REGION']);

    el.setTrackVisibility('G', 'b', false);
    await vi.waitFor(() =>
      expect(types(aggregate(el, 'G').data)).toEqual(['DOMAIN'])
    );

    el.setTrackVisibility('G', 'b', true);
    await vi.waitFor(() =>
      expect(types(aggregate(el, 'G').data)).toEqual(['DOMAIN', 'REGION'])
    );
  });

  it('never includes a track the author shipped hidden', async () => {
    const el = await mount(config({ b: true }));
    expect(types(aggregate(el, 'G').data)).toEqual(['DOMAIN']);
  });

  it('still shows a group whose only feeding track is hidden, for its detailOnly track', async () => {
    // Like the default VARIATION group with its line graph hidden — authored,
    // or restored from a saved layout. The collapsed view has nothing to draw,
    // but the visible `detailOnly` track does, so the group must appear.
    const el = await mount({
      rows: [
        ...config().rows,
        {
          id: 'D',
          tracks: [
            { id: 'graph', kind: 'linegraph', hidden: true, data: points(3) },
            {
              id: 'detail',
              kind: 'features',
              detailOnly: true,
              data: features('DOMAIN', 1, 5),
            },
          ],
        },
      ],
    });
    const group = () =>
      el.querySelector(`#${CSS_PREFIX}-group_D`) as HTMLElement | null;
    await vi.waitFor(() => expect(group()?.style.display).toBe('flex'));
    expect(el.data.D).toBeUndefined();
  });

  it('keeps every track’s own data, so nothing is refetched', async () => {
    const el = await mount();
    const before = el.data['G-b'];
    el.setTrackVisibility('G', 'b', false);
    await el.updateComplete;
    expect(el.data['G-b']).toBe(before);
  });
});

describe('a collapsed graph group draws its first visible track', () => {
  /** The `detail.track` a hover on the collapsed VAR graph reports. */
  const hoverSource = (el: El) => {
    let detail: ProtvistaChangeEventDetail | undefined;
    const listener = (e: Event) => {
      detail = (e as CustomEvent<ProtvistaChangeEventDetail>).detail;
    };
    document.addEventListener('change', listener);
    aggregate(el, 'VAR').dispatchEvent(
      new CustomEvent('change', {
        detail: { eventType: 'mouseover' },
        bubbles: true,
      })
    );
    document.removeEventListener('change', listener);
    return detail?.track?.sourceTrackId;
  };

  it('moves on to the next track when the first is hidden', async () => {
    const el = await mount();
    expect(aggregate(el, 'VAR').data).toBe(el.data['VAR-first']);
    expect(hoverSource(el)).toBe('first');

    el.setTrackVisibility('VAR', 'first', false);
    await vi.waitFor(() =>
      expect(aggregate(el, 'VAR').data).toBe(el.data['VAR-second'])
    );
    expect(hoverSource(el)).toBe('second');
  });

  it('follows a reorder, and names the track it draws', async () => {
    const el = await mount();
    el.setTrackOrder('VAR', ['second', 'first']);
    await vi.waitFor(() =>
      expect(aggregate(el, 'VAR').data).toBe(el.data['VAR-second'])
    );
    expect(hoverSource(el)).toBe('second');
  });
});
