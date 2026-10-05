/**
 * DOM wiring for the playground's "Load data file…" control: the file
 * picker, drag-and-drop onto the editor pane, the attach form (and, for a
 * FASTA file, the "use as sequence" form), the status line and the list of
 * loaded files.
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

/** Where a loaded FASTA goes: into this config, or a new sequence-only one. */
export type SequenceTarget = 'this' | 'new';

export interface SequenceRequest {
  file: ReadFile;
  /** One line on the sequence itself: its label and length. */
  summary: string;
  /** What each choice does to the editor text, one item per change. */
  consequences: Readonly<Record<SequenceTarget, readonly string[]>>;
  defaultTarget: SequenceTarget;
  /** Why "This config" can't be chosen, when it can't. */
  thisDisabled?: string;
}

export interface LocalDataControl {
  /**
   * Show the attach form for `request`. Resolves with the user's choice on
   * Add, or `null` on Cancel / Escape (focus then returns to the button).
   */
  ask(request: AttachRequest): Promise<AttachChoice | null>;
  /**
   * Show the "use as sequence" form for a FASTA file. Resolves with the
   * target on Use, or `null` on Cancel / Escape.
   */
  askSequence(request: SequenceRequest): Promise<SequenceTarget | null>;
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

/** A byte count as the status line and the file list show it. */
export const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** `66 residues`, `1 residue`. */
export const residueCount = (n: number): string =>
  `${n} residue${n === 1 ? '' : 's'}`;

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
          `${file.name} looks like a binary or compressed file — load plain ` +
            `text: CSV, TSV, JSON or BED for a track, or FASTA for the sequence.`
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

  // ── The forms ──
  /**
   * Open a form in the panel: the shared shell of both forms. `build` fills
   * the fieldset and returns the control to focus and how to read the
   * choice on submit (`undefined` keeps the form open). Escape and Cancel
   * resolve `null`; whatever closes it, focus returns to the Load button.
   */
  function openForm<T>(
    className: string,
    legendText: string,
    submitText: string,
    build: (fieldset: HTMLFieldSetElement) => {
      focus: HTMLElement;
      choice: () => T | undefined;
    }
  ): Promise<T | null> {
    cancelOpen?.();
    return new Promise((resolve) => {
      const form = document.createElement('form');
      form.className = className;
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = legendText;
      fieldset.append(legend);
      const { focus, choice } = build(fieldset);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = submitText;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      actions.append(submit, cancel);
      fieldset.append(actions);
      form.append(fieldset);

      const close = (value: T | null) => {
        cancelOpen = undefined;
        panel.hidden = true;
        panel.replaceChildren();
        // Whatever closed it, the focused control is gone: return focus to
        // the button that opened the form, not to <body>.
        button.focus();
        resolve(value);
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const value = choice();
        if (value !== undefined) close(value);
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
      focus.focus();
    });
  }

  /** A paragraph of plain text (never markup). */
  const note = (text: string, className = 'data-attach-note') => {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    return p;
  };

  function ask(request: AttachRequest): Promise<AttachChoice | null> {
    const { file, inferred } = request;
    return openForm<AttachChoice>(
      'data-attach',
      `Add ${file.name} (${formatSize(file.size)})`,
      'Add',
      (fieldset) => {
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

        fieldset.append(
          note(
            [
              inferred
                ? request.reason
                : `The extension doesn't say how to read ${file.name}, so choose a format.`,
              PRIVACY_NOTE,
            ]
              .filter(Boolean)
              .join(' ')
          )
        );
        return {
          focus: inferred ? target : format,
          choice: () => ({
            format: format.value as DataFormat,
            target: target.value,
          }),
        };
      }
    );
  }

  function askSequence(
    request: SequenceRequest
  ): Promise<SequenceTarget | null> {
    const { file, consequences, thisDisabled } = request;
    const checked: SequenceTarget = thisDisabled
      ? 'new'
      : request.defaultTarget;
    return openForm<SequenceTarget>(
      'data-attach sequence-attach',
      `Use ${file.name} (${formatSize(file.size)}) as the sequence`,
      'Use',
      (fieldset) => {
        fieldset.append(note(request.summary, 'sequence-summary'));

        const group = document.createElement('fieldset');
        group.className = 'sequence-targets';
        const legend = document.createElement('legend');
        legend.textContent = 'Apply to';
        group.append(legend);
        const radios = new Map<SequenceTarget, HTMLInputElement>();
        const choices: Array<[SequenceTarget, string]> = [
          ['this', 'This config'],
          ['new', 'A new sequence-only config'],
        ];
        for (const [value, text] of choices) {
          const id = `sequence-target-${value}`;
          const wrap = document.createElement('div');
          wrap.className = 'sequence-target';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'sequence-target';
          radio.id = id;
          radio.value = value;
          radio.checked = value === checked;
          const label = document.createElement('label');
          label.htmlFor = id;
          label.textContent = text;
          const list = document.createElement('ul');
          list.id = `${id}-what`;
          list.className = 'sequence-consequences';
          const items =
            value === 'this' && thisDisabled
              ? [thisDisabled]
              : consequences[value];
          for (const item of items) {
            const li = document.createElement('li');
            li.textContent = item;
            list.append(li);
          }
          if (value === 'this' && thisDisabled) radio.disabled = true;
          radio.setAttribute('aria-describedby', list.id);
          wrap.append(radio, label, list);
          group.append(wrap);
          radios.set(value, radio);
        }
        fieldset.append(group, note(PRIVACY_NOTE));
        return {
          focus: radios.get(checked)!,
          choice: () => [...radios].find(([, radio]) => radio.checked)?.[0],
        };
      }
    );
  }

  return {
    ask,
    askSequence,
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
          const named =
            file.ref === `./${file.name}`
              ? file.name
              : `${file.name} as ${file.ref}`;
          const role =
            file.kind === 'sequence'
              ? ` — sequence, ${residueCount(file.sequence.residues.length)}`
              : '';
          what.textContent = `${named}${role} (${formatSize(file.size)})`;
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
