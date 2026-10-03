/**
 * "Load data file…" in the playground, through the real page controller.
 *
 * The playground's `index.ts` wires itself to the page's elements when it is
 * first imported, so this spec builds the same skeleton `playground.astro`
 * serves (the ids are the contract), seeds the URL hash with a small config,
 * stubs `fetch` for everything but `blob:` URLs, and imports the controller
 * once. The tests then run in order against that one live page — loading a
 * file is meant to change what comes next.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { userEvent } from 'vitest/browser';
import { EditorView } from 'codemirror';

import { CSS_PREFIX } from '../styles/css-prefix.js';
import { decodeState, encodeState } from '../playground/url-state.js';
import { expectNoA11yViolations } from './axe.js';

const BADGE = `.${CSS_PREFIX}-error-badge`;

/** Every id `index.ts` and the local-data control look up. */
const SKELETON = `
  <header>
    <select id="preset" aria-label="Configuration preset"></select>
    <input id="accession" aria-label="Accession" value="P05067" />
    <div class="local-data">
      <button id="load-data" type="button" aria-describedby="local-note">Load data file…</button>
      <input id="data-file" type="file" hidden />
      <span id="local-note">Read in your browser — never uploaded.</span>
    </div>
    <button id="run" type="button">Run</button>
  </header>
  <p id="preset-desc"></p>
  <main id="panels">
    <section id="config-pane" aria-label="Config editor">
      <div class="local-files">
        <div id="data-attach" hidden></div>
        <p id="data-status" role="status" aria-live="polite"></p>
        <pre id="data-snippet" hidden></pre>
        <ul id="data-files" aria-label="Loaded data files" hidden></ul>
      </div>
      <div id="editor"></div>
      <div id="drop-overlay" hidden><p>Drop to load — never uploaded.</p></div>
      <div role="region" aria-label="Validation results">
        <p id="error-summary"></p>
        <ul id="errors"></ul>
      </div>
    </section>
    <div id="splitter" role="separator" aria-label="Resize panels" aria-valuenow="50" tabindex="0"></div>
    <section aria-label="Live preview">
      <p id="preview-stale" hidden></p>
      <div id="preview"></div>
    </section>
  </main>
`;

const CONFIG = `accession: P05067
rows:
  # An inline track, so the preview has something before any file loads.
  - id: base
    kind: features
    data:
      from: inline
      inlineData:
        - { type: DOMAIN, start: 1, end: 10 }
`;

const GOOD = 'type,start,end,description\nDOMAIN,10,25,Kinase\nSITE,30,30,Site';
const OUT_OF_RANGE =
  'type,start,end,description\nDOMAIN,10,25,Kinase\nSITE,700,812,Tail';
const BAD = 'type,start,end,description\nDOMAIN,abc,25,Kinase';

type Preview = HTMLElement & { data: Record<string, unknown> };
type ErrorDetail = {
  phase: string;
  context?: { errorKind?: string; trackId?: string };
};

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const editorView = () =>
  EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
const editorText = () => editorView().state.doc.toString();
const listItems = () => [...byId('errors').querySelectorAll('li')];
const preview = () =>
  document.querySelector<Preview>('#preview protvista-uniprot');

/** Resolves with the next `protvista-error` the preview raises that `match`es. */
function nextError(match: (d: ErrorDetail) => boolean): Promise<ErrorDetail> {
  return new Promise((resolve) => {
    const host = byId('preview');
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<ErrorDetail>).detail;
      if (!match(detail)) return;
      host.removeEventListener('protvista-error', listener);
      resolve(detail);
    };
    host.addEventListener('protvista-error', listener);
  });
}

async function pick(name: string, text: string): Promise<void> {
  await userEvent.upload(
    byId('data-file'),
    new File([text], name, { type: 'text/plain' })
  );
}

/** Choose "New track" in the open attach form and press Add, by keyboard. */
async function addAsNewTrack(): Promise<void> {
  const target = await vi.waitFor(() => {
    const select = byId<HTMLSelectElement>('data-attach-target');
    if (!select) throw new Error('attach form not open');
    return select;
  });
  expect(document.activeElement).toBe(target);
  await userEvent.selectOptions(target, '');
  target.focus();
  await userEvent.tab(); // → Add
  expect(document.activeElement?.textContent).toBe('Add');
  await userEvent.keyboard('{Enter}');
}

/** A drag carrying one file, as the browser builds it. */
function fileDrag(
  type: 'dragover' | 'drop',
  name: string,
  text: string
): DragEvent {
  const transfer = new DataTransfer();
  transfer.items.add(new File([text], name));
  return new DragEvent(type, {
    dataTransfer: transfer,
    bubbles: true,
    cancelable: true,
  });
}

const realFetch = globalThis.fetch.bind(globalThis);
/** The skeleton's top-level nodes, removed again after the run. */
const fixture: Element[] = [];

beforeAll(async () => {
  const parsed = new DOMParser().parseFromString(SKELETON, 'text/html');
  fixture.push(...parsed.body.children);
  document.body.append(...fixture);
  history.replaceState(
    null,
    '',
    `#${encodeState({ config: CONFIG, accession: 'P05067' })}`
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      // A loaded file is a real `blob:` fetch: no network involved.
      if (url.startsWith('blob:')) return realFetch(input, init);
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'M'.repeat(770), length: 770 } }
        : {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => '',
      } as unknown as Response;
    })
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  await import('../playground/index.js');
  await vi.waitFor(() => {
    if (!preview()) throw new Error('preview not mounted');
  });
});

afterAll(() => {
  for (const node of fixture) node.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('playground: load a local data file', () => {
  it('attaches a picked CSV as a new track and renders it, keeping the data out of the URL', async () => {
    await pick('hits.csv', GOOD);
    await addAsNewTrack();

    await vi.waitFor(() => expect(editorText()).toContain('data: ./hits.csv'));
    // The author's comment survived the splice.
    expect(editorText()).toContain('# An inline track');

    const records = await vi.waitFor(() => {
      const data = preview()?.data?.['hits-hits'] as unknown[] | undefined;
      if (!data?.length) throw new Error('no data yet');
      return data;
    });
    expect(records).toHaveLength(2);

    expect(byId('data-status').textContent).toMatch(
      /Loaded hits\.csv\. 2 records/
    );
    expect(byId('data-files').textContent).toContain('hits.csv');
    expect(
      document.querySelector('#errors li[data-code="data-parse"]')
    ).toBeNull();

    const shared = decodeState(location.hash)?.config ?? '';
    expect(shared).toContain('./hits.csv');
    expect(shared).not.toContain('Kinase');
  });

  it('reloads the same file with no form, and names it in the out-of-range warning', async () => {
    const warned = nextError((d) => d.phase === 'track-data');
    const before = editorText();
    await pick('hits.csv', OUT_OF_RANGE);
    // Same name, same reference: replaced in place, no form, no edit.
    expect(byId('data-attach').hidden).toBe(true);
    await warned;

    const row = await vi.waitFor(() => {
      const li = listItems().find((l) => l.dataset.severity === 'warning');
      if (!li) throw new Error('no warning listed');
      return li;
    });
    expect(row.textContent).toMatch(
      /^\[track-data\] \.\/hits\.csv \(parsed as CSV\): 1 of 2 rows/
    );
    expect(listItems().some((li) => li.textContent?.includes('blob:'))).toBe(
      false
    );
    expect(byId('error-summary').textContent).toMatch(
      /warning.* — config is valid\./
    );
    expect(editorText()).toBe(before);
  });

  it('lists a malformed file once, by name, while the preview still renders', async () => {
    const failed = nextError(
      (d) => d.phase === 'track-fetch' && d.context?.trackId === 'bad'
    );
    await pick('bad.csv', BAD);
    await addAsNewTrack();
    const detail = await failed;
    expect(detail.context?.errorKind).toBe('adapter');

    const parse = document.querySelector('#errors li[data-code="data-parse"]');
    expect(parse?.textContent).toMatch(
      /^\.\/bad\.csv \(parsed as CSV\): row 2/
    );
    // The preview's own report of the same failure was dropped.
    expect(
      listItems().filter((li) => li.textContent?.includes('row 2'))
    ).toHaveLength(1);
    expect(listItems().some((li) => li.textContent?.includes('blob:'))).toBe(
      false
    );

    // The rest still renders, and the bad row wears its badge.
    await vi.waitFor(() => {
      expect((preview()?.data?.['hits-hits'] as unknown[])?.length).toBe(2);
      expect(preview()?.querySelector(BADGE)).not.toBeNull();
    });
  });

  it('asks for a format when the extension says nothing, and cancels with Escape', async () => {
    await pick('x.txt', GOOD);
    const format = await vi.waitFor(() => {
      const select = byId<HTMLSelectElement>('data-attach-format');
      if (!select) throw new Error('attach form not open');
      return select;
    });
    expect(document.activeElement).toBe(format);
    expect(format.required).toBe(true);
    expect([...format.options].map((o) => o.value)).toEqual([
      '',
      'csv',
      'tsv',
      'json',
      'bed',
    ]);

    await expectNoA11yViolations(document.querySelector('.local-data')!);
    await expectNoA11yViolations(document.querySelector('.local-files')!);

    await userEvent.keyboard('{Escape}');
    expect(byId('data-attach').hidden).toBe(true);
    expect(document.activeElement).toBe(byId('load-data'));
  });

  it('takes a file dropped anywhere on the editor pane without pasting it, and ignores one dropped elsewhere', async () => {
    const before = editorText();
    for (const selector of ['.cm-content', '.cm-gutters']) {
      const target = document.querySelector(selector)!;
      const over = fileDrag('dragover', 'drop.csv', GOOD);
      target.dispatchEvent(over);
      expect(over.defaultPrevented, selector).toBe(true);

      const drop = fileDrag('drop', 'drop.csv', GOOD);
      target.dispatchEvent(drop);
      expect(drop.defaultPrevented, selector).toBe(true);
      await vi.waitFor(() => expect(byId('data-attach').hidden).toBe(false));
      expect(byId('data-attach').textContent).toContain('drop.csv');
      expect(editorText()).toBe(before);
      await userEvent.keyboard('{Escape}');
    }

    const elsewhere = fileDrag('drop', 'stray.csv', GOOD);
    byId('preview').dispatchEvent(elsewhere);
    expect(elsewhere.defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(byId('data-attach').hidden).toBe(true);
    expect(editorText()).toBe(before);
  });

  it('removes a file with its button, flagging the preview out of date', async () => {
    const remove = byId('data-files').querySelector<HTMLButtonElement>(
      'button[aria-label="Remove bad.csv"]'
    )!;
    remove.focus();
    await userEvent.keyboard('{Enter}');
    expect(byId('data-files').textContent).not.toContain('bad.csv');
    expect(document.activeElement).toBe(byId('load-data'));
    await vi.waitFor(() =>
      expect(
        listItems().some((li) => li.dataset.code === 'local-file-missing')
      ).toBe(true)
    );
    expect(byId('preview-stale').hidden).toBe(false);
  });
});
