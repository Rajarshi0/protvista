/**
 * DOM wiring for the playground's "Load data file…" control: the file
 * picker, drag-and-drop onto the editor pane, the attach form, the status
 * line and the list of loaded files.
 *
 * It only reads files and asks questions. What a file means for the config
 * — which reference it answers to, which track it lands on, the edit — is
 * decided by the page controller (`index.ts`) through the DOM-free
 * `local-files.ts` / `config-edit.ts`. Every string reaches the page through
 * `textContent`, never markup.
 */
import type { DataFormat } from '../schema/types.js';
import { DATA_FORMAT_NAMES } from '../schema/file-formats.js';
import {
  MAX_FILE_BYTES,
  PRIVACY_NOTE,
  SNIFF_BYTES,
  looksBinary,
  type LocalFile,
} from './local-files.js';

/** A file read off disk, before it is registered. */
export interface ReadFile {
  name: string;
  size: number;
  text: string;
}

/** One choice in the attach form's "Use for" picker. */
export interface AttachOption {
  /** Opaque value handed back on Add; `''` is "New track". */
  value: string;
  label: string;
}

export interface AttachRequest {
  file: ReadFile;
  /**
   * The format the file seems to be in: the one its extension implies, or
   * what its header says instead. Without one, a choice is required.
   */
  inferred?: DataFormat;
  /** Why `inferred` is not what the extension implies, when it is not. */
  reason?: string;
  options: readonly AttachOption[];
  /** Which option starts selected (default: New track). */
  selected?: string;
}

export interface AttachChoice {
  format: DataFormat;
  /** The chosen option's value; `''` is "New track". */
  target: string;
}

export interface LocalDataControl {
  /**
   * Show the attach form for `request`. Resolves with the user's choice on
   * Add, or `null` on Cancel / Escape (focus then returns to the button).
   */
  ask(request: AttachRequest): Promise<AttachChoice | null>;
  /** Announce `message` on the status line. */
  setStatus(message: string): void;
  /** Show a paste-able snippet under the status (or hide it with `''`). */
  setSnippet(snippet: string): void;
  /** Re-render the loaded-files list. */
  showFiles(files: readonly LocalFile[]): void;
}

export interface LocalDataControlOptions {
  button: HTMLButtonElement;
  input: HTMLInputElement;
  /** Container the attach form is rendered into; hidden when idle. */
  panel: HTMLElement;
  status: HTMLElement;
  snippet: HTMLElement;
  list: HTMLElement;
  /** The editor pane: a file dropped anywhere on it is loaded. */
  dropTarget: HTMLElement;
  /** Shown over the pane while a file is dragged over it. */
  overlay?: HTMLElement;
  /**
   * A file was read; the controller decides what happens next. `skipped`
   * counts the other files of a multi-file drop, which are not loaded.
   */
  onFile(file: ReadFile, skipped: number): void | Promise<void>;
  /** The user removed the file registered under `ref`. */
  onRemove(ref: string): void;
}

const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** True for a drag that carries files (`files` itself is empty until drop). */
const isFileDrag = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

export function createLocalDataControl(
  options: LocalDataControlOptions
): LocalDataControl {
  const { button, input, panel, status, snippet, list, dropTarget, overlay } =
    options;
  /** Cancels the open form, if any. */
  let cancelOpen: (() => void) | undefined;

  const setStatus = (message: string) => {
    status.textContent = message;
  };

  /** Size cap and binary sniff before the full read; then the text. */
  async function read(file: File): Promise<ReadFile | undefined> {
    if (file.size > MAX_FILE_BYTES) {
      setStatus(
        `${file.name} is ${formatSize(file.size)} — the playground opens data ` +
          `files up to ${formatSize(MAX_FILE_BYTES)}.`
      );
      return undefined;
    }
    try {
      const head = new Uint8Array(
        await file.slice(0, SNIFF_BYTES).arrayBuffer()
      );
      if (looksBinary(head)) {
        setStatus(
          `${file.name} looks like a binary or compressed file — export it as ` +
            `CSV or TSV and load that.`
        );
        return undefined;
      }
      return { name: file.name, size: file.size, text: await file.text() };
    } catch {
      // A dropped folder, or a file moved or changed on disk since it was
      // picked: the browser refuses the read.
      setStatus(
        `Couldn't read ${file.name} — if it is a folder, or it changed on ` +
          `disk, pick the file again.`
      );
      return undefined;
    }
  }

  async function load(files: readonly File[]): Promise<void> {
    const [first] = files;
    if (!first) return;
    cancelOpen?.();
    const file = await read(first);
    if (!file) return;
    await options.onFile(file, files.length - 1);
  }

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    // Reset so picking the same file again (after fixing it on disk) fires
    // `change` and reloads it.
    input.value = '';
    void load(files);
  });

  // ── Drag and drop ──
  // Capture phase on the pane, so CodeMirror's own drop handler (on the
  // text area) never sees a file — it would paste the file's text into the
  // config. Text drags inside the editor are left alone.
  const showOverlay = (shown: boolean) => {
    if (overlay) overlay.hidden = !shown;
  };
  const claim = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  dropTarget.addEventListener(
    'dragenter',
    (event) => {
      if (!isFileDrag(event)) return;
      claim(event);
      showOverlay(true);
    },
    true
  );
  dropTarget.addEventListener(
    'dragover',
    (event) => {
      if (!isFileDrag(event)) return;
      claim(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      showOverlay(true);
    },
    true
  );
  dropTarget.addEventListener(
    'dragleave',
    (event) => {
      if (!isFileDrag(event)) return;
      const to = event.relatedTarget as Node | null;
      if (!to || !dropTarget.contains(to)) showOverlay(false);
    },
    true
  );
  dropTarget.addEventListener(
    'drop',
    (event) => {
      if (!isFileDrag(event)) return;
      claim(event);
      showOverlay(false);
      void load(Array.from(event.dataTransfer?.files ?? []));
    },
    true
  );
  // Anywhere else on the page a dropped file would make the browser open it,
  // navigating away from the playground. Refuse it instead.
  const refuse = (event: DragEvent) => {
    if (!isFileDrag(event) || dropTarget.contains(event.target as Node)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  document.addEventListener('dragover', refuse);
  document.addEventListener('drop', refuse);

  // ── The attach form ──
  function ask(request: AttachRequest): Promise<AttachChoice | null> {
    cancelOpen?.();
    const { file, inferred } = request;
    return new Promise((resolve) => {
      const form = document.createElement('form');
      form.className = 'data-attach';
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = `Add ${file.name} (${formatSize(file.size)})`;
      fieldset.append(legend);

      const field = (id: string, text: string, control: HTMLElement) => {
        const wrap = document.createElement('div');
        wrap.className = 'field';
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = text;
        control.id = id;
        wrap.append(label, control);
        fieldset.append(wrap);
      };

      const format = document.createElement('select');
      if (!inferred) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Choose a format…';
        format.append(placeholder);
        format.required = true;
      }
      for (const name of DATA_FORMAT_NAMES) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        format.append(option);
      }
      format.value = inferred ?? '';
      field('data-attach-format', 'Read as', format);

      const target = document.createElement('select');
      for (const { value, label } of [
        { value: '', label: 'New track' },
        ...request.options,
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        target.append(option);
      }
      target.value = request.selected ?? '';
      field('data-attach-target', 'Use for', target);

      const note = document.createElement('p');
      note.className = 'data-attach-note';
      note.textContent = [
        inferred
          ? request.reason
          : `The extension doesn't say how to read ${file.name}, so choose a format.`,
        PRIVACY_NOTE,
      ]
        .filter(Boolean)
        .join(' ');
      fieldset.append(note);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const add = document.createElement('button');
      add.type = 'submit';
      add.textContent = 'Add';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      actions.append(add, cancel);
      fieldset.append(actions);
      form.append(fieldset);

      const close = (choice: AttachChoice | null) => {
        cancelOpen = undefined;
        panel.hidden = true;
        panel.replaceChildren();
        // Whatever closed it, the focused control is gone: return focus to
        // the button that opened the form, not to <body>.
        button.focus();
        resolve(choice);
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        close({ format: format.value as DataFormat, target: target.value });
      });
      cancel.addEventListener('click', () => close(null));
      form.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(null);
        }
      });

      cancelOpen = () => close(null);
      panel.replaceChildren(form);
      panel.hidden = false;
      (inferred ? target : format).focus();
    });
  }

  return {
    ask,
    setStatus,
    setSnippet(text) {
      snippet.textContent = text;
      snippet.hidden = text === '';
    },
    showFiles(files) {
      list.replaceChildren(
        ...files.map((file) => {
          const li = document.createElement('li');
          const what = document.createElement('span');
          what.textContent =
            file.ref === `./${file.name}`
              ? `${file.name} (${formatSize(file.size)})`
              : `${file.name} as ${file.ref} (${formatSize(file.size)})`;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = 'Remove';
          remove.setAttribute('aria-label', `Remove ${file.name}`);
          remove.addEventListener('click', () => {
            options.onRemove(file.ref);
            button.focus();
          });
          li.append(what, remove);
          return li;
        })
      );
      list.hidden = files.length === 0;
    },
  };
}
