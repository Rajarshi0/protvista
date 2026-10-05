/**
 * `build.mjs --check` compares today's provenance with the committed one. The
 * `retrieved` dates come from each response's `Date` header, so they differ
 * on every run and must be ignored; every other field must still be compared.
 * Importing `build.mjs` runs nothing: its `main` only runs as a script.
 */
import { describe, it, expect } from 'vitest';
import { firstDifference } from './build.mjs';

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

  it('reports a field that appeared or disappeared', () => {
    const today = structuredClone(committed);
    delete today.outputs['conservation.csv'];
    expect(firstDifference(committed, today)).toMatch(
      /^outputs\.conservation\.csv: "111" → undefined/
    );
  });
});
