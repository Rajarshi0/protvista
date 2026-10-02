/**
 * Every item the loader hands a track carries its source track and kind
 * (`getFeatureSource`), so an item picked out of a collapsed group's
 * flattened aggregate still says which track produced it — without that tag
 * leaking into anything that serialises or iterates the item.
 */

import { describe, it, expect } from 'vitest';

import { loadProtvistaData } from '../load-data.js';
import { createRegistry } from '../schema/registry.js';
import { normalizeConfig } from '../schema/normalize.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';
import { PV_SOURCE, getFeatureSource } from '../feature-source.js';

const noFetch = async () => null;

const load = (config: ProtvistaViewerConfig, custom = {}) => {
  const r = createRegistry();
  return loadProtvistaData(
    'P05067',
    normalizeConfig(config, { registry: r }),
    noFetch,
    (name) => r.getAdapter(name),
    custom
  );
};

const DOMAINS: ProtvistaViewerConfig = {
  accession: 'P05067',
  rows: [
    {
      id: 'DOMAINS',
      tracks: [
        {
          id: 'domain',
          kind: 'features',
          data: {
            from: 'inline',
            inlineData: [{ type: 'DOMAIN', start: 1, end: 5 }],
          },
        },
        {
          id: 'interpro',
          kind: 'interpro-features',
          data: {
            from: 'inline',
            inlineData: [
              {
                type: 'InterPro Representative Domain',
                start: 10,
                end: 20,
                // Already carries a tooltip: still tagged.
                tooltipContent: '<p>Kringle</p>',
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('feature source tagging', () => {
  it('tags each item in a collapsed aggregate with the track it came from', async () => {
    const { data } = await load(DOMAINS);
    const aggregate = data.DOMAINS as object[];

    expect(aggregate.map(getFeatureSource)).toEqual([
      { trackId: 'domain', kind: 'features' },
      { trackId: 'interpro', kind: 'interpro-features' },
    ]);
  });

  it('keeps the aggregate and per-track data the same objects', async () => {
    const { data } = await load(DOMAINS);
    expect((data.DOMAINS as object[])[1]).toBe(
      (data['DOMAINS-interpro'] as object[])[0]
    );
  });

  it('is invisible to Object.keys and JSON.stringify', async () => {
    const { data } = await load(DOMAINS);
    const [item] = data['DOMAINS-domain'] as Record<string, unknown>[];

    expect(Object.keys(item)).not.toContain(String(PV_SOURCE));
    expect(Object.getOwnPropertySymbols(item)).toEqual([PV_SOURCE]);
    expect(Object.getOwnPropertyDescriptor(item, PV_SOURCE)?.enumerable).toBe(
      false
    );
    expect(JSON.parse(JSON.stringify(item))).toEqual({
      type: 'DOMAIN',
      start: 1,
      end: 5,
      tooltipContent: item.tooltipContent,
    });
  });

  it('tags setTrackData() input without mutating it', async () => {
    const injected = [{ type: 'REGION', start: 2, end: 4 }];
    const { data } = await load(
      {
        accession: 'P05067',
        rows: [
          {
            id: 'G',
            tracks: [
              { id: 'mine', kind: 'features', data: { from: 'custom' } },
            ],
          },
        ],
      },
      { 'G-mine': injected }
    );

    expect(getFeatureSource((data['G-mine'] as object[])[0])).toEqual({
      trackId: 'mine',
      kind: 'features',
    });
    expect(getFeatureSource(injected[0])).toBeUndefined();
  });

  it('tags each variant of a { variants } payload and reports a null kind', async () => {
    const { data } = await load(
      {
        accession: 'P05067',
        rows: [
          {
            id: 'G',
            tracks: [
              {
                id: 'v',
                component: 'nightingale-track-canvas',
                data: {
                  from: 'custom',
                },
              },
            ],
          },
        ],
      },
      { 'G-v': { sequence: 'MA', variants: [{ start: 1, variant: 'V' }] } }
    );

    const payload = data['G-v'] as { variants: object[] };
    expect(getFeatureSource(payload.variants[0])).toEqual({
      trackId: 'v',
      kind: null,
    });
  });

  it('returns undefined for untagged values', () => {
    expect(getFeatureSource(undefined)).toBeUndefined();
    expect(getFeatureSource('MSEQ')).toBeUndefined();
    expect(getFeatureSource({ start: 1 })).toBeUndefined();
  });
});
