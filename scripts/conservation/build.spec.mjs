/**
 * `build.mjs --check` compares today's provenance with the committed one. The
 * `retrieved` dates come from each response's `Date` header, so they differ
 * on every run and must be ignored; every other field must still be compared.
 * `build.mjs` must also refuse, rather than write, data it cannot map onto
 * the target. Importing `build.mjs` runs nothing: its `main` only runs as a
 * script.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstDifference, scoreTarget } from './build.mjs';

const SEED = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '__fixtures__/PF00301.seed.sto'
  ),
  'utf8'
);

/** UniProt P24297 (54 residues); its sha256 is in provenance.json. */
const P24297 = 'MAKWVCKICGYIYDEDAGDPDNGISPGTKFEELPDDWVCPICGAPKSEFEKLED';
const IDS = { pfam: 'PF00301', target: 'P24297' };

describe('firstDifference (build.mjs --check)', () => {
  const committed = {
    target: {
      retrieved: '2026-10-05T07:21:05.000Z',
      uniprotRelease: '2026_03',
    },
    alignment: { retrieved: '2026-10-05T07:21:05.000Z', sha256: 'aaa' },
    outputs: { 'conservation.csv': '111' },
  };

  it('ignores the retrieved dates at any depth', () => {
    const today = structuredClone(committed);
    today.target.retrieved = '2026-11-01T00:00:00.000Z';
    today.alignment.retrieved = '2026-11-01T00:00:00.000Z';
    expect(firstDifference(committed, today)).toBeNull();
  });

  it('names the path of any other difference', () => {
    const today = structuredClone(committed);
    today.target.retrieved = '2026-11-01T00:00:00.000Z';
    today.alignment.sha256 = 'bbb';
    expect(firstDifference(committed, today)).toBe(
      'alignment.sha256: "aaa" → "bbb"'
    );
  });

  it('reports a field that disappeared', () => {
    const today = structuredClone(committed);
    delete today.outputs['conservation.csv'];
    expect(firstDifference(committed, today)).toMatch(
      /^outputs\.conservation\.csv: "111" → undefined/
    );
  });

  it('reports a field that appeared', () => {
    const today = structuredClone(committed);
    today.outputs['extra.csv'] = '222';
    expect(firstDifference(committed, today)).toBe(
      'outputs.extra.csv: undefined → "222"'
    );
  });
});

describe('scoreTarget (build.mjs)', () => {
  it('maps the scores onto the target row, residues 3–49 of the seed', () => {
    const { row, points } = scoreTarget(SEED, P24297, IDS);
    expect(row.name).toBe('RUBR_PYRFU/3-49');
    expect(points.map((p) => p.position)).toEqual(
      Array.from({ length: 47 }, (_, i) => i + 3)
    );
  });

  it('refuses a target that is not exactly one row', () => {
    expect(() =>
      scoreTarget(SEED, P24297, { ...IDS, target: 'P99999' })
    ).toThrow("P99999 is 0 rows of PF00301's full alignment, not 1");
    const twice = SEED.replace(
      '#=GS RUBR_ACESD/3-49        AC P23474.1',
      '#=GS RUBR_ACESD/3-49        AC P24297.1'
    );
    expect(() => scoreTarget(twice, P24297, IDS)).toThrow(
      "P24297 is 2 rows of PF00301's full alignment, not 1"
    );
  });

  it('refuses a row whose residues differ from the UniProt sequence', () => {
    // C6 → S: one residue inside the row's 3–49.
    const mutant = `${P24297.slice(0, 5)}S${P24297.slice(6)}`;
    expect(() => scoreTarget(SEED, mutant, IDS)).toThrow(
      'RUBR_PYRFU/3-49 differs from UniProt P24297 3-49'
    );
  });

  it('refuses scored residues with a hole, or none', () => {
    // T's middle column is 50% gaps (over the 30% cutoff), so residue 2 has
    // no score between 1 and 3.
    const holed = [
      '# STOCKHOLM 1.0',
      '#=GS T/1-3 AC P00001.1',
      'T/1-3  ACD',
      'U/1-2  A-D',
      'V/1-3  ACD',
      'W/1-2  A-D',
      '//',
      '',
    ].join('\n');
    expect(() =>
      scoreTarget(holed, 'ACD', { pfam: 'PF0', target: 'P00001' })
    ).toThrow("P00001's scored residues are not one unbroken run");
    // T's one residue sits in a column of 75% gaps: nothing is scored.
    const empty = [
      '# STOCKHOLM 1.0',
      '#=GS T/1-1 AC P00001.1',
      'T/1-1  A-',
      'U/1-1  -C',
      'V/1-1  -C',
      'W/1-1  -C',
      '//',
      '',
    ].join('\n');
    expect(() =>
      scoreTarget(empty, 'A', { pfam: 'PF0', target: 'P00001' })
    ).toThrow("P00001's scored residues are not one unbroken run");
  });
});
