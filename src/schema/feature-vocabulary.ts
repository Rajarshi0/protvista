/**
 * The feature `type` and `rendering.shape` vocabulary, as drawn by
 * Nightingale.
 *
 * The per-type defaults (colour, shape, label) live in
 * `@nightingale-elements/nightingale-track`'s `config`, which its package
 * does not export. The drift spec reads that table from the copy
 * `nightingale-track-canvas` actually renders with and hands it to
 * `renderFeatureVocabularyMarkdown()`; this module holds only what
 * Nightingale exposes as a type, not a value — the shape names.
 */

import type { Shapes } from '@nightingale-elements/nightingale-track-canvas';

/**
 * Every glyph name Nightingale's `Shapes` type declares, in its order. The
 * spellings (`discontinuos*`) are Nightingale's. `satisfies` rejects a name
 * Nightingale doesn't declare; `EveryShapeListed` below rejects one it
 * declares but this list omits — so an upstream change fails `tsc`.
 */
export const FEATURE_SHAPES = [
  'rectangle',
  'roundRectangle',
  'bridge',
  'line',
  'diamond',
  'chevron',
  'catFace',
  'triangle',
  'wave',
  'hexagon',
  'pentagon',
  'circle',
  'arrow',
  'doubleBar',
  'discontinuosStart',
  'discontinuos',
  'discontinuosEnd',
  'helix',
  'strand',
  'leftEndedTag',
  'rightEndedTag',
  'doubleEndedTag',
] as const satisfies readonly Shapes[];

type UnlistedShape = Exclude<Shapes, (typeof FEATURE_SHAPES)[number]>;
/** Fails to compile while a Nightingale shape is missing from the list. */
export const EVERY_SHAPE_LISTED: [UnlistedShape] extends [never]
  ? true
  : UnlistedShape = true;

/** How the canvas track draws a shape (`shapeCategory()` upstream). */
export type ShapeCategory = 'range' | 'symbol' | 'unknown';

/** One entry of nightingale-track's `config` table. */
export interface NightingaleTypeDoc {
  readonly name: string;
  readonly label: string;
  readonly tooltip: string;
  readonly shape: string;
  readonly color: string;
}

/** Everything the vocabulary page is rendered from. */
export interface NightingaleVocabulary {
  /** The nightingale-track version the table was read from. */
  readonly version: string;
  /** `config`, keyed by type code, in Nightingale's order. */
  readonly types: Readonly<Record<string, NightingaleTypeDoc>>;
  /** The canvas renderer's category for each of `FEATURE_SHAPES`. */
  readonly shapeCategories: Readonly<Record<string, ShapeCategory>>;
  /** What an unrecognised `type` gets. */
  readonly fallback: { readonly color: string; readonly shape: string };
}

/**
 * Whether a default colour is one a browser will paint. Nightingale's table
 * uses `#rrggbb` and bare keywords (`black`); a keyword is accepted on its
 * form alone.
 */
export function isPaintableColor(value: string): boolean {
  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
    /^[a-z]+$/i.test(value)
  );
}
