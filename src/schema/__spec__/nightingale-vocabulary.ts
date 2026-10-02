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
  type ShapeCategory,
  type ShapeDrawings,
} from '../feature-vocabulary.js';
import { CanvasSvgRecorder } from './canvas-svg-recorder.js';

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

/**
 * Read a numeric constant the canvas track keeps module-private
 * (`const SYMBOL_SIZE = 10;`, `const SYMBOL_RADIUS = 0.5 * SYMBOL_SIZE;`).
 */
function canvasConstant(source: string, name: string): number {
  const m = new RegExp(`^const ${name} = (.+);$`, 'm').exec(source);
  if (!m) {
    throw new Error(
      `nightingale-track-canvas no longer declares \`const ${name}\` — update canvasConstant()`
    );
  }
  // Only literals, references to other constants, and `*` occur today; any
  // other form is a change worth a look, so it throws rather than guesses.
  const factors = m[1].split('*').map((f) => f.trim());
  return factors.reduce((product, factor) => {
    if (/^\d+(?:\.\d+)?$/.test(factor)) return product * Number(factor);
    if (/^[A-Z_]+$/.test(factor))
      return product * canvasConstant(source, factor);
    throw new Error(`Unexpected value for ${name}: ${m[1]}`);
  }, 1);
}

/** The drawing area each shape is drawn on, in canvas pixels. */
const DRAWING = {
  /** Residues a range shape spans. */
  residues: 6,
  baseWidth: 8,
  featureHeight: 12,
  margin: 2,
} as const;

/** The parts of the canvas track's `src/utils/draw-shapes.ts` used here. */
interface DrawShapes {
  shapeCategory(shape: string): ShapeCategory;
  drawRange(
    ctx: CanvasRenderingContext2D,
    shape: string,
    x: number,
    y: number,
    width: number,
    height: number,
    optXPadding: number,
    fragmentLength: number
  ): boolean;
  drawSymbol(
    ctx: CanvasRenderingContext2D,
    shape: string,
    cx: number,
    cy: number,
    r: number
  ): boolean;
  drawUnknown(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number
  ): void;
}

/**
 * Draw every shape with the canvas track's own drawers, following the
 * per-feature branch in `NightingaleTrackCanvas.drawCanvasContent()`: a
 * range shape stretches across the feature, anything else is a symbol
 * centred on a single residue, and a shape with no drawer is a question mark.
 */
function drawShapes(
  { drawRange, drawSymbol, drawUnknown }: DrawShapes,
  canvasSource: string
): ShapeDrawings {
  const symbolRadius = canvasConstant(canvasSource, 'SYMBOL_RADIUS');
  const lineWidth = canvasConstant(canvasSource, 'LINE_WIDTH');
  const { residues, baseWidth, featureHeight: height, margin } = DRAWING;
  const rangeWidth = residues * baseWidth;
  const optXPadding = Math.min(1.5, 0.25 * baseWidth);
  const x = margin;
  const y = margin;

  const shapes = Object.fromEntries(
    FEATURE_SHAPES.map((shape) => {
      const ctx = new CanvasSvgRecorder();
      const canvas = ctx as unknown as CanvasRenderingContext2D;
      ctx.lineWidth = lineWidth;
      const drawn = drawRange(
        canvas,
        shape,
        x,
        y,
        rangeWidth,
        height,
        optXPadding,
        residues
      );
      if (!drawn) {
        const cx = x + 0.5 * rangeWidth;
        const cy = y + 0.5 * height;
        if (!drawSymbol(canvas, shape, cx, cy, symbolRadius)) {
          drawUnknown(canvas, cx, cy, symbolRadius);
        }
      }
      return [shape, ctx.toSvg()];
    })
  );
  return {
    width: rangeWidth + 2 * margin,
    height: height + 2 * margin,
    shapes,
  };
}

export async function loadNightingaleVocabulary(): Promise<NightingaleVocabulary> {
  const { version } = JSON.parse(readFileSync(trackPkgPath, 'utf8'));
  const { config } = await importShipped(trackDir, 'src/config.ts');
  const { getColorByType, getShapeByType } = await importShipped(
    trackDir,
    'src/ConfigHelper.ts'
  );
  const drawShapesModule: DrawShapes = await importShipped(
    canvasDir,
    'src/utils/draw-shapes.ts'
  );
  const canvasSource = readFileSync(
    join(canvasDir, 'src/nightingale-track-canvas.ts'),
    'utf8'
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
      FEATURE_SHAPES.map((s) => [s, drawShapesModule.shapeCategory(s)])
    ),
    shapeDrawings: drawShapes(drawShapesModule, canvasSource),
    fallback,
  };
}
