import 'protvista-uniprot';
import { projectTo } from './isoforms-adapter.js';

const iso = 'P10636-8';
const canon = 'P10636';

// Wraps projectTo to dynamically update track labels with dropped counts
const baseAdapter = projectTo(iso);
const trackingAdapter = (featuresBody, entry) => {
  const projected = baseAdapter(featuresBody, entry);
  const feats = featuresBody?.features || featuresBody || [];
  
  if (feats.length > 0 && projected._droppedCount !== undefined) {
    const type = feats[0].type.toLowerCase().replace('_', '');
    const trackId = type === 'modres' ? 'modres-track' : `${type}-track`;
    const trackEl = document.querySelector(`protvista-track[id="${trackId}"]`);
    if (trackEl && trackEl.parentElement && trackEl.parentElement.label) {
       const base = trackEl.parentElement.label.split(' (')[0];
       const total = projected.length + projected._droppedCount;
       trackEl.parentElement.label = `${base} (projected; ${projected._droppedCount} of ${total} dropped)`;
    }
  }
  return projected;
};

const viewer = document.createElement('protvista-uniprot');
viewer.setAttribute('nostructure', '');
viewer.adapters = { 'project-to-isoform': trackingAdapter };

viewer.viewerConfig = {
  accession: iso,
  sources: {
    canonFeatures: `https://www.ebi.ac.uk/proteins/api/features/${canon}`,
    canonEntry: `https://rest.uniprot.org/uniprotkb/${canon}.json?fields=sequence,ft_var_seq,cc_alternative_products`,
  },
  rows: [{ 
    id: 'PROJECTED', 
    label: 'Canonical annotations on Tau-F', 
    tracks: [
      { id: 'repeat-track', label: 'Repeats (projected)', kind: 'features', filter: 'REPEAT',
        data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } },
      { id: 'region-track', label: 'Regions (projected)', kind: 'features', filter: 'REGION',
        data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } },
      { id: 'variant-track', label: 'Natural variants (projected)', kind: 'features', filter: 'VARIANT',
        data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } },
      { id: 'modres-track', label: 'Modified residues (projected)', kind: 'features', filter: 'MOD_RES',
        data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' } }
    ] 
  }],
};

document.body.append(viewer);
