/**
 * Sequence-only mode: the `sequence:` config field.
 *
 * A config sets `sequence:` instead of `accession:` to show a protein that
 * isn't in UniProt — a predicted protein, a construct, a patient variant. The
 * value takes one of three forms:
 *
 *   - raw residues, inline (`MKTAYIAKQR…`, wrapped over lines or not);
 *   - inline FASTA text (a YAML `|` block starting with `>header`);
 *   - a path or URL to a one-record FASTA file (`./protein.fasta`).
 *
 * Everything here is pure: no DOM, no fetch, no `console`. The validator
 * parses inline values synchronously (so editors and CI catch bad residues
 * without fetching), and the loader fetches and parses a reference after the
 * config validates. Failures come back as results; only `load.ts` turns them
 * into thrown `ConfigValidationError` issues, which the element reports
 * through its one routed config report.
 *
 * The element imports the label helpers (`sequenceDisplayLabel`,
 * `escapeMarkdocInline`) from here, so this module is on its import graph;
 * it imports nothing that renders, which keeps the validator and the editor
 * tooling free to use it too. No spec enforces that: keep it so by hand.
 */

/** A `sequence:` value, resolved to residues. */
export interface ResolvedSequence {
  /** Uppercased one-letter residues, whitespace and a trailing `*` removed. */
  residues: string;
  /**
   * The FASTA header, without its `>` and trimmed. Absent for raw residues
   * and for an empty header (`>` alone).
   */
  header?: string;
}

/**
 * What the viewer calls a sequence with no FASTA header, wherever it would
 * otherwise show an accession.
 */
export const DEFAULT_SEQUENCE_LABEL = 'your sequence';

/** Longest header shown as-is; a longer one is cut and given an ellipsis. */
const MAX_LABEL_LENGTH = 80;

/** Extensions that make a bare value (`protein.fasta`) a file reference. */
export const FASTA_EXTENSIONS = ['.fasta', '.fa', '.faa', '.fas'] as const;

/**
 * Built-in adapters that read a provider's data for a UniProt entry, keyed to
 * the provider's name for the `needs-accession` message.
 *
 * These are the only built-ins with no record shape to fall back on — they
 * take one or more provider responses, and fetch further provider data of
 * their own — so a track that uses one cannot work from a `sequence:`. The
 * map is static on purpose: a consumer-registered adapter is never listed,
 * because the viewer can't know what it needs. A drift guard in
 * `validate.spec.ts` checks every built-in shapeless kind's adapter, and every
 * built-in adapter that calls `fetch`, is here.
 */
export const UNIPROT_KEYED_ADAPTERS: Readonly<Record<string, string>> = {
  'alphafold-prediction-json': 'AlphaFold DB',
  'alphamissense-average-csv': 'AlphaMissense',
  'alphamissense-full-csv': 'AlphaMissense',
};

/**
 * The provider a built-in UniProt-keyed adapter reads, or `undefined` for any
 * other adapter name. An own-property lookup, so an author-supplied name such
 * as `constructor` or `toString` doesn't match `Object.prototype`.
 */
export function uniprotKeyedProvider(adapter: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(UNIPROT_KEYED_ADAPTERS, adapter)
    ? UNIPROT_KEYED_ADAPTERS[adapter]
    : undefined;
}

/**
 * Whether a `sequence:` value names a file to fetch rather than carrying the
 * sequence inline.
 *
 * A reference is a single line that doesn't start with `>` and either starts
 * like a URL or path (`http(s)://`, `/`, `./`, `../` — the prefixes `extends:`
 * accepts) or ends in a FASTA extension (ignoring any `?query` or `#hash`).
 * Everything else is inline: FASTA when it starts with `>`, raw residues
 * otherwise.
 */
export function isSequenceReference(value: string): boolean {
  const v = value.trim();
  if (v === '' || v.startsWith('>') || /[\r\n]/.test(v)) return false;
  if (
    /^https?:\/\//i.test(v) ||
    v.startsWith('/') ||
    v.startsWith('./') ||
    v.startsWith('../')
  ) {
    return true;
  }
  const path = v.replace(/[?#].*$/, '').toLowerCase();
  return FASTA_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * How a message names the sequence it rejected, mirroring the data pipeline's
 * `sourceLabel` (`./x.csv (parsed as CSV)`): `./protein.fasta (parsed as
 * FASTA)`, `inline sequence (parsed as FASTA)`, or plain `inline sequence` for
 * raw residues.
 */
export function sequenceLabel(
  origin: string | undefined,
  fasta: boolean
): string {
  const subject = origin ?? 'inline sequence';
  return fasta ? `${subject} (parsed as FASTA)` : subject;
}

export type SequenceParseResult =
  | { ok: true; value: ResolvedSequence; message?: undefined }
  | { ok: false; message: string; value?: undefined };

/**
 * Parse a `sequence:` value — or a fetched FASTA file's text — into residues.
 *
 * `origin` is the path the text was fetched from, or `undefined` for an
 * inline value; it only changes how messages name the input, plus two hints
 * that only make sense inline.
 *
 * Rules: a leading BOM is stripped and CRLF accepted; FASTA has exactly one
 * record, whose header is the first line minus `>`, trimmed; body lines are
 * joined with all whitespace removed; one trailing `*` (a stop) is dropped;
 * letters are uppercased; the alphabet is `A`–`Z` (every IUPAC protein
 * letter, including B, J, O, U, X and Z). The first character outside it is
 * reported with its 1-based residue position.
 */
export function parseSequenceText(
  text: string,
  origin: string | undefined
): SequenceParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const first = lines.findIndex((line) => line.trim() !== '');
  const fasta = first !== -1 && lines[first].trimStart().startsWith('>');
  const label = sequenceLabel(origin, fasta);
  const fail = (message: string): SequenceParseResult => ({
    ok: false,
    message: `${label}: ${message}`,
  });

  let header: string | undefined;
  let body: string[];
  if (fasta) {
    const records = lines.filter((line) =>
      line.trimStart().startsWith('>')
    ).length;
    if (records > 1) {
      return fail(
        `contains ${records} records; the viewer shows one protein. Keep a single '>' record.`
      );
    }
    header = lines[first].trimStart().slice(1).trim() || undefined;
    body = lines.slice(first + 1);
  } else {
    body = lines;
    // Residues never contain `/` or `.`, so a value that does is almost
    // certainly a path written without the `./` that marks it as one.
    const value = text.trim();
    if (origin === undefined && /^[^\s]+$/.test(value) && /[/.]/.test(value)) {
      return fail(
        `'${value}' looks like a file path; write it as './${value.replace(/^\/+/, '')}'.`
      );
    }
  }

  let residues = body.join('').replace(/\s+/g, '');
  if (residues.endsWith('*')) residues = residues.slice(0, -1);
  residues = residues.toUpperCase();

  if (residues === '') {
    // YAML's folded `>` indicator joins every line into one, so inline FASTA
    // written that way arrives as a header with the residues inside it.
    const folded =
      fasta && origin === undefined && body.every((line) => line.trim() === '');
    return fail(
      'has no residues.' +
        (folded
          ? " For inline FASTA in YAML use 'sequence: |' (a literal block); '>' folds the lines into one."
          : '')
    );
  }

  const bad = /[^A-Z]/.exec(residues);
  if (bad) {
    return fail(
      `invalid character '${bad[0]}' at residue ${bad.index + 1}. A protein sequence uses the one-letter codes A–Z, optionally ending in '*'.`
    );
  }

  return { ok: true, value: header ? { residues, header } : { residues } };
}

/**
 * The plain-text name the viewer shows for a resolved sequence, wherever it
 * would show an accession: the FASTA header, cut to 80 characters with an
 * ellipsis, or {@link DEFAULT_SEQUENCE_LABEL}.
 */
export function sequenceDisplayLabel(sequence: ResolvedSequence): string {
  const { header } = sequence;
  if (!header) return DEFAULT_SEQUENCE_LABEL;
  return header.length > MAX_LABEL_LENGTH
    ? `${header.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
    : header;
}

/**
 * Backslash-escape every ASCII punctuation character, so text substituted
 * into a Markdoc label source renders as literal text.
 *
 * A FASTA header is author data, not markup: `[x](javascript:…)` must not
 * become a link, `{% … %}` must not become a tag, and a leading `#` or `1.`
 * must not become a block. Markdoc honours CommonMark's backslash escape for
 * every ASCII punctuation character, so escaping all of them is both
 * sufficient and lossless.
 */
export function escapeMarkdocInline(text: string): string {
  return text.replace(/[!-/:-@[-`{-~]/g, '\\$&');
}
