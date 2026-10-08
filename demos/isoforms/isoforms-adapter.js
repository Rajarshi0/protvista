export function isoformEdits(entry) {
  const ap = (entry.comments || []).find((c) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!ap) return {};
  const vsp = new Map((entry.features || []).filter((f) => f.type === 'Alternative sequence').map((f) => [f.featureId, f]));
  const edits = {};
  for (const isoform of ap.isoforms) {
    const id = isoform.isoformIds[0];
    edits[id] = (isoform.sequenceIds || []).map((id) => vsp.get(id)).filter(Boolean);
  }
  return edits;
}

export function uniprotIsoforms(entry) {
  const ap = (entry.comments || []).find((c) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!ap) return [];
  const editsMap = isoformEdits(entry);
  const canonLen = entry.sequence?.length || 0;
  
  return ap.isoforms.map((isoform) => {
    const id = isoform.isoformIds[0];
    const isCanon = isoform.isoformSequenceStatus === 'Displayed';
    const edits = editsMap[id] || [];
    
    const missing = edits.filter((e) => !e.alternativeSequence);
    missing.sort((a, b) => a.location.start.value - b.location.start.value);
    
    let cur = 1;
    const fragments = [];
    for (const m of missing) {
      const start = m.location.start.value;
      const end = m.location.end.value;
      if (start > cur) fragments.push({ start: cur, end: start - 1 });
      cur = end + 1;
    }
    if (cur <= canonLen) fragments.push({ start: cur, end: canonLen });
    
    const notes = edits.map((e) => {
      const s = e.location.start.value;
      const alt = e.alternativeSequence;
      return alt ? `${s}: ${alt}` : `${s}-${e.location.end.value}: missing`;
    });

    return {
      accession: id,
      description: isCanon ? 'Canonical' : `${id}: ${notes.join('; ') || 'No edits'}`,
      color: isCanon ? '#0053d6' : '#888888',
      locations: [{ fragments }],
    };
  });
}

/**
 * Milestone 3: project canonical features onto a specific target isoform
 */
export function projectFeatures(features, entry, isoformId) {
  const editsMap = isoformEdits(entry);
  const edits = editsMap[isoformId] || [];
  const missingRegions = edits
    .filter((e) => !e.alternativeSequence)
    .map((e) => ({ start: e.location.start.value, end: e.location.end.value }))
    .sort((a, b) => a.start - b.start);

  const mapCoord = (coord) => {
    let offset = 0;
    for (const reg of missingRegions) {
      if (coord >= reg.start && coord <= reg.end) return null;
      if (coord > reg.end) offset += reg.end - reg.start + 1;
    }
    return coord - offset;
  };

  let droppedCount = 0;
  const projected = [];

  features.forEach((feat) => {
    const newLocs = (feat.locations || []).map((loc) => {
      const newFrags = (loc.fragments || []).map((frag) => {
        const start = mapCoord(frag.start);
        const end = mapCoord(frag.end);
        if (start === null || end === null) return null;
        return { ...frag, start, end };
      }).filter(Boolean);
      return { ...loc, fragments: newFrags };
    }).filter((loc) => loc.fragments.length > 0);

    if (newLocs.length === 0) {
      droppedCount++;
    } else {
      projected.push({ ...feat, locations: newLocs });
    }
  });

  return { projected, droppedCount };
}

export function projectToIsoformAdapter(data, options = {}) {
  const features = Array.isArray(data) ? data[0] : data.features || [];
  const entry = Array.isArray(data) ? data[1] : data.entry || data;
  const isoformId = options.isoformId || 'P10636-8';
  const { projected } = projectFeatures(features, entry, isoformId);
  return projected;
}
