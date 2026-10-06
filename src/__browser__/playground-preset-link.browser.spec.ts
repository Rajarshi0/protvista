/**
 * A docs-style deep link to a preset whose protein is not the default,
 * `#preset=small-protein`. Before the deep-link fix it opened
 * P05067; it must open crambin, P01542. (`#preset=conservation` is covered by
 * `playground-presets.browser.spec.ts`, which opens on that link.)
 *
 * The controller reads the link once, when it is imported, so this needs a
 * page of its own (see `playground-page.ts`).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import {
  byId,
  closePlayground,
  openPlayground,
  preview,
  sequenceLength,
} from './playground-page.js';

/** Crambin P01542 (46 residues), as UniProt release 2026_03 gives it. */
const P01542 = 'TTCCPSIVARSNFNVCRLPGTPEALCATYTGCIIIPGATCPGDYAN';

/** Every non-`blob:` URL the page fetched, in order. */
const recorded: string[] = [];

function respond(url: string): Response | undefined {
  if (url.endsWith('/proteins/api/proteins/P01542')) {
    return Response.json({
      accession: 'P01542',
      sequence: { sequence: P01542, length: 46 },
      features: [],
      comments: [],
      dbReferences: [],
    });
  }
  if (url.endsWith('/proteins/api/features/P01542')) {
    // One domain, so the default viewer draws a track rather than its
    // empty state.
    return Response.json({
      accession: 'P01542',
      sequence: P01542,
      features: [
        {
          type: 'DOMAIN',
          category: 'DOMAINS_AND_SITES',
          begin: '2',
          end: '20',
          description: 'Stub domain',
        },
      ],
    });
  }
  return new Response('Not Found', { status: 404, statusText: 'Not Found' });
}

/** The accession box's value as the page first set it. */
let initialAccession = '';

beforeAll(async () => {
  await openPlayground({ hash: '#preset=small-protein', recorded, respond });
  initialAccession = byId<HTMLInputElement>('accession').value;
});

afterAll(closePlayground);

describe('playground: a #preset= deep link', () => {
  it('#preset=small-protein opens crambin, P01542, not the default protein', async () => {
    expect(byId<HTMLSelectElement>('preset').value).toBe('small-protein');
    expect(initialAccession).toBe('P01542');
    await vi.waitFor(() => expect(sequenceLength()).toBe('46'), {
      timeout: 5000,
    });
    expect(preview()?.getAttribute('accession')).toBe('P01542');
    expect(recorded.filter((url) => url.includes('P05067'))).toEqual([]);
  });
});
