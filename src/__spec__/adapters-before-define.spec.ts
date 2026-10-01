/**
 * `adapters` set on `<protvista-uniprot>` before the module that defines it
 * has loaded — what a React host does when it renders the tag and lazy-loads
 * the package. The value lands as a plain own property of an undefined
 * element; on upgrade the constructor moves it through the setter, so the
 * adapters are registered before `connectedCallback` starts the load, with
 * no `suspend` involved.
 *
 * Its own file: the element must not be defined yet when the test starts,
 * and `customElements` cannot un-define a tag.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import type { ProtvistaViewerConfig } from '../schema/types.js';

type El = HTMLElement & {
  adapters?: Record<string, (...raw: unknown[]) => unknown>;
  data: Record<string, unknown>;
};

const CONFIG_URL = 'https://example.org/config.json';

const CONFIG: ProtvistaViewerConfig = {
  rows: [
    {
      id: 'G',
      tracks: [
        {
          id: 't',
          component: 'nightingale-track-canvas',
          data: {
            from: 'url',
            url: 'https://example.org/proteomics',
            adapter: 'uniprot-proteomics-json',
          },
        },
      ],
    },
  ],
};

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('adapters set before the element is defined', () => {
  it('loads data through them, overriding a built-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body =
          url === CONFIG_URL
            ? CONFIG
            : { sequence: { sequence: 'MSEQENCE' }, features: [] };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      })
    );
    const mine = vi.fn(() => [{ type: 'MINE', start: 1, end: 2 }]);

    // Undefined tag: `adapters` is a plain own property for now. The rest
    // go on as attributes, the way React 19 sets props on an element that is
    // not defined yet. Connected before the definition exists, so the
    // upgrade runs the constructor and then `connectedCallback` straight
    // away.
    expect(customElements.get('protvista-uniprot')).toBeUndefined();
    const el = document.createElement('protvista-uniprot') as unknown as El;
    el.adapters = { 'uniprot-proteomics-json': mine };
    el.setAttribute('accession', 'P05067');
    el.setAttribute('no-persist-layout', '');
    el.setAttribute('config-src', CONFIG_URL);
    document.body.append(el);

    await import('../protvista-uniprot.js');

    await vi.waitFor(() => expect(mine).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(el.data['G-t']).toEqual([
        expect.objectContaining({ type: 'MINE' }),
      ])
    );
    expect(el.adapters).toEqual({ 'uniprot-proteomics-json': mine });
  });

  it('warns when React 19 stringified them into an attribute', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The lost `viewerConfig` arrives as `null` (Lit can't parse
    // "[object Object]" as JSON), so the config load fails too. Expected
    // here; keep it out of the test output.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          sequence: { sequence: 'MSEQENCE' },
          features: [],
        }),
        text: async () => '{}',
      }))
    );
    await import('../protvista-uniprot.js');

    // React 19's DOM for `<protvista-uniprot adapters={…} viewerConfig={…}>`
    // rendered before the tag was defined: each object prop became an
    // attribute holding `String(value)`.
    const el = document.createElement('protvista-uniprot') as unknown as El;
    el.setAttribute('accession', 'P05067');
    el.setAttribute('no-persist-layout', '');
    el.setAttribute('adapters', '[object Object]');
    el.setAttribute('viewerconfig', '[object Object]');
    document.body.append(el);

    const warnings = warn.mock.calls.map(([message]) => String(message));
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/`adapters`.*value was lost/),
        expect.stringMatching(/`viewerConfig`.*value was lost/),
      ])
    );
    expect(el.adapters).toBeUndefined();

    // Once per element, however often it is moved.
    const count = warn.mock.calls.length;
    document.body.append(el);
    expect(warn.mock.calls.length).toBe(count);
    warn.mockRestore();
    error.mockRestore();
  });
});
