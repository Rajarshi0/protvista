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
 * below, for crambin (P01542) with its real sequence, and for any other
 * accession with a 770-residue protein and no features; every other remote
 * URL (the structure panel's, for one) answers 404, an expected absence that
 * the playground does not list. Every non-`blob:` URL is recorded.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { userEvent } from 'vitest/browser';

import defaultConfigYaml from '../default-config.yaml?raw';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import {
  COMMUNITY_PRESETS,
  PRESETS,
  getPreset,
} from '../playground/presets.js';
import { decodeState } from '../playground/url-state.js';
import {
  byId,
  closePlayground,
  editorText,
  listItems,
  notFoundPageRelative,
  openPlayground,
  pick,
  preview,
  setEditorText,
} from './playground-page.js';

/**
 * The files the docs site serves under `/protvista/sample-data/`: copies of
 * `examples/<dir>/<file>` (two of them at the top level, for the tutorial).
 */
const EXAMPLE_FILES = import.meta.glob<string>(
  '../../examples/*/*.{csv,tsv,json,bed}',
  { eager: true, query: '?raw', import: 'default' }
);
const SERVED: Record<string, string> = {
  '/protvista/sample-data/hotspots.csv':
    EXAMPLE_FILES['../../examples/csv/hotspots.csv'],
  '/protvista/sample-data/hotspots.json':
    EXAMPLE_FILES['../../examples/json/hotspots.json'],
  ...Object.fromEntries(
    Object.entries(EXAMPLE_FILES).map(([path, body]) => [
      path.replace('../../examples/', '/protvista/sample-data/'),
      body,
    ])
  ),
};

/** Community views give their protein's length in their `preset.json`. */
// (examples.spec.ts checks these lengths; P05067 always keeps its stub.)
const COMMUNITY_LENGTHS = new Map(
  COMMUNITY_PRESETS.filter((p) => p.length && p.accession !== 'P05067').map(
    (p) => [p.accession, p.length!]
  )
);

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

/** Crambin P01542 (46 residues), as UniProt release 2026_03 gives it. */
const P01542_SEQUENCE = 'TTCCPSIVARSNFNVCRLPGTPEALCATYTGCIIIPGATCPGDYAN';

/** A protein's sequence for the Proteins API stub. */
const sequenceOf = (accession: string) =>
  accession === 'P01542'
    ? P01542_SEQUENCE
    : 'M'.repeat(COMMUNITY_LENGTHS.get(accession) ?? 770);

const STUB_DOMAIN = {
  type: 'DOMAIN',
  category: 'DOMAINS_AND_SITES',
  begin: '2',
  end: '20',
  description: 'Stub domain',
};

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
  // Any other entry: its sequence and one domain, so the default viewer has
  // a track to draw rather than its empty state.
  const entry = /\/proteins\/api\/(proteins|features)\/(\w+)$/.exec(url);
  if (entry) {
    const [, endpoint, accession] = entry;
    const sequence = sequenceOf(accession);
    return Response.json(
      endpoint === 'proteins'
        ? {
            accession,
            sequence: { sequence, length: sequence.length },
            features: [],
            comments: [],
            dbReferences: [],
          }
        : { accession, sequence, features: [STUB_DOMAIN] }
    );
  }
  if (/^https?:/.test(url)) return NOT_FOUND();
  // The base config `extend-uniprot` extends, which the site generates from
  // `src/default-config.yaml`.
  if (url === '/protvista/default-config.yaml') {
    return new Response(defaultConfigYaml);
  }
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

type Feature = {
  type: string;
  start: number;
  end: number;
  tooltipContent?: string;
};
/** A track's records, as `type start–end`. */
const spans = (key: string) =>
  (records(key) as Feature[] | undefined)?.map(
    (f) => `${f.type} ${f.start}–${f.end}`
  );

/**
 * Click `feature` on a track, as Nightingale reports a click, and return the
 * tooltip it opens: each `<h5>` heading paired with the text under it.
 */
function clickFeature(key: string, feature: Feature): [string, string][] {
  const track = preview()!.querySelector<HTMLElement>(
    `#${CSS_PREFIX}-track-${key}`
  )!;
  track.dispatchEvent(
    new CustomEvent('change', {
      detail: { eventType: 'click', feature },
      bubbles: true,
    })
  );
  const tooltip = preview()!.querySelector<HTMLElement>(
    ':scope > .protvista-tooltip'
  )!;
  expect(tooltip.hidden).toBe(false);
  return [...tooltip.querySelectorAll('h5')].map((h) => [
    h.textContent ?? '',
    h.nextElementSibling?.textContent ?? '',
  ]);
}

/** Close an open tooltip, as Escape does. */
async function closeTooltip(): Promise<void> {
  await userEvent.keyboard('{Escape}');
}

/** Resolves once the preview has mounted and its ruler says `length`. */
async function rendered(length: string): Promise<void> {
  await vi.waitFor(() => expect(sequenceLength()).toBe(length), {
    timeout: 5000,
  });
}

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
    // The default features tooltip shows type, description, start and end;
    // UniProt leaves the description empty and names the iron as the ligand.
    for (const site of records('binding_sites-binding_sites') as {
      start: number;
      tooltipContent: string;
    }[]) {
      expect(site.tooltipContent, `binding site ${site.start}`).toContain(
        '<h5>Ligand</h5><p>Fe cation</p>'
      );
    }
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

  it('small-peptide draws Trp-cage’s helices, PPII stretch and Trp6, and Trp6’s tooltip says why', async () => {
    await choose('small-peptide');
    await rendered('20');
    await vi.waitFor(() =>
      expect(spans('structure-structure')).toEqual([
        'HELIX 2–8',
        'HELIX 11–14',
        'REGION 17–19',
        'SITE 6–6',
      ])
    );
    const site = (records('structure-structure') as Feature[]).find(
      (f) => f.type === 'SITE'
    )!;
    expect(clickFeature('structure-structure', site)).toContainEqual([
      'Description',
      'Trp6, buried in the cage',
    ]);
    await closeTooltip();
  });

  it('conservation shows its three rows, the six most conserved residues, and the four binding sites on four of the peaks', async () => {
    await choose('conservation');
    await rendered('54');
    await vi.waitFor(() =>
      expect(records('binding_sites-binding_sites')).toHaveLength(4)
    );
    for (const label of [
      'Conservation (Pfam PF00301)',
      'Most conserved residues',
      'UniProt binding sites',
    ]) {
      expect(preview()?.textContent).toContain(label);
    }
    // UniProt gives its coordinates as strings.
    const starts = (key: string) =>
      (records(key) as Feature[]).map((f) => Number(f.start));
    expect(starts('conserved_sites-conserved_sites')).toEqual([
      6, 9, 13, 37, 39, 42,
    ]);
    expect(starts('binding_sites-binding_sites')).toEqual([6, 9, 39, 42]);
    // The line runs from residue 4 to 49 with no gaps.
    const [line] = records('conservation-conservation') as {
      values: { position: number }[];
    }[];
    expect(line.values.map((v) => v.position)).toEqual(
      Array.from({ length: 46 }, (_, i) => i + 4)
    );
  });

  it('a conserved residue’s tooltip gives its score and why it is shown; a binding site’s names its ligand', async () => {
    const conserved = records('conserved_sites-conserved_sites') as Feature[];
    const why =
      'At or above the 90th percentile of the scored residues in Pfam PF00301';
    for (const [at, score] of [
      [6, '0.877'],
      [37, '0.759'],
    ] as const) {
      expect(
        clickFeature(
          'conserved_sites-conserved_sites',
          conserved.find((f) => f.start === at)!
        ),
        `residue ${at}`
      ).toEqual([
        ['Residue', String(at)],
        ['Conservation score', score],
        ['Why it is shown', why],
      ]);
      await closeTooltip();
    }
    const binding = records('binding_sites-binding_sites') as Feature[];
    expect(
      clickFeature(
        'binding_sites-binding_sites',
        binding.find((f) => Number(f.start) === 9)!
      )
    ).toEqual([
      ['Residue', '9'],
      ['Ligand', 'Fe cation'],
    ]);
    await closeTooltip();
  });

  it('small-protein shows the default viewer on crambin, 46 residues', async () => {
    await choose('small-protein');
    expect(accessionBox().value).toBe('P01542');
    await rendered('46');
    expect(preview()?.getAttribute('accession')).toBe('P01542');
    expect(recorded).toContain(
      'https://www.ebi.ac.uk/proteins/api/proteins/P01542'
    );
  });

  it('own-sequence disables the accession box, and Basic enables it again with its own accession', async () => {
    await choose('own-sequence');
    await rendered('240');
    expect(accessionBox().disabled).toBe(true);
    expect(byId('accession-hint').textContent).toBe(
      'Not used: this config sets sequence:'
    );
    await choose('basic');
    await vi.waitFor(() =>
      expect(preview()?.getAttribute('accession')).toBe(
        getPreset('basic')!.accession
      )
    );
    expect(accessionBox().disabled).toBe(false);
    expect(byId('accession-hint').hidden).toBe(true);
    expect(accessionBox().value).toBe(getPreset('basic')!.accession);
  });

  it('the UniProt preset after a sequence: config re-enables the box and loads P05067', async () => {
    await choose('own-sequence');
    await rendered('240');
    await choose('uniprot-default');
    expect(accessionBox().disabled).toBe(false);
    expect(accessionBox().value).toBe('P05067');
    await rendered('770');
    expect(preview()?.getAttribute('accession')).toBe('P05067');
  });

  it('a new accession, entered in the box, reloads the viewer for it with nothing listed', async () => {
    await settled();
    recorded.length = 0;
    await userEvent.fill(accessionBox(), 'P69905');
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() =>
      expect(preview()?.getAttribute('accession')).toBe('P69905')
    );
    await rendered('770');
    await settled();
    expect(recorded).toContain(
      'https://www.ebi.ac.uk/proteins/api/proteins/P69905'
    );
    expect(recorded.filter((url) => url.includes('P05067'))).toEqual([]);
    expect(listItems().map((li) => li.textContent)).toEqual([]);
  });

  it('an edited config goes into the link with the accession', async () => {
    const edited = `# My edit\n${editorText()}`;
    setEditorText(edited);
    await vi.waitFor(() =>
      expect(decodeState(location.hash)).toEqual({
        config: edited,
        accession: 'P69905',
      })
    );
    expect(byId<HTMLSelectElement>('preset').value).toBe('custom');
  });

  it('ships twelve presets', () => {
    expect(PRESETS.map((p) => p.id)).toHaveLength(12);
  });

  // One test per preset, so adding community views never grows a single test
  // past its timeout.
  it.each([...PRESETS, ...COMMUNITY_PRESETS].map((p) => p.id))(
    '%s renders with nothing listed and no console error',
    async (id) => {
      const errors = vi.spyOn(console, 'error');
      try {
        await choose(id);
        await vi.waitFor(() => expect(preview()).not.toBeNull());
        await settled();
        // Give a late failure time to be listed, then check none was.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(byId('error-summary').textContent, id).toBe(
          'No problems — config is valid.'
        );
        expect(
          listItems().map((li) => li.textContent),
          id
        ).toEqual([]);
        expect(
          preview()!.querySelector(`.${CSS_PREFIX}-error-badge`)
        ).toBeNull();
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    }
  );
});
