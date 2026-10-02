/**
 * The two proteomics adapters pass the API's fields through, under the API's
 * own names (their documented output contract, `adapter-reference.ts`):
 *
 *   - `uniprot-proteomics-json` passes every field of the API feature through,
 *     rewrites `type` for the `filter:` sugar but keeps the API's type as
 *     `sourceType`, adds the response's `taxid`, and never mutates the raw
 *     body (it is shared with the PTM adapter);
 *   - `uniprot-proteomics-ptm-json` passes the API's `ptms` entries through on
 *     each marker, with the `confidenceScore` its colour is computed from.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { proteomicsAdapter } from '../proteomics-adapter.js';
import { proteomicsPtmAdapter } from '../ptm-exchange-adapter.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const ptm = (
  name: string,
  position: number,
  score: string | undefined = 'Gold'
) => ({
  name,
  position,
  sources: ['PTMeXchange'],
  dbReferences: [
    {
      id: 'PXD000001',
      properties: score === undefined ? {} : { 'Confidence score': score },
    },
  ],
});

describe('proteomicsAdapter', () => {
  const raw = () => ({
    accession: 'P05067',
    taxid: 9606,
    features: [
      {
        type: 'PROTEOMICS_PTM',
        begin: '10',
        end: '15',
        peptide: 'ASTKLM',
        unique: true,
        ptms: [ptm('Phosphothreonine', 3)],
      },
      {
        type: 'PROTEOMICS',
        begin: '20',
        end: '24',
        peptide: 'GGHHK',
        unique: false,
      },
    ],
  });

  it('keeps the API type as sourceType and rewrites type for filter:', () => {
    const out = proteomicsAdapter(raw()) as Record<string, unknown>[];
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: 'unique',
      sourceType: 'PROTEOMICS_PTM',
      taxid: 9606,
      category: 'PROTEOMICS',
      start: '10',
      residuesToHighlight: [
        expect.objectContaining({ name: 'Phosphothreonine', position: 3 }),
      ],
    });
    expect(out[1]).toMatchObject({
      type: 'non_unique',
      sourceType: 'PROTEOMICS',
      taxid: 9606,
    });
  });

  it('passes the rest of the API feature through unchanged', () => {
    const input = raw();
    const [first] = proteomicsAdapter(input) as Record<string, unknown>[];
    const apiFields: Record<string, unknown> = { ...input.features[0] };
    delete apiFields.type;
    expect(first).toMatchObject(apiFields);
    expect(first.ptms).toBe(input.features[0].ptms);
  });

  it('does not mutate the raw response', () => {
    const input = raw();
    const snapshot = structuredClone(input);
    proteomicsAdapter(input);
    expect(input).toEqual(snapshot);
  });

  it('returns [] for an empty body', () => {
    expect(proteomicsAdapter([])).toEqual([]);
    expect(proteomicsAdapter(null)).toEqual([]);
  });
});

describe('proteomicsPtmAdapter', () => {
  it('passes ptms through and adds confidenceScore on each marker', () => {
    const phospho1 = ptm('Phosphothreonine', 3);
    const phospho2 = ptm('Phosphothreonine', 1);
    const acetyl = ptm('Acetyllysine', 4, 'Silver');
    const out = proteomicsPtmAdapter({
      taxid: 9606,
      features: [
        // Residue 12 is T in both peptides; residue 13 is K.
        { begin: '10', peptide: 'ASTKLM', ptms: [phospho1, acetyl] },
        { begin: '12', peptide: 'TPR', ptms: [phospho2] },
      ],
    }) as Record<string, unknown>[];

    expect(out).toEqual([
      {
        source: 'PTMeXchange',
        type: 'MOD_RES_LS',
        start: 12,
        end: 12,
        shape: 'triangle',
        color: '#c39b00',
        ptms: [phospho1, phospho2],
        confidenceScore: 'Gold',
      },
      {
        source: 'PTMeXchange',
        type: 'MOD_RES_LS',
        start: 13,
        end: 13,
        shape: 'triangle',
        color: '#8194a1',
        ptms: [acetyl],
        confidenceScore: 'Silver',
      },
    ]);
  });

  it('sets confidenceScore to null when the entries report none', () => {
    const out = proteomicsPtmAdapter({
      features: [
        {
          begin: '1',
          peptide: 'S',
          ptms: [
            {
              ...ptm('Phosphoserine', 1),
              dbReferences: [{ id: 'PXD000001', properties: {} }],
            },
          ],
        },
      ],
    }) as Record<string, unknown>[];
    expect(out[0].confidenceScore).toBeNull();
    expect(out[0].color).toBe('black');
  });

  it('sets confidenceScore to null and warns on a mixture', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    const out = proteomicsPtmAdapter({
      features: [
        {
          begin: '1',
          peptide: 'S',
          ptms: [
            ptm('Phosphoserine', 1, 'Gold'),
            ptm('Phosphoserine', 1, 'Bronze'),
          ],
        },
      ],
    }) as Record<string, unknown>[];

    expect(out).toHaveLength(1);
    expect(out[0].confidenceScore).toBeNull();
    expect(out[0].color).toBe('black');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mixture'));
    expect(error).not.toHaveBeenCalled();
  });

  it('warns, not errors, when two peptides disagree on the residue', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    proteomicsPtmAdapter({
      features: [
        { begin: '1', peptide: 'S', ptms: [ptm('Phosphoserine', 1)] },
        { begin: '1', peptide: 'T', ptms: [ptm('Phosphothreonine', 1)] },
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('different amino acid')
    );
    expect(error).not.toHaveBeenCalled();
  });
});
