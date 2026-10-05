/**
 * End-to-end coverage for the tooltip pipeline as it fires inside the
 * loader. Complements the sibling unit-test files:
 *
 *   - `resolve.spec.ts`   — `resolveTooltip()` in isolation.
 *   - `defaults.spec.ts`  — the per-kind `tooltipDefaults` registry.
 *   - `popover.spec.ts`   — the click-tooltip installer.
 *
 * Tests here drive `loadProtvistaData` (which calls
 * `applyTooltipResolver` as a post-adapter step) and assert on the
 * per-item `tooltipContent` it writes. The coverage map:
 *
 *   1. `track.dataTooltip` present → its spec wins over any per-kind
 *      default.
 *   2. Existing adapter-provided `tooltipContent` survives unchanged.
 *   3. Neither `dataTooltip` nor a per-kind default present → the
 *      auto-fallback synthesizes compact Markdoc from common adapted
 *      payload fields. (The intermediate `tooltipDefaults[kind]`
 *      step has its own unit coverage in `defaults.spec.ts`.)
 *   4. Variation-shaped adapter output (`{ sequence, variants }`) has
 *      the resolver applied to each item in `variants`, not to the
 *      wrapper.
 *   5. The `TooltipContext` passed to the resolver carries the
 *      accession, track id, and kind verbatim, and is reachable from
 *      a Markdoc template via `$ctx.accession` / `$ctx.trackId` /
 *      `$ctx.kind`.
 *   6. An authored `dataTooltip` naming fields no rendered item carries is
 *      returned on `tooltipFieldMisses`, never logged — and never for a
 *      per-kind default or a graph component.
 *
 * Rich / interactive / stateful tooltips are NOT the loader's
 * concern — consumers wire those via the Nightingale `change` event
 * on the element, with `notooltip` set to suppress the built-in
 * popover. There is no programmatic per-kind override surface.
 *
 * The config shape is hand-crafted against the `NormalizedConfig` API —
 * the renderer now consumes that directly, no legacy bridge in between.
 * Each fixture sets only the fields the loader reads:
 * `id`, `component`, `data[0].{ from, url, adapter }`, plus whichever
 * resolver inputs the test exercises.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadProtvistaData, type AdapterMap } from '../../load-data.js';
import type { TooltipSpec } from '../types.js';
import { ACCESSION, makeConfig } from '../../__spec__/fixtures.js';

const fetchOne = vi.fn(async (url: string) => ({ url })); // payload is irrelevant — adapters below ignore it

describe('tooltip pipeline — loader-driven end-to-end', () => {
  it('applies `dataTooltip` to every item in an array adapter output', async () => {
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Desc' }],
    };
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'DOMAIN', description: 'first' },
        { type: 'DOMAIN', description: 'second' },
      ],
    };
    const config = makeConfig({
      id: 'domain',
      label: 'domain',
      component: 'nightingale-track-canvas',
      rendering: {},
      dataTooltip: spec,
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, (name) => adapters[name]);
    const items = data['GROUP-domain'] as Array<{ tooltipContent: string }>;
    expect(items).toHaveLength(2);
    expect(items[0].tooltipContent).toBe('<h5>Desc</h5><p>first</p>');
    expect(items[1].tooltipContent).toBe('<h5>Desc</h5><p>second</p>');
  });

  it('`dataTooltip` wins over a per-kind default', async () => {
    // `kind: 'features'` has a built-in default in tooltipDefaults; the
    // override below must replace it.
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'description', label: 'Override' }],
    };
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [{ type: 'DOMAIN', description: 'x' }],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features',
      dataTooltip: spec,
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, (name) => adapters[name]);
    const [item] = data['GROUP-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe('<h5>Override</h5><p>x</p>');
  });

  it('preserves `tooltipContent` already stashed on an adapter item', async () => {
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        {
          type: 'DOMAIN',
          description: 'resolver would replace this',
          tooltipContent: '<strong>adapter tooltip</strong>',
        },
      ],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features',
      dataTooltip: {
        kind: 'fields',
        fields: [{ path: 'description', label: 'Override' }],
      },
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, (name) => adapters[name]);
    const [item] = data['GROUP-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe('<strong>adapter tooltip</strong>');
  });

  it('auto-synthesizes a fields tooltip when no spec is configured and the adapter sets nothing', async () => {
    // No `kind`, no `dataTooltip`, and the adapter emits plain
    // feature-shaped data without `tooltipContent`. The auto-fallback
    // should kick in and produce a Type/Description/Start/End block
    // out of the box.
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [
        { type: 'DOMAIN', description: 'Kinase', start: 10, end: 50 },
      ],
    };
    const config = makeConfig({
      id: 't',
      label: 't',
      component: 'nightingale-track-canvas',
      rendering: {},
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(ACCESSION, config, fetchOne, (name) => adapters[name]);
    const [item] = data['GROUP-t'] as Array<{ tooltipContent: string }>;
    expect(item.tooltipContent).toBe(
      '<h5>Type</h5><p>DOMAIN</p>' +
        '<h5>Description</h5><p>Kinase</p>' +
        '<h5>Start</h5><p>10</p>' +
        '<h5>End</h5><p>50</p>'
    );
  });

  it('applies the resolver to each entry under `.variants` for variation-shaped adapter output', async () => {
    const spec: TooltipSpec = {
      kind: 'fields',
      fields: [{ path: 'wildType', label: 'WT' }],
    };
    const adapters: AdapterMap = {
      'uniprot-variation-json': async () => ({
        sequence: 'ACDEFG',
        variants: [
          { wildType: 'A', alternativeSequence: 'G' },
          { wildType: 'C', alternativeSequence: 'T' },
        ],
      }),
    };
    const config = makeConfig({
      id: 'variation',
      label: 'variation',
      component: 'nightingale-variation-canvas',
      rendering: {},
      dataTooltip: spec,
      data: [
        {
          from: 'url',
          // variation-adapter has a documented early-return when the
          // raw payload is empty — stub fetchOne to return something
          // non-empty for this one URL.
          url: 'variation-url',
          adapter: 'uniprot-variation-json',
        },
      ],
    });
    const fetchNonEmpty = vi.fn(async () => [{ something: true }]);

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchNonEmpty,
      (name) => adapters[name]
    );
    const bundle = data['GROUP-variation'] as {
      variants: Array<{ tooltipContent: string; wildType: string }>;
    };
    expect(bundle.variants).toHaveLength(2);
    expect(bundle.variants[0].tooltipContent).toBe('<h5>WT</h5><p>A</p>');
    expect(bundle.variants[1].tooltipContent).toBe('<h5>WT</h5><p>C</p>');
  });

  it('threads (accession, trackId, kind) into the Markdoc `$ctx` scope', async () => {
    // The loader passes per-track `(accession, trackId, kind)` into
    // the resolver as a `TooltipContext`. The Markdoc branch surfaces
    // that to authors as `{% $ctx.accession %}` / `{% $ctx.trackId %}` /
    // `{% $ctx.kind %}`. This test pins the plumbing end to end.
    const adapters: AdapterMap = {
      'uniprot-features-json': async () => [{ type: 'X' }],
    };
    const config = makeConfig({
      id: 'my-track',
      label: 'my-track',
      component: 'nightingale-track-canvas',
      rendering: {},
      kind: 'features-domain',
      dataTooltip: {
        kind: 'markdown',
        template:
          '{% $ctx.accession %} / {% $ctx.trackId %} / {% $ctx.kind %}',
      },
      data: [
        {
          from: 'url',
          url: 'u',
          adapter: 'uniprot-features-json',
        },
      ],
    });

    const { data } = await loadProtvistaData(
      ACCESSION,
      config,
      fetchOne,
      (name) => adapters[name]
    );
    const [item] = data['GROUP-my-track'] as Array<{
      tooltipContent: string;
    }>;
    expect(item.tooltipContent).toContain(ACCESSION);
    expect(item.tooltipContent).toContain('my-track');
    expect(item.tooltipContent).toContain('features-domain');
  });
});

describe('tooltip pipeline — unknown dataTooltip fields (#135)', () => {
  // The loader returns what it found and logs nothing: the element routes it
  // (`_reportTooltipFieldMisses`), which is where the one console line is made.
  const tenDomains = async () =>
    Array.from({ length: 10 }, (_, i) => ({
      type: 'DOMAIN',
      start: i + 1,
      end: i + 3,
    }));

  const load = async (
    track: Parameters<typeof makeConfig>[0],
    adapters: AdapterMap = { 'uniprot-features-json': tenDomains },
    customTrackData?: Record<string, unknown>
  ) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await loadProtvistaData(
        ACCESSION,
        makeConfig(track),
        fetchOne,
        (name) => adapters[name],
        customTrackData
      );
      expect(warn).not.toHaveBeenCalled();
      return result;
    } finally {
      warn.mockRestore();
    }
  };

  const urlTrack = (extra: Partial<Parameters<typeof makeConfig>[0]>) => ({
    id: 't',
    label: 't',
    component: 'nightingale-track-canvas',
    rendering: {},
    data: [
      { from: 'url' as const, url: 'u', adapter: 'uniprot-features-json' },
    ],
    ...extra,
  });

  it('returns one miss per track naming every unknown field, without logging', async () => {
    const result = await load(
      urlTrack({
        dataTooltip: {
          kind: 'markdown',
          template: '{% $type %} {% $pvalue %} {% $start %} {% $Gene %}',
        },
      })
    );
    expect(result.tooltipFieldMisses).toEqual([
      { groupId: 'GROUP', trackId: 't', fields: ['pvalue', 'Gene'] },
    ]);
  });

  it('checks the `fields` form too', async () => {
    const result = await load(
      urlTrack({
        dataTooltip: {
          kind: 'fields',
          fields: [
            { path: 'type', label: 'Type' },
            { path: 'pvalue', label: 'p' },
          ],
        },
      })
    );
    expect(result.tooltipFieldMisses).toEqual([
      { groupId: 'GROUP', trackId: 't', fields: ['pvalue'] },
    ]);
  });

  it('never checks a per-kind default', async () => {
    // `features`' default names `description`, which these items lack.
    const result = await load(urlTrack({ kind: 'features' }));
    expect(result.tooltipFieldMisses).toEqual([]);
  });

  it('checks an inline track', async () => {
    const result = await load({
      id: 'inl',
      label: 'inl',
      component: 'nightingale-track-canvas',
      rendering: {},
      dataTooltip: { kind: 'markdown', template: '{% $nope %}' },
      data: [
        {
          from: 'inline',
          inlineData: [{ type: 'DOMAIN', start: 1, end: 5 }],
        },
      ],
    });
    expect(result.tooltipFieldMisses).toEqual([
      { groupId: 'GROUP', trackId: 'inl', fields: ['nope'] },
    ]);
  });

  it('checks a setTrackData() track', async () => {
    const result = await load(
      {
        id: 'c',
        label: 'c',
        component: 'nightingale-track-canvas',
        rendering: {},
        dataTooltip: { kind: 'markdown', template: '{% $type %} {% $nope %}' },
        data: [{ from: 'custom' }],
      },
      {},
      { 'GROUP-c': [{ type: 'DOMAIN', start: 1, end: 5 }] }
    );
    expect(result.tooltipFieldMisses).toEqual([
      { groupId: 'GROUP', trackId: 'c', fields: ['nope'] },
    ]);
  });

  it('does not count items whose adapter supplied the tooltip', async () => {
    const result = await load(
      urlTrack({ dataTooltip: { kind: 'markdown', template: '{% $nope %}' } }),
      {
        'uniprot-features-json': async () => [
          { type: 'X', tooltipContent: '<p>from the adapter</p>' },
        ],
      }
    );
    expect(result.tooltipFieldMisses).toEqual([]);
  });

  it('checks only what `filter:` leaves for the tooltip to render', async () => {
    const result = await load(
      urlTrack({
        filter: 'DOMAIN',
        dataTooltip: { kind: 'markdown', template: '{% $site %}' },
      }),
      {
        'uniprot-features-json': async () => [
          { type: 'DOMAIN', start: 1, end: 5 },
          { type: 'SITE', start: 2, end: 2, site: 'active' },
        ],
      }
    );
    expect(result.tooltipFieldMisses).toEqual([
      { groupId: 'GROUP', trackId: 't', fields: ['site'] },
    ]);
  });

  it.each([
    ['nightingale-linegraph-track'],
    ['nightingale-colored-sequence'],
    ['nightingale-sequence-heatmap'],
  ])(
    "never checks a %s, whose payload is the renderer's series wrapper",
    async (component) => {
      const result = await load({
        id: 'lg',
        label: 'lg',
        component,
        rendering: {},
        dataTooltip: { kind: 'markdown', template: '{% $value %}' },
        data: [
          {
            from: 'inline',
            shape: 'point',
            inlineData: [
              { position: 1, value: 3 },
              { position: 2, value: 4 },
            ],
          },
        ],
      });
      // The records carry `value`; the resolver saw the series wrapper.
      expect(result.data['GROUP-lg']).toEqual([
        expect.objectContaining({ values: expect.any(Array) }),
      ]);
      expect(result.tooltipFieldMisses).toEqual([]);
    }
  );

  it('checks the variants of a `{ sequence, variants }` payload, not the wrapper', async () => {
    const result = await load(
      {
        id: 'variation',
        label: 'variation',
        component: 'nightingale-variation-canvas',
        rendering: {},
        dataTooltip: {
          kind: 'markdown',
          template: '{% $variant %} {% $nope %} {% $sequence %}',
        },
        data: [
          {
            from: 'url',
            url: 'variation-url',
            adapter: 'uniprot-variation-json',
          },
        ],
      },
      {
        'uniprot-variation-json': async () => ({
          sequence: 'MAAA',
          variants: [{ start: 1, end: 1, variant: 'K' }],
        }),
      }
    );
    // `sequence` is the wrapper's key, not a variant's, so it is unknown too.
    expect(result.tooltipFieldMisses).toEqual([
      { groupId: 'GROUP', trackId: 'variation', fields: ['nope', 'sequence'] },
    ]);
  });

  it('lists misses in config order, whatever order the tracks settle in', async () => {
    const gate: { release?: () => void } = {};
    const slowDone = new Promise<void>((resolve) => (gate.release = resolve));
    const settled: string[] = [];
    const adapters: AdapterMap = {
      slow: async () => {
        await slowDone;
        settled.push('a');
        return [{ type: 'DOMAIN', start: 1, end: 2 }];
      },
      fast: async () => {
        settled.push('b');
        gate.release!();
        return [{ type: 'DOMAIN', start: 1, end: 2 }];
      },
    };
    const track = (id: string, adapter: string) =>
      urlTrack({
        id,
        label: id,
        dataTooltip: { kind: 'markdown', template: '{% $nope %}' },
        data: [{ from: 'url' as const, url: `u-${id}`, adapter }],
      });
    const config = makeConfig(track('a', 'slow'));
    config.rows[0].tracks.push(track('b', 'fast'));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let result;
    try {
      result = await loadProtvistaData(
        ACCESSION,
        config,
        fetchOne,
        (name) => adapters[name]
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    expect(settled).toEqual(['b', 'a']);
    expect(result.tooltipFieldMisses.map((m) => m.trackId)).toEqual(['a', 'b']);
  });

  it('records nothing for a track whose adapter threw', async () => {
    const result = await load(
      urlTrack({ dataTooltip: { kind: 'markdown', template: '{% $nope %}' } }),
      {
        'uniprot-features-json': async () => {
          throw new Error('bad body');
        },
      }
    );
    expect(result.trackFailures['GROUP-t']).toBeDefined();
    expect(result.tooltipFieldMisses).toEqual([]);
  });
});
