import 'protvista-uniprot';
import { projectTo } from './isoforms-adapter.js';
const iso = 'P10636-8', canon = 'P10636';
const viewer = document.createElement('protvista-uniprot');
viewer.setAttribute('nostructure', '');
viewer.adapters = { 'project-to-isoform': projectTo(iso) };
viewer.viewerConfig = {
  accession: iso,
  sources: {
    canonFeatures: `https://www.ebi.ac.uk/proteins/api/features/${canon}`,
    canonEntry: `https://rest.uniprot.org/uniprotkb/${canon}.json?fields=sequence,ft_var_seq,cc_alternative_products`,
  },
  rows: [{ id: 'PROJECTED', label: 'Canonical annotations on Tau-F', tracks: [
    { id: 'repeat', label: 'Repeats (projected)', kind: 'features', filter: 'REPEAT',
      data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } },
    { id: 'region', label: 'Regions (projected)', kind: 'features', filter: 'REGION',
      data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } },
    { id: 'variant', label: 'Natural variants (projected)', kind: 'features', filter: 'VARIANT',
      data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } },
    { id: 'modres', label: 'Modified residues (projected)', kind: 'features', filter: 'MOD_RES',
      data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } },
  ] }],
};
viewer.addEventListener('protvista-error', (e) => console.log('PVERR', JSON.stringify(e.detail).slice(0, 400)));
document.body.append(viewer);
