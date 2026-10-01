export { default as filterConfig, colorConfig } from './filter-config.js';
export { default as ProtvistaUniprotStructure } from './protvista-uniprot-structure.js';
export type { ProcessedStructureData } from './protvista-uniprot-structure.js';
export type { AdapterFunction, ProtvistaViewerConfig } from './schema/types.js';
export type { TooltipSpec } from './tooltips/types.js';
export type {
  ProtvistaChangeEvent,
  ProtvistaChangeEventDetail,
  ProtvistaEventType,
  ProtvistaTrackOrigin,
} from './events.js';
export {
  PV_SOURCE,
  getFeatureSource,
  type FeatureSource,
} from './feature-source.js';
import ProtvistaUniprot from './protvista-uniprot.js';
export default ProtvistaUniprot;
