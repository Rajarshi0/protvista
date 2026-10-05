/**
 * The playground's example presets for your own sequence and small proteins,
 * through the real page controller.
 *
 * The page opens on a docs-style link, `#preset=own-sequence`, with no
 * accession. The tests then run in order against that one live page,
 * switching presets with the picker as a visitor would. Served sample data is
 * answered from the canonical files under `examples/` (the docs site serves
 * byte-identical copies, which `presets.spec.ts` checks); any other
 * `/protvista/sample-data/` path, and any page-relative URL, answers 404, as
 * the docs host would. Every non-`blob:` URL is recorded.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { userEvent } from 'vitest/browser';

import smallPeptideStructure from '../../examples/small-peptide/structure.csv?raw';
import {
  byId,
  closePlayground,
  editorText,
  listItems,
  notFoundPageRelative,
  openPlayground,
  pick,
  preview,
} from './playground-page.js';

/** The files the docs site serves under `/protvista/sample-data/`. */
const SERVED: Record<string, string> = {
  '/protvista/sample-data/small-peptide/structure.csv': smallPeptideStructure,
};

const NOT_FOUND = () =>
  new Response('Not Found', { status: 404, statusText: 'Not Found' });

function respond(url: string): Response | undefined {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/protvista/sample-data/')) {
    const body = SERVED[path];
    return body === undefined ? NOT_FOUND() : new Response(body);
  }
  return notFoundPageRelative(url);
}

/** Every non-`blob:` URL the page fetched, in order. */
const recorded: string[] = [];

const accessionBox = () => byId<HTMLInputElement>('accession');
const sequenceLength = () =>
  preview()?.querySelector('nightingale-sequence')?.getAttribute('length');
/** The records the mounted preview holds for a track. */
const records = (key: string) =>
  preview()?.data?.[key] as unknown[] | undefined;

/** Pick a preset in the picker, as a visitor would. */
async function choose(id: string): Promise<void> {
  await userEvent.selectOptions(byId<HTMLSelectElement>('preset'), id);
}

beforeAll(async () => {
  await openPlayground({ hash: '#preset=own-sequence', recorded, respond });
  await vi.waitFor(() => expect(sequenceLength()).toBe('240'), {
    timeout: 5000,
  });
});

afterAll(closePlayground);

describe('playground presets: your own sequence and small proteins', () => {
  it('own-sequence shows its 240 residues with the accession box disabled, nothing listed and no request', async () => {
    expect(byId<HTMLSelectElement>('preset').value).toBe('own-sequence');
    expect(accessionBox().disabled).toBe(true);
    expect(byId('accession-hint').hidden).toBe(false);
    expect(preview()?.hasAttribute('accession')).toBe(false);
    await vi.waitFor(() =>
      expect(preview()?.textContent).toContain('Hotspots on my construct v2')
    );
    expect(records('hotspots-hotspots')).toHaveLength(4);
    expect(listItems()).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('small-peptide shows its 20 residues and its structure from the one served CSV', async () => {
    await choose('small-peptide');
    await vi.waitFor(() => expect(sequenceLength()).toBe('20'));
    await vi.waitFor(() =>
      expect(records('structure-structure')).toHaveLength(4)
    );
    expect(preview()?.textContent).toContain('Structure of Trp-cage TC5b');
    expect(recorded).toEqual([
      '/protvista/sample-data/small-peptide/structure.csv',
    ]);
    expect(accessionBox().disabled).toBe(true);
    expect(listItems()).toEqual([]);
  });

  it('a FASTA loaded over own-sequence replaces its inline block, keeps its track, and its coordinates are checked against it', async () => {
    await choose('own-sequence');
    await vi.waitFor(() => expect(sequenceLength()).toBe('240'));
    recorded.length = 0;

    await pick(
      'construct.fasta',
      '>my construct v2\n' +
        'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ\n'
    );
    const thisConfig = await vi.waitFor(() => {
      const radio = document.getElementById(
        'sequence-target-this'
      ) as HTMLInputElement | null;
      if (!radio) throw new Error('sequence form not open');
      return radio;
    });
    // Nothing in the preset needs UniProt data, so the form offers to
    // replace its own block.
    expect(thisConfig.checked).toBe(true);
    const consequences = [
      ...byId(thisConfig.getAttribute('aria-describedby')!).querySelectorAll(
        'li'
      ),
    ].map((li) => li.textContent);
    expect(consequences).toEqual([
      'Sets sequence: ./construct.fasta',
      'Replaces the inline sequence (240 residues)',
      'Keeps the tracks',
    ]);
    await userEvent.click(
      [...document.querySelectorAll('.sequence-attach button')].find(
        (b) => b.textContent === 'Use'
      )!
    );

    await vi.waitFor(() => expect(sequenceLength()).toBe('66'));
    expect(editorText()).toContain('sequence: ./construct.fasta');
    expect(editorText()).not.toContain('MQNCSGGMDLW');
    expect(editorText()).toContain('label: Hotspots on {accession}');
    // The preset and the file share a header, so the label alone cannot tell
    // them apart; the warning's residue count can.
    const warning = await vi.waitFor(() => {
      const li = listItems().find((l) => l.dataset.severity === 'warning');
      if (!li) throw new Error('no warning listed');
      return li;
    });
    expect(warning.textContent).toContain(
      '4 of 4 rows fall outside my construct v2 (66 residues)'
    );
    expect(recorded).toEqual([]);
  });
});
