import * as fs from 'fs';
import * as path from 'path';
import { isoformEdits, buildIsoform, canonicalToIsoformMap } from '../isoform-map';

describe('Isoform Mapper', () => {
  const fixturePath = path.join(__dirname, '../../__fixtures__/isoforms');

  // Helpers to load the offline hackathon data
  const loadJSON = (acc: string) => JSON.parse(fs.readFileSync(path.join(fixturePath, `${acc}.json`), 'utf8'));
  
  const loadFasta = (acc: string) => {
    const content = fs.readFileSync(path.join(fixturePath, `${acc}.fasta`), 'utf8');
    const sequences: Record<string, string> = {};
    let currentId = '';
    let seq = '';
    for (const line of content.split('\n')) {
      if (line.startsWith('>')) {
        if (currentId) sequences[currentId] = seq;
        const parts = line.split('|');
        currentId = parts.length > 1 ? parts[1] : line.substring(1).split(' ')[0];
        seq = '';
      } else {
        seq += line.trim();
      }
    }
    if (currentId) sequences[currentId] = seq;
    return sequences;
  };

  it('rebuilds isoforms exactly matching UniProt FASTA for demo proteins', () => {
    const proteins = ['P05067', 'P04637', 'P10636', 'P42771'];
    
    proteins.forEach(acc => {
      // Graceful fallback if a fixture is missing during CI
      if (!fs.existsSync(path.join(fixturePath, `${acc}.json`))) return;

      const entry = loadJSON(acc);
      const fastas = loadFasta(acc);
      const canonicalSeq = entry.sequence.value;
      const edits = isoformEdits(entry);

      Object.keys(edits).forEach(isoformId => {
        if (fastas[isoformId]) {
          const rebuilt = buildIsoform(canonicalSeq, edits[isoformId]);
          expect(rebuilt).toEqual(fastas[isoformId]); // The biological truth check!
        }
      });
    });
  });

  it('skips External isoforms like ARF in CDKN2A (P42771)', () => {
    if (!fs.existsSync(path.join(fixturePath, `P42771.json`))) return;
    const cdkn2a = loadJSON('P42771');
    const edits = isoformEdits(cdkn2a);
    
    const extIsoform = cdkn2a.comments?.find((c: any) => c.commentType === 'ALTERNATIVE PRODUCTS')
      ?.isoforms.find((iso: any) => iso.sequenceIds && iso.sequenceIds.includes('External'));
      
    if (extIsoform) {
      expect(edits[extIsoform.isoformIds[0]]).toBeUndefined();
    }
  });

  it('maps inserted and deleted residues to null and perfectly round-trips', () => {
    // Synthetic sequence for exact coordinate mapping tests
    const canonical = "ABCDEFGHIJ"; // Length 10
    const edits = [
      { start: 3, end: 4, alternativeSequence: "Missing" }, // Delete C, D
      { start: 8, end: 8, alternativeSequence: "XYZ" }      // Replace H with XYZ
    ];
    
    const { canonicalToIsoform, isoformToCanonical } = canonicalToIsoformMap(10, edits);
    
    // Deletions map to null
    expect(canonicalToIsoform(3)).toBeNull();
    expect(canonicalToIsoform(4)).toBeNull();
    
    // Inserted/replaced residues map to null from canonical perspective
    expect(canonicalToIsoform(8)).toBeNull(); 
    
    // Position shift check (E is at 5 canonically, moves to 3 in isoform)
    expect(canonicalToIsoform(5)).toBe(3);
    expect(isoformToCanonical(3)).toBe(5);
    
    // Round trip verification
    [1, 2, 5, 6, 7, 9, 10].forEach(pos => {
      const isoPos = canonicalToIsoform(pos);
      expect(isoPos).not.toBeNull();
      expect(isoformToCanonical(isoPos as number)).toBe(pos);
    });
  });
});
