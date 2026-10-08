/**
 * A shared link to `examples/sequence-only`, whose config names two local
 * files: `sequence: ./protein.fasta` and `data: ./hotspots.csv`. A link
 * carries the names, never the files, so both are listed as not loaded, no preview is
 * mounted (it could only request the private file name from the docs host),
 * and loading the two files renders it with no request.
 *
 * The controller reads the link once, when it is imported, so this needs a
 * page of its own (see `playground-page.ts`).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import exampleConfig from '../../examples/sequence-only/config.yaml?raw';
import {
  byId,
  closePlayground,
  listItems,
  notFoundPageRelative,
  openPlayground,
  pickFixture,
  preview,
  records,
  sequenceLength,
} from './playground-page.js';

/** Every non-`blob:` URL the page fetched, in order. */
const recorded: string[] = [];

const missing = () =>
  listItems()
    .filter((li) => li.dataset.code === 'local-file-missing')
    .map((li) => li.textContent);

beforeAll(async () => {
  await openPlayground({
    state: { config: exampleConfig, accession: 'P05067' },
    recorded,
    respond: notFoundPageRelative,
  });
  await vi.waitFor(() => {
    if (missing().length === 0) throw new Error('not validated yet');
  });
});

afterAll(closePlayground);

describe('playground: a shared link naming a local sequence and a local data file', () => {
  it('lists both files as not loaded and mounts no preview, requesting neither', async () => {
    expect(missing()).toEqual([
      './protein.fasta isn\'t loaded in this browser — press "Load data file…" and pick protein.fasta.',
      './hotspots.csv isn\'t loaded in this browser — press "Load data file…" and pick hotspots.csv.',
    ]);
    // Give a mounted preview time to fetch, had one been mounted.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(preview()).toBeNull();
    expect(byId('preview-stale').hidden).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('renders once both files are loaded, still with no request', async () => {
    await pickFixture('seq-hotspots.csv', 'hotspots.csv');
    await pickFixture('protein.fasta');
    await vi.waitFor(() => expect(sequenceLength()).toBe('240'));
    await vi.waitFor(() =>
      expect(records('hotspots-hotspots')).toHaveLength(4)
    );
    expect(byId('data-attach').hidden).toBe(true);
    expect(listItems()).toEqual([]);
    expect(byId<HTMLInputElement>('accession').disabled).toBe(true);
    expect(recorded).toEqual([]);
  });
});
