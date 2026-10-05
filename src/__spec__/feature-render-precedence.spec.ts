/**
 * A record's own `color` / `fill` / `shape` wins over the track's.
 *
 * The CSV/TSV/JSON decoders pass those columns through so an author can style
 * features one by one (#283), and the docs promise the precedence
 * record > track `rendering:` > type default. That order is Nightingale's, not
 * ours, so this pins it against the copy of `nightingale-track` the viewer
 * actually draws with: if an upgrade changes it, this fails and the docs (not
 * the decoder) need revisiting.
 *
 * The package is only a transitive dependency (via `nightingale-track-canvas`)
 * and every `@nightingale-elements/*` name is mocked for the unit project, so
 * its compiled entry is resolved from the canvas package and imported by path,
 * the way `schema/__spec__/nightingale-vocabulary.ts` reads its type table.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';

const fromHere = createRequire(import.meta.url);
const canvasPkgPath = fromHere.resolve(
  '@nightingale-elements/nightingale-track-canvas/package.json'
);
const trackDir = dirname(
  createRequire(canvasPkgPath).resolve(
    '@nightingale-elements/nightingale-track/package.json'
  )
);

type Feature = Record<string, unknown>;
interface TrackMethods {
  getFeatureColor(f: Feature): string;
  getFeatureFillColor(f: Feature): string;
  getShape(f: Feature): string;
}

let track: TrackMethods;
let typeTable: Record<string, { color: string; shape: string }>;

beforeAll(async () => {
  // Nightingale's resizable mixin builds a `ResizeObserver` at module load;
  // jsdom has none, and nothing here lays anything out, so an inert one does.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // The path is built from module resolution above, never from input.
  // eslint-disable-next-line no-unsanitized/method
  const mod = await import(join(trackDir, 'dist/index.js'));
  track = mod.default.prototype as TrackMethods;
  // The type table is not exported from the compiled entry; the package ships
  // its source, which is what `getColorByType` / `getShapeByType` read.
  // eslint-disable-next-line no-unsanitized/method
  const configModule = await import(join(trackDir, 'src/config.ts'));
  typeTable = configModule.config;
});

/** Call a track method the way the canvas does, on a track with `rendering:`. */
const onTrack = (
  method: keyof TrackMethods,
  record: Feature,
  rendering: { color?: string; shape?: string } = {
    color: 'red',
    shape: 'circle',
  }
): string => {
  // A plain stand-in for `this`: the methods read only `color` / `shape` and
  // call each other, so no element is constructed. (Not `Object.create` on the
  // prototype — `color` / `shape` are Lit reactive setters there.)
  const self = {
    ...rendering,
    getFeatureColor: track.getFeatureColor,
    getFeatureFillColor: track.getFeatureFillColor,
    getShape: track.getShape,
  };
  return self[method](record);
};

describe("Nightingale's per-record styling precedence", () => {
  it('a record color wins over the track color', () => {
    expect(
      onTrack('getFeatureColor', { type: 'DOMAIN', color: '#1f77b4' })
    ).toBe('#1f77b4');
  });

  it('the track color applies when the record has none', () => {
    expect(onTrack('getFeatureColor', { type: 'DOMAIN' })).toBe('red');
  });

  it('a record fill wins, and falls back to the resolved outline colour', () => {
    expect(
      onTrack('getFeatureFillColor', { type: 'DOMAIN', fill: '#aec7e8' })
    ).toBe('#aec7e8');
    expect(
      onTrack('getFeatureFillColor', { type: 'DOMAIN', color: '#1f77b4' })
    ).toBe('#1f77b4');
    expect(onTrack('getFeatureFillColor', { type: 'DOMAIN' })).toBe('red');
  });

  it('a record shape wins over the track shape', () => {
    expect(onTrack('getShape', { type: 'DOMAIN', shape: 'diamond' })).toBe(
      'diamond'
    );
    expect(onTrack('getShape', { type: 'DOMAIN' })).toBe('circle');
  });

  it.each(['DOMAIN', 'SITE'])(
    'the %s type default applies when neither record nor track sets one',
    (type) => {
      // The expected values come from Nightingale's own type table, so this
      // fails if the type lookup is replaced by a constant fallback.
      const expected = typeTable[type];
      expect(onTrack('getFeatureColor', { type }, {})).toBe(expected.color);
      expect(onTrack('getShape', { type }, {})).toBe(expected.shape);
    }
  );

  it('the two type defaults differ, so no constant satisfies both', () => {
    expect(typeTable.SITE.color).not.toBe(typeTable.DOMAIN.color);
    expect(typeTable.SITE.shape).not.toBe(typeTable.DOMAIN.shape);
  });
});

describe("the canvas reads a record's opacity", () => {
  it('sets globalAlpha from the record, defaulting to 0.9', () => {
    // The canvas track is a class with no exported per-feature alpha helper,
    // so its source is pinned instead: the docs promise `opacity` per record
    // with a 0.9 default, and the decoder's 0..1 range check exists because
    // the canvas ignores an out-of-range alpha.
    const source = readFileSync(
      join(dirname(canvasPkgPath), 'src/nightingale-track-canvas.ts'),
      'utf8'
    );
    expect(source).toMatch(
      /ctx\.globalAlpha = \(?this\.data\[iFeature\]\.opacity \?\? 0\.9\)?;/
    );
  });
});
