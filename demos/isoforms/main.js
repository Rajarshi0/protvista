import 'protvista-uniprot';
import { uniprotIsoforms } from './isoforms-adapter.js';
const acc = new URLSearchParams(location.search).get('acc') || 'P05067';
const viewer = document.createElement('protvista-uniprot');
viewer.setAttribute('nostructure', '');
viewer.adapters = { 'uniprot-isoforms': uniprotIsoforms };
viewer.viewerConfig = {
  accession: acc,
  sources: {
    features: 'https://www.ebi.ac.uk/proteins/api/features/{accession}',
    uniprotEntry: 'https://rest.uniprot.org/uniprotkb/{accession}.json?fields=sequence,ft_var_seq,cc_alternative_products',
  },
  rows: [
    { id: 'ISOFORMS', label: 'Isoforms', tracks: [
      { id: 'isoforms', label: 'Isoforms (canonical coordinates)', kind: 'features',
        data: { source: 'uniprotEntry', adapter: 'uniprot-isoforms' },
        rendering: { layout: 'non-overlapping', height: 160 } },
      { id: 'splice', label: 'Splice variant (VAR_SEQ)', kind: 'features', filter: 'VAR_SEQ', data: 'features',
        rendering: { layout: 'non-overlapping', height: 110 } },
    ] },
    { id: 'DOMAINS', label: 'Domains', tracks: [
      { id: 'domain', kind: 'features', filter: 'DOMAIN', data: 'features' } ] },
  ],
};
viewer.addEventListener('protvista-error', (e) => console.log('PVERR', JSON.stringify(e.detail).slice(0, 300)));
document.body.append(viewer);
window.__viewer = viewer;
