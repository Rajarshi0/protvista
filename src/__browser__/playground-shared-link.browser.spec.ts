/**
 * A shared playground link carrying an edited config, opened in a new tab:
 * the config and accession come back, and, since the link names a local file
 * but never carries its contents, the file is listed as not loaded until it
 * is picked again.
 *
 * The controller reads the link once, when it is imported, so this needs a
 * page of its own (see `playground-page.ts`).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { decodeState } from '../playground/url-state.js';
import {
  byId,
  closePlayground,
  editorText,
  listItems,
  notFoundPageRelative,
  openPlayground,
  pickFixture,
  preview,
  records,
} from './playground-page.js';

/** An edited config whose track names a local file, `./hits.csv`. */
const CONFIG = `# Shared from my playground
accession: P69905
rows:
  - id: hotspots
    label: Hotspots
    kind: features
    data: ./hits.csv
`;

beforeAll(async () => {
  await openPlayground({
    state: { config: CONFIG, accession: 'P69905' },
    // Unlike a missing sequence file, a missing track file costs only its
    // track, so the preview mounts and asks the docs host, which has no
    // such file.
    respond: notFoundPageRelative,
  });
  await vi.waitFor(() => {
    if (!listItems().some((li) => li.dataset.code === 'local-file-missing')) {
      throw new Error('not validated yet');
    }
  });
});

afterAll(closePlayground);

describe('playground: a shared link to an edited config', () => {
  it('restores the config and the accession', () => {
    expect(editorText()).toBe(CONFIG);
    expect(byId<HTMLInputElement>('accession').value).toBe('P69905');
    expect(byId<HTMLSelectElement>('preset').value).toBe('custom');
    expect(decodeState(location.hash)).toEqual({
      config: CONFIG,
      accession: 'P69905',
    });
  });

  it('lists the local file the link names as not loaded, until it is picked', async () => {
    expect(
      listItems()
        .filter((li) => li.dataset.code === 'local-file-missing')
        .map((li) => [li.dataset.severity, li.textContent])
    ).toEqual([
      [
        'warning',
        './hits.csv isn\'t loaded in this browser — press "Load data file…" and pick hits.csv.',
      ],
    ]);

    // The config names it, so it loads with no form.
    await pickFixture('hits.csv');
    await vi.waitFor(() => expect(listItems()).toEqual([]));
    expect(byId('data-attach').hidden).toBe(true);
    expect(editorText()).toBe(CONFIG);
    await vi.waitFor(() =>
      expect(records('hotspots-hotspots')?.length).toBeGreaterThan(0)
    );
    expect(preview()?.getAttribute('accession')).toBe('P69905');
  });
});
