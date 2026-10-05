/**
 * The playground page, for specs that drive the real page controller.
 *
 * The playground's `index.ts` wires itself to the page's elements when it is
 * first imported, so {@link openPlayground} builds the same skeleton
 * `playground.astro` serves (the ids are the contract), seeds the URL hash,
 * stubs `fetch` for everything but `blob:` URLs, and imports the controller
 * once. Each browser spec file runs in a page of its own, so each gets a fresh
 * controller; the tests in one file then run in order against that one live
 * page.
 */
import { vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { EditorView } from 'codemirror';

import { encodeState, type PlaygroundState } from '../playground/url-state.js';

/** Every id `index.ts` and the local-data control look up. */
export const SKELETON = `
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

export type Preview = HTMLElement & { data: Record<string, unknown> };
export type ErrorDetail = {
  phase: string;
  context?: { errorKind?: string; trackId?: string };
};

export const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const editorView = () =>
  EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
export const editorText = () => editorView().state.doc.toString();
export const listItems = () => [...byId('errors').querySelectorAll('li')];
export const preview = () =>
  document.querySelector<Preview>('#preview protvista-uniprot');

/** Resolves with the next `protvista-error` the preview raises that `match`es. */
export function nextError(
  match: (d: ErrorDetail) => boolean
): Promise<ErrorDetail> {
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

/** Pick `name` with the "Load data file…" input. */
export async function pick(name: string, text: string): Promise<void> {
  await userEvent.upload(
    byId('data-file'),
    new File([text], name, { type: 'text/plain' })
  );
}

/** Replace the whole editor text, as typing or pasting would. */
export function setEditorText(text: string): void {
  const view = editorView();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

/** A drag carrying `files`, as the browser builds it. */
export function filesDrag(type: 'dragover' | 'drop', files: File[]): DragEvent {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return new DragEvent(type, {
    dataTransfer: transfer,
    bubbles: true,
    cancelable: true,
  });
}

/** A drag carrying one file, as the browser builds it. */
export function fileDrag(
  type: 'dragover' | 'drop',
  name: string,
  text: string
): DragEvent {
  return filesDrag(type, [new File([text], name)]);
}

/** Drop `files` on the editor pane. */
export function dropOnPane(files: File[]): void {
  byId('config-pane').dispatchEvent(filesDrag('drop', files));
}

/**
 * A `respond` hook that answers `404 Not Found` for a page-relative URL
 * (`./missing.fasta`, `data/x.csv`), as the docs host would for a file only
 * the author has, and leaves every other URL to the stub.
 */
export function notFoundPageRelative(url: string): Response | undefined {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) || url.startsWith('/')) {
    return undefined;
  }
  return new Response('Not Found', { status: 404, statusText: 'Not Found' });
}

export interface PlaygroundOptions {
  /** The state the page opens with, as a shared link would carry it. */
  state: PlaygroundState;
  /** Every non-`blob:` URL fetched is pushed here, in order. */
  recorded?: string[];
  /**
   * Consulted first for every non-`blob:` URL. A `Response` answers it;
   * `undefined` falls through to the default: `ok` with an empty body, and
   * a 770-residue protein for the Proteins API.
   */
  respond?: (url: string) => Response | undefined;
}

const realFetch = globalThis.fetch.bind(globalThis);
/** The skeleton's top-level nodes, removed again by {@link closePlayground}. */
const fixture: Element[] = [];

/**
 * Every `blob:` fetch waits on this gate, so a test can hold the preview's
 * read of a loaded file back while it edits the config. Open by default.
 */
let gate: Promise<void> = Promise.resolve();
let release: () => void = () => undefined;
let blobFetches = 0;

/** How many `blob:` URLs the page has fetched so far. */
export const blobFetchCount = (): number => blobFetches;

/** Hold every later `blob:` fetch until {@link openGate}. */
export function closeGate(): void {
  gate = new Promise((resolve) => (release = resolve));
}

/** Let held `blob:` fetches through. */
export function openGate(): void {
  release();
}

/**
 * Build the page, stub `fetch`, and import the controller, which runs the
 * first validation (and mounts a preview when the state allows one).
 */
export async function openPlayground(
  options: PlaygroundOptions
): Promise<void> {
  const parsed = new DOMParser().parseFromString(SKELETON, 'text/html');
  fixture.push(...parsed.body.children);
  document.body.append(...fixture);
  history.replaceState(null, '', `#${encodeState(options.state)}`);
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
      options.recorded?.push(url);
      const answer = options.respond?.(url);
      if (answer) return answer;
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
}

/** Remove the page and restore `fetch` and the console. */
export function closePlayground(): void {
  for (const node of fixture.splice(0)) node.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
