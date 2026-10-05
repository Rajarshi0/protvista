/**
 * The playground's example presets for conservation, your own sequence and
 * small proteins, through the real page controller.
 *
 * The page opens on a docs-style link, `#preset=conservation`, with no
 * accession. The tests then run in order against that one live page,
 * switching presets with the picker as a visitor would. Served sample data is
 * answered from the canonical files under `examples/` (the docs site serves
 * byte-identical copies, which `presets.spec.ts` checks); any other
 * `/protvista/sample-data/` path, and any page-relative URL, answers 404, as
 * the docs host would. The Proteins API answers for P24297 with the literals
 * below; every other remote URL (the structure panel's, for one) answers 404,
 * an expected absence that the playground does not list. Every non-`blob:`
 * URL is recorded.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { userEvent } from 'vitest/browser';

import smallPeptideStructure from '../../examples/small-peptide/structure.csv?raw';
import conservationCsv from '../../examples/conservation/conservation.csv?raw';
import conservedSitesCsv from '../../examples/conservation/conserved-sites.csv?raw';
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
  '/protvista/sample-data/conservation/conservation.csv': conservationCsv,
  '/protvista/sample-data/conservation/conserved-sites.csv': conservedSitesCsv,
};

/**
 * Rubredoxin P24297 as the EBI Proteins API gave it on 2026-10-05: the
 * sequence (54 residues) and the entry's four Binding sites, "Fe cation".
 * UniProt data, CC BY 4.0.
 */
const P24297_SEQUENCE =
  'MAKWVCKICGYIYDEDAGDPDNGISPGTKFEELPDDWVCPICGAPKSEFEKLED';
const P24297_BINDING = [6, 9, 39, 42].map((at) => ({
  type: 'BINDING',
  category: 'DOMAINS_AND_SITES',
  begin: String(at),
  end: String(at),
  ligand: {
    name: 'Fe cation',
    dbReference: { name: 'ChEBI', id: 'CHEBI:24875' },
  },
}));

const NOT_FOUND = () =>
  new Response('Not Found', { status: 404, statusText: 'Not Found' });

function respond(url: string): Response | undefined {
  if (url.endsWith('/proteins/api/proteins/P24297')) {
    return Response.json({
      accession: 'P24297',
      sequence: { sequence: P24297_SEQUENCE, length: 54 },
    });
  }
  if (url.endsWith('/proteins/api/features/P24297')) {
    return Response.json({
      accession: 'P24297',
      sequence: P24297_SEQUENCE,
      features: P24297_BINDING,
    });
  }
  if (/^https?:/.test(url)) return NOT_FOUND();
  if (url.startsWith('/protvista/sample-data/')) {
    const body = SERVED[url];
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

/** Resolves once no request has been recorded for 300 ms. */
async function settled(): Promise<void> {
  let seen = -1;
  while (seen !== recorded.length) {
    seen = recorded.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/** Pick a preset in the picker, as a visitor would. */
async function choose(id: string): Promise<void> {
  await userEvent.selectOptions(byId<HTMLSelectElement>('preset'), id);
}

/** The accession box's value as the page first set it. */
let initialAccession = '';

beforeAll(async () => {
  await openPlayground({ hash: '#preset=conservation', recorded, respond });
  // Read straight after the controller's import, before anything else runs.
  initialAccession = accessionBox().value;
});

afterAll(closePlayground);

describe('playground presets: conservation, your own sequence and small proteins', () => {
  it('a #preset= link with no accession opens the preset on its own protein', () => {
    expect(byId<HTMLSelectElement>('preset').value).toBe('conservation');
    expect(initialAccession).toBe('P24297');
  });

  it('conservation draws its 46 scores as a line, its 6 most conserved residues, and UniProt’s 4 binding sites, with nothing listed', async () => {
    await vi.waitFor(() => expect(sequenceLength()).toBe('54'), {
      timeout: 5000,
    });
    const line = await vi.waitFor(() => {
      const series = records('conservation-conservation') as
        { values: { position: number; value: number }[] }[] | undefined;
      if (!series?.length) throw new Error('no line yet');
      return series;
    });
    expect(line).toHaveLength(1);
    expect(line[0].values).toHaveLength(46);
    expect(line[0].values[0]).toEqual({ position: 4, value: 0.606 });
    await vi.waitFor(() =>
      expect(records('conserved_sites-conserved_sites')).toHaveLength(6)
    );
    await vi.waitFor(() =>
      expect(records('binding_sites-binding_sites')).toHaveLength(4)
    );
    expect(preview()?.getAttribute('accession')).toBe('P24297');
    expect(recorded).toEqual(
      expect.arrayContaining([
        '/protvista/sample-data/conservation/conservation.csv',
        '/protvista/sample-data/conservation/conserved-sites.csv',
      ])
    );
    // Give a late failure time to be listed, then check none was.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      listItems().map((li) => li.textContent),
      'nothing about the conservation tracks or the served data is listed'
    ).toEqual([]);
  });

  it('own-sequence shows its 240 residues with the accession box disabled, nothing listed and no request', async () => {
    // Let the conservation preview's requests finish, so any request from
    // here on is own-sequence's.
    await settled();
    const mark = recorded.length;
    await choose('own-sequence');
    await vi.waitFor(() => expect(sequenceLength()).toBe('240'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(byId<HTMLSelectElement>('preset').value).toBe('own-sequence');
    expect(accessionBox().disabled).toBe(true);
    expect(byId('accession-hint').hidden).toBe(false);
    expect(preview()?.hasAttribute('accession')).toBe(false);
    await vi.waitFor(() =>
      expect(preview()?.textContent).toContain('Hotspots on my construct v2')
    );
    expect(records('hotspots-hotspots')).toHaveLength(4);
    expect(listItems()).toEqual([]);
    expect(recorded.slice(mark)).toEqual([]);
    recorded.length = 0;
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
