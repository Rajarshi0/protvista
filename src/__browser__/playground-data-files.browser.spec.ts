/**
 * Authored data files in the playground, through the real page controller,
 * with the fixture files in `src/__fixtures__/local-files/`: styled columns,
 * tooltip fields no record has, delimiter hints, and opening a local file.
 *
 * The page opens on a styled-track config, which names `./styled.csv`. The
 * tests then run in order against that one live page, as a visitor would
 * work: pasting a config, loading a file, pressing Run.
 * `/protvista/sample-data/hotspots.csv` is answered from the copy the docs
 * site serves; the Proteins API gets the stub's 770-residue protein; every
 * other URL answers the stub's empty `ok`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { userEvent } from 'vitest/browser';

import servedHotspots from '../../docs/public/sample-data/hotspots.csv?raw';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { PRIVACY_NOTE } from '../playground/local-files.js';
import {
  addAsNewTrack,
  byId,
  choose,
  closePlayground,
  editorText,
  fileList,
  filesDrag,
  listItems,
  openPlayground,
  pickFixture,
  preview,
  records,
  fixtureText,
  setEditorText,
  status,
} from './playground-page.js';

const BADGE = `.${CSS_PREFIX}-error-badge`;

/** A grouped styled track with a markdown tooltip, reading `data` from the file named. */
const styledConfig = (data: string, template: string) => `accession: P05067
rows:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hits
        label: Styled hits
        kind: features
        data: ${data}
        rendering:
          color: '#7f7f7f'
        dataTooltip:
          kind: markdown
          template: '${template}'
`;

/** A grouped markdown template and a standalone `fields` row, both on hotspots.csv. */
const tooltipConfig = (template: string) => `accession: P05067
rows:
  - id: LAB
    label: Lab
    tracks:
      - id: grouped
        label: Grouped hits
        kind: features
        data: /protvista/sample-data/hotspots.csv
        dataTooltip:
          kind: markdown
          template: '${template}'
  - id: solo
    label: Standalone hits
    kind: features
    data: /protvista/sample-data/hotspots.csv
    dataTooltip:
      kind: fields
      fields:
        - { path: score, label: Score }
        - { path: pvalue, label: P-value }
`;

/** One standalone features track, reading `data` from the file named. */
const delimiterConfig = (data: string) => `accession: P05067
rows:
  - id: d
    label: Delimiter test
    kind: features
    data: ${data}
`;

const FEATURE_HEADER =
  'Header must contain type, start, end, description[, score].';

const run = () => userEvent.click(byId('run'));
const rows = (code: string) =>
  listItems().filter((li) => li.dataset.code === code);
const texts = (code: string) => rows(code).map((li) => li.textContent);

/** The open attach form's controls. */
const attachForm = () => ({
  legend: byId('data-attach').querySelector('legend')?.textContent,
  format: byId<HTMLSelectElement>('data-attach-format'),
  target: byId<HTMLSelectElement>('data-attach-target'),
  note: document.querySelector('.data-attach-note')?.textContent,
});
async function attachFormOpens(): Promise<ReturnType<typeof attachForm>> {
  return vi.waitFor(() => {
    if (byId('data-attach').hidden || !byId('data-attach-target')) {
      throw new Error('attach form not open');
    }
    return attachForm();
  });
}

/** Resolves once the editor's list has been quiet for 300 ms. */
async function listSettled(): Promise<void> {
  let seen = '';
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const now = listItems()
      .map((li) => li.textContent)
      .join('\n');
    if (now === seen) return;
    seen = now;
  }
}

/** Every non-`blob:` URL the page fetched, in order. */
const recorded: string[] = [];

beforeAll(async () => {
  await openPlayground({
    state: {
      config: styledConfig('./styled.csv', '{% $description %}'),
      accession: 'P05067',
    },
    recorded,
    respond: (url) =>
      url === '/protvista/sample-data/hotspots.csv'
        ? new Response(servedHotspots)
        : undefined,
  });
});

afterAll(closePlayground);

describe('authored columns, in the diagnostics list (#283)', () => {
  it('lists reserved columns and unpaintable colours as two grey track-data rows, with no badge and no injected markup', async () => {
    setEditorText(
      styledConfig('./reserved-and-bad-colours.csv', '{% $description %}')
    );
    await pickFixture('reserved-and-bad-colours.csv');
    // The config names the file, so it loads in place: no form.
    expect(byId('data-attach').hidden).toBe(true);

    await vi.waitFor(() => {
      expect(texts('data-field-ignored')).toEqual([
        '[track-data] ./reserved-and-bad-colours.csv (parsed as CSV): ' +
          'ignored column(s) "tooltipContent", "toString" — these names are ' +
          'reserved by the viewer or by JavaScript and cannot come from a ' +
          'data file.',
      ]);
      expect(texts('unpaintable-color')).toEqual([
        '[track-data] ./reserved-and-bad-colours.csv (parsed as CSV): ' +
          '2 row(s) have a colour the canvas cannot paint ("bleu", ' +
          '"#catFace"); those features are drawn in the previous ' +
          "feature's colour.",
      ]);
    });
    for (const li of [
      ...rows('data-field-ignored'),
      ...rows('unpaintable-color'),
    ]) {
      expect(li.dataset.severity).toBe('warning');
    }
    expect(preview()?.querySelector(BADGE)).toBeNull();

    // The template shows the description alone: the file's own
    // `tooltipContent` column never reaches a tooltip.
    const hits = records('MY_LAB-hits')!;
    expect(hits).toHaveLength(3);
    for (const record of hits) {
      expect(String(record.tooltipContent)).not.toContain('injected');
      expect(String(record.tooltipContent)).not.toMatch(/<[bi]>/);
    }
  });

  it('lists an out-of-range opacity as one red data-parse row, and badges the track', async () => {
    setEditorText(styledConfig('./bad-opacity.csv', '{% $description %}'));
    await pickFixture('bad-opacity.csv');

    await vi.waitFor(() =>
      expect(texts('data-parse')).toEqual([
        './bad-opacity.csv (parsed as CSV): row 2, column "opacity": ' +
          'expected a number from 0 to 1, got "1.5".',
      ])
    );
    expect(rows('data-parse')[0].dataset.severity).toBeUndefined();
    // The preview's own report of it is not listed a second time.
    expect(listItems().some((li) => li.textContent?.includes('blob:'))).toBe(
      false
    );
    await vi.waitFor(() =>
      expect(preview()?.querySelector(BADGE)).not.toBeNull()
    );
  });
});

describe('tooltip fields no record has (#135)', () => {
  it('lists exactly one tooltip-field-miss row per track, the standalone one by its bare id', async () => {
    setEditorText(
      tooltipConfig('{% $description %} p={% $pvalue %} gene={% $Gene %}')
    );
    await run();

    await vi.waitFor(() =>
      expect(texts('tooltip-field-miss')).toEqual([
        '[tooltip-field-miss] Track LAB/grouped: dataTooltip references ' +
          'unknown fields: pvalue, Gene',
        '[tooltip-field-miss] Track solo: dataTooltip references unknown ' +
          'fields: pvalue',
      ])
    );
    for (const li of rows('tooltip-field-miss')) {
      expect(li.dataset.severity).toBe('warning');
    }
    // `score` is in the file, so it is never named.
    expect(texts('tooltip-field-miss').join()).not.toContain('score');
    expect(preview()?.querySelector(BADGE)).toBeNull();
  });

  it('lists the same rows again on each Run, without piling them up', async () => {
    for (let i = 0; i < 2; i++) {
      await run();
      await listSettled();
      expect(rows('tooltip-field-miss')).toHaveLength(2);
    }
  });

  it('drops the grouped row once its template names fields the file has', async () => {
    setEditorText(tooltipConfig('{% $description %} score={% $score %}'));
    await run();
    await vi.waitFor(() =>
      expect(texts('tooltip-field-miss')).toEqual([
        '[tooltip-field-miss] Track solo: dataTooltip references unknown ' +
          'fields: pvalue',
      ])
    );
  });
});

describe('delimiter hints, as the list shows them (#276)', () => {
  it.each([
    {
      file: 'tab-header.csv',
      message:
        './tab-header.csv (parsed as CSV): missing required header column ' +
        `"type". ${FEATURE_HEADER} The header looks tab-separated — read it ` +
        'as TSV: set `format: tsv` (or rename the file to .tsv).',
    },
    {
      file: 'comma.tsv',
      message:
        './comma.tsv (parsed as TSV): missing required header column ' +
        `"type". ${FEATURE_HEADER} The header looks comma-separated — read ` +
        'it as CSV: set `format: csv` (or rename the file to .csv).',
    },
    {
      file: 'semicolon.csv',
      message:
        './semicolon.csv (parsed as CSV): missing required header column ' +
        `"type". ${FEATURE_HEADER} The header looks semicolon-separated, ` +
        'which ProtVista does not read. If it came from Excel, save it as ' +
        '"Text (Tab delimited)" and read it as TSV (`format: tsv` or a .tsv ' +
        'name — Excel names that export .txt), or re-export it ' +
        'comma-separated.',
    },
    {
      file: 'semicolon.tsv',
      message:
        './semicolon.tsv (parsed as TSV): missing required header column ' +
        `"type". ${FEATURE_HEADER} The header looks semicolon-separated, ` +
        'which ProtVista does not read. If it came from Excel, save it again ' +
        'as "Text (Tab delimited)" and keep reading it as TSV ' +
        '(`format: tsv`), or re-export it comma-separated and read it as ' +
        'CSV: set `format: csv` (or rename the file to .csv).',
    },
  ])(
    'lists $file as one red data-parse row, named ./$file',
    async ({ file, message }) => {
      setEditorText(delimiterConfig(`./${file}`));
      await pickFixture(file);
      expect(byId('data-attach').hidden).toBe(true);
      await vi.waitFor(() => expect(texts('data-parse')).toEqual([message]));
    }
  );

  it('reads the tab-separated .csv once the track says format: tsv', async () => {
    setEditorText(delimiterConfig('{ url: ./tab-header.csv, format: tsv }'));
    await pickFixture('tab-header.csv');
    await vi.waitFor(() =>
      expect(records('d-d')).toEqual([
        expect.objectContaining({ type: 'DOMAIN', start: 18, end: 189 }),
      ])
    );
    expect(rows('data-parse')).toHaveLength(0);
  });
});

describe('opening a local data file, from the CSV preset (#277)', () => {
  beforeAll(async () => {
    await choose('csv');
    await vi.waitFor(() =>
      expect(records('hotspots-hotspots')?.length).toBeGreaterThan(0)
    );
  });

  it('offers a new file as a new track or for the existing one, and writes the new row', async () => {
    await pickFixture('second-file.csv');
    const form = await attachFormOpens();
    expect(form.legend).toBe('Add second-file.csv (259 B)');
    expect(form.format.value).toBe('csv');
    expect([...form.target.options].map((o) => o.textContent)).toEqual([
      'New track',
      expect.stringContaining('hotspots'),
    ]);
    expect(form.note).toBe(PRIVACY_NOTE);
    await addAsNewTrack();

    await vi.waitFor(() =>
      expect(editorText()).toContain(
        [
          '  - id: second-file',
          '    label: second-file.csv',
          '    kind: features',
          '    data: ./second-file.csv',
        ].join('\n')
      )
    );
    await vi.waitFor(() =>
      expect(status()).toBe(
        'Loaded second-file.csv. 4 records — read in your browser, never ' +
          'uploaded.'
      )
    );
    await vi.waitFor(() =>
      expect(records('second-file-second-file')).toHaveLength(4)
    );
  });

  it('lists a named file as missing until it is loaded, then loads it with no form', async () => {
    setEditorText(
      editorText().replace('/protvista/sample-data/hotspots.csv', './hits.csv')
    );
    await run();
    await vi.waitFor(() =>
      expect(texts('local-file-missing')).toEqual([
        './hits.csv isn\'t loaded in this browser — press "Load data file…" ' +
          'and pick hits.csv.',
      ])
    );

    await pickFixture('hits.csv');
    expect(byId('data-attach').hidden).toBe(true);
    await vi.waitFor(() =>
      expect(records('hotspots-hotspots')).toHaveLength(4)
    );
    expect(rows('local-file-missing')).toHaveLength(0);
  });

  it('warns about a CSV with a header and no rows', async () => {
    await pickFixture('empty.csv');
    await attachFormOpens();
    await addAsNewTrack();
    await vi.waitFor(() =>
      expect(texts('data-empty')).toEqual([
        './empty.csv (parsed as CSV): decoded 0 records — the file has no ' +
          'data rows the track can draw.',
      ])
    );
    expect(rows('data-empty')[0].dataset.severity).toBe('warning');
  });

  it('loads only the first of two files picked at once, and says so', async () => {
    // The picker takes one file, so a second can only arrive through an
    // input whose `files` the browser filled: set them as it would.
    const input = byId<HTMLInputElement>('data-file');
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([fixtureText('second-file.csv')], 'second-file.csv')
    );
    transfer.items.add(new File([fixtureText('depth.csv')], 'depth.csv'));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() =>
      expect(status()).toMatch(
        /^Load one file at a time — loaded second-file\.csv only\. Loaded second-file\.csv\. /
      )
    );
    expect(byId('data-attach').hidden).toBe(true);
    expect(fileList().some((name) => name?.includes('depth.csv'))).toBe(false);
  });

  it('shows the drop overlay over the pane and hides it when the drag leaves or is cancelled', () => {
    const pane = byId('config-pane');
    const overlay = byId('drop-overlay');
    const file = [new File(['type,start,end\n'], 'drag.csv')];
    expect(overlay.hidden).toBe(true);

    pane.dispatchEvent(filesDrag('dragenter', file));
    expect(overlay.hidden).toBe(false);
    // Moving onto a child of the pane is not leaving it.
    byId('editor').dispatchEvent(
      filesDrag('dragleave', file, document.querySelector('.cm-content'))
    );
    expect(overlay.hidden).toBe(false);
    // Out of the window, or Escape: a dragleave to nowhere.
    pane.dispatchEvent(filesDrag('dragleave', file, null));
    expect(overlay.hidden).toBe(true);

    // Leaving for another part of the page hides it too, and a drop there
    // is refused rather than opening the file in the tab.
    pane.dispatchEvent(filesDrag('dragover', file));
    expect(overlay.hidden).toBe(false);
    pane.dispatchEvent(filesDrag('dragleave', file, byId('preview')));
    expect(overlay.hidden).toBe(true);
    const elsewhere = filesDrag('drop', file);
    byId('preview').dispatchEvent(elsewhere);
    expect(elsewhere.defaultPrevented).toBe(true);
    expect(overlay.hidden).toBe(true);
  });

  it('removes a file but keeps its reference, now listed as missing', async () => {
    const before = editorText();
    await userEvent.click(
      byId('data-files').querySelector<HTMLButtonElement>(
        'button[aria-label="Remove second-file.csv"]'
      )!
    );
    expect(status()).toBe('Removed second-file.csv.');
    expect(editorText()).toBe(before);
    expect(editorText()).toContain('data: ./second-file.csv');
    await vi.waitFor(() =>
      expect(texts('local-file-missing')).toEqual([
        './second-file.csv isn\'t loaded in this browser — press "Load data ' +
          'file…" and pick second-file.csv.',
      ])
    );
  });

  it('makes a comma depth.csv a line graph with no note, and a tab one a tsv line graph', async () => {
    await pickFixture('depth.csv');
    let form = await attachFormOpens();
    expect(form.format.value).toBe('csv');
    expect(form.note).toBe(PRIVACY_NOTE);
    await addAsNewTrack();
    await vi.waitFor(() =>
      expect(editorText()).toMatch(
        /- id: depth\n {4}label: depth\.csv\n {4}kind: linegraph\n {4}data: \.\/depth\.csv\n/
      )
    );

    await pickFixture('depth-tab.csv');
    form = await attachFormOpens();
    expect(form.format.value).toBe('tsv');
    expect(form.note).toBe(
      `Its header looks tab-separated, so it is read as tsv. ${PRIVACY_NOTE}`
    );
    await addAsNewTrack();
    await vi.waitFor(() =>
      expect(editorText()).toMatch(
        /- id: depth-tab\n {4}label: depth-tab\.csv\n {4}kind: linegraph\n {4}data: \{ url: \.\/depth-tab\.csv, format: tsv \}\n/
      )
    );
  });

  it('makes a variants CSV a variants track, and hands its variants to the preview', async () => {
    await pickFixture('my-variants.csv');
    await attachFormOpens();
    await addAsNewTrack();
    await vi.waitFor(() =>
      expect(editorText()).toMatch(
        /- id: my-variants\n {4}label: my-variants\.csv\n {4}kind: variants\n {4}data: \.\/my-variants\.csv\n/
      )
    );
    const variants = await vi.waitFor(() => {
      const data = preview()?.data?.['my-variants-my-variants'] as
        { variants?: { start?: unknown }[] } | undefined;
      if (!data?.variants?.length) throw new Error('no variants yet');
      return data.variants;
    });
    expect(variants.map((v) => Number(v.start))).toEqual([
      672, 673, 692, 714, 717, 723,
    ]);
  });

  it('reads a tab-separated .csv with a comma in a cell as tsv, and draws it', async () => {
    await pickFixture('hits-note.csv');
    const form = await attachFormOpens();
    expect(form.format.value).toBe('tsv');
    expect(form.note).toBe(
      `Its header looks tab-separated, so it is read as tsv. ${PRIVACY_NOTE}`
    );
    await addAsNewTrack();
    await vi.waitFor(() =>
      expect(editorText()).toContain(
        'data: { url: ./hits-note.csv, format: tsv }'
      )
    );
    await vi.waitFor(() =>
      expect(records('hits-note-hits-note')).toEqual([
        expect.objectContaining({ type: 'DOMAIN', start: 18, end: 189 }),
      ])
    );
    expect(texts('data-parse').some((t) => t?.includes('hits-note.csv'))).toBe(
      false
    );
  });
});
