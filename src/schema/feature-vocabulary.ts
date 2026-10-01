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
 * Nightingale doesn't declare; `EVERY_SHAPE_LISTED` below rejects one it
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

/**
 * SVG markup for each shape, recorded from the canvas track's own drawers
 * on a `width` × `height` drawing area.
 */
export interface ShapeDrawings {
  readonly width: number;
  readonly height: number;
  readonly shapes: Readonly<Record<string, string>>;
}

/** Everything the vocabulary page is rendered from. */
export interface NightingaleVocabulary {
  /** The nightingale-track version the table was read from. */
  readonly version: string;
  /** `config`, keyed by type code, in Nightingale's order. */
  readonly types: Readonly<Record<string, NightingaleTypeDoc>>;
  /** The canvas renderer's category for each of `FEATURE_SHAPES`. */
  readonly shapeCategories: Readonly<Record<string, ShapeCategory>>;
  /** Each of `FEATURE_SHAPES` as the canvas track draws it. */
  readonly shapeDrawings: ShapeDrawings;
  /** What an unrecognised `type` gets. */
  readonly fallback: { readonly color: string; readonly shape: string };
}

/** The CSS named colours (CSS Color 4), plus the two special keywords. */
const CSS_COLOR_KEYWORDS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
  'transparent',
  'currentcolor',
]);

/**
 * Whether a default colour is one a browser will paint: a hex colour, a CSS
 * colour keyword, or an `rgb()`/`hsl()` function (accepted on its form).
 * Anything else — `#catFace`, a misspelt keyword — is ignored by the canvas,
 * which keeps painting with the previous colour.
 */
export function isPaintableColor(value: string): boolean {
  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
    CSS_COLOR_KEYWORDS.has(value.toLowerCase()) ||
    /^(?:rgba?|hsla?)\([^()]*\)$/i.test(value)
  );
}
