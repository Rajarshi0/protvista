import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isoformEdits, buildIsoform, isoformPositionMap } from '../isoform-map.js';

const fixturesDir = path.join(__dirname, '../../__fixtures__/isoforms');

function readEntry(acc: string) {
  const file = path.join(fixturesDir, `${acc}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing fixture: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readFasta(acc: string) {
  const file = path.join(fixturesDir, `${acc}.fasta`);
  if (!fs.existsSync(file)) throw new Error(`Missing fixture: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const blocks = text.trim().split('>').filter(Boolean);
  const fasta = new Map<string, string>();
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0];
    const seq = lines.slice(1).join('').trim();
    const match = header.match(/\|([^|]+)\|/);
    if (match) fasta.set(match[1], seq);
  }
  return fasta;
}

describe('isoform-map', () => {
  it('rebuilds sequences exactly matching UniProt FASTA and handles insertions/deletions', () => {
    const proteins = ['P05067', 'P04637', 'P10636', 'P42771', 'A0A1B0GTW7'];
    
    for (const acc of proteins) {
      const entry = readEntry(acc);
      const fasta = readFasta(acc);
      const isoforms = isoformEdits(entry);
      
      for (const iso of isoforms) {
        if (iso.external) continue;
        
        // Canonical IDs in FASTA sometimes lack the -1 suffix, so fallback safely
        const expectedSeq = fasta.get(iso.id) || (iso.canonical ? fasta.get(acc) : undefined);
        expect(expectedSeq).toBeDefined();
        
        // FIX: pass entry.sequence.value, not the object itself
        const rebuilt = buildIsoform(entry.sequence.value, iso.edits);
        expect(rebuilt).toBe(expectedSeq);
        
        const map = isoformPositionMap(entry, iso.id);
        expect(map).not.toBeNull();
        
        if (map) {
          for (let i = 1; i <= entry.sequence.length; i++) {
            const isoPos = map.canonicalToIsoform(i);
            if (isoPos !== null) {
              expect(map.isoformToCanonical(isoPos)).toBe(i);
              // FIX: compare against entry.sequence.value
              expect(entry.sequence.value[i - 1]).toBe(expectedSeq![isoPos - 1]);
            }
          }
        }
      }
    }
  });

  it('flags ARF (CDKN2A) as external with no edits', () => {
    const entry = readEntry('P42771');
    const isoforms = isoformEdits(entry);
    const arf = isoforms.find(i => i.id === 'Q8N726-1');
    expect(arf).toBeDefined();
    expect(arf?.external).toBe(true);
    expect(arf?.edits).toHaveLength(0);
    expect(isoformPositionMap(entry, 'Q8N726-1')).toBeNull();
  });

  it('tracks unresolved sequence IDs', () => {
    const entry = readEntry('P05067');
    // Artificially break a mapping to test tracking
    entry.features = entry.features.filter((f: any) => f.featureId !== 'VSP_000002');
    const isoforms = isoformEdits(entry);
    const affected = isoforms.find(i => i.unresolved.includes('VSP_000002'));
    expect(affected).toBeDefined();
  });
});
