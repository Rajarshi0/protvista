/**
 * `detailOnly` tracks and the collapsed group aggregate.
 *
 * A group's collapsed view is built from the tracks that are *not*
 * `detailOnly`. Graph groups used to draw whichever track came first
 * (`groupData[0]`), so reordering a group to put its detail track first made
 * the collapsed view draw the detail track's data with the summary track's
 * component. These pin that the aggregate follows the flag, not position.
 */

import { describe, it, expect } from 'vitest';

import { loadProtvistaData } from '../load-data.js';
import { createRegistry } from '../schema/registry.js';
import { normalizeConfig } from '../schema/normalize.js';
import type { ProtvistaViewerConfig } from '../schema/types.js';
import '../protvista-uniprot.js';

const noFetch = async () => null;

const load = (config: ProtvistaViewerConfig) => {
  const r = createRegistry();
  return loadProtvistaData(
    'P05067',
    normalizeConfig(config, { registry: r }),
    noFetch,
    (name) => r.getAdapter(name),
    {}
  );
};

describe('collapsed aggregate skips detailOnly tracks', () => {
  it('a graph group draws the first non-detailOnly track, even when a detailOnly track comes first', async () => {
    const { data } = await load({
      accession: 'P05067',
      rows: [
        {
          id: 'G',
          tracks: [
            {
              id: 'detail',
              kind: 'linegraph',
              detailOnly: true,
              data: {
                from: 'inline',
                inlineData: [{ position: 1, value: 99 }],
              },
            },
            {
              id: 'summary',
              kind: 'linegraph',
              data: {
                from: 'inline',
                inlineData: [{ position: 1, value: 3 }],
              },
            },
          ],
        },
      ],
    });
    expect(data['G-summary']).toBeDefined();
    expect(data.G).toEqual(data['G-summary']);
    expect(data.G).not.toEqual(data['G-detail']);
  });

  it('a flattened group leaves the detailOnly track out of the aggregate', async () => {
    const { data } = await load({
      accession: 'P05067',
      rows: [
        {
          id: 'G',
          tracks: [
            {
              id: 'kept',
              kind: 'features',
              data: {
                from: 'inline',
                inlineData: [{ type: 'DOMAIN', start: 1, end: 5 }],
              },
            },
            {
              id: 'detail',
              kind: 'features',
              detailOnly: true,
              data: {
                from: 'inline',
                inlineData: [{ type: 'REGION', start: 10, end: 20 }],
              },
            },
          ],
        },
      ],
    });
    expect(data['G-detail']).toHaveLength(1);
    expect(data.G).toEqual(data['G-kept']);
  });
});
