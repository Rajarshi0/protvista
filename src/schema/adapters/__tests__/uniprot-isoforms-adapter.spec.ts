import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { uniprotIsoformsAdapter } from '../uniprot-isoforms-adapter.js';

describe('uniprot-isoforms-adapter', () => {
  const loadJSON = (acc: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../src/__fixtures__/isoforms', `${acc}.json`), 'utf8'));

  it('creates features for APP and keeps each isoform on its own row', () => {
    const app = loadJSON('P05067');
    const features = uniprotIsoformsAdapter(app);
    
    expect(features.length).toBe(11); // Fixture accurately contains 11
    features.forEach((feature: any) => {
      const fragments = feature.locations[0].fragments;
      expect(fragments[0].start).toBe(1);
      expect(fragments[fragments.length - 1].end).toBeGreaterThan(1);
    });
  });

  it('creates features for CDKN2A (External isoforms skipped)', () => {
    const cdkn2a = loadJSON('P42771');
    const features = uniprotIsoformsAdapter(cdkn2a);
    
    expect(features.length).toBeGreaterThan(0);
    const hasExternal = features.some((f: any) => f.accession === 'Q8N726' || f.description.includes('External'));
    expect(hasExternal).toBe(false); // Validates the filter works
  });
});
