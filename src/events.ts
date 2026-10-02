/**
 * Public shape of the `change` event `<protvista-uniprot>` re-exposes from its
 * Nightingale tracks.
 *
 * Nightingale tracks dispatch `change` (bubbling) for hovers, clicks and
 * zoom/pan. Before any other listener sees one, the host fills in the facts a
 * consumer needs to build its own tooltip — which track the event came from
 * (`track`) and a single spelling of the event type (`eventType`). See
 * `docs/src/content/docs/react-integration.md`.
 *
 * Pure module — types only.
 */

/** Where a `change` event came from. */
export interface ProtvistaTrackOrigin {
  /** The group id, or the standalone track's own id. */
  rowId: string;
  /**
   * The track id. `null` when the event came from a group's collapsed
   * aggregate, which draws several tracks at once — read `sourceTrackId`.
   */
  trackId: string | null;
  /**
   * The track's semantic kind after `extends` merging, or `null` when it has
   * none (always `null` for a collapsed aggregate — read `sourceKind`).
   */
  kind: string | null;
  /**
   * Id of the track that produced `detail.feature`, read from the feature's
   * source tag (`getFeatureSource`). Present whenever the feature was loaded
   * through the viewer, which is what disambiguates an item clicked in a
   * collapsed group. A collapsed graph group (line graph, coloured sequence)
   * draws a single track, so its events always name that track.
   */
  sourceTrackId?: string;
  /** Semantic kind of the track that produced `detail.feature`. */
  sourceKind?: string | null;
}

export type ProtvistaEventType = 'click' | 'mouseover' | 'mouseout' | 'reset';

/**
 * `detail` of a `change` event observed on (or above) `<protvista-uniprot>`.
 *
 * Zoom/pan events carry `display-start` / `display-end`; pointer events carry
 * `eventType`, `feature` and `track`.
 */
export interface ProtvistaChangeEventDetail<Feature = Record<string, unknown>> {
  /** Pointer event type. Always camel-cased, whichever track sent it. */
  eventType?: ProtvistaEventType;
  /**
   * @deprecated The lowercase spelling `nightingale-linegraph-track` sends.
   * The host copies it to `eventType`; read that instead.
   */
  eventtype?: ProtvistaEventType;
  /**
   * The item under the pointer. For a line graph, an object keyed by series
   * name, each value `{ position, value }`, plus `tooltipContent` on a click.
   */
  feature?: Feature & { tooltipContent?: string };
  /** Pointer position in page coordinates (`pageX`, `pageY`). */
  coords?: [number, number] | null;
  /** Highlighted range, `"start:end"`. */
  highlight?: string;
  /** First visible position after a zoom or pan. */
  'display-start'?: number;
  /** Last visible position after a zoom or pan. */
  'display-end'?: number;
  /** The Nightingale element (or sub-element) that dispatched the event. */
  target?: EventTarget;
  /** The DOM event that triggered this one. */
  parentEvent?: Event;
  /** Which track the event came from. Absent for events from outside a track. */
  track?: ProtvistaTrackOrigin;
}

export type ProtvistaChangeEvent<Feature = Record<string, unknown>> =
  CustomEvent<ProtvistaChangeEventDetail<Feature>>;
