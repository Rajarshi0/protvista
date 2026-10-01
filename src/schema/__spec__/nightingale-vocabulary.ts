/**
 * Reads the feature vocabulary out of the Nightingale packages the viewer
 * actually renders with.
 *
 * `nightingale-track`'s type table is not exported, and the package is only a
 * transitive dependency (via `nightingale-track-canvas`), so it is resolved
 * from the canvas package's own location and its shipped `src/` is imported
 * by path. That pins the page to the exact copy that draws the features, and
 * keeps these imports clear of the module mocks in `nightingale-mocks.ts`,
 * which match on package name.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  FEATURE_SHAPES,
  type NightingaleVocabulary,
} from '../feature-vocabulary.js';

const fromHere = createRequire(import.meta.url);
const canvasPkgPath = fromHere.resolve(
  '@nightingale-elements/nightingale-track-canvas/package.json'
);
const trackPkgPath = createRequire(canvasPkgPath).resolve(
  '@nightingale-elements/nightingale-track/package.json'
);
const canvasDir = dirname(canvasPkgPath);
const trackDir = dirname(trackPkgPath);

/** A type code no table will ever hold, used to probe the fallback. */
const UNRECOGNISED_TYPE = 'PROTVISTA_UNRECOGNISED_TYPE_PROBE';

/** Import a source file a Nightingale package ships, by its package dir. */
function importShipped(packageDir: string, file: string) {
  // The path is built from module resolution above, never from input, so
  // there is nothing to sanitise.
  // eslint-disable-next-line no-unsanitized/method
  return import(join(packageDir, file));
}

export async function loadNightingaleVocabulary(): Promise<NightingaleVocabulary> {
  const { version } = JSON.parse(readFileSync(trackPkgPath, 'utf8'));
  const { config } = await importShipped(trackDir, 'src/config.ts');
  const { getColorByType, getShapeByType } = await importShipped(
    trackDir,
    'src/ConfigHelper.ts'
  );
  const { shapeCategory } = await importShipped(
    canvasDir,
    'src/utils/draw-shapes.ts'
  );

  // `getColorByType` logs any type it does not recognise; the probe is
  // expected to miss, so keep it out of the test output.
  const log = console.log;
  console.log = () => {};
  let fallback: NightingaleVocabulary['fallback'];
  try {
    fallback = {
      color: getColorByType(UNRECOGNISED_TYPE),
      shape: getShapeByType(UNRECOGNISED_TYPE),
    };
  } finally {
    console.log = log;
  }

  return {
    version,
    types: config,
    shapeCategories: Object.fromEntries(
      FEATURE_SHAPES.map((s) => [s, shapeCategory(s)])
    ),
    fallback,
  };
}
