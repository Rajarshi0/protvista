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
import { parseConfigText } from '../schema/parse.js';
import { decodeState, encodeState } from '../playground/url-state.js';
import { MAX_FILE_BYTES, PRIVACY_NOTE } from '../playground/local-files.js';
import { getPreset } from '../playground/presets.js';
import { expectNoA11yViolations } from './axe.js';

// The real parser, wrapped in a spy so a validation's parses can be counted.
vi.mock('../schema/parse.js', { spy: true });

const BADGE = `.${CSS_PREFIX}-error-badge`;

/** Every id `index.ts` and the local-data control look up. */
const SKELETON = `
  <header>
    <select id="preset" aria-label="Configuration preset"></select>
    <input id="accession" aria-label="Accession" value="P05067" />
    <div class="local-data">
      <button id="load-data" type="button" aria-describedby="local-note">Load data file…</button>
      <input id="data-file" type="file" hidden />
      <span id="local-note">Read in your browser — never uploaded. Only the file name goes into the config.</span>
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

/** An `extends:` base that brings a `sequence:` of its own. */
const SEQUENCE_BASE_URL = 'https://lab.example/base.yaml';
const SEQUENCE_BASE = `sequence: |
  >my construct v2
  MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ
rows: []
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
  // The form is gone; focus is back on the button that opened it.
  expect(byId('data-attach').hidden).toBe(true);
  expect(document.activeElement).toBe(byId('load-data'));
}

/** Replace the whole editor text, as typing or pasting would. */
function setEditorText(text: string): void {
  const view = editorView();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

/** A drag carrying `files`, as the browser builds it. */
function filesDrag(type: 'dragover' | 'drop', files: File[]): DragEvent {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return new DragEvent(type, {
    dataTransfer: transfer,
    bubbles: true,
    cancelable: true,
  });
}

/** A drag carrying one file, as the browser builds it. */
function fileDrag(
  type: 'dragover' | 'drop',
  name: string,
  text: string
): DragEvent {
  return filesDrag(type, [new File([text], name)]);
}

/** Drop `files` on the editor pane. */
function dropOnPane(files: File[]): void {
  byId('config-pane').dispatchEvent(filesDrag('drop', files));
}

const realFetch = globalThis.fetch.bind(globalThis);
/**
 * Every `blob:` fetch waits on this gate, so a test can hold the preview's
 * read of a loaded file back while it edits the config. Open by default.
 */
let gate: Promise<void> = Promise.resolve();
let openGate: () => void = () => undefined;
function closeGate(): void {
  gate = new Promise((resolve) => (openGate = resolve));
}
let blobFetches = 0;
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
      if (url.startsWith('blob:')) {
        blobFetches += 1;
        await gate;
        return realFetch(input, init);
      }
      if (url === SEQUENCE_BASE_URL) {
        return new Response(SEQUENCE_BASE, { status: 200 });
      }
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
    await vi.waitFor(() =>
      expect(document.querySelector('.data-attach-note')?.textContent).toBe(
        PRIVACY_NOTE
      )
    );
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

  it('parses the config once per validation, pre-flight included', async () => {
    const before = editorText();
    const parses = vi.mocked(parseConfigText);
    parses.mockClear();
    const edited = `${before}# an edit\n`;
    setEditorText(edited);
    // The share link is written once the validation, pre-flight and all, is done.
    await vi.waitFor(
      () => expect(decodeState(location.hash)?.config).toBe(edited),
      { timeout: 3000 }
    );
    expect(parses).toHaveBeenCalledTimes(1);

    setEditorText(before);
    await vi.waitFor(
      () => expect(decodeState(location.hash)?.config).toBe(before),
      { timeout: 3000 }
    );
  });

  it('reloads the same file with no form, and names it in the out-of-range warning', async () => {
    const warned = nextError((d) => d.phase === 'track-data');
    const before = editorText();
    await pick('hits.csv', OUT_OF_RANGE);
    // The input was reset, so picking the same file again fires `change`.
    expect(byId<HTMLInputElement>('data-file').value).toBe('');
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
    // The form says the name, not the data, goes into the config.
    expect(document.querySelector('.data-attach-note')?.textContent).toBe(
      `The extension doesn't say how to read x.txt, so choose a format. ${PRIVACY_NOTE}`
    );
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

  it('answers a Starter Kit path with the same file name, with no form and no edit', async () => {
    const kit = `accession: P05067
rows:
  - id: kit
    kind: features
    data: ./data/hits.csv
`;
    setEditorText(kit);
    await pick('hits.csv', GOOD);
    expect(byId('data-attach').hidden).toBe(true);

    await vi.waitFor(() =>
      expect(byId('data-status').textContent).toMatch(
        /Loaded hits\.csv as \.\/data\/hits\.csv\. 2 records/
      )
    );
    expect(editorText()).toBe(kit);
    await vi.waitFor(() =>
      expect((preview()?.data?.['kit-kit'] as unknown[])?.length).toBe(2)
    );
    expect(
      listItems().some((li) => li.dataset.code === 'local-file-missing')
    ).toBe(false);
  });

  it('writes the chosen format into the config for an extension that says nothing', async () => {
    await pick('x.txt', GOOD);
    const format = await vi.waitFor(() => {
      const select = byId<HTMLSelectElement>('data-attach-format');
      if (!select) throw new Error('attach form not open');
      return select;
    });
    await userEvent.selectOptions(format, 'csv');
    byId('data-attach-target').focus();
    await addAsNewTrack();

    await vi.waitFor(() => expect(editorText()).toContain('url: ./x.txt'));
    expect(editorText()).toContain('format: csv');
    await vi.waitFor(() =>
      expect((preview()?.data?.['x-x'] as unknown[])?.length).toBe(2)
    );
  });

  it('writes a format chosen for a named path into the config, so the share link reads it the same', async () => {
    const twoPaths = `accession: P05067
rows:
  - id: a
    kind: features
    data: ./a/hits.csv
  - id: b
    kind: features
    data: ./b/hits.csv
`;
    setEditorText(twoPaths);
    // Two paths name hits.csv: the form asks, preselecting the first.
    await pick('hits.csv', GOOD.replaceAll(',', '\t'));
    const target = await vi.waitFor(() => {
      const select = byId<HTMLSelectElement>('data-attach-target');
      if (!select) throw new Error('attach form not open');
      return select;
    });
    expect(target.value).toBe('a');
    await userEvent.selectOptions(byId('data-attach-format'), 'tsv');
    target.focus();
    await userEvent.tab(); // → Add
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() =>
      expect(editorText()).toContain('data: { url: ./a/hits.csv, format: tsv }')
    );
    expect(editorText()).toContain('data: ./b/hits.csv');
    await vi.waitFor(() =>
      expect((preview()?.data?.['a-a'] as unknown[])?.length).toBe(2)
    );
    expect(
      document.querySelector('#errors li[data-code="data-parse"]')
    ).toBeNull();
  });

  it('gives a different file whose name sanitises the same a reference of its own', async () => {
    await pick('a(b.csv', GOOD);
    await addAsNewTrack();
    await vi.waitFor(() => expect(editorText()).toContain('data: ./a-b.csv'));

    // `a b.csv` also sanitises to `a-b.csv`, but that reference is taken by
    // another file: it must not silently replace it.
    await pick('a b.csv', GOOD);
    await addAsNewTrack();
    await vi.waitFor(() => expect(editorText()).toContain('data: ./a-b-2.csv'));
    expect(editorText()).toContain('data: ./a-b.csv');
    const listed = byId('data-files').textContent ?? '';
    expect(listed).toContain('a(b.csv as ./a-b.csv');
    expect(listed).toContain('a b.csv as ./a-b-2.csv');
  });

  it('reloads a file whose reference got a suffix in place, with no form and no edit', async () => {
    const before = editorText();
    // The reload renders the new rows, one of which is out of range.
    const rendered = nextError((d) => d.phase === 'track-data');
    await pick('a b.csv', OUT_OF_RANGE);
    await rendered;
    expect(byId('data-status').textContent).toMatch(
      /^Loaded a b\.csv as \.\/a-b-2\.csv\. /
    );
    expect(byId('data-attach').hidden).toBe(true);
    expect(editorText()).toBe(before);
    expect(editorText().split('./a-b-2.csv')).toHaveLength(2);
  });

  it('matches a path by the file name in its exact case', async () => {
    const scores = `accession: P05067
rows:
  - id: scores
    kind: features
    data: ./data/scores.csv
`;
    setEditorText(scores);
    await pick('SCORES.csv', GOOD);
    // `./data/scores.csv` is another file on a case-sensitive host: ask.
    await vi.waitFor(() => expect(byId('data-attach').hidden).toBe(false));
    expect(byId<HTMLSelectElement>('data-attach-target').value).toBe('');
    await userEvent.keyboard('{Escape}');
    expect(editorText()).toBe(scores);
  });

  it('loads only the first of several dropped files, says so, and renders it', async () => {
    dropOnPane([
      new File([GOOD], 'first.csv', { type: 'text/plain' }),
      new File([BAD], 'second.csv', { type: 'text/plain' }),
    ]);
    await vi.waitFor(() =>
      expect(byId('data-attach').textContent).toContain('first.csv')
    );
    expect(byId('data-attach').textContent).not.toContain('second.csv');
    await addAsNewTrack();

    await vi.waitFor(() =>
      expect(byId('data-status').textContent).toBe(
        'Load one file at a time — loaded first.csv only. Loaded first.csv. ' +
          '2 records — read in your browser, never uploaded.'
      )
    );
    expect(editorText()).toContain('data: ./first.csv');
    expect(editorText()).not.toContain('second.csv');
    await vi.waitFor(() =>
      expect((preview()?.data?.['first-first'] as unknown[])?.length).toBe(2)
    );
  });

  it('refuses a file over the size cap before reading it', async () => {
    const before = editorText();
    const big = new File(
      [new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61)],
      'big.csv'
    );
    const text = vi.spyOn(big, 'text');
    dropOnPane([big]);
    await vi.waitFor(() =>
      expect(byId('data-status').textContent).toBe(
        'big.csv is 20.0 MB — the playground opens data files up to 20.0 MB.'
      )
    );
    expect(text).not.toHaveBeenCalled();
    expect(byId('data-attach').hidden).toBe(true);
    expect(byId('data-files').textContent).not.toContain('big.csv');
    expect(editorText()).toBe(before);
  });

  it('refuses a binary or compressed file', async () => {
    const before = editorText();
    await pick('x.xlsx', '');
    await userEvent.upload(
      byId('data-file'),
      new File([new Uint8Array([0x50, 0x4b, 3, 4, 0x41, 0x42])], 'x.xlsx')
    );
    await vi.waitFor(() =>
      expect(byId('data-status').textContent).toBe(
        'x.xlsx looks like a binary or compressed file — export it as CSV ' +
          'or TSV and load that.'
      )
    );
    expect(byId('data-attach').hidden).toBe(true);
    expect(byId('data-files').textContent).not.toContain('x.xlsx');
    expect(editorText()).toBe(before);
  });

  it('says so when the browser cannot read a dropped file, such as a folder', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    const arrayBuffer = vi
      .spyOn(Blob.prototype, 'arrayBuffer')
      .mockRejectedValue(
        new DOMException('A requested file could not be found', 'NotFoundError')
      );
    try {
      dropOnPane([new File(['x'], 'MyFolder')]);
      await vi.waitFor(() =>
        expect(byId('data-status').textContent).toBe(
          "Couldn't read MyFolder — if it is a folder, or it changed on disk, " +
            'pick the file again.'
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
      expect(byId('data-attach').hidden).toBe(true);
    } finally {
      arrayBuffer.mockRestore();
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  });

  it('offers a tab-separated .csv as tsv, and adds it as a line graph that reads cleanly', async () => {
    await pick('depth.csv', 'position\tvalue\n1\t0.5\n2\t0.7\n');
    const format = await vi.waitFor(() => {
      const select = byId<HTMLSelectElement>('data-attach-format');
      if (!select) throw new Error('attach form not open');
      return select;
    });
    expect(format.value).toBe('tsv');
    expect(document.querySelector('.data-attach-note')?.textContent).toBe(
      `Its header looks tab-separated, so it is read as tsv. ${PRIVACY_NOTE}`
    );
    await addAsNewTrack();

    await vi.waitFor(() =>
      expect(editorText()).toContain('data: { url: ./depth.csv, format: tsv }')
    );
    expect(editorText()).toMatch(
      /- id: depth\n\s+label: depth\.csv\n\s+kind: linegraph/
    );
    await vi.waitFor(() =>
      expect(byId('data-status').textContent).toMatch(
        /Loaded depth\.csv\. 2 records/
      )
    );
    expect(
      document.querySelector('#errors li[data-code="data-parse"]')
    ).toBeNull();
  });

  describe("reads the mounted preview's events by what it was mounted with", () => {
    const LATE = `accession: P05067
rows:
  - id: base
    kind: features
    data:
      from: inline
      inlineData:
        - { type: DOMAIN, start: 1, end: 10 }
  - id: late
    kind: features
    data: ./late.csv
`;
    const rowTwo = () =>
      listItems().filter((li) => li.textContent?.includes('row 2'));
    /** The next `track-fetch` failure on the `late` track, once listed (or skipped). */
    const lateFailure = () =>
      nextError(
        (d) => d.phase === 'track-fetch' && d.context?.trackId === 'late'
      ).then(() => new Promise((resolve) => setTimeout(resolve, 0)));

    afterAll(() => openGate());

    it("lists a decode failure once when the track is renamed before the preview's report arrives", async () => {
      setEditorText(LATE);
      closeGate();
      const fetched = blobFetches;
      const failed = lateFailure();
      await pick('late.csv', BAD);
      await vi.waitFor(() =>
        expect(byId('data-status').textContent).toMatch(/couldn't be read/)
      );
      await vi.waitFor(() => expect(blobFetches).toBeGreaterThan(fetched));
      expect(rowTwo()).toHaveLength(1);

      // Live validation of the edit pre-flights `renamed`, not `late`.
      setEditorText(LATE.replace('id: late', 'id: renamed'));
      await vi.waitFor(() => expect(byId('preview-stale').hidden).toBe(false), {
        timeout: 3000,
      });
      expect(rowTwo()).toHaveLength(1);

      openGate();
      await failed;
      expect(rowTwo()).toHaveLength(1);
      expect(rowTwo()[0].dataset.code).toBe('data-parse');
    });

    it("skips the mounted preview's report of a failure the pre-flight listed, even after the config breaks", async () => {
      setEditorText(LATE);
      closeGate();
      const fetched = blobFetches;
      const failed = lateFailure();
      byId('run').click();
      await vi.waitFor(() => expect(blobFetches).toBeGreaterThan(fetched), {
        timeout: 5000,
      });
      await vi.waitFor(() => expect(rowTwo()).toHaveLength(1));

      setEditorText(`${LATE}rows: [\n`);
      await vi.waitFor(
        () =>
          expect(
            listItems().filter((li) => li.dataset.code === 'data-parse')
          ).toHaveLength(0),
        { timeout: 3000 }
      );

      openGate();
      await failed;
      expect(rowTwo()).toHaveLength(0);
    });
  });

  it('clears the status line on a new preset or accession, keeping the files loaded', async () => {
    /** A file the flow-style `rows:` can't take: the status and a snippet say so. */
    async function failEdit(name: string): Promise<void> {
      setEditorText('accession: P05067\nrows: []\n');
      await pick(name, GOOD);
      await addAsNewTrack();
      await vi.waitFor(() =>
        expect(byId('data-status').textContent).toMatch(
          /Couldn't add the track automatically/
        )
      );
      expect(byId('data-snippet').hidden).toBe(false);
    }
    const cleared = () => {
      expect(byId('data-status').textContent).toBe('');
      expect(byId('data-snippet').hidden).toBe(true);
      expect(byId('data-snippet').textContent).toBe('');
      expect(byId('data-files').textContent).toContain('hits.csv');
    };

    await failEdit('flow.csv');
    await userEvent.selectOptions(byId('preset'), 'csv');
    expect(editorText()).toBe(getPreset('csv')!.config);
    cleared();
    expect(byId('data-files').textContent).toContain('flow.csv');

    await failEdit('flow2.csv');
    const accession = byId<HTMLInputElement>('accession');
    await userEvent.clear(accession);
    await userEvent.type(accession, 'P12345');
    await userEvent.keyboard('{Tab}');
    expect(accession.value).toBe('P12345');
    cleared();
    expect(byId('data-files').textContent).toContain('flow2.csv');
  });
});

describe('playground: a sequence-only config', () => {
  const SEQUENCE_CONFIG = `sequence: |
  >my construct v2
  MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ
rows:
  - id: sites
    label: Sites on {accession}
    kind: features
    data:
      from: inline
      inlineData:
        - { type: DOMAIN, start: 4, end: 30 }
`;

  it('previews without an accession and disables the accession input', async () => {
    setEditorText(SEQUENCE_CONFIG);
    byId('run').click();

    await vi.waitFor(() =>
      expect(preview()?.textContent).toContain('Sites on my construct v2')
    );
    // The page's accession is not handed to a config with its own protein.
    expect(preview()?.hasAttribute('accession')).toBe(false);
    expect(listItems()).toEqual([]);
    const input = byId<HTMLInputElement>('accession');
    expect(input.disabled).toBe(true);
    const hint = byId('accession-hint');
    expect(input.getAttribute('aria-describedby')).toBe('accession-hint');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('sequence:');

    // Back to an accession config: the input is live again.
    setEditorText(CONFIG);
    byId('run').click();
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(hint.hidden).toBe(true);
  });

  it('previews a child config whose extends: base declares the sequence', async () => {
    // The child names no `sequence:`; the element finds it after merging
    // the base, so handing it the accession would fail as "both".
    setEditorText(`extends: ${SEQUENCE_BASE_URL}
rows:
  - id: sites
    label: Sites on {accession}
    kind: features
    data:
      from: inline
      inlineData:
        - { type: DOMAIN, start: 4, end: 30 }
`);
    byId('run').click();

    await vi.waitFor(() =>
      expect(preview()?.textContent).toContain('Sites on my construct v2')
    );
    expect(preview()?.hasAttribute('accession')).toBe(false);
    expect(byId<HTMLInputElement>('accession').disabled).toBe(true);
    expect(listItems().map((li) => li.dataset.code)).not.toContain(
      'accession-and-sequence'
    );

    setEditorText(CONFIG);
    byId('run').click();
    await vi.waitFor(() =>
      expect(byId<HTMLInputElement>('accession').disabled).toBe(false)
    );
  });
});
