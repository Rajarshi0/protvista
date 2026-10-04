/**
 * The pure half of sequence-only mode (`sequence:`): telling a file reference
 * from an inline value, parsing residues and FASTA, the display label, and
 * the Markdoc escaping that keeps a FASTA header from becoming markup.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEQUENCE_LABEL,
  escapeMarkdocInline,
  isSequenceReference,
  parseSequenceText,
  sequenceDisplayLabel,
  sequenceLabel,
} from '../sequence.js';
import { renderLabel } from '../../tooltips/resolve.js';

describe('isSequenceReference', () => {
  it.each([
    ['./protein.fasta', true],
    ['../data/protein.fa', true],
    ['/static/protein.faa', true],
    ['https://host/x.fa?v=2', true],
    ['http://host/api/sequence', true],
    // A bare name with a FASTA extension is fetched page-relative.
    ['protein.fasta', true],
    ['PROTEIN.FAS', true],
    ['protein.fasta#top', true],
    // Inline values.
    ['MKTAYIAKQR', false],
    ['MKT AYI\nAKQ', false],
    ['>my construct v2\nMKTAYIAKQR\n', false],
    // A leading `>` is always FASTA, even when the header holds a path.
    ['>sp|P05067|./a.fasta', false],
    // No FASTA extension and no path prefix: inline (and then invalid).
    ['protein.txt', false],
    ['', false],
  ])('%j → %s', (value, expected) => {
    expect(isSequenceReference(value)).toBe(expected);
  });
});

describe('sequenceLabel', () => {
  it('mirrors the data pipeline’s “(parsed as …)” prefix', () => {
    expect(sequenceLabel('./protein.fasta', true)).toBe(
      './protein.fasta (parsed as FASTA)'
    );
    expect(sequenceLabel(undefined, true)).toBe(
      'inline sequence (parsed as FASTA)'
    );
    expect(sequenceLabel(undefined, false)).toBe('inline sequence');
  });
});

describe('parseSequenceText', () => {
  const ok = (text: string, origin?: string) => {
    const result = parseSequenceText(text, origin);
    if (!result.ok) throw new Error(result.message);
    return result.value;
  };
  const err = (text: string, origin?: string) => {
    const result = parseSequenceText(text, origin);
    if (result.ok) throw new Error('expected a failure');
    return result.message;
  };

  it('reads raw residues', () => {
    expect(ok('MKTAYIAKQR')).toEqual({ residues: 'MKTAYIAKQR' });
  });

  it('strips whitespace from a wrapped value', () => {
    expect(ok('MKT AYI\nAKQ')).toEqual({ residues: 'MKTAYIAKQ' });
  });

  it('reads a FASTA record and keeps its header', () => {
    expect(ok('>my construct v2\nMKTAY\nIAKQR\n')).toEqual({
      residues: 'MKTAYIAKQR',
      header: 'my construct v2',
    });
  });

  it('accepts CRLF and a leading BOM', () => {
    expect(ok('\uFEFF>hdr\r\nMKT\r\nAYI\r\n', './p.fasta')).toEqual({
      residues: 'MKTAYI',
      header: 'hdr',
    });
  });

  it('drops an empty header', () => {
    expect(ok('>\nMKT')).toEqual({ residues: 'MKT' });
  });

  it('uppercases residues and drops one trailing stop', () => {
    expect(ok('mkt*')).toEqual({ residues: 'MKT' });
    // Only one: a second trailing stop is an invalid residue.
    expect(err('MKT**')).toMatch(/invalid character '\*' at residue 4/);
  });

  it('accepts every IUPAC protein letter', () => {
    expect(ok('ACDEFGHIKLMNPQRSTVWYBJOUXZ').residues).toHaveLength(26);
  });

  it('rejects more than one record, naming the count', () => {
    expect(err('>a\nMKT\n>b\nMKT\n', './two.fasta')).toBe(
      "./two.fasta (parsed as FASTA): contains 2 records; the viewer shows one protein. Keep a single '>' record."
    );
  });

  it('names the first invalid character and its residue position', () => {
    expect(err('MKT1AY')).toBe(
      "inline sequence: invalid character '1' at residue 4. A protein sequence uses the one-letter codes A–Z, optionally ending in '*'."
    );
    // Only a *trailing* stop is dropped.
    expect(err('MK*T')).toMatch(/invalid character '\*' at residue 3/);
  });

  it('says a header with no residues has none', () => {
    expect(err('>hdr\n', './p.fasta')).toBe(
      './p.fasta (parsed as FASTA): has no residues.'
    );
  });

  it('points inline FASTA folded by YAML ">" at the literal block form', () => {
    // `sequence: >` folds the header and residues into one line.
    expect(err('>my construct v2 MKTAYIAKQR\n')).toBe(
      "inline sequence (parsed as FASTA): has no residues. For inline FASTA in YAML use 'sequence: |' (a literal block); '>' folds the lines into one."
    );
  });

  it('reads a path-like inline value as a missing ./', () => {
    expect(err('protein.txt')).toBe(
      "inline sequence: 'protein.txt' looks like a file path; write it as './protein.txt'."
    );
  });

  it('rejects an empty value', () => {
    expect(err('   \n')).toBe('inline sequence: has no residues.');
  });
});

describe('sequenceDisplayLabel', () => {
  it('is the header, or "your sequence" without one', () => {
    expect(
      sequenceDisplayLabel({ residues: 'M', header: 'my construct' })
    ).toBe('my construct');
    expect(sequenceDisplayLabel({ residues: 'M' })).toBe(
      DEFAULT_SEQUENCE_LABEL
    );
  });

  it('cuts a header over 80 characters with an ellipsis', () => {
    const label = sequenceDisplayLabel({
      residues: 'M',
      header: 'x'.repeat(200),
    });
    expect(label).toHaveLength(80);
    expect(label.endsWith('…')).toBe(true);
  });

  it('keeps an 80-character header whole and cuts one of 81', () => {
    const label = (header: string) =>
      sequenceDisplayLabel({ residues: 'M', header });
    expect(label('x'.repeat(80))).toBe('x'.repeat(80));
    expect(label('x'.repeat(81))).toBe(`${'x'.repeat(79)}…`);
  });

  it('trims the space before the ellipsis', () => {
    // The cut falls just after a space: no "construct …".
    const header = `${'x'.repeat(78)} ${'y'.repeat(10)}`;
    expect(sequenceDisplayLabel({ residues: 'M', header })).toBe(
      `${'x'.repeat(78)}…`
    );
  });
});

describe('escapeMarkdocInline through the real label renderer', () => {
  const render = (header: string) =>
    renderLabel('Hotspots on {accession}', escapeMarkdocInline(header));

  it('renders a link-shaped header as literal text', () => {
    const html = render('[x](javascript:alert(1)) *y*');
    expect(html).not.toContain('<');
    expect(html).toContain('[x](javascript:alert(1)) *y*');
  });

  it('never parses a header as a Markdoc tag', () => {
    const html = render('{% help slug="x" %}hi{% /help %}');
    // Plain text through and through: no element of any kind.
    expect(html).not.toContain('<');
    expect(html).toContain('{% help slug=&quot;x&quot; %}hi{% /help %}');
  });

  it('keeps ordinary FASTA punctuation as written', () => {
    expect(render('sp|P05067|A4_HUMAN')).toContain(
      'Hotspots on sp|P05067|A4_HUMAN'
    );
  });
});
