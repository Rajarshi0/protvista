import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { uniprotIsoformsAdapter } from '../uniprot-isoforms-adapter.js';

const fixturesDir = path.join(__dirname, '../../../__fixtures__/isoforms');

function readEntry(acc: string) {
  const file = path.join(fixturesDir, `${acc}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('uniprot-isoforms-adapter', () => {
  it('APP695 (P05067-4): specific fragments, highlights, and description', () => {
    const data = readEntry('P05067');
    const features = uniprotIsoformsAdapter(data);
    const app695 = features.find((f: any) => f.accession === 'P05067-4');
    
    expect(app695.locations[0].fragments).toEqual([
      { start: 1, end: 289 },
      { start: 365, end: 770 }
    ]);
    expect(app695.residuesToHighlight).toEqual([
      { position: 289, name: '289: E → V' }
    ]);
    expect(app695.description).toBe('P05067-4 (APP695): 289: E → V; 290-364: missing');
  });

  it('Row counts: APP 11, tau 9, CDKN2A 4 (canonical included, external skipped)', () => {
    expect(uniprotIsoformsAdapter(readEntry('P05067'))).toHaveLength(11);
    expect(uniprotIsoformsAdapter(readEntry('P10636'))).toHaveLength(9);
    expect(uniprotIsoformsAdapter(readEntry('P42771'))).toHaveLength(4);
  });

  it('CDKN2A canonical row names External isoforms and checks colours', () => {
    const features = uniprotIsoformsAdapter(readEntry('P42771'));
    const canonical = features.find((f: any) => f.color === '#0053d6');
    const nonCanonical = features.find((f: any) => f.color === '#888888');
    
    expect(canonical).toBeDefined();
    expect(nonCanonical).toBeDefined();
    expect(canonical.description).toBe(
      'P42771-1 (isoform 1): canonical sequence; not shown (External): Q8N726-1 (tumor suppressor ARF), Q8N726-2 (smARF)'
    );
  });

  it('P05067-11: long sequence truncation formatting', () => {
    const features = uniprotIsoformsAdapter(readEntry('P05067'));
    const p11 = features.find((f: any) => f.accession === 'P05067-11');
    
    expect(p11.locations[0].fragments).toEqual([{ start: 1, end: 770 }]);
    const h1 = p11.residuesToHighlight.find((r: any) => r.position === 1);
    const h345 = p11.residuesToHighlight.find((r: any) => r.position === 345);
    
    expect(h1.name).toBe('1-19: MLPGLALLLL… (19 aa) → MDQLEDLLVL… (14 aa)');
    expect(h345.name).toBe('345-364: MSQSLLKTTQ… (20 aa) → I');
    expect(p11.description).toBe(
      'P05067-11 (isoform 11): 1-19: MLPGLALLLL… (19 aa) → MDQLEDLLVL… (14 aa); 345-364: MSQSLLKTTQ… (20 aa) → I'
    );
  });

  it('CIROP isoform 2 and 3: insertions and highlights', () => {
    const features = uniprotIsoformsAdapter(readEntry('A0A1B0GTW7'));
    
    const iso2 = features.find((f: any) => f.accession === 'A0A1B0GTW7-2');
    expect(iso2.locations[0].fragments).toEqual([{ start: 1, end: 201 }, { start: 260, end: 788 }]);
    expect(iso2.residuesToHighlight).toBeUndefined();

    const iso3 = features.find((f: any) => f.accession === 'A0A1B0GTW7-3');
    expect(iso3.locations[0].fragments).toEqual([{ start: 1, end: 201 }, { start: 302, end: 788 }]);
    
    const h108 = iso3.residuesToHighlight.find((r: any) => r.position === 108);
    expect(h108.name).toBe('108: V → VPPV (insertion)');
    
    const h493 = iso3.residuesToHighlight.find((r: any) => r.position === 493);
    expect(h493.name).toBe('493-495: SEC → VSR');
  });

  it('Every description contains no [object Object]', () => {
    const proteins = ['P05067', 'P10636', 'P42771', 'A0A1B0GTW7'];
    for (const acc of proteins) {
      const features = uniprotIsoformsAdapter(readEntry(acc));
      for (const feat of features) {
        expect(feat.description).not.toContain('[object Object]');
        if (feat.residuesToHighlight) {
          for (const res of feat.residuesToHighlight) {
            expect(res.name).not.toContain('[object Object]');
          }
        }
      }
    }
  });

  it('Edge cases: array input, no sequence, unresolved', () => {
    const entry = readEntry('P05067');
    
    // Array input
    const fromArray = uniprotIsoformsAdapter([entry]);
    expect(fromArray).toHaveLength(11);
    
    // No sequence
    const noSeq = { ...entry, sequence: undefined };
    expect(uniprotIsoformsAdapter(noSeq)).toEqual([]);
    
    // Unresolved
    const broken = JSON.parse(JSON.stringify(entry));
    broken.features = broken.features.filter((f: any) => f.featureId !== 'VSP_000002');
    const bFeats = uniprotIsoformsAdapter(broken);
    const affected = bFeats.find((f: any) => f.description.includes('edits not in the entry: VSP_000002'));
    expect(affected).toBeDefined();
  });
});
