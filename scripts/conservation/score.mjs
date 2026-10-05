/**
 * Per-residue conservation from a Pfam Stockholm alignment: pure functions, no
 * I/O. `build.mjs` fetches the inputs and writes the files; everything that
 * decides a number lives here, so the unit tests can run it offline on the
 * committed seed alignment.
 *
 * The score is the Jensen–Shannon divergence of a column's amino-acid
 * distribution from the BLOSUM62 background, with Henikoff position-based
 * sequence weights and a gap penalty, and no window smoothing:
 *
 *   Capra JA, Singh M. Predicting functionally important residues from
 *   sequence conservation. Bioinformatics 2007;23(15):1875–1882.
 *   doi:10.1093/bioinformatics/btm270
 *
 * It follows the method of that paper's reference program
 * (score_conservation.py) where the paper leaves a detail open: gaps are
 * ignored when weighting sequences, the gap symbol is dropped from the column
 * distribution before comparing it with the 20-letter background, the
 * pseudocount is 1e-7, B and Z count as D and Q, and X counts as a gap. This
 * file is an independent implementation; none of that (GPL) code is copied.
 */

/** The 20 amino acids, in the order of {@link BLOSUM62_BACKGROUND}. */
export const AMINO_ACIDS = 'ARNDCQEGHILKMFPSTWYV';

/** The gap symbol after {@link normaliseSymbol}. */
export const GAP = '-';

/**
 * The BLOSUM62 background distribution, in the order of {@link AMINO_ACIDS},
 * exactly as published with Capra & Singh 2007:
 * `distributions/blosum62.distribution` in `conservation_code.tar.gz`
 * (https://compbio.cs.princeton.edu/conservation/, sha256
 * ee2565eb93a1e8865fdfab544b70c0b2b6199c86f81b737e17ef0f16bf2fe26c).
 *
 * The published values sum to 1.002 (rounding to 3 dp). They are used as
 * published, not renormalised: the reference program accepts a background
 * summing to anywhere in [0.997, 1.003] and uses it unchanged, so these
 * numbers reproduce its scores.
 */
export const BLOSUM62_BACKGROUND = Object.freeze([
  0.078, 0.051, 0.041, 0.052, 0.024, 0.034, 0.059, 0.083, 0.025, 0.062, 0.092,
  0.056, 0.024, 0.044, 0.043, 0.059, 0.055, 0.014, 0.034, 0.072,
]);

/** Added to every symbol's weighted count, as in the reference program. */
export const PSEUDOCOUNT = 1e-7;

/** Columns with more than this fraction of gaps (unweighted) are not scored. */
export const GAP_CUTOFF = 0.3;

/**
 * @typedef {object} AlignmentRow
 * @property {string} name      Row name, `ID/start-end`.
 * @property {string} accession `#=GS … AC` without its version, or `''`.
 * @property {number} start     First residue number of the aligned segment.
 * @property {number} end       Last residue number of the aligned segment.
 * @property {string} aligned   The aligned text, inserts and gaps included.
 */

/**
 * @typedef {object} Point
 * @property {number} position 1-based residue number in the target.
 * @property {number} value    The conservation score.
 */

/**
 * @typedef {object} Run
 * @property {number} start First residue of a run of adjacent residues.
 * @property {number} end   Last residue of the run.
 * @property {number} score The highest score in the run.
 */

const RESIDUE = /[A-Za-z]/;
const ROW_NAME = /^(.+)\/(\d+)-(\d+)$/;

/**
 * Parse a Stockholm alignment (single or interleaved blocks).
 *
 * Throws when the text is not Stockholm, when rows differ in length, when a
 * row name has no `/start-end`, or when a row's residue count disagrees with
 * its `/start-end`.
 *
 * @param {string} text
 * @returns {{ rows: AlignmentRow[], annotations: Record<string, string> }}
 */
export function parseStockholm(text) {
  if (!text.startsWith('# STOCKHOLM')) {
    throw new Error('not a Stockholm alignment (no "# STOCKHOLM" header)');
  }
  /** @type {Map<string, string>} */
  const aligned = new Map();
  /** @type {Map<string, string>} */
  const accessions = new Map();
  /** @type {Record<string, string>} */
  const annotations = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('//')) break;
    if (line.startsWith('#=GF ')) {
      const [, key, ...value] = line.split(/\s+/);
      const joined = value.join(' ');
      annotations[key] =
        key in annotations ? `${annotations[key]} ${joined}` : joined;
      continue;
    }
    if (line.startsWith('#=GS ')) {
      const [, name, key, value] = line.split(/\s+/);
      if (key === 'AC') accessions.set(name, value.replace(/\.\d+$/, ''));
      continue;
    }
    if (line.startsWith('#') || !line.trim()) continue;
    const [name, segment] = line.trim().split(/\s+/);
    aligned.set(name, (aligned.get(name) ?? '') + segment);
  }
  if (aligned.size === 0) throw new Error('the alignment has no rows');
  const rows = [...aligned].map(([name, text]) => {
    const match = ROW_NAME.exec(name);
    if (!match) throw new Error(`row ${name} has no /start-end`);
    return {
      name,
      accession: accessions.get(name) ?? '',
      start: Number(match[2]),
      end: Number(match[3]),
      aligned: text,
    };
  });
  const width = rows[0].aligned.length;
  for (const row of rows) {
    if (row.aligned.length !== width) {
      throw new Error(
        `row ${row.name} is ${row.aligned.length} columns wide, not ${width}`
      );
    }
    const residues = row.aligned.replace(/[.-]/g, '').length;
    if (residues !== row.end - row.start + 1) {
      throw new Error(
        `row ${row.name} has ${residues} residues, but /${row.start}-${row.end} says ${row.end - row.start + 1}`
      );
    }
  }
  return { rows, annotations };
}

/**
 * Which alignment columns are match (consensus) columns.
 *
 * Pfam full alignments are hmmalign output: a match state is an upper-case
 * residue or `-`, an insert is a lower-case residue or `.`. A column is a
 * match column when any row has a match state in it. In a seed alignment,
 * which is upper case with `.` for every gap, that is every column holding a
 * residue.
 *
 * @param {AlignmentRow[]} rows
 * @returns {boolean[]}
 */
export function matchColumns(rows) {
  const width = rows[0].aligned.length;
  /** @type {boolean[]} */
  const isMatch = [];
  for (let c = 0; c < width; c += 1) {
    isMatch.push(rows.some((row) => /[A-Z-]/.test(row.aligned[c])));
  }
  return isMatch;
}

/**
 * The scoring alphabet: one of {@link AMINO_ACIDS}, or {@link GAP}. B and Z
 * count as D and Q; X and any other letter (U, O) count as a gap, as in the
 * reference program.
 *
 * @param {string} ch
 * @returns {string}
 */
export function normaliseSymbol(ch) {
  const upper = ch.toUpperCase();
  if (upper === 'B') return 'D';
  if (upper === 'Z') return 'Q';
  return AMINO_ACIDS.includes(upper) ? upper : GAP;
}

/**
 * The match columns of an alignment, column-major: `columns[c][r]` is row
 * `r`'s symbol in match column `c`, normalised by {@link normaliseSymbol}.
 *
 * @param {AlignmentRow[]} rows
 * @param {boolean[]} isMatch
 * @returns {string[][]}
 */
export function columnsOf(rows, isMatch) {
  /** @type {string[][]} */
  const columns = [];
  isMatch.forEach((match, c) => {
    if (match) columns.push(rows.map((row) => normaliseSymbol(row.aligned[c])));
  });
  return columns;
}

/**
 * Henikoff & Henikoff (1994) position-based sequence weights. In each column,
 * a row holding a residue type seen `n` times among `k` types gains
 * `1 / (k × n)`; gaps gain nothing and are not a type. The sum is divided by
 * the number of columns. A row of gaps only has weight 0.
 *
 *   Henikoff S, Henikoff JG. Position-based sequence weights.
 *   J Mol Biol 1994;243:574–578.
 *
 * @param {string[][]} columns
 * @returns {number[]}
 */
export function henikoffWeights(columns) {
  const rowCount = columns[0].length;
  const weights = new Array(rowCount).fill(0);
  for (const column of columns) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const symbol of column) {
      if (symbol !== GAP) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    column.forEach((symbol, r) => {
      if (symbol !== GAP) weights[r] += 1 / (counts.size * counts.get(symbol));
    });
  }
  return weights.map((weight) => weight / columns.length);
}

/**
 * A column's weighted amino-acid distribution and its gap fractions.
 *
 * Each of the 20 amino acids and the gap gets `PSEUDOCOUNT` plus the weights
 * of the rows holding it. The gap is then dropped and the 20 counts are
 * normalised to sum to 1, because the background has no gap.
 *
 * @param {string[]} column
 * @param {number[]} weights
 * @returns {{ p: number[], gapFraction: number, weightedGapFraction: number }}
 */
export function columnDistribution(column, weights) {
  const counts = new Array(AMINO_ACIDS.length).fill(PSEUDOCOUNT);
  let total = 0;
  let gapWeight = 0;
  let gaps = 0;
  column.forEach((symbol, r) => {
    total += weights[r];
    if (symbol === GAP) {
      gapWeight += weights[r];
      gaps += 1;
    } else {
      counts[AMINO_ACIDS.indexOf(symbol)] += weights[r];
    }
  });
  if (!(total > 0)) throw new Error('a column has no weighted sequences');
  const sum = counts.reduce((a, b) => a + b, 0);
  return {
    p: counts.map((count) => count / sum),
    gapFraction: gaps / column.length,
    weightedGapFraction: gapWeight / total,
  };
}

/**
 * Jensen–Shannon divergence (base 2) between two distributions.
 *
 * @param {readonly number[]} p
 * @param {readonly number[]} q
 * @returns {number}
 */
export function jsd(p, q) {
  let d = 0;
  for (let k = 0; k < p.length; k += 1) {
    const m = (p[k] + q[k]) / 2;
    if (m === 0) continue;
    if (p[k] > 0) d += p[k] * Math.log2(p[k] / m);
    if (q[k] > 0) d += q[k] * Math.log2(q[k] / m);
  }
  return d / 2;
}

/**
 * Score every match column: `jsd(p, background) × (1 − weighted gap
 * fraction)`, or `null` when more than `gapCutoff` of the column (unweighted)
 * is gaps.
 *
 * @param {string[][]} columns
 * @param {number[]} weights
 * @param {{ background?: readonly number[], gapCutoff?: number }} [options]
 * @returns {(number | null)[]}
 */
export function scoreColumns(columns, weights, options = {}) {
  const background = options.background ?? BLOSUM62_BACKGROUND;
  const gapCutoff = options.gapCutoff ?? GAP_CUTOFF;
  return columns.map((column) => {
    const { p, gapFraction, weightedGapFraction } = columnDistribution(
      column,
      weights
    );
    if (gapFraction > gapCutoff) return null;
    return jsd(p, background) * (1 - weightedGapFraction);
  });
}

/**
 * Where a row's residues sit: for each residue in a match column, its residue
 * number (counted from the row's `/start`, inserts included) and the index of
 * its match column.
 *
 * @param {AlignmentRow} row
 * @param {boolean[]} isMatch
 * @returns {{ position: number, column: number }[]}
 */
export function mapRowToResidues(row, isMatch) {
  /** @type {{ position: number, column: number }[]} */
  const mapped = [];
  let position = row.start;
  let column = 0;
  for (let c = 0; c < row.aligned.length; c += 1) {
    const residue = RESIDUE.test(row.aligned[c]);
    if (isMatch[c]) {
      if (residue) mapped.push({ position, column });
      column += 1;
    }
    if (residue) position += 1;
  }
  return mapped;
}

/**
 * The scored residues of a row, in residue order.
 *
 * @param {AlignmentRow} row
 * @param {boolean[]} isMatch
 * @param {(number | null)[]} scores One per match column.
 * @returns {Point[]}
 */
export function scoreResidues(row, isMatch, scores) {
  return mapRowToResidues(row, isMatch)
    .filter(({ column }) => scores[column] !== null)
    .map(({ position, column }) => ({
      position,
      value: /** @type {number} */ (scores[column]),
    }));
}

/**
 * Whether the points cover one unbroken run of residues. The line graph joins
 * its points, so a missing residue inside the run would be drawn as if it had
 * an interpolated score.
 *
 * @param {Point[]} points
 * @returns {boolean}
 */
export function isContiguous(points) {
  return points.every(
    (point, i) => i === 0 || point.position === points[i - 1].position + 1
  );
}

/**
 * The most conserved residues: those scoring at least the value at ascending
 * index `floor(0.9 × (n − 1))` among the `n` scored residues (the 90th
 * percentile), with adjacent residues merged into runs. With distinct scores
 * that keeps `n − floor(0.9 × (n − 1))` residues, which is more than 10% by
 * construction (6 of 46, with no tie); a tie at the threshold adds more.
 *
 * @param {Point[]} points In residue order.
 * @returns {Run[]}
 */
export function topDecileRuns(points) {
  if (points.length === 0) return [];
  const sorted = points.map((point) => point.value).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(0.9 * (sorted.length - 1))];
  /** @type {Run[]} */
  const runs = [];
  for (const { position, value } of points) {
    if (value < threshold) continue;
    const last = runs.at(-1);
    if (last && last.end === position - 1) {
      last.end = position;
      last.score = Math.max(last.score, value);
    } else {
      runs.push({ start: position, end: position, score: value });
    }
  }
  return runs;
}

/**
 * Each position's rank by score, 1 for the highest. Tied scores share the
 * best rank (1, 2, 2, 4).
 *
 * @param {Point[]} points
 * @returns {Map<number, number>}
 */
export function ranks(points) {
  return new Map(
    points.map(({ position, value }) => [
      position,
      1 + points.filter((other) => other.value > value).length,
    ])
  );
}

/**
 * The line-graph CSV: `position,value`, scores to 3 decimal places.
 *
 * @param {Point[]} points
 * @returns {string}
 */
export function conservationCsv(points) {
  const lines = points.map(
    ({ position, value }) => `${position},${value.toFixed(3)}`
  );
  return ['position,value', ...lines].join('\n') + '\n';
}

/**
 * The description of every row of the conserved-sites CSV. It names the 90th
 * percentile and no share of residues, because the rule in
 * {@link topDecileRuns} keeps more than 10% of them.
 *
 * @param {string} pfam
 * @returns {string}
 */
export function conservedSitesDescription(pfam) {
  return `At or above the 90th percentile of the scored residues in Pfam ${pfam}`;
}

/**
 * The features CSV of the most conserved residues: one `SITE` per run, with
 * the run's best score in a `score` column.
 *
 * @param {Run[]} runs
 * @param {string} description Shared by every row; no commas or quotes.
 * @returns {string}
 */
export function sitesCsv(runs, description) {
  if (/[",\n]/.test(description)) {
    throw new Error('the site description must not contain , " or a newline');
  }
  const lines = runs.map(
    ({ start, end, score }) =>
      `SITE,${start},${end},${description},${score.toFixed(3)}`
  );
  return ['type,start,end,description,score', ...lines].join('\n') + '\n';
}

/**
 * Read a `position,value` CSV back into points. Strict: the header must be
 * exactly `position,value` and every row an integer position and a finite
 * number.
 *
 * @param {string} text
 * @returns {Point[]}
 */
export function readPointCsv(text) {
  const [header, ...lines] = text.trimEnd().split(/\r?\n/);
  if (header !== 'position,value') {
    throw new Error(`expected the header "position,value", got "${header}"`);
  }
  return lines.map((line, i) => {
    const fields = line.split(',');
    const position = Number(fields[0]);
    const value = Number(fields[1]);
    if (
      fields.length !== 2 ||
      !Number.isInteger(position) ||
      fields[1].trim() === '' ||
      !Number.isFinite(value)
    ) {
      throw new Error(`row ${i + 2} is not "position,value": ${line}`);
    }
    return { position, value };
  });
}
