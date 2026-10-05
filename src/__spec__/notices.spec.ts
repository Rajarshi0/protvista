/**
 * Visitor notices and author mode on the mounted element.
 *
 * Every warning the routing table gives a visitor notice shows a quiet ⓘ on
 * its track's label, or on the top bar beside Customize; `quiet-notices`
 * removes them. Author mode (`show-warnings`, or `showWarnings: true` in the
 * config) lists every warning in full instead, with the text the event and
 * the console carry, and expands error badges into their author detail.
 *
 * Network-free throughout: a `sequence:` config, inline CSV, and a stubbed
 * `fetch` that answers 404 (the one authored path below is meant to fail).
 * Every positive fixture first checks its warning event fired, so no test
 * can pass because nothing happened.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Registers <protvista-uniprot>; nightingale packages are stubbed globally
// via `src/__spec__/nightingale-mocks.ts` (setupFiles).
import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import type { NormalizedConfig } from '../schema/normalize.js';

const PANEL = `.${CSS_PREFIX}-error-panel`;
const BADGE = `.${CSS_PREFIX}-error-badge`;

type Detail = {
  phase: string;
  severity: 'error' | 'warning';
  message: string;
  source?: string;
  issues: { path: string; message: string; code: string }[];
  context: Record<string, unknown>;
};

type El = HTMLElement & {
  config?: NormalizedConfig;
  viewerConfig?: unknown;
  openGroups: string[];
  _customizeMode: boolean;
  _mountError: unknown;
  registerComponent(name: string, ctor: CustomElementConstructor): void;
  setTrackData(groupId: string, trackId: string, data: unknown): void;
  setConfig(config: unknown): Promise<void>;
  _assignComponentData(element: unknown, payload: unknown, key: string): void;
  _loadData(only?: Set<string>): Promise<void>;
  updateComplete: Promise<boolean>;
};

/** 40 residues. */
const RESIDUES = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV';

/**
 * Three rows, two of them outside the 40 residues and two with colours the
 * canvas cannot paint, plus a column the decoder ignores. The template names
 * two fields the data never has.
 */
const LAB_CSV = [
  'type,start,end,description,color,tooltipContent',
  'DOMAIN,5,20,a,#2a7,x',
  'REGION,30,60,b,bleu,y',
  'SITE,0,3,c,#catFace,z',
].join('\n');

const labHits = (extra: Record<string, unknown> = {}) => ({
  id: 'lab',
  label: 'Lab hits',
  kind: 'features',
  dataTooltip: {
    kind: 'markdown',
    template: '{% $gene %} · {% link href=$url /%}',
  },
  data: { from: 'inline', format: 'csv', inlineData: LAB_CSV },
  ...extra,
});

/** A URL whose `{dataset}` nothing defines: never fetched. */
const partner = (id = 'partner', label = 'Partner data') => ({
  id,
  label,
  kind: 'features',
  data: 'https://example.org/{dataset}/hits.csv',
});

/** A path to the author's own file that 404s: a track error with a badge. */
const broken = () => ({
  id: 'broken',
  label: 'Broken',
  kind: 'features',
  data: './missing.csv',
});

/** A registered component the renderer cannot draw. */
const CUSTOM_TAG = 'notice-custom-track';
const mine = () => ({
  id: 'mine',
  label: 'Mine',
  component: CUSTOM_TAG,
  data: { from: 'custom' },
});

/** Every warning kind the table routes, and one track error. */
const everything = (extra: Record<string, unknown> = {}) => ({
  sequence: RESIDUES,
  theme: { accentColor: 'not-a-colour' },
  rows: [labHits(), partner(), broken(), mine()],
  ...extra,
});

const notFound = () =>
  vi.fn(
    async () =>
      ({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      }) as unknown as Response
  );

const appended: El[] = [];

/** Create, configure and connect an element, collecting its events. */
function mountEl(
  viewerConfig: unknown,
  opts: { attrs?: string[]; props?: Partial<El> } = {}
) {
  vi.stubGlobal('fetch', notFound());
  const el = document.createElement('protvista-uniprot') as unknown as El;
  el.registerComponent(CUSTOM_TAG, class extends HTMLElement {});
  for (const name of opts.attrs ?? []) el.setAttribute(name, '');
  Object.assign(el, { viewerConfig, ...opts.props });
  const events: Detail[] = [];
  el.addEventListener('protvista-error', (e) =>
    events.push((e as CustomEvent<Detail>).detail)
  );
  document.body.append(el);
  appended.push(el);
  return { el, events };
}

/** Until the viewer has drawn and the coordinate check (last) has run. */
async function ready(
  el: El,
  events: Detail[],
  last = 'coordinate-out-of-range'
) {
  await vi.waitFor(() => {
    if (!el.querySelector('nightingale-manager')) {
      throw new Error('viewer not ready');
    }
    if (last && !events.some((e) => e.issues.some((i) => i.code === last))) {
      throw new Error(`no ${last} yet`);
    }
  });
  await el.updateComplete;
}

/** A Nightingale element that rejects any payload. */
const rejecting = () => ({
  set data(_: unknown) {
    throw new Error('cannot read this payload');
  },
});

/** Lit's comment markers are not content, and the instance nonce varies. */
const normalize = (html: string) =>
  html.replace(/<!--[^]*?-->/g, '').replace(/(-(?:g?err|note)-)\d+-/g, '$1N-');

afterEach(() => {
  for (const el of appended.splice(0)) el.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const quiet = () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
};

describe('the protvista-error event is unchanged', () => {
  /**
   * Every warning kind plus a track error, a rejected `setTrackData()` call
   * and a payload rejected under a key no row owns. The snapshot was taken
   * before notices existed, so it pins the detail as it was.
   */
  async function recordAll(attrs: string[]) {
    quiet();
    const { el, events } = mountEl(everything(), { attrs });
    await ready(el, events);
    el.setTrackData('nope', 'x', []);
    el._assignComponentData(rejecting(), [], 'no-such-key');
    await el.updateComplete;
    return events;
  }

  it('carries the same details whatever quiet-notices and show-warnings say', async () => {
    const runs = [];
    for (const attrs of [
      [],
      ['quiet-notices'],
      ['show-warnings'],
      ['quiet-notices', 'show-warnings'],
    ]) {
      runs.push(await recordAll(attrs));
    }
    // Every kind fired: a fixture missing one would pin less than it claims.
    const kinds = runs[0].map(
      (d) => `${d.severity}/${d.phase}/${d.issues[0]?.code ?? '-'}`
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        'warning/config/-',
        'warning/config/missing-variable',
        'error/track-fetch/-',
        'warning/track-fetch/-',
        'warning/track-data/data-field-ignored',
        'warning/track-data/unpaintable-color',
        'warning/tooltip-field-miss/tooltip-field-miss',
        'warning/track-data/coordinate-out-of-range',
        'warning/set-track-data/-',
      ])
    );
    for (const run of runs.slice(1)) expect(run).toEqual(runs[0]);
    expect(runs[0]).toMatchSnapshot();
  });
});

describe('author mode off: errors look exactly as they did', () => {
  it('keeps the track badge an image with its title and description', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    const badge = el.querySelector(`#${CSS_PREFIX}-group_broken ${BADGE}`)!;
    expect(badge.tagName).toBe('SPAN');
    expect(badge.getAttribute('role')).toBe('img');
    const label = badge.parentElement!;
    expect(normalize(label.innerHTML)).toMatchSnapshot();
  });

  it('keeps the strict track panel as it was', async () => {
    quiet();
    const { el, events } = mountEl(
      everything({ strict: true, rows: [labHits(), broken()] })
    );
    await vi.waitFor(() => {
      if (!el.querySelector(PANEL)) throw new Error('no panel');
    });
    await el.updateComplete;
    expect(events.some((e) => e.severity === 'error')).toBe(true);
    expect(normalize(el.querySelector(PANEL)!.outerHTML)).toMatchSnapshot();
  });

  it('keeps the config-failure panel as it was, after the rich upgrade', async () => {
    quiet();
    const { el } = mountEl({
      sequence: RESIDUES,
      rows: [
        {
          id: 'FOO',
          tracks: [{ id: 'bar', kind: 'features', data: 'missingKey' }],
        },
      ],
    });
    await vi.waitFor(() => {
      if (!el.querySelector(`.${CSS_PREFIX}-error-issues`)) {
        throw new Error('no upgraded panel');
      }
    });
    await el.updateComplete;
    expect(normalize(el.querySelector(PANEL)!.outerHTML)).toMatchSnapshot();
  });
});
