/**
 * `<protvista-uniprot-structure>` on its own, published as the
 * `protvista-uniprot/structure` subpath.
 *
 * Importing the package root defines the whole viewer. A page that only shows
 * the structure panel imports this instead, which defines
 * `<protvista-uniprot-structure>` (and the structure viewer and datatable it
 * renders) without `<protvista-uniprot>` and its tracks.
 * `src/__spec__/config-subpath-purity.spec.ts` checks that this entry never
 * reaches the viewer element.
 */
export { default } from './protvista-uniprot-structure.js';
export type { ProcessedStructureData } from './protvista-uniprot-structure.js';
