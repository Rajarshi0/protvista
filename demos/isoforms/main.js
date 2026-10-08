import '../../src/index.js';
import { uniprotIsoforms, projectTo } from './isoforms-adapter.js';

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('data:image')) {
        node.textContent = '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.querySelectorAll('*').forEach(el => {
          if (el.textContent && el.textContent.includes('data:image') && el.children.length === 0) {
            el.textContent = '';
          }
        });
      }
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });

const bioCheck = document.createElement('div');
bioCheck.style.cssText = "background: #eef5fa; padding: 15px; border-left: 4px solid #0053d6; margin-bottom: 20px; border-radius: 4px;";
bioCheck.innerHTML = `
    <h3 style="margin-top: 0;">Biology Check: What is an Isoform?</h3>
    <p style="margin-bottom: 0;">Most human proteins have multiple variants, or <strong>isoforms</strong>, created by alternative splicing. 
    Positions often differ between the canonical sequence and specific isoforms due to missing or altered residues.</p>
`;
document.body.prepend(bioCheck);

const urlParams = new URLSearchParams(window.location.search);
const iso = urlParams.get('acc') || 'P10636-8';
const canon = iso.includes('-') ? iso.split('-')[0] : iso;

const viewer = document.createElement('protvista-uniprot');
viewer.setAttribute('nostructure', '');
viewer.adapters = { 
  'uniprot-isoforms': uniprotIsoforms,
  'project-to-isoform': projectTo(iso)
};

viewer.viewerConfig = {
  accession: iso,
  sources: {
    canonFeatures: `https://www.ebi.ac.uk/proteins/api/features/${canon}`,
    canonEntry: `https://rest.uniprot.org/uniprotkb/${canon}.json?fields=sequence,ft_var_seq,cc_alternative_products`,
  },
  rows: [
    { 
      id: 'ISOFORMS', 
      label: 'Isoform Overview', 
      tracks: [
        { 
          id: 'isoforms', 
          label: 'Isoforms (canonical coordinates)', 
          kind: 'features',
          data: { source: 'canonEntry', adapter: 'uniprot-isoforms' }
        },
      ] 
    },
    { 
      id: 'PROJECTED', 
      label: `Canonical annotations projected on ${iso}`, 
      tracks: [
        { 
          id: 'repeat', 
          label: 'Repeats (projected)', 
          kind: 'features', 
          filter: 'REPEAT',
          data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' }
        },
        { 
          id: 'region', 
          label: 'Regions (projected)', 
          kind: 'features', 
          filter: 'REGION',
          data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' }
        },
        { 
          id: 'variant', 
          label: 'Natural variants (projected)', 
          kind: 'features', 
          filter: 'VARIANT',
          data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' }
        },
        { 
          id: 'modres', 
          label: 'Modified residues (projected)', 
          kind: 'features', 
          filter: 'MOD_RES',
          data: { source: ['canonFeatures', 'canonEntry'], adapter: 'project-to-isoform' }
        }
      ] 
    },
  ],
};

viewer.addEventListener('protvista-error', (e) => console.log('PVERR', JSON.stringify(e.detail).slice(0, 400)));
document.body.append(viewer);
window.__viewer = viewer;
