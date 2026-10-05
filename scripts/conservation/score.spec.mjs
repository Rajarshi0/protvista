/**
 * Tests for the conservation scoring in `score.mjs`.
 *
 * Everything here is offline. The scoring runs on the committed Pfam PF00301
 * seed alignment (`__fixtures__/PF00301.seed.sto`, 21 sequences) and on small
 * hand-made columns. It imports `score.mjs` only, never `src/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AMINO_ACIDS,
  BLOSUM62_BACKGROUND,
  GAP,
  columnDistribution,
  columnsOf,
  conservationCsv,
  henikoffWeights,
  isContiguous,
  mapRowToResidues,
  matchColumns,
  normaliseSymbol,
  parseStockholm,
  ranks,
  readPointCsv,
  scoreColumns,
  scoreResidues,
  sitesCsv,
  topDecileRuns,
} from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const read = (path) => readFileSync(resolve(REPO_ROOT, path), 'utf8');

const SEED = read('scripts/conservation/__fixtures__/PF00301.seed.sto');

/** UniProt P24297's Fe-binding cysteines (Binding site, release 2026_03). */
const FE_CYSTEINES = [6, 9, 39, 42];

/** The positions of the `n` highest-scoring points. */
const topPositions = (points, n) =>
  [...points]
    .sort((a, b) => b.value - a.value)
    .slice(0, n)
    .map((p) => p.position)
    .sort((a, b) => a - b);

/** A column of `n` copies of one symbol. */
const invariant = (symbol, n = 10) => new Array(n).fill(symbol);
const ones = (n) => new Array(n).fill(1);

/** Score the seed alignment and map it onto RUBR_PYRFU (P24297). */
function scoreSeed() {
  const { rows } = parseStockholm(SEED);
  const isMatch = matchColumns(rows);
  const columns = columnsOf(rows, isMatch);
  const scores = scoreColumns(columns, henikoffWeights(columns));
  const target = rows.find((row) => row.accession === 'P24297');
  return scoreResidues(target, isMatch, scores);
}

describe('parseStockholm (S1)', () => {
  it('reads every row of the seed with its /start-end and accession', () => {
    const { rows, annotations } = parseStockholm(SEED);
    expect(rows).toHaveLength(21);
    expect(annotations.AC).toBe('PF00301.26');
    for (const row of rows) {
      // Counted here, independently of the parser's own check.
      const residues = row.aligned.match(/[A-Za-z]/g).length;
      expect(residues, row.name).toBe(row.end - row.start + 1);
    }
    const target = rows.find((row) => row.name === 'RUBR_PYRFU/3-49');
    expect(target).toMatchObject({ accession: 'P24297', start: 3, end: 49 });
  });

  // The seed uses `.` for every gap and has a residue in every column, so all
  // 52 columns are match columns. Measured when the fixture was committed.
  it('finds the seed has 52 match columns', () => {
    expect(
      matchColumns(parseStockholm(SEED).rows).filter(Boolean)
    ).toHaveLength(52);
  });

  it('refuses a row whose residues disagree with its /start-end', () => {
    const text = '# STOCKHOLM 1.0\nA/1-4  AC.D\nB/1-3  AC.D\n//\n';
    expect(() => parseStockholm(text)).toThrow(/A\/1-4 has 3 residues/);
  });

  it('refuses ragged rows and text that is not Stockholm', () => {
    expect(() =>
      parseStockholm('# STOCKHOLM 1.0\nA/1-2  AC\nB/1-3  ACD\n//\n')
    ).toThrow(/columns wide/);
    expect(() => parseStockholm('>A\nACD\n')).toThrow(/not a Stockholm/);
  });

  it('joins interleaved blocks', () => {
    const text =
      '# STOCKHOLM 1.0\nA/1-4  AC\nB/2-4  -C\n\nA/1-4  DE\nB/2-4  DE\n//\n';
    expect(parseStockholm(text).rows.map((row) => row.aligned)).toEqual([
      'ACDE',
      '-CDE',
    ]);
  });
});

// A miniature hmmalign-style alignment: column 2 is an insert column (lower
// case or `.`), the rest are match columns (upper case or `-`). Row B has an
// insert residue, `w`, which takes a residue number but no match column.
const MINI = [
  '# STOCKHOLM 1.0',
  '#=GS A/10-13 AC P11111.1',
  '#=GS B/5-8   AC P22222.3',
  'A/10-13  AC.DE',
  'B/5-8    -CwDE',
  '//',
  '',
].join('\n');

describe('match columns and residue mapping (S1)', () => {
  it('keeps match states and drops insert columns', () => {
    const { rows } = parseStockholm(MINI);
    expect(matchColumns(rows)).toEqual([true, true, false, true, true]);
    expect(rows.map((row) => row.accession)).toEqual(['P11111', 'P22222']);
  });

  it('numbers residues from /start, counting inserts, and skips gaps', () => {
    const { rows } = parseStockholm(MINI);
    const isMatch = matchColumns(rows);
    expect(mapRowToResidues(rows[0], isMatch)).toEqual([
      { position: 10, column: 0 },
      { position: 11, column: 1 },
      { position: 12, column: 2 },
      { position: 13, column: 3 },
    ]);
    // C is residue 5 in match column 1; w (6) is an insert; D is 7, E is 8.
    expect(mapRowToResidues(rows[1], isMatch)).toEqual([
      { position: 5, column: 1 },
      { position: 7, column: 2 },
      { position: 8, column: 3 },
    ]);
  });

  it('puts each match column of each row into the scoring alphabet', () => {
    const { rows } = parseStockholm(MINI);
    expect(columnsOf(rows, matchColumns(rows))).toEqual([
      ['A', GAP],
      ['C', 'C'],
      ['D', 'D'],
      ['E', 'E'],
    ]);
  });

  it('reads B and Z as D and Q, and X, other letters and . as gaps', () => {
    expect(['B', 'z', 'X', 'U', '.', '-', 'w'].map(normaliseSymbol)).toEqual([
      'D',
      'Q',
      GAP,
      GAP,
      GAP,
      GAP,
      'W',
    ]);
  });
});

describe('henikoffWeights (S2)', () => {
  it('gives each of two identical rows half the weight of a row unlike them', () => {
    // Row 2 differs from rows 0 and 1 at every column.
    const columns = [
      ['A', 'A', 'C'],
      ['D', 'D', 'E'],
      ['G', 'G', 'H'],
    ];
    const [a, b, c] = henikoffWeights(columns);
    expect(a).toBe(b);
    expect(a).toBeCloseTo(c / 2, 12);
  });

  it('ignores gaps: they gain no weight and are not a residue type', () => {
    // One type (A) seen twice: each A gains 1 / (1 × 2). Counting the gap as
    // a second type would give 1/4, 1/4 and 1/2.
    expect(henikoffWeights([['A', 'A', GAP]])).toEqual([0.5, 0.5, 0]);
  });
});

describe('the BLOSUM62 background (S3)', () => {
  // Capra JA, Singh M. Bioinformatics 2007;23(15):1875–1882.
  // distributions/blosum62.distribution in conservation_code.tar.gz from
  // https://compbio.cs.princeton.edu/conservation/ (sha256
  // ee2565eb93a1e8865fdfab544b70c0b2b6199c86f81b737e17ef0f16bf2fe26c).
  it('is the published distribution, value for value, in ARND… order', () => {
    expect(AMINO_ACIDS).toBe('ARNDCQEGHILKMFPSTWYV');
    expect([...BLOSUM62_BACKGROUND]).toEqual([
      0.078, 0.051, 0.041, 0.052, 0.024, 0.034, 0.059, 0.083, 0.025, 0.062,
      0.092, 0.056, 0.024, 0.044, 0.043, 0.059, 0.055, 0.014, 0.034, 0.072,
    ]);
  });

  it('keeps the published sum of 1.002 rather than renormalising', () => {
    const sum = BLOSUM62_BACKGROUND.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.002, 9);
  });

  it('is the background the score uses', () => {
    // For an invariant column, p is (almost exactly) 1 at C, so
    // JSD = ½[log2(2 / (1 + q_C)) + q_C·log2(2q_C / (1 + q_C)) + (Σq − q_C)],
    // with q_C = 0.024 and Σq = 1.002. The pseudocount moves it by ~2e-6.
    const expected =
      0.5 *
      (Math.log2(2 / 1.024) +
        0.024 * Math.log2(0.048 / 1.024) +
        (1.002 - 0.024));
    const [score] = scoreColumns([invariant('C')], ones(10));
    expect(score).toBeCloseTo(expected, 5);
  });
});

describe('scoreColumns (S3)', () => {
  it('scores an invariant rare residue (C) above an invariant common one (L)', () => {
    const [c, l] = scoreColumns([invariant('C'), invariant('L')], ones(10));
    // By a real margin (0.919 vs 0.773): under a uniform background the two
    // would differ only by rounding.
    expect(c - l).toBeGreaterThan(0.1);
  });

  it('scales a column with 20% gaps by 0.8', () => {
    const gapped = [...invariant('C', 8), GAP, GAP];
    const [withGaps, without] = scoreColumns(
      [gapped, invariant('C')],
      ones(10)
    );
    expect(withGaps).toBeCloseTo(0.8 * without, 3);
  });

  it('scores a column with 30% gaps but not one with more', () => {
    const thirty = [...invariant('C', 7), GAP, GAP, GAP]; // 3 of 10
    const over = [...invariant('C', 9), GAP, GAP, GAP, GAP]; // 4 of 13, 31%
    expect(scoreColumns([thirty], ones(10))[0]).not.toBeNull();
    expect(scoreColumns([over], ones(13))[0]).toBeNull();
  });

  it('weights the gap penalty, but not the gap cutoff', () => {
    // One C row of weight 3 and one gap row of weight 1: half the rows are
    // gaps, but only a quarter of the weight.
    const { gapFraction, weightedGapFraction } = columnDistribution(
      ['C', GAP],
      [3, 1]
    );
    expect(gapFraction).toBe(0.5);
    expect(weightedGapFraction).toBe(0.25);
  });

  it('weights the residue distribution by sequence', () => {
    const { p } = columnDistribution(['C', 'L'], [3, 1]);
    expect(p[AMINO_ACIDS.indexOf('C')]).toBeCloseTo(0.75, 6);
    expect(p[AMINO_ACIDS.indexOf('L')]).toBeCloseTo(0.25, 6);
  });
});

describe('the seed alignment, end to end (S4)', () => {
  it("ranks RUBR_PYRFU's four Fe-binding cysteines highest", () => {
    const points = scoreSeed();
    expect(points[0].position).toBe(3);
    expect(points.at(-1).position).toBe(49);
    expect(topPositions(points, 4)).toEqual(FE_CYSTEINES);
    // The four are tied (each column is invariant C), so check the gap to
    // the fifth, Y13, too.
    const sorted = points.map((p) => p.value).sort((a, b) => b - a);
    expect(sorted[4]).toBeLessThan(sorted[3] - 0.01);
  });
});

describe('topDecileRuns, ranks and the CSV helpers', () => {
  const points = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.95, 0.9, 0.05].map(
    (value, i) => ({ position: i + 1, value })
  );

  it('keeps scores at or above the value at index floor(0.9 × (n − 1)), merged into runs', () => {
    // n = 11: index 9 of the ascending scores is 0.9, so 9 (0.95) and 10
    // (0.9) qualify, and as neighbours they form one run.
    expect(topDecileRuns(points)).toEqual([{ start: 9, end: 10, score: 0.95 }]);
  });

  it('ranks the highest 1 and gives tied scores the same rank', () => {
    const rank = ranks([
      { position: 1, value: 0.5 },
      { position: 2, value: 0.9 },
      { position: 3, value: 0.9 },
      { position: 4, value: 0.1 },
    ]);
    expect([...rank.values()]).toEqual([3, 1, 1, 4]);
  });

  it('tells an unbroken run from one with a hole', () => {
    expect(isContiguous([4, 5, 6].map((position) => ({ position })))).toBe(
      true
    );
    expect(isContiguous([4, 5, 7].map((position) => ({ position })))).toBe(
      false
    );
  });

  it('round-trips the line CSV to 3 dp and rejects anything else', () => {
    const text = conservationCsv([{ position: 4, value: 0.60649 }]);
    expect(text).toBe('position,value\n4,0.606\n');
    expect(readPointCsv(text)).toEqual([{ position: 4, value: 0.606 }]);
    expect(() => readPointCsv('pos,value\n4,0.6\n')).toThrow(/header/);
    expect(() => readPointCsv('position,value\n4.5,0.6\n')).toThrow(/row 2/);
    expect(() => readPointCsv('position,value\n4,\n')).toThrow(/row 2/);
  });

  it('refuses a site description that would break the CSV', () => {
    expect(() => sitesCsv([], 'a, b')).toThrow(/must not contain/);
  });
});

describe('score.mjs stays pure (S6)', () => {
  it('neither fetches nor imports a Node built-in', () => {
    const source = read('scripts/conservation/score.mjs');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from\s+['"]node:|import\(\s*['"]node:/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
