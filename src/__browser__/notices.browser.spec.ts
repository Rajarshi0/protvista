/**
 * Visitor notices in a real browser: keyboard, axe, narrow screens and the
 * live region. The jsdom suite (`src/__spec__/notices.spec.ts`) pins what the
 * notices say and where they go; this file is about whether a person can
 * reach and read them — focus that really moves, a popover that is really on
 * screen, and the label column at its real `20vw`.
 *
 * Network-free: a `sequence:` config with inline CSV, Nightingale stubbed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { track, unmountAll } from './mount.js';
import { expectNoA11yViolations } from './axe.js';

const RESIDUES = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV';
const NOTE = `.${CSS_PREFIX}-note`;
const TOP_NOTE = `.${CSS_PREFIX}-nav-track-label ${NOTE}`;

type El = HTMLElement & {
  viewerConfig?: unknown;
  openGroups?: string[];
  _customizeMode?: boolean;
  updateComplete: Promise<unknown>;
};

const LAB = {
  id: 'lab',
  label: 'Lab hits',
  kind: 'features',
  data: {
    from: 'inline',
    format: 'csv',
    inlineData: [
      'type,start,end,description,color',
      'DOMAIN,5,20,a,#2a7',
      'REGION,30,60,b,bleu',
      'SITE,0,3,c,#catFace',
    ].join('\n'),
  },
};

/** Lab hits (two notices) standalone, and a URL whose variable is undefined. */
const CONFIG = {
  sequence: RESIDUES,
  rows: [
    LAB,
    {
      id: 'partner',
      label: 'Partner data',
      kind: 'features',
      data: 'https://example.org/{dataset}/hits.csv',
    },
  ],
};

/** The same track inside a group, for the group toggle. */
const GROUPED = {
  sequence: RESIDUES,
  rows: [{ id: 'G', label: 'Group', tracks: [LAB] }],
};

afterEach(async () => {
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await page.viewport(1280, 720);
});

async function mountViewer(config: unknown, attrs: string[] = []) {
  // Only the author's own `./missing.csv` is ever fetched, and it 404s.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Not Found', { status: 404 }))
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const el = document.createElement('protvista-uniprot') as unknown as El;
  for (const a of attrs) el.setAttribute(a, '');
  el.viewerConfig = config;
  track(el);
  await vi.waitFor(
    () => {
      if (!el.querySelector(NOTE)) throw new Error('no notice yet');
    },
    { timeout: 5000 }
  );
  await el.updateComplete;
  return el;
}

const trackNote = (el: El) =>
  el.querySelector<HTMLButtonElement>(
    `#${CSS_PREFIX}-group_lab .${CSS_PREFIX}-track-label ${NOTE}`
  )!;
const popoverOf = (button: Element) =>
  document.getElementById(button.getAttribute('aria-controls')!)!;

/** Floating UI places the popover a frame or so after it opens. */
async function opened(el: El, button: HTMLElement) {
  button.click();
  await el.updateComplete;
  const popover = popoverOf(button);
  await vi.waitFor(() => {
    if (popover.hidden || !popover.style.left) throw new Error('not placed');
  });
  await new Promise((r) => requestAnimationFrame(r));
  return popover;
}

describe('visitor notices in a browser', () => {
  it('have no axe violations closed, open, and on the top bar', async () => {
    const el = await mountViewer(CONFIG);
    await expectNoA11yViolations(el);
    await opened(el, trackNote(el));
    await expectNoA11yViolations(el);
    await opened(el, el.querySelector<HTMLElement>(TOP_NOTE)!);
    await expectNoA11yViolations(el);
  });

  it('have no axe violations in author mode, the error badge open too', async () => {
    const el = await mountViewer(
      {
        ...CONFIG,
        rows: [
          ...CONFIG.rows,
          {
            id: 'broken',
            label: 'Broken',
            kind: 'features',
            data: './missing.csv',
          },
        ],
      },
      ['show-warnings']
    );
    const error = await vi.waitFor(() => {
      const button = el.querySelector<HTMLElement>(
        `#${CSS_PREFIX}-group_broken .${CSS_PREFIX}-note--error`
      );
      if (!button) throw new Error('no error control yet');
      return button;
    });
    await expectNoA11yViolations(el);
    await opened(
      el,
      el.querySelector<HTMLElement>(
        `#${CSS_PREFIX}-group_lab .${CSS_PREFIX}-note--author`
      )!
    );
    await expectNoA11yViolations(el);
    await opened(el, error);
    await expectNoA11yViolations(el);
    await opened(el, el.querySelector<HTMLElement>(TOP_NOTE)!);
    await expectNoA11yViolations(el);
  });

  it('are reachable with Tab, open with Enter, and close with Escape', async () => {
    const el = await mountViewer(CONFIG);
    const button = trackNote(el);
    document.body.focus();
    let presses = 0;
    while (document.activeElement !== button && presses < 30) {
      await userEvent.tab();
      presses += 1;
    }
    expect(document.activeElement).toBe(button);

    await userEvent.keyboard('{Enter}');
    await el.updateComplete;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(popoverOf(button).hidden).toBe(false);

    await userEvent.keyboard('{Escape}');
    await el.updateComplete;
    expect(popoverOf(button).hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  for (const [width, height] of [
    [320, 640],
    [390, 844],
  ] as const) {
    it(`stay on screen at ${width}px`, async () => {
      await page.viewport(width, height);
      const el = await mountViewer(CONFIG);
      for (const button of [
        trackNote(el),
        el.querySelector<HTMLElement>(TOP_NOTE)!,
      ]) {
        const box = (await opened(el, button)).getBoundingClientRect();
        expect(box.left, 'left edge').toBeGreaterThanOrEqual(0);
        expect(box.right, 'right edge').toBeLessThanOrEqual(width);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      // The top-bar ⓘ sits in the label column, under Customize.
      const column = el
        .querySelector(`.${CSS_PREFIX}-nav-track-label`)!
        .getBoundingClientRect();
      const top = el.querySelector(TOP_NOTE)!.getBoundingClientRect();
      expect(top.left).toBeGreaterThanOrEqual(column.left);
      expect(top.right).toBeLessThanOrEqual(column.right + 0.5);
    });
  }

  it('is not cut off by the label cell in customize mode', async () => {
    const el = await mountViewer(CONFIG);
    el._customizeMode = true;
    await el.updateComplete;
    const label = el.querySelector(
      `#${CSS_PREFIX}-group_lab .${CSS_PREFIX}-track-label`
    )!;
    // The cell does clip in this mode — which is what is being escaped.
    expect(getComputedStyle(label).overflow).toBe('hidden');
    const popover = await opened(el, trackNote(el));
    const box = popover.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(label.getBoundingClientRect().width);
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    );
    expect(popover.contains(hit)).toBe(true);
  });

  it('are announced once, and not again on a group or customize toggle', async () => {
    const el = await mountViewer(GROUPED);
    const region = el.querySelector(`.${CSS_PREFIX}-live-region`)!;
    const said: string[] = [];
    new MutationObserver(() => said.push(region.textContent!.trim())).observe(
      region,
      { childList: true, characterData: true, subtree: true }
    );
    const expected =
      "2 notes about what's shown. Use the information buttons beside the track names and the Customize button to read them.";
    await vi.waitFor(() => expect(region.textContent!.trim()).toBe(expected));
    el.openGroups = ['G'];
    await el.updateComplete;
    el.openGroups = [];
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 300));
    expect(said.filter((t) => t === expected)).toHaveLength(1);

    // Customize mode announces itself; the notes must not talk over it.
    el.querySelector<HTMLElement>(`.${CSS_PREFIX}-customize-toggle`)!.click();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 300));
    expect(region.textContent!.trim()).toMatch(/^Customize layout on/);
    expect(said.filter((t) => t === expected)).toHaveLength(1);
  });
});
