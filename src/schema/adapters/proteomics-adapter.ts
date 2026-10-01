import type { AdapterFunction } from '../types.js';
import { renameProperties } from '../../utils/index.js';

type ProteomicsPtm = {
  name: string;
  position: number;
  sources: string[];
  dbReferences: unknown;
};

type ProteomicsFeature = {
  type?: string;
  unique?: boolean;
  ptms?: ProteomicsPtm[];
  residuesToHighlight?: unknown;
  [key: string]: unknown;
};

type ProteomicsData = {
  features: ProteomicsFeature[];
  taxid?: number;
  length?: number;
};

/**
 * `uniprot-proteomics-json`: one peptide feature per API feature.
 *
 * `type` is rewritten to `'unique' | 'non_unique'` so the `filter:` sugar can
 * split the two tracks, which would lose the API's own type
 * (`PROTEOMICS` vs `PROTEOMICS_PTM`). That value is kept as `sourceType`, and
 * the response-level `taxid` is copied onto each feature, so a consumer's
 * tooltip can still build the PTM / PeptideAtlas sections from
 * `detail.feature`. The raw response is never mutated: the same body also
 * feeds `uniprot-proteomics-ptm-json` in the default config.
 */
export const proteomicsAdapter: AdapterFunction = (raw) => {
  const data = raw as ProteomicsData;
  if (!data || data.length === 0) return [];

  return renameProperties(
    data.features.map((feature) => ({
      ...feature,
      residuesToHighlight: feature.ptms?.map((ptm) => ({
        name: ptm.name,
        position: ptm.position,
        sources: ptm.sources,
        dbReferences: ptm.dbReferences,
      })),
      sourceType: feature.type,
      taxid: data.taxid,
      category: 'PROTEOMICS',
      type: feature.unique ? 'unique' : 'non_unique',
    }))
  );
};
