/**
 * Where a rendered feature came from.
 *
 * A collapsed group hands Nightingale one flattened array built from every
 * feeding track, so by the time a `change` event carries `detail.feature` the
 * item no longer says which track produced it. The loader tags every item it
 * annotates with its source track and semantic kind under {@link PV_SOURCE},
 * and the host's `change` listener lifts that tag onto
 * `detail.track.sourceTrackId` / `detail.track.sourceKind`.
 *
 * The tag is a non-enumerable, symbol-keyed property: invisible to
 * `Object.keys`, `JSON.stringify`, object spread and snapshot serialisers, so
 * it never reaches Nightingale's rendering or a consumer's serialised data.
 * `Symbol.for` keeps it stable across duplicated bundles.
 *
 * Pure module — no DOM, no element imports.
 */

/** Symbol key of the source tag. Read it with {@link getFeatureSource}. */
export const PV_SOURCE: unique symbol = Symbol.for(
  'protvista-uniprot.source'
) as never;

export interface FeatureSource {
  /** Id of the track whose data produced the item. */
  trackId: string;
  /** The track's semantic kind after `extends` merging, or `null` if it has none. */
  kind: string | null;
}

/**
 * The source tag of a feature taken from `detail.feature` or a track's data,
 * or `undefined` for untagged values (non-objects, data built outside the
 * loader).
 */
export function getFeatureSource(feature: unknown): FeatureSource | undefined {
  if (!feature || typeof feature !== 'object') return undefined;
  return (feature as { [PV_SOURCE]?: FeatureSource })[PV_SOURCE];
}

/**
 * A shallow copy of `item` carrying `source` under {@link PV_SOURCE}. Copies
 * rather than tagging in place so adapter output and `setTrackData()` input are
 * never mutated.
 */
export function withFeatureSource<T extends object>(
  item: T,
  source: FeatureSource
): T {
  const copy = { ...item };
  Object.defineProperty(copy, PV_SOURCE, {
    value: source,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return copy;
}
