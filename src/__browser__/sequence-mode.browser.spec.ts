/**
 * Sequence-only mode in a real browser: a config with `sequence:` instead of
 * an accession renders the navigation, the sequence and the author's own
 * tracks — and no structure section — with no accessibility violations. The
 * chrome differs from accession mode (the structure panel is gone, and the
 * FASTA header stands in for the accession in labels), so axe looks at it
 * once on its own.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import '../protvista-uniprot.js';
import { mount, unmountAll } from './mount.js';
import { expectNoA11yViolations } from './axe.js';

const CONFIG = {
  sequence:
    '>my construct v2\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQ\n',
  rows: [
    {
      id: 'hotspots',
      label: 'Hotspots on {accession}',
      tracks: [
        {
          id: 'sites',
          label: 'Sites',
          kind: 'features',
          data: {
            from: 'inline',
            inlineData: [
              {
                type: 'DOMAIN',
                start: 4,
                end: 30,
                description: 'Designed domain',
              },
              {
                type: 'BINDING',
                start: 12,
                end: 18,
                description: 'Binding site',
              },
            ],
          },
        },
      ],
    },
  ],
};

type El = HTMLElement & { viewerConfig?: unknown; openGroups?: string[] };

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

describe('sequence-only mode', () => {
  it('renders with no structure section, no requests and no axe violations', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const el = mount<El>('protvista-uniprot', {
      viewerConfig: CONFIG,
      openGroups: ['hotspots'],
    });

    await vi.waitFor(() => {
      if (!el.querySelector('nightingale-manager')) {
        throw new Error('viewer not ready');
      }
    });

    expect(el.textContent).toContain('Hotspots on my construct v2');
    expect(el.querySelector('protvista-uniprot-structure')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    await expectNoA11yViolations(el);
  });
});
