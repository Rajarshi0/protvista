/**
 * "Load data file…" with a FASTA file, through the real page controller: the
 * file becomes the config's `sequence:`. The editor (and so the share link)
 * only ever names the file; the preview is handed the sequence inline, so it
 * makes no request for it.
 *
 * The page opens on a shared link whose `sequence:` names a file that isn't
 * loaded, so no preview is mounted at first. The tests then run in order
 * against that one live page, as in `playground-local-data.browser.spec.ts`.
 * Every page-relative URL answers 404, as the docs host would for a file only
 * the author has, and every non-`blob:` URL is recorded.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { userEvent } from 'vitest/browser';

import exampleConfig from '../../examples/sequence-only/config.yaml?raw';
import exampleProtein from '../../examples/sequence-only/protein.fasta?raw';
import exampleHotspots from '../../examples/sequence-only/hotspots.csv?raw';
import playgroundPage from '../../docs/src/pages/playground.astro?raw';
import { decodeState } from '../playground/url-state.js';
import { PRIVACY_NOTE } from '../playground/local-files.js';
import { expectNoA11yViolations } from './axe.js';
import {
  byId,
  closePlayground,
  dropOnPane,
  editorText,
  editorView,
  listItems,
  notFoundPageRelative,
  openPlayground,
  pick,
  preview,
  setEditorText,
} from './playground-page.js';

/** A designed construct: 66 residues. */
const CONSTRUCT = `>my construct v2
MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ
`;

/**
 * Crambin, as downloaded from https://rest.uniprot.org/uniprotkb/P01542.fasta
 * (UniProt release 2026_03, CC BY 4.0): 46 residues under a 92-character
 * header, which the viewer cuts to 80.
 */
const CRAMBIN = `>sp|P01542|CRAM_CRAAB Crambin OS=Crambe hispanica subsp. abyssinica OX=3721 GN=THI2 PE=1 SV=2
TTCCPSIVARSNFNVCRLPGTPEALCATYTGCIIIPGATCPGDYAN
`;
const CRAMBIN_LABEL =
  'sp|P01542|CRAM_CRAAB Crambin OS=Crambe hispanica subsp. abyssinica OX=3721 GN=T…';

/** A track whose label shows whatever stands in for the accession. */
const SITES = `rows:
  - id: sites
    label: Sites on {accession}
    kind: features
    data:
      from: inline
      inlineData:
        - { type: DOMAIN, start: 4, end: 30 }
`;
const ACCESSION_CONFIG = `# A lab viewer
accession: P05067
${SITES}`;
/** The shape of a "your own FASTA" preset: inline FASTA, no UniProt tracks. */
const INLINE_CONFIG = `sequence: |
  >my construct v2
  MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ
${SITES}`;
/** One track that needs UniProt data. */
const REMOTE_CONFIG = `accession: P05067
rows:
  - id: remote
    kind: features
    data: https://lab.example/{accession}.json
`;

const LOADED = (name: string, label: string, residues: number) =>
  `Loaded ${name} as the sequence (${label}, ${residues} residues) — ` +
  'read in your browser, never uploaded.';

/** The preview banner while the shared link's sequence file isn't loaded. */
const HELD_BACK =
  "Load missing.fasta to see the preview — the config's sequence: names it.";

/** Every non-`blob:` URL the page fetched, in order. */
const recorded: string[] = [];

const sequenceForm = () => document.querySelector('.sequence-attach');
const radio = (target: 'this' | 'new') =>
  byId<HTMLInputElement>(`sequence-target-${target}`);
/** The list of what a choice changes, as its radio's description. */
const consequences = (target: 'this' | 'new') =>
  [
    ...byId(radio(target).getAttribute('aria-describedby')!).querySelectorAll(
      'li'
    ),
  ].map((li) => li.textContent);
const status = () => byId('data-status').textContent;
const fileList = () =>
  [...byId('data-files').querySelectorAll('li span')].map((s) => s.textContent);
const sequenceTrack = () =>
  preview()?.querySelector('nightingale-sequence') ?? null;

async function formOpens(): Promise<HTMLInputElement> {
  return vi.waitFor(() => {
    if (!sequenceForm()) throw new Error('sequence form not open');
    return radio('this');
  });
}

/** Press the form's Use button. */
async function use(): Promise<void> {
  await press('Use');
}

/** Press one of the form's buttons. */
async function press(label: 'Use' | 'Cancel'): Promise<void> {
  const button = [...sequenceForm()!.querySelectorAll('button')].find(
    (b) => b.textContent === label
  )!;
  await userEvent.click(button);
}

beforeAll(async () => {
  await openPlayground({
    state: {
      config: 'sequence: ./missing.fasta\nrows: []\n',
      accession: 'P05067',
    },
    recorded,
    respond: notFoundPageRelative,
  });
  // No preview is mounted for this link: wait for its warning instead.
  await vi.waitFor(() => {
    if (!listItems().some((li) => li.dataset.code === 'local-file-missing')) {
      throw new Error('not validated yet');
    }
  });
});

afterAll(closePlayground);

describe('playground: load a FASTA file as the sequence', () => {
  it('lists an unloaded local sequence: on a shared link, and mounts no preview that would request it', async () => {
    const row = listItems().find(
      (li) => li.dataset.code === 'local-file-missing'
    )!;
    expect(row.textContent).toBe(
      './missing.fasta isn\'t loaded in this browser — press "Load data file…" and pick missing.fasta.'
    );
    expect(row.dataset.severity).toBe('warning');
    // Give a mounted preview time to fetch, had one been mounted.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(preview()).toBeNull();
    expect(byId('preview-stale').hidden).toBe(false);
    expect(byId('preview-stale').textContent).toBe(HELD_BACK);

    // Run can't help, and the banner keeps saying what would.
    await userEvent.click(byId('run'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(preview()).toBeNull();
    expect(byId('preview-stale').hidden).toBe(false);
    expect(byId('preview-stale').textContent).toBe(HELD_BACK);
    expect(recorded.filter((url) => url.includes('missing.fasta'))).toEqual([]);
  });

  it('sets sequence: in place of accession:, by keyboard, and renders it with no request', async () => {
    setEditorText(ACCESSION_CONFIG);
    await pick('construct.fasta', CONSTRUCT);
    await formOpens();

    expect(sequenceForm()!.querySelector('legend')?.textContent).toBe(
      'Use construct.fasta (84 B) as the sequence'
    );
    expect(document.querySelector('.sequence-summary')?.textContent).toBe(
      'my construct v2 — 66 residues.'
    );
    expect(radio('this').checked).toBe(true);
    expect(document.activeElement).toBe(radio('this'));
    expect(consequences('this')).toEqual([
      'Sets sequence: ./construct.fasta',
      'Removes accession: P05067',
      'Keeps the tracks',
    ]);
    expect(sequenceForm()!.textContent).toContain(PRIVACY_NOTE);

    await userEvent.tab(); // → Use
    expect(document.activeElement?.textContent).toBe('Use');
    await userEvent.keyboard('{Enter}');
    expect(byId('data-attach').hidden).toBe(true);
    expect(document.activeElement).toBe(byId('load-data'));

    await vi.waitFor(() =>
      expect(status()).toBe(LOADED('construct.fasta', 'my construct v2', 66))
    );
    expect(editorText()).toBe(
      ACCESSION_CONFIG.replace(
        'accession: P05067',
        'sequence: ./construct.fasta'
      )
    );
    const shared = decodeState(location.hash)?.config ?? '';
    expect(shared).toContain('sequence: ./construct.fasta');
    expect(shared).not.toContain('MKTAYIAKQR');
    expect(shared).not.toContain('my construct v2');

    await vi.waitFor(() =>
      expect(sequenceTrack()?.getAttribute('length')).toBe('66')
    );
    expect(preview()?.hasAttribute('accession')).toBe(false);
    expect(preview()?.textContent).toContain('Sites on my construct v2');
    expect(byId<HTMLInputElement>('accession').disabled).toBe(true);
    expect(fileList()).toEqual([
      'construct.fasta — sequence, 66 residues (84 B)',
    ]);
    expect(listItems()).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('reloads a file the config already names with no form and no edit', async () => {
    const before = editorText();
    byId('data-status').textContent = '';
    await pick('construct.fasta', CONSTRUCT);
    await vi.waitFor(() =>
      expect(status()).toBe(LOADED('construct.fasta', 'my construct v2', 66))
    );
    expect(byId('data-attach').hidden).toBe(true);
    expect(editorText()).toBe(before);
  });

  it('names the sequence, by its header, in a loaded file’s out-of-range warning', async () => {
    await pick(
      'hits.csv',
      'type,start,end,description\nDOMAIN,10,25,Kinase\nSITE,100,120,Tail'
    );
    const target = await vi.waitFor(() => {
      const select = byId<HTMLSelectElement>('data-attach-target');
      if (!select) throw new Error('attach form not open');
      return select;
    });
    await userEvent.selectOptions(target, '');
    await userEvent.click(
      [...byId('data-attach').querySelectorAll('button')].find(
        (b) => b.textContent === 'Add'
      )!
    );
    const row = await vi.waitFor(() => {
      const li = listItems().find((l) => l.dataset.severity === 'warning');
      if (!li) throw new Error('no warning listed');
      return li;
    });
    expect(row.textContent).toMatch(
      /^\[track-data\] \.\/hits\.csv \(parsed as CSV\): 1 of 2 rows fall outside my construct v2 \(66 residues\)/
    );
    expect(recorded).toEqual([]);
  });

  it('replaces an inline sequence: | block with a dropped UniProt download, showing its header cut to 80 characters', async () => {
    setEditorText(INLINE_CONFIG);
    dropOnPane([new File([CRAMBIN], 'crambin.fasta')]);
    await formOpens();

    expect(radio('this').checked).toBe(true);
    expect(consequences('this')).toEqual([
      'Sets sequence: ./crambin.fasta',
      'Replaces the inline sequence (66 residues)',
      'Keeps the tracks',
    ]);
    expect(document.querySelector('.sequence-summary')?.textContent).toBe(
      `${CRAMBIN_LABEL} — 46 residues.`
    );
    await use();

    await vi.waitFor(() =>
      expect(status()).toBe(LOADED('crambin.fasta', CRAMBIN_LABEL, 46))
    );
    expect(editorText()).toBe(`sequence: ./crambin.fasta\n${SITES}`);
    await vi.waitFor(() =>
      expect(sequenceTrack()?.getAttribute('length')).toBe('46')
    );
    expect(preview()?.textContent).toContain(`Sites on ${CRAMBIN_LABEL}`);
    expect(decodeState(location.hash)?.config).not.toContain('CRAM_CRAAB');
    expect(recorded).toEqual([]);
  });

  it('defaults to a new config when the tracks need UniProt; Cancel leaves the text, and Ctrl+Z undoes the new config', async () => {
    setEditorText(REMOTE_CONFIG);
    dropOnPane([new File([CONSTRUCT], 'construct.fasta')]);
    await formOpens();
    expect(radio('new').checked).toBe(true);
    expect(document.activeElement).toBe(radio('new'));
    expect(consequences('this')).toContain(
      '1 track needs UniProt data and would be listed as errors'
    );
    await userEvent.click(
      [...sequenceForm()!.querySelectorAll('button')].find(
        (b) => b.textContent === 'Cancel'
      )!
    );
    expect(status()).toBe('construct.fasta was not loaded.');
    expect(editorText()).toBe(REMOTE_CONFIG);

    dropOnPane([new File([CONSTRUCT], 'construct.fasta')]);
    await formOpens();
    await use();
    await vi.waitFor(() =>
      expect(status()).toBe(
        `${LOADED('construct.fasta', 'my construct v2', 66)} The previous ` +
          'config was replaced — press Ctrl/Cmd+Z in the editor to undo.'
      )
    );
    expect(editorText()).toBe(
      '# construct.fasta, shown from its own sequence — no UniProt entry.\n' +
        '# Add tracks with "Load data file…" (CSV, TSV, JSON or BED).\n' +
        'sequence: ./construct.fasta\nrows: []\n'
    );
    // With no rows yet, the element shows its empty state, naming the
    // sequence it loaded.
    await vi.waitFor(() =>
      expect(preview()?.textContent).toContain(
        'No feature data available for my construct v2'
      )
    );
    expect(listItems()).toEqual([]);

    editorView().focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(editorText()).toBe(REMOTE_CONFIG);

    // This config anyway: the track that needs UniProt is listed, and the
    // status says to fix it rather than that the sequence is shown.
    dropOnPane([new File([CONSTRUCT], 'construct.fasta')]);
    await formOpens();
    await userEvent.click(radio('this'));
    await use();
    await vi.waitFor(() =>
      expect(status()).toBe(
        'Loaded construct.fasta as the sequence (my construct v2, 66 ' +
          'residues). Fix the config problems listed below, then press Run.'
      )
    );
    expect(editorText()).toBe(
      REMOTE_CONFIG.replace('accession: P05067', 'sequence: ./construct.fasta')
    );
    expect(listItems().map((li) => li.dataset.code)).toContain(
      'needs-accession'
    );
  });

  it('defaults an extends: child to a new config, saying the base may need UniProt', async () => {
    setEditorText('extends: /protvista/base.yaml\nrows: []\n');
    dropOnPane([new File([CONSTRUCT], 'construct.fasta')]);
    await formOpens();
    expect(radio('new').checked).toBe(true);
    expect(consequences('this')).toEqual([
      'Sets sequence: ./construct.fasta',
      'Keeps the tracks',
      'Keeps extends: — anything the base adds that needs UniProt is listed after Run',
    ]);
    await press('Cancel');
  });

  it('shows the line to set by hand when the config layout cannot be spliced', async () => {
    const flow = '# Flow style\n{ accession: P05067, rows: [] }\n';
    setEditorText(flow);
    await pick('construct.fasta', CONSTRUCT);
    await formOpens();
    expect(radio('this').checked).toBe(true);
    await use();
    await vi.waitFor(() =>
      expect(status()).toBe(
        "Loaded construct.fasta as ./construct.fasta. Couldn't set the " +
          'sequence automatically — set it by hand, and remove accession: ' +
          'if there is one:'
      )
    );
    expect(byId('data-snippet').hidden).toBe(false);
    expect(byId('data-snippet').textContent).toBe(
      'sequence: ./construct.fasta'
    );
    expect(editorText()).toBe(flow);
  });

  it('loads only the FASTA of a multi-file drop, says so, and names the sequence: a later one replaces', async () => {
    setEditorText(ACCESSION_CONFIG);
    dropOnPane([
      new File([CONSTRUCT], 'other.fasta'),
      new File(['type,start,end\nDOMAIN,1,5\n'], 'x.csv'),
    ]);
    await formOpens();
    await use();
    await vi.waitFor(() =>
      expect(status()).toBe(
        'Load one file at a time — loaded other.fasta only. ' +
          LOADED('other.fasta', 'my construct v2', 66)
      )
    );
    expect(byId('data-snippet').hidden).toBe(true);

    dropOnPane([new File([CONSTRUCT], 'construct.fasta')]);
    await formOpens();
    expect(radio('this').checked).toBe(true);
    expect(consequences('this')).toEqual([
      'Sets sequence: ./construct.fasta',
      'Replaces ./other.fasta',
      'Keeps the tracks',
    ]);
    await press('Cancel');
  });

  it.each([
    [
      'two.fasta',
      '>a\nMK\n>b\nMK\n',
      "two.fasta wasn't loaded: ./two.fasta (parsed as FASTA): contains 2 records; the viewer shows one protein. Keep a single '>' record.",
    ],
    [
      'bad.fasta',
      '>h\nMK1L\n',
      "bad.fasta wasn't loaded: ./bad.fasta (parsed as FASTA): invalid character '1' at residue 3. A protein sequence uses the one-letter codes A–Z, optionally ending in '*'.",
    ],
    [
      'empty.fasta',
      '',
      "empty.fasta wasn't loaded: ./empty.fasta: has no residues.",
    ],
    [
      'big.fasta',
      `>h\n${'M'.repeat(2_202_010)}\n`,
      'big.fasta is 2.1 MB — a sequence file can be at most 2.0 MB, the most a hosted viewer fetches.',
    ],
    [
      'x.fasta.gz',
      new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
      'x.fasta.gz looks like a binary or compressed file — load plain text: CSV, TSV, JSON or BED for a track, or FASTA for the sequence.',
    ],
  ])(
    'refuses %s with the message a hosted viewer would give, changing nothing',
    async (name, content, message) => {
      const text = editorText();
      const files = fileList();
      byId('data-status').textContent = '';
      await userEvent.upload(byId('data-file'), new File([content], name));
      await vi.waitFor(() => expect(status()).toBe(message));
      expect(byId('data-attach').hidden).toBe(true);
      expect(fileList()).toEqual(files);
      expect(editorText()).toBe(text);
    }
  );

  it('keeps the copy loaded earlier when the file has since broken, and says so', async () => {
    setEditorText('sequence: ./construct.fasta\nrows: []\n');
    const files = fileList();
    expect(files).toContain('construct.fasta — sequence, 66 residues (84 B)');
    await pick('construct.fasta', `${CONSTRUCT}>second\nMK\n`);
    await vi.waitFor(() =>
      expect(status()).toBe(
        "construct.fasta wasn't loaded: ./construct.fasta (parsed as FASTA): " +
          "contains 2 records; the viewer shows one protein. Keep a single '>' " +
          'record. The copy loaded earlier is still in use.'
      )
    );
    expect(fileList()).toEqual(files);
  });

  it('claims no earlier copy is in use when the config no longer names it', async () => {
    setEditorText(ACCESSION_CONFIG);
    byId('data-status').textContent = '';
    await pick('construct.fasta', `${CONSTRUCT}>second\nMK\n`);
    await vi.waitFor(() =>
      expect(status()).toBe(
        "construct.fasta wasn't loaded: ./construct.fasta (parsed as FASTA): " +
          "contains 2 records; the viewer shows one protein. Keep a single '>' " +
          'record.'
      )
    );
  });

  it('sends a .txt by its content: a > first line to the sequence form, CSV to the attach form', async () => {
    await pick('seq.txt', '\n>my construct v2\nMKTAYIAKQR\n');
    await formOpens();
    expect(consequences('this')[0]).toBe('Sets sequence: ./seq.txt');
    await userEvent.keyboard('{Escape}');
    expect(sequenceForm()).toBeNull();

    await pick('notes.txt', 'type,start,end,description\nDOMAIN,1,5,x\n');
    await vi.waitFor(() => {
      if (!byId('data-attach-format')) throw new Error('attach form not open');
    });
    expect(sequenceForm()).toBeNull();
    await userEvent.keyboard('{Escape}');

    // Raw residues in a .fa: no header to show, so the form says so.
    await pick('raw.fa', 'MKTAYIAKQR\n');
    await formOpens();
    expect(document.querySelector('.sequence-summary')?.textContent).toBe(
      'No FASTA header — shown as "your sequence". 10 residues.'
    );
    await userEvent.keyboard('{Escape}');
  });

  it.each([
    ['seq.txt', 'a headerless .txt'],
    ['seq.csv', 'a data extension'],
  ])(
    'loads %s (%s) as the sequence when the config’s sequence: names it',
    async (name) => {
      const config = `sequence: ./${name}\nrows: []\n`;
      setEditorText(config);
      byId('data-status').textContent = '';
      await pick(name, 'MKTAYIAKQR\n');
      await vi.waitFor(() =>
        expect(status()).toBe(LOADED(name, 'your sequence', 10))
      );
      expect(sequenceForm()).toBeNull();
      expect(byId('data-attach').hidden).toBe(true);
      expect(editorText()).toBe(config);
      expect(
        listItems().filter((li) => li.dataset.code === 'local-file-missing')
      ).toEqual([]);
      await vi.waitFor(() =>
        expect(preview()?.textContent).toContain(
          'No feature data available for your sequence'
        )
      );
    }
  );

  it('flags the preview out of date and lists the sequence as missing once its file is removed', async () => {
    setEditorText(
      '# construct.fasta, shown from its own sequence — no UniProt entry.\n' +
        '# Add tracks with "Load data file…" (CSV, TSV, JSON or BED).\n' +
        'sequence: ./construct.fasta\nrows: []\n'
    );
    await vi.waitFor(() => expect(byId('preview-stale').hidden).toBe(true), {
      timeout: 3000,
    });
    byId<HTMLButtonElement>('data-files')
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Remove construct.fasta"]'
      )!
      .click();
    expect(status()).toBe('Removed construct.fasta.');
    await vi.waitFor(() =>
      expect(
        listItems().find((li) => li.dataset.code === 'local-file-missing')
          ?.textContent
      ).toBe(
        './construct.fasta isn\'t loaded in this browser — press "Load data file…" and pick construct.fasta.'
      )
    );
    expect(byId('preview-stale').hidden).toBe(false);
  });

  it('has no accessibility violations, with This config disabled for a config that does not parse', async () => {
    setEditorText('rows: [\n');
    await pick('construct.fasta', CONSTRUCT);
    await formOpens();
    expect(radio('this').disabled).toBe(true);
    expect(radio('new').checked).toBe(true);
    expect(document.activeElement).toBe(radio('new'));
    expect(consequences('this')).toEqual([
      "The config doesn't parse — fix it first.",
    ]);
    await expectNoA11yViolations(document.querySelector('.local-files')!);
    await userEvent.keyboard('{Escape}');

    setEditorText(ACCESSION_CONFIG);
    await pick('construct.fasta', CONSTRUCT);
    await formOpens();
    await expectNoA11yViolations(document.querySelector('.local-files')!);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(byId('load-data'));
  });

  it('wraps a long file name within a phone-width pane, in the form and in the loaded list', async () => {
    // The page's own stylesheet, on the skeleton, with the pane as wide as
    // a 390 px phone leaves it.
    const css = /<style is:global>([\s\S]*?)<\/style>/.exec(playgroundPage)![1];
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const pane = document.querySelector<HTMLElement>('.local-files')!;
    pane.style.width = '390px';
    const overflowing = () => {
      const right = pane.getBoundingClientRect().right;
      return [...pane.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > right + 0.5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    };
    const name =
      'AF-P05067-F1-model_v4_reference_sequence_isoform_canonical_long_name.fasta';
    try {
      setEditorText(ACCESSION_CONFIG);
      await pick(name, CONSTRUCT);
      await formOpens();
      expect(overflowing()).toEqual([]);
      await use();
      await vi.waitFor(() =>
        expect(status()).toBe(LOADED(name, 'my construct v2', 66))
      );
      expect(overflowing()).toEqual([]);
    } finally {
      style.remove();
      pane.style.width = '';
    }
  });

  it('renders the shipped examples/sequence-only from its own two files, with no form and no request', async () => {
    const from = recorded.length;
    setEditorText(exampleConfig);
    await pick('hotspots.csv', exampleHotspots);
    await vi.waitFor(() =>
      expect(status()).toBe(
        'Loaded hotspots.csv. Load protein.fasta to see the preview — ' +
          "the config's sequence: names it."
      )
    );
    expect(byId('data-attach').hidden).toBe(true);

    await pick('protein.fasta', exampleProtein);
    await vi.waitFor(() =>
      expect(status()).toBe(LOADED('protein.fasta', 'my construct v2', 240))
    );
    expect(byId('data-attach').hidden).toBe(true);
    expect(editorText()).toBe(exampleConfig);
    await vi.waitFor(() =>
      expect(sequenceTrack()?.getAttribute('length')).toBe('240')
    );
    await vi.waitFor(() =>
      expect(
        (preview()?.data?.['hotspots-hotspots'] as unknown[])?.length
      ).toBe(4)
    );
    expect(listItems()).toEqual([]);
    expect(recorded.slice(from)).toEqual([]);
  });
});
