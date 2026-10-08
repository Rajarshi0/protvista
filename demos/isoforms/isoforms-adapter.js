// Escape-hatch adapter: UniProt REST entry JSON -> one feature per isoform (canonical coordinates).
export function isoformEdits(entry) {
  const ap = (entry.comments || []).find((c) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!ap) return [];
  const vsp = new Map((entry.features || []).filter((f) => f.type === 'Alternative sequence')
    .map((f) => [f.featureId, { start: f.location.start.value, end: f.location.end.value,
      orig: f.alternativeSequence?.originalSequence ?? '', alt: f.alternativeSequence?.alternativeSequences?.[0] ?? '' }]));
  return ap.isoforms.map((iso) => ({
    id: iso.isoformIds[0], name: iso.name?.value, status: iso.isoformSequenceStatus,
    edits: (iso.sequenceIds || []).map((v) => vsp.get(v)).filter(Boolean).sort((a, b) => a.start - b.start),
  }));
}
export function uniprotIsoforms(entry) {
  const L = entry.sequence.length;
  const out = [];
  for (const iso of isoformEdits(entry)) {
    if (iso.status === 'Displayed' || iso.status === 'External') continue;
    const frags = []; let c = 1;
    for (const e of iso.edits) { if (c < e.start) frags.push({ start: c, end: e.start - 1 }); c = e.end + 1; }
    if (c <= L) frags.push({ start: c, end: L });
    const changes = iso.edits.map((e) => `${e.start}-${e.end}: ${e.alt ? (e.orig.length > 12 ? e.orig.slice(0, 10) + '…' : e.orig) + ' → ' + (e.alt.length > 12 ? e.alt.slice(0, 10) + '…' : e.alt) : 'missing'}`).join('; ');
    out.push({ type: 'VAR_SEQ', start: 1, end: L, locations: [{ fragments: frags }],
      color: '#777777', description: `${iso.id} (${iso.name}): ${changes}`, isoform: iso.id });
  }
  return out;
}

// Gold-lite: project canonical Proteins-API features onto one isoform.
export function canonicalToIsoformMap(entry, isoformId) {
  const iso = isoformEdits(entry).find((i) => i.id === isoformId);
  const L = entry.sequence.length;
  const map = new Array(L + 1).fill(null);
  let c = 1, p = 0;
  for (const e of iso.edits) { while (c < e.start) map[c++] = ++p; p += e.alt.length; c = e.end + 1; }
  while (c <= L) map[c++] = ++p;
  return map;
}
export const projectTo = (isoformId) => (featuresResponse, entry) => {
  const map = canonicalToIsoformMap(entry, isoformId);
  const out = [];
  for (const f of featuresResponse.features) {
    const b = Number(f.begin), e = Number(f.end);
    if (!Number.isFinite(b) || !Number.isFinite(e)) continue;
    const kept = [];
    for (let c = b; c <= e; c++) if (map[c] != null) kept.push(map[c]);
    if (kept.length === 0) continue; // lost in this isoform
    const partial = kept.length < e - b + 1;
    out.push({ type: f.type, start: Math.min(...kept), end: Math.max(...kept),
      description: `${f.description ?? ''} [canonical ${b}-${e}${partial ? '; partly lost in ' + isoformId : ''}]` });
  }
  return out;
};
