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

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Registers <protvista-uniprot>; nightingale packages are stubbed globally
// via `src/__spec__/nightingale-mocks.ts` (setupFiles).
import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { ruleFor, type FailureReport } from '../errors/router.js';
import type { NormalizedConfig } from '../schema/normalize.js';

// `autoUpdate` passes through to Floating UI unless a test swaps it, so the
// popover's cleanup can be observed.
const floating = vi.hoisted(() => ({
  autoUpdate: vi.fn(),
  actual: undefined as unknown as (...args: unknown[]) => () => void,
}));
vi.mock('@floating-ui/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/dom')>();
  floating.actual = actual.autoUpdate as never;
  return {
    ...actual,
    autoUpdate: (...args: unknown[]) => floating.autoUpdate(...args),
  };
});
const autoUpdateSpy = floating.autoUpdate;
beforeEach(() => {
  autoUpdateSpy.mockReset();
  autoUpdateSpy.mockImplementation((...args: unknown[]) =>
    floating.actual(...args)
  );
});

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

/**
 * Lit's comment markers are not content, a run of whitespace renders as one
 * space whatever the template's indentation, and the instance nonce varies.
 */
const normalize = (html: string) =>
  html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(-(?:g?err|note)-)\d+-/g, '$1N-');

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

// ── Visitor notices ─────────────────────────────────────────────

const NOTE = `.${CSS_PREFIX}-note`;
const TOP_BAR = `.${CSS_PREFIX}-nav-track-label`;

/** The label cell of a standalone row, or of a track inside a group. */
const rowLabel = (el: El, rowId: string) =>
  el.querySelector(`#${CSS_PREFIX}-group_${rowId} .${CSS_PREFIX}-track-label`);
const trackLabel = (el: El, trackId: string) =>
  el.querySelector(
    `#${CSS_PREFIX}-track_${trackId} .${CSS_PREFIX}-track-label`
  );
const topNote = (el: El) =>
  el.querySelector<HTMLButtonElement>(`${TOP_BAR} ${NOTE}`);
const noResultsNote = (el: El) =>
  el.querySelector<HTMLButtonElement>(`.protvista-no-results ${NOTE}`);

const popoverOf = (button: Element) =>
  document.getElementById(button.getAttribute('aria-controls')!)!;
const linesOf = (button: Element) =>
  [...popoverOf(button).querySelectorAll('li')].map((li) =>
    li.textContent!.replace(/\s+/g, ' ').trim()
  );
/** Every line in every note popover the element draws. */
const allLines = (el: El) =>
  [...el.querySelectorAll(NOTE)].flatMap((b) => linesOf(b));

const csvTrack = (
  id: string,
  label: string,
  rows: string[],
  extra: Record<string, unknown> = {}
) => ({
  id,
  label,
  kind: 'features',
  data: {
    from: 'inline',
    format: 'csv',
    inlineData: ['type,start,end,description,color', ...rows].join('\n'),
  },
  ...extra,
});
/** A track that draws one feature and warns about nothing. */
const okTrack = (id = 'ok', label = 'Fine') =>
  csvTrack(id, label, ['DOMAIN,2,8,fine,#2a7']);

const TWO_OUTSIDE =
  "2 features extend beyond this sequence, so they aren't shown in full.";
const COLOUR_TEXT =
  "Some colours in the data couldn't be shown, so some features may be in the wrong colour.";

/** Wait for an event matching `pred`. */
const eventFired = (events: Detail[], pred: (d: Detail) => boolean) =>
  vi.waitFor(() => {
    if (!events.some(pred)) throw new Error('event not fired yet');
  });
const hasCode = (code: string) => (d: Detail) =>
  d.issues.some((i) => i.code === code);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every author text in every note popover, in DOM order. */
const authorTexts = (el: El) =>
  [...el.querySelectorAll(`.${CSS_PREFIX}-note-popover__text`)].map(
    (p) => p.textContent!
  );
/**
 * What the event carries, as the playground lists it: each issue's message,
 * or the message. Errors and warnings, never info (info has no event).
 */
const eventTexts = (events: Detail[]) =>
  events.flatMap((d) =>
    d.issues.length ? d.issues.map((i) => i.message) : [d.message]
  );

describe('visitor notices, one per routing-table row', () => {
  type Scenario = {
    name: string;
    config: Record<string, unknown>;
    /** The report the warning routes as, for `ruleFor`. */
    report: Pick<FailureReport, 'severity' | 'phase' | 'code'> & {
      scope: 'viewer' | 'track';
    };
    /** The event (or console line) that proves the scenario happened. */
    fired: (events: Detail[]) => Promise<void>;
    /** Row whose label would carry a track notice. */
    row?: string;
    after?: (el: El) => void;
  };

  const SCENARIOS: Scenario[] = [
    {
      name: 'coordinates outside the sequence',
      config: {
        sequence: RESIDUES,
        rows: [
          csvTrack('lab', 'Lab hits', ['DOMAIN,5,20,a,', 'REGION,30,60,b,']),
        ],
      },
      report: {
        severity: 'warning',
        scope: 'track',
        phase: 'track-data',
        code: 'coordinate-out-of-range',
      },
      fired: (ev) => eventFired(ev, hasCode('coordinate-out-of-range')),
      row: 'lab',
    },
    {
      name: 'an unpaintable colour',
      config: {
        sequence: RESIDUES,
        rows: [csvTrack('lab', 'Lab hits', ['DOMAIN,5,20,a,bleu'])],
      },
      report: {
        severity: 'warning',
        scope: 'track',
        phase: 'track-data',
        code: 'unpaintable-color',
      },
      fired: (ev) => eventFired(ev, hasCode('unpaintable-color')),
      row: 'lab',
    },
    {
      name: 'an ignored column',
      config: {
        sequence: RESIDUES,
        rows: [
          labHits({
            dataTooltip: undefined,
            data: {
              from: 'inline',
              format: 'csv',
              inlineData:
                'type,start,end,description,tooltipContent\nDOMAIN,5,20,a,x',
            },
          }),
        ],
      },
      report: {
        severity: 'warning',
        scope: 'track',
        phase: 'track-data',
        code: 'data-field-ignored',
      },
      fired: (ev) => eventFired(ev, hasCode('data-field-ignored')),
      row: 'lab',
    },
    {
      name: 'a tooltip field no record has',
      config: {
        sequence: RESIDUES,
        rows: [okTrack('lab', 'Lab hits')].map((t) => ({
          ...t,
          dataTooltip: { kind: 'markdown', template: '{% $gene %}' },
        })),
      },
      report: {
        severity: 'warning',
        scope: 'track',
        phase: 'tooltip-field-miss',
      },
      fired: (ev) => eventFired(ev, hasCode('tooltip-field-miss')),
      row: 'lab',
    },
    {
      name: 'a skipped fetch',
      config: { sequence: RESIDUES, rows: [okTrack(), partner()] },
      report: {
        severity: 'warning',
        scope: 'viewer',
        phase: 'track-fetch',
        code: 'url-variable-unresolved',
      },
      fired: (ev) =>
        eventFired(ev, (d) => d.message.startsWith('Not fetching')),
    },
    {
      name: 'a component with no renderer',
      config: { sequence: RESIDUES, rows: [okTrack(), mine()] },
      report: {
        severity: 'warning',
        scope: 'viewer',
        phase: 'config',
        code: 'unrendered-component',
      },
      fired: (ev) => eventFired(ev, (d) => d.message.startsWith('No renderer')),
    },
    {
      name: 'a theme colour that does not resolve',
      config: {
        sequence: RESIDUES,
        theme: { accentColor: 'not-a-colour' },
        rows: [okTrack()],
      },
      report: {
        severity: 'warning',
        scope: 'viewer',
        phase: 'config',
        code: 'theme-color-ignored',
      },
      fired: (ev) =>
        eventFired(ev, (d) => d.message.startsWith('Ignoring theme')),
    },
    {
      name: 'a rejected setTrackData() call',
      config: { sequence: RESIDUES, rows: [okTrack()] },
      report: { severity: 'warning', scope: 'viewer', phase: 'set-track-data' },
      fired: (ev) => eventFired(ev, (d) => d.phase === 'set-track-data'),
      after: (el) => el.setTrackData('nope', 'x', []),
    },
    {
      name: 'a config validation warning',
      config: {
        sequence: RESIDUES,
        rows: [{ ...okTrack(), detailOnly: true }],
      },
      report: { severity: 'warning', scope: 'viewer', phase: 'config' },
      fired: (ev) => eventFired(ev, hasCode('detail-only-standalone')),
    },
    {
      name: 'a payload rejected under a key no row owns',
      config: { sequence: RESIDUES, rows: [okTrack()] },
      report: { severity: 'warning', scope: 'viewer', phase: 'track-fetch' },
      fired: (ev) => eventFired(ev, (d) => d.message.includes('no-such-key')),
      after: (el) => el._assignComponentData(rejecting(), [], 'no-such-key'),
    },
    {
      name: 'a track error',
      config: { sequence: RESIDUES, rows: [okTrack(), broken()] },
      report: { severity: 'error', scope: 'track', phase: 'track-fetch' },
      fired: (ev) => eventFired(ev, (d) => d.severity === 'error'),
      row: 'broken',
    },
    {
      name: 'a provider 404 (info)',
      config: {
        sequence: RESIDUES,
        sources: { features: 'https://example.org/features' },
        rows: [
          okTrack(),
          { id: 'prov', label: 'Provider', kind: 'features', data: 'features' },
        ],
      },
      report: { severity: 'info', scope: 'track', phase: 'track-fetch' },
      fired: () =>
        vi.waitFor(() => {
          const info = vi.mocked(console.info).mock.calls;
          if (!info.some((c) => String(c[0]).includes('no data (HTTP 404)'))) {
            throw new Error('no info line yet');
          }
        }),
      row: 'prov',
    },
  ];

  it.each(SCENARIOS)('$name', async ({ config, report, fired, row, after }) => {
    quiet();
    const { el, events } = mountEl(config);
    await ready(el, events, '');
    after?.(el);
    await fired(events);
    await el.updateComplete;

    const expected = ruleFor({
      ...report,
      scope: report.scope === 'viewer' ? 'viewer' : { trackKey: 'x' },
      message: '',
      consoleLevel: 'warn',
    }).notice;
    const onRow = row ? (rowLabel(el, row)?.querySelector(NOTE) ?? null) : null;
    const onTop = topNote(el);
    expect(!!onRow, 'track notice').toBe(expected === 'track');
    expect(!!onTop, 'viewer notice').toBe(expected === 'viewer');
    if (expected === 'none') expect(el.querySelector(NOTE)).toBeNull();
  });

  // Author mode lists what the event carries: every error and warning,
  // never info — the routing table's event column.
  it.each(SCENARIOS)(
    'author mode: $name',
    async ({ config, report, fired, after }) => {
      quiet();
      const { el, events } = mountEl(config, { attrs: ['show-warnings'] });
      await ready(el, events, '');
      after?.(el);
      await fired(events);
      await el.updateComplete;

      const rule = ruleFor({
        ...report,
        scope: report.scope === 'viewer' ? 'viewer' : { trackKey: 'x' },
        message: '',
        consoleLevel: 'warn',
      });
      expect(authorTexts(el).sort()).toEqual(eventTexts(events).sort());
      // The scenario's own report is among them exactly when it has an event.
      expect(authorTexts(el).length > 0).toBe(rule.event);
      // Author mode replaces the visitor ⓘ: one control per anchor.
      expect(el.querySelector(`.${CSS_PREFIX}-note--notice`)).toBeNull();
    }
  );
});

describe('what a visitor notice says', () => {
  it('counts the features outside the sequence', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [
        csvTrack('lab', 'Lab hits', [
          'DOMAIN,5,20,a,',
          'REGION,30,60,b,',
          'SITE,0,3,c,',
        ]),
      ],
    });
    await ready(el, events);
    const note = rowLabel(el, 'lab')!.querySelector(NOTE)!;
    expect(note.getAttribute('aria-label')).toBe('Note about Lab hits');
    expect(linesOf(note)).toEqual([TWO_OUTSIDE]);
  });

  it('counts them in accession mode too', async () => {
    quiet();
    const { el, events } = mountEl({
      accession: 'P05067',
      rows: [
        csvTrack('lab', 'Lab hits', [
          'DOMAIN,5,20,a,',
          'REGION,30,60,b,',
          'SITE,0,3,c,',
        ]),
      ],
    });
    // The entry answers with the same 40 residues.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/proteins/api/proteins/')
          ? ({
              ok: true,
              status: 200,
              json: async () => ({ sequence: { sequence: RESIDUES } }),
              text: async () => '',
            } as unknown as Response)
          : notFound()()
      )
    );
    await ready(el, events);
    expect(linesOf(rowLabel(el, 'lab')!.querySelector(NOTE)!)).toEqual([
      TWO_OUTSIDE,
    ]);
  });

  it('names the skipped tracks on the top bar, and nothing on a row', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    const top = topNote(el)!;
    expect(top.getAttribute('aria-label')).toBe('Notes about this view (2)');
    expect(popoverOf(top).textContent).toContain('About this view');
    expect(linesOf(top)).toEqual([
      "“Mine” can't be displayed in this viewer.",
      "“Partner data” isn't shown: its data couldn't be loaded.",
    ]);
    // Lab hits carries its own two lines.
    expect(linesOf(rowLabel(el, 'lab')!.querySelector(NOTE)!)).toEqual([
      COLOUR_TEXT,
      TWO_OUTSIDE,
    ]);
    // Visitors never see a URL, a file, a field or a variable.
    for (const line of allLines(el)) {
      expect(line).not.toMatch(/https?:|\{|\.csv|tooltipContent|gene/);
    }
  });

  it('says a track that fetched some of its URLs is incomplete', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      sources: {
        here: 'https://example.org/here',
        there: 'https://example.org/{dataset}/there',
      },
      rows: [
        okTrack(),
        {
          id: 'two',
          label: 'Two sources',
          kind: 'features',
          data: { source: ['here', 'there'] },
        },
      ],
    });
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('Not fetching'));
    await el.updateComplete;
    expect(linesOf(topNote(el)!)).toEqual([
      "“Two sources” is incomplete: some of its data couldn't be loaded.",
    ]);
  });
});

describe('quiet-notices', () => {
  it('removes every notice, and a runtime toggle brings them back', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['quiet-notices'] });
    await ready(el, events);
    expect(el.querySelector(NOTE)).toBeNull();

    el.removeAttribute('quiet-notices');
    await el.updateComplete;
    expect(topNote(el)).not.toBeNull();
    expect(rowLabel(el, 'lab')!.querySelector(NOTE)).not.toBeNull();

    el.setAttribute('quiet-notices', '');
    await el.updateComplete;
    expect(el.querySelector(NOTE)).toBeNull();
  });
});

describe('where a note goes', () => {
  /** A grouped track whose rows are all filtered out: a colour note, no data. */
  const emptyColour = () =>
    csvTrack('pale', 'Pale', ['DOMAIN,5,20,a,bleu'], { filter: 'NOPE' });

  const grouped = (tracks: unknown[], extra: Record<string, unknown> = {}) => ({
    sequence: RESIDUES,
    rows: [{ id: 'G', label: 'Group', tracks }, okTrack('other', 'Other')],
    ...extra,
  });

  /** Each line once in the whole viewer; `on` says where. */
  const expectOnce = (el: El, text: string, on: 'row' | 'top') => {
    const hits = allLines(el).filter((l) => l.endsWith(text));
    expect(hits, text).toHaveLength(1);
    const top = topNote(el) ?? noResultsNote(el);
    const inTop = top ? linesOf(top).some((l) => l.endsWith(text)) : false;
    expect(inTop ? 'top' : 'row').toBe(on);
  };

  const labInGroup = () =>
    csvTrack('lab', 'Lab hits', [
      'DOMAIN,5,20,a,',
      'REGION,30,60,b,',
      'SITE,0,3,c,',
    ]);

  it('collapsed group: on the top bar, named', async () => {
    quiet();
    const { el, events } = mountEl(grouped([labInGroup()]));
    await ready(el, events);
    expectOnce(el, TWO_OUTSIDE, 'top');
    expect(linesOf(topNote(el)!)).toEqual([`Lab hits: ${TWO_OUTSIDE}`]);
  });

  it('expanded group: on the track only', async () => {
    quiet();
    const { el, events } = mountEl(grouped([labInGroup()]), {
      props: { openGroups: ['G'] },
    });
    await ready(el, events);
    expectOnce(el, TWO_OUTSIDE, 'row');
    expect(trackLabel(el, 'lab')!.querySelector(NOTE)).not.toBeNull();
  });

  it('a group toggled open and closed moves the note, never copies it', async () => {
    quiet();
    const { el, events } = mountEl(grouped([labInGroup()]));
    await ready(el, events);
    el.openGroups = ['G'];
    await el.updateComplete;
    expectOnce(el, TWO_OUTSIDE, 'row');
    el.openGroups = [];
    await el.updateComplete;
    expectOnce(el, TWO_OUTSIDE, 'top');
  });

  it('open group, empty track: on the top bar', async () => {
    quiet();
    const { el, events } = mountEl(grouped([labInGroup(), emptyColour()]), {
      props: { openGroups: ['G'] },
    });
    await ready(el, events);
    await eventFired(events, hasCode('unpaintable-color'));
    await el.updateComplete;
    expectOnce(el, COLOUR_TEXT, 'top');
    expectOnce(el, TWO_OUTSIDE, 'row');
  });

  it('group-error row: on the top bar', async () => {
    quiet();
    const { el, events } = mountEl(grouped([broken(), emptyColour()]));
    await ready(el, events, 'unpaintable-color');
    // The group draws only its header and badge.
    expect(el.querySelector(`#${CSS_PREFIX}-group_G ${BADGE}`)).not.toBeNull();
    expectOnce(el, COLOUR_TEXT, 'top');
  });

  it('a hidden track has no visitor line, until customize mode shows it', async () => {
    quiet();
    const { el, events } = mountEl(
      grouped([okTrack('shown', 'Shown'), { ...labInGroup(), hidden: true }]),
      { props: { openGroups: ['G'] } }
    );
    await ready(el, events);
    expect(allLines(el).filter((l) => l.endsWith(TWO_OUTSIDE))).toEqual([]);

    // A ghost row draws its label, so the note is on it.
    el._customizeMode = true;
    await el.updateComplete;
    expectOnce(el, TWO_OUTSIDE, 'row');
  });

  it('a hidden track is not named on the top bar either, until customize mode shows it', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [okTrack(), { ...partner(), hidden: true }],
    });
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('Not fetching'));
    await el.updateComplete;
    expect(topNote(el)).toBeNull();
    // Author mode lists the skip, and says visitors see nothing of it.
    el.setAttribute('show-warnings', '');
    await el.updateComplete;
    const author = popoverOf(topNote(el)!).textContent!;
    expect(author).toContain('Not fetching');
    expect(author).not.toContain('Visitors see');
    el.removeAttribute('show-warnings');

    el._customizeMode = true;
    await el.updateComplete;
    expect(linesOf(topNote(el)!)).toEqual([
      "“Partner data” isn't shown: its data couldn't be loaded.",
    ]);
  });

  it('names only the shown tracks of a skip several tracks share', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [
        okTrack(),
        partner(),
        { ...partner('p2', 'Hidden'), hidden: true },
      ],
    });
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('Not fetching'));
    await el.updateComplete;
    expect(linesOf(topNote(el)!)).toEqual([
      "“Partner data” isn't shown: its data couldn't be loaded.",
    ]);
  });

  it('a hidden row with no renderer is not named', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [okTrack(), { ...mine(), hidden: true }],
    });
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('No renderer'));
    await el.updateComplete;
    expect(allLines(el).filter((l) => l.includes('Mine'))).toEqual([]);
  });

  it('customize stub: on the top bar', async () => {
    quiet();
    const { el, events } = mountEl(grouped([labInGroup(), emptyColour()]), {
      props: { openGroups: ['G'] },
    });
    await ready(el, events, 'unpaintable-color');
    el._customizeMode = true;
    await el.updateComplete;
    // The empty track is a stub: a label with controls, but no notes.
    expect(trackLabel(el, 'pale')).not.toBeNull();
    expect(trackLabel(el, 'pale')!.querySelector(NOTE)).toBeNull();
    expectOnce(el, COLOUR_TEXT, 'top');
  });

  it('no results: every note on the one control, with a live region', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [partner(), emptyColour()],
    });
    await vi.waitFor(() => {
      if (!el.querySelector('.protvista-no-results'))
        throw new Error('not yet');
    });
    await eventFired(events, hasCode('unpaintable-color'));
    await el.updateComplete;
    const note = noResultsNote(el)!;
    expect(linesOf(note)).toEqual([
      "“Partner data” isn't shown: its data couldn't be loaded.",
      `Pale: ${COLOUR_TEXT}`,
    ]);
    expect(el.querySelector(`.${CSS_PREFIX}-live-region`)).not.toBeNull();
  });
});

describe('notes follow the loads that raised them', () => {
  it('a full reload replaces the load notes', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [okTrack(), partner()],
    });
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('Not fetching'));
    await el.updateComplete;
    expect(topNote(el)).not.toBeNull();

    // Defining the variable reloads every track: the URL is now fetched (and
    // 404s, a badge), so nothing is skipped any more.
    el.setAttribute('data-dataset', 'v1');
    await vi.waitFor(() => {
      if (!el.querySelector(`#${CSS_PREFIX}-group_partner ${BADGE}`)) {
        throw new Error('not reloaded yet');
      }
    });
    await el.updateComplete;
    expect(topNote(el)).toBeNull();
  });

  it('a targeted retry keeps every other track’s notes', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [
        csvTrack('lab', 'Lab hits', [
          'DOMAIN,5,20,a,',
          'REGION,30,60,b,',
          'SITE,0,3,c,',
        ]),
        broken(),
      ],
    });
    await ready(el, events);
    await el._loadData(new Set(['broken-broken']));
    await el.updateComplete;
    expect(linesOf(rowLabel(el, 'lab')!.querySelector(NOTE)!)).toEqual([
      TWO_OUTSIDE,
    ]);
  });

  it('a new config drops the old config’s notes', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [okTrack(), mine()],
    });
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('No renderer'));
    await el.updateComplete;
    expect(topNote(el)).not.toBeNull();

    await el.setConfig({ sequence: RESIDUES, rows: [okTrack()] });
    await ready(el, events, '');
    expect(topNote(el)).toBeNull();
  });
});

describe('overlapping setConfig() calls', () => {
  it('keep only the last config’s notes', async () => {
    quiet();
    const { el, events } = mountEl({ sequence: RESIDUES, rows: [okTrack()] });
    await ready(el, events, '');
    // Both start before either resolves, so both pass the config drop first.
    const first = el.setConfig({
      sequence: RESIDUES,
      rows: [okTrack(), mine()],
    });
    const second = el.setConfig({ sequence: RESIDUES, rows: [okTrack()] });
    await Promise.all([first, second]);
    await ready(el, events, '');
    await el.updateComplete;
    // The first config did apply and warn: its note is what must go.
    expect(events.some((d) => d.message.startsWith('No renderer'))).toBe(true);
    expect(el.config!.rows.map((r) => r.id)).toEqual(['ok']);
    expect(topNote(el)).toBeNull();
  });
});

describe('the announcement', () => {
  const regionText = (el: El) =>
    el.querySelector(`.${CSS_PREFIX}-live-region`)!.textContent!.trim();

  it('is made once, after the region has settled, and not again on a group toggle', async () => {
    quiet();
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: [
        {
          id: 'G',
          label: 'Group',
          tracks: [
            csvTrack('lab', 'Lab hits', [
              'DOMAIN,5,20,a,',
              'REGION,30,60,b,',
              'SITE,0,3,c,',
            ]),
          ],
        },
      ],
    });
    const announce = vi.spyOn(
      el as unknown as { _announce(m: string): void },
      '_announce'
    );
    await ready(el, events);
    const expected = `Note about Lab hits: ${TWO_OUTSIDE}`;
    // The control is up, but the region does not hold the text yet: it
    // arrives as an update to a region already on screen.
    expect(regionText(el)).not.toBe(expected);
    await vi.waitFor(() => expect(regionText(el)).toBe(expected));
    const said = () => announce.mock.calls.filter(([m]) => m === expected);
    expect(said()).toHaveLength(1);

    el.openGroups = ['G'];
    await el.updateComplete;
    el.openGroups = [];
    await el.updateComplete;
    await sleep(250);
    expect(said()).toHaveLength(1);
  });

  it('counts several notes and points at the controls', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    await vi.waitFor(() =>
      expect(regionText(el)).toBe(
        "4 notes about what's shown. Use the information buttons beside the track names and the Customize button to read them."
      )
    );
  });

  it('says nothing under quiet-notices', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['quiet-notices'] });
    const announce = vi.spyOn(
      el as unknown as { _announce(m: string): void },
      '_announce'
    );
    await ready(el, events);
    await sleep(250);
    expect(announce.mock.calls.filter(([m]) => /note/i.test(m))).toEqual([]);
  });
});

describe('the popover', () => {
  const open = async (el: El, button: HTMLElement) => {
    button.click();
    await el.updateComplete;
  };

  it('opens on click, closes on Escape and hands focus back', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    const button = rowLabel(el, 'lab')!.querySelector<HTMLElement>(NOTE)!;
    expect(popoverOf(button).hidden).toBe(true);
    await open(el, button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(popoverOf(button).hidden).toBe(false);

    popoverOf(button).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await el.updateComplete;
    expect(popoverOf(button).hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes on a press outside it, and not on one inside', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    const button = topNote(el)!;
    await open(el, button);
    popoverOf(button).dispatchEvent(
      new Event('pointerdown', { bubbles: true })
    );
    await el.updateComplete;
    expect(popoverOf(button).hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await el.updateComplete;
    expect(popoverOf(button).hidden).toBe(true);
  });

  it('keeps one popover open at a time', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    const track = rowLabel(el, 'lab')!.querySelector<HTMLElement>(NOTE)!;
    const top = topNote(el)!;
    await open(el, track);
    await open(el, top);
    expect(popoverOf(track).hidden).toBe(true);
    expect(popoverOf(top).hidden).toBe(false);
  });

  it('gives each control its own id, so one click opens one popover', async () => {
    quiet();
    // Ids that flatten to the same characters: two of a length outside
    // ASCII, and two that differ only by punctuation.
    const ids = ['α', 'β', 'a b', 'a.b'];
    const { el, events } = mountEl({
      sequence: RESIDUES,
      rows: ids.map((id) => csvTrack(id, `Track ${id}`, ['REGION,30,60,b,'])),
    });
    await ready(el, events);
    await vi.waitFor(() => {
      if (el.querySelectorAll(`.${CSS_PREFIX}-track-label ${NOTE}`).length < 4)
        throw new Error('not every note yet');
    });
    const buttons = [
      ...el.querySelectorAll<HTMLElement>(`.${CSS_PREFIX}-track-label ${NOTE}`),
    ];
    expect(new Set(buttons.map((b) => b.id)).size).toBe(4);
    for (const button of buttons) {
      await open(el, button);
      const shown = [
        ...el.querySelectorAll<HTMLElement>(`.${CSS_PREFIX}-note-popover`),
      ].filter((p) => !p.hidden);
      expect(shown).toEqual([popoverOf(button)]);
      expect(button.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('stops following its button when the element is removed', async () => {
    quiet();
    const cleanup = vi.fn();
    autoUpdateSpy.mockImplementation(() => cleanup);
    const { el, events } = mountEl(everything());
    await ready(el, events);
    await open(el, topNote(el)!);
    expect(autoUpdateSpy).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    el.remove();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

// ── Author mode ─────────────────────────────────────────────────

const AUTHOR = `.${CSS_PREFIX}-note--author`;
const ERROR_NOTE = `.${CSS_PREFIX}-note--error`;

describe('author mode is opt-in', () => {
  it('is off by default', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    expect(el.querySelector(AUTHOR)).toBeNull();
    expect(el.querySelector(ERROR_NOTE)).toBeNull();
    expect(authorTexts(el)).toEqual([]);
  });

  it('turns on with the show-warnings attribute alone', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['show-warnings'] });
    await ready(el, events);
    expect(el.querySelector(AUTHOR)).not.toBeNull();
  });

  it('turns on with showWarnings: true in the config alone', async () => {
    quiet();
    const { el, events } = mountEl(everything({ showWarnings: true }));
    await ready(el, events);
    expect(el.querySelector(AUTHOR)).not.toBeNull();
  });

  it('turns on and off at runtime, with no reload', async () => {
    quiet();
    const { el, events } = mountEl(everything());
    await ready(el, events);
    el.setAttribute('show-warnings', '');
    await el.updateComplete;
    expect(el.querySelector(AUTHOR)).not.toBeNull();
    el.removeAttribute('show-warnings');
    await el.updateComplete;
    expect(el.querySelector(AUTHOR)).toBeNull();
    expect(topNote(el)).not.toBeNull();
  });
});

describe('author mode lists every warning, as the event and playground say it', () => {
  it('shows the same texts as the event, for every warning kind', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['show-warnings'] });
    await ready(el, events);
    el.setTrackData('nope', 'x', []);
    el._assignComponentData(rejecting(), [], 'no-such-key');
    await el.updateComplete;
    const warnings = events.filter((d) => d.severity === 'warning');
    // Seven kinds, ten texts: the fixture really raises them all.
    expect(warnings.length).toBeGreaterThanOrEqual(9);
    expect(authorTexts(el).sort()).toEqual(eventTexts(events).sort());
    // No console tag reaches a person.
    for (const t of authorTexts(el)) expect(t).not.toMatch(/^\[protvista/);
  });

  it('says what visitors see, unless notices are off', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['show-warnings'] });
    await ready(el, events);
    const lab = rowLabel(el, 'lab')!.querySelector(AUTHOR)!;
    const text = popoverOf(lab).textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(`Visitors see: “${TWO_OUTSIDE}”`);
    expect(text).toContain(`Visitors see: “${COLOUR_TEXT}”`);
    expect(text).toContain(
      "Shown because author mode (show-warnings) is on. Visitors don't see this list."
    );
    // The ignored column and the tooltip miss tell visitors nothing.
    expect(text.match(/Visitors see/g)).toHaveLength(2);

    el.setAttribute('quiet-notices', '');
    await el.updateComplete;
    expect(
      popoverOf(rowLabel(el, 'lab')!.querySelector(AUTHOR)!).textContent
    ).not.toContain('Visitors see');
  });

  it('names the phase, code and path of each entry', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['show-warnings'] });
    await ready(el, events);
    const lab = rowLabel(el, 'lab')!.querySelector(AUTHOR)!;
    expect(lab.textContent!.trim()).toBe('⚠ 4');
    expect(lab.getAttribute('aria-label')).toBe(
      '4 authoring notes for Lab hits'
    );
    const metas = [
      ...popoverOf(lab).querySelectorAll(`.${CSS_PREFIX}-note-popover__meta`),
    ].map((m) => m.textContent);
    expect(metas).toContain('track-data · coordinate-out-of-range · lab');
    expect(metas).toContain('tooltip-field-miss · lab');
  });

  it('counts three identical setTrackData() misuses as one entry ×3', async () => {
    quiet();
    const { el, events } = mountEl(
      { sequence: RESIDUES, rows: [okTrack()] },
      { attrs: ['show-warnings'] }
    );
    await ready(el, events, '');
    for (let i = 0; i < 3; i++) el.setTrackData('nope', 'x', []);
    await el.updateComplete;
    const top = topNote(el)!;
    expect(linesOf(top)).toHaveLength(1);
    expect(popoverOf(top).textContent).toContain('×3');
  });

  it('keeps at most 200 notes on one anchor', async () => {
    quiet();
    const { el, events } = mountEl(
      { sequence: RESIDUES, rows: [okTrack()] },
      { attrs: ['show-warnings'] }
    );
    await ready(el, events, '');
    // 201 different calls: none merges into another.
    for (let i = 0; i <= 200; i++) el.setTrackData('nope', `x${i}`, []);
    await el.updateComplete;
    expect(events.filter((d) => d.phase === 'set-track-data')).toHaveLength(
      201
    );
    expect(linesOf(topNote(el)!)).toHaveLength(200);
  });

  it('does not count a skip a targeted retry reports again', async () => {
    quiet();
    const { el, events } = mountEl(
      {
        sequence: RESIDUES,
        sources: {
          here: 'https://example.org/here',
          there: 'https://example.org/{dataset}/there',
        },
        rows: [
          okTrack(),
          {
            id: 'two',
            label: 'Two sources',
            kind: 'features',
            data: { source: ['here', 'there'] },
          },
        ],
      },
      { attrs: ['show-warnings'] }
    );
    // `here` answers 503: a recoverable error, so the track can be retried.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            json: async () => ({}),
            text: async () => '',
          }) as unknown as Response
      )
    );
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('Not fetching'));
    await el._loadData(new Set(['two-two']));
    await el.updateComplete;
    // Reported twice, listed once.
    expect(
      events.filter((d) => d.message.startsWith('Not fetching'))
    ).toHaveLength(2);
    const skip = authorTexts(el).filter((t) => t.startsWith('Not fetching'));
    expect(skip).toHaveLength(1);
    expect(popoverOf(topNote(el)!).textContent).not.toContain('×2');
  });

  it('lists a shared skip once after a retry of a track that is not its first', async () => {
    quiet();
    const { el, events } = mountEl(
      {
        sequence: RESIDUES,
        sources: {
          here: 'https://example.org/here',
          there: 'https://example.org/{dataset}/there',
        },
        rows: [
          {
            id: 'one',
            label: 'Only there',
            kind: 'features',
            data: { source: 'there' },
          },
          {
            id: 'two',
            label: 'Two sources',
            kind: 'features',
            data: { source: ['here', 'there'] },
          },
        ],
      },
      { attrs: ['show-warnings'] }
    );
    // `here` answers 503, so the second track can be retried on its own.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            json: async () => ({}),
            text: async () => '',
          }) as unknown as Response
      )
    );
    await ready(el, events, '');
    await eventFired(events, (d) => d.message.startsWith('Not fetching'));
    await el.updateComplete;
    const before = topNote(el)!.textContent!.trim();
    await el._loadData(new Set(['two-two']));
    await el.updateComplete;
    // The retry reports the skip naming the second track, not the first.
    const skips = events.filter((d) => d.message.startsWith('Not fetching'));
    expect(skips.map((d) => d.message.includes('track two/two'))).toEqual([
      false,
      true,
    ]);
    expect(authorTexts(el).filter((t) => t.startsWith('Not fetching'))).toEqual(
      [skips[0].message]
    );
    expect(topNote(el)!.textContent!.trim()).toBe(before);
  });

  it('is announced once, as a count', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['show-warnings'] });
    await ready(el, events);
    await vi.waitFor(() =>
      expect(
        el.querySelector(`.${CSS_PREFIX}-live-region`)!.textContent!.trim()
      ).toMatch(
        /^\d+ authoring notes\. Use the warning buttons to read them\.$/
      )
    );
  });
});

describe('author mode expands errors', () => {
  it('turns the track badge into a button listing its text and source', async () => {
    quiet();
    const { el, events } = mountEl(everything(), { attrs: ['show-warnings'] });
    await ready(el, events);
    const label = rowLabel(el, 'broken')!;
    // The image badge is gone: the button replaces it, same glyph and red.
    expect(label.querySelector('span[role="img"]')).toBeNull();
    const button = label.querySelector<HTMLButtonElement>(ERROR_NOTE)!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.classList.contains(`${CSS_PREFIX}-error-badge`)).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe(
      'Track failed to load — 1 authoring note'
    );
    const text = popoverOf(button).textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(
      './missing.csv could not be found (HTTP 404) — check the path is relative to the page.'
    );
    expect(text).toContain('Source: ./missing.csv');
    // Retry is kept beside it.
    expect(label.querySelector(`.${CSS_PREFIX}-error-retry`)).not.toBeNull();
  });

  it('lists the error of a track in a collapsed group on the top bar', async () => {
    quiet();
    const { el, events } = mountEl(
      {
        sequence: RESIDUES,
        rows: [{ id: 'G', label: 'Group', tracks: [okTrack(), broken()] }],
      },
      { attrs: ['show-warnings'] }
    );
    await ready(el, events, '');
    await eventFired(events, (d) => d.severity === 'error');
    await el.updateComplete;
    // The group keeps its count badge; the text goes to the top bar.
    expect(el.querySelector(`#${CSS_PREFIX}-group_G ${BADGE}`)!.tagName).toBe(
      'SPAN'
    );
    const top = el.querySelector(`${TOP_BAR} ${AUTHOR}`)!;
    expect(popoverOf(top).textContent!.replace(/\s+/g, ' ')).toContain(
      'Broken ./missing.csv could not be found (HTTP 404)'
    );
  });

  it('adds the console text to the strict track panel, in author mode only', async () => {
    quiet();
    const config = everything({ strict: true, rows: [labHits(), broken()] });
    const detail = `.${CSS_PREFIX}-error-panel__detail`;
    const off = mountEl(config);
    await vi.waitFor(() => {
      if (!off.el.querySelector(PANEL)) throw new Error('no panel');
    });
    expect(off.el.querySelector(detail)).toBeNull();

    const on = mountEl(config, { attrs: ['show-warnings'] });
    await vi.waitFor(() => {
      if (!on.el.querySelector(PANEL)) throw new Error('no panel');
    });
    await on.el.updateComplete;
    expect(on.el.querySelector(detail)!.textContent!.trim()).toBe(
      'broken/broken: ./missing.csv could not be found (HTTP 404) — check the path is relative to the page.'
    );
  });

  it.each([
    ['a missing track', ['nope', 'x', []]],
    ['null data', ['G', 't', null]],
  ] as const)(
    'does not repeat a strict setTrackData() panel’s summary as its detail (%s)',
    async (_, args) => {
      quiet();
      const { el, events } = mountEl(
        {
          sequence: RESIDUES,
          strict: true,
          rows: [{ id: 'G', label: 'G', tracks: [okTrack('t', 'T')] }],
        },
        { attrs: ['show-warnings'] }
      );
      await ready(el, events, '');
      el.setTrackData(...(args as unknown as [string, string, unknown]));
      await vi.waitFor(() => {
        if (!el.querySelector(PANEL)) throw new Error('no panel');
      });
      await el.updateComplete;
      expect(el.querySelector(PANEL)!.textContent).toContain('setTrackData');
      expect(el.querySelector(`.${CSS_PREFIX}-error-panel__detail`)).toBeNull();
    }
  );

  it('keeps the detail on a config-failure panel through the rich upgrade', async () => {
    quiet();
    const { el } = mountEl(
      {
        sequence: RESIDUES,
        rows: [
          {
            id: 'FOO',
            tracks: [{ id: 'bar', kind: 'features', data: 'missingKey' }],
          },
        ],
      },
      { attrs: ['show-warnings'] }
    );
    await vi.waitFor(() => {
      if (!el.querySelector(`.${CSS_PREFIX}-error-issues`)) {
        throw new Error('no upgraded panel');
      }
    });
    await el.updateComplete;
    expect(
      el
        .querySelector(`.${CSS_PREFIX}-error-panel__detail`)!
        .textContent!.trim()
    ).toBe('Failed to load config.');
  });
});

describe('every author note appears exactly once', () => {
  const lab = () =>
    csvTrack('lab', 'Lab hits', [
      'DOMAIN,5,20,a,',
      'REGION,30,60,b,',
      'SITE,0,3,c,',
    ]);
  const pale = () =>
    csvTrack('pale', 'Pale', ['DOMAIN,5,20,a,bleu'], { filter: 'NOPE' });
  const group = (tracks: unknown[]) => ({
    sequence: RESIDUES,
    rows: [{ id: 'G', label: 'Group', tracks }, okTrack('other', 'Other')],
  });

  const CASES: {
    name: string;
    config: unknown;
    props?: Partial<El>;
    customize?: boolean;
  }[] = [
    { name: 'collapsed group', config: group([lab(), pale()]) },
    {
      name: 'expanded group',
      config: group([lab(), pale()]),
      props: { openGroups: ['G'] },
    },
    { name: 'group-error row', config: group([broken(), pale()]) },
    {
      name: 'hidden track',
      config: group([okTrack('shown', 'Shown'), { ...lab(), hidden: true }]),
      props: { openGroups: ['G'] },
    },
    {
      name: 'customize ghost and stub',
      config: group([
        okTrack('shown', 'Shown'),
        { ...lab(), hidden: true },
        pale(),
      ]),
      props: { openGroups: ['G'] },
      customize: true,
    },
    {
      name: 'no results',
      config: { sequence: RESIDUES, rows: [partner(), pale()] },
    },
  ];

  it.each(CASES)('$name', async ({ config, props, customize }) => {
    quiet();
    const { el, events } = mountEl(config, {
      attrs: ['show-warnings'],
      ...(props ? { props } : {}),
    });
    await vi.waitFor(() => {
      if (!el.querySelector(`nightingale-manager, .protvista-no-results`)) {
        throw new Error('not rendered');
      }
      if (
        !events.some(hasCode('unpaintable-color')) &&
        !events.some(hasCode('coordinate-out-of-range'))
      ) {
        throw new Error('no warnings yet');
      }
    });
    await sleep(20);
    if (customize) el._customizeMode = true;
    await el.updateComplete;
    const expected = eventTexts(events);
    expect(expected.length).toBeGreaterThan(0);
    expect(authorTexts(el).sort()).toEqual([...expected].sort());
  });
});
