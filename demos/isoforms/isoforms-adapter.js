export function isoformEdits(entry) {
  const comment = (entry.comments || []).find((c) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!comment) return {};
  
  const vspMap = new Map(
    (entry.features || [])
      .filter((f) => f.type === 'Alternative sequence')
      .map((f) => [f.featureId, f])
  );

  const edits = {};
  for (const isoform of comment.isoforms) {
    const id = isoform.isoformIds[0];
    edits[id] = (isoform.sequenceIds || [])
      .map((seqId) => vspMap.get(seqId))
      .filter(Boolean);
  }
  return edits;
}

export function uniprotIsoforms(entry) {
  const comment = (entry.comments || []).find((c) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!comment) return [];
  
  const editsMap = isoformEdits(entry);
  const canonLength = entry.sequence?.length || 0;

  return comment.isoforms.map((isoform) => {
    const id = isoform.isoformIds[0];
    const isCanonical = isoform.isoformSequenceStatus === 'Displayed';
    const edits = editsMap[id] || [];

    const missing = edits.filter((e) => !e.alternativeSequence);
    missing.sort((a, b) => a.location.start.value - b.location.start.value);

    let current = 1;
    const fragments = [];
    for (const m of missing) {
      const start = m.location.start.value;
      const end = m.location.end.value;
      if (start > current) fragments.push({ start: current, end: start - 1 });
      current = end + 1;
    }
    if (current <= canonLength) fragments.push({ start: current, end: canonLength });

    return {
      accession: id,
      type: 'CHAIN',
      begin: 1,
      end: canonLength,
      description: isCanonical ? 'Canonical' : `${id}`,
      color: isCanonical ? '#0053d6' : '#888888',
      locations: [{ fragments }],
    };
  });
}

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

  const projected = [];
  for (const feat of features) {
    const newLocations = [];
    for (const loc of (feat.locations || [])) {
      const newFragments = [];
      for (const frag of (loc.fragments || [])) {
        const start = mapCoord(frag.start);
        const end = mapCoord(frag.end);
        if (start !== null && end !== null) {
          newFragments.push({ ...frag, start: Math.min(start, end), end: Math.max(start, end) });
        }
      }
      if (newFragments.length > 0) {
        newLocations.push({ ...loc, fragments: newFragments });
      }
    }

    if (newLocations.length > 0) {
      projected.push({
        type: feat.type || 'REGION',
        category: feat.category || 'DOMAIN_REGION',
        description: feat.description || '',
        begin: feat.begin,
        end: feat.end,
        locations: newLocations,
      });
    }
  }

  return projected;
}

export function projectTo(isoformId) {
  return function (data) {
    let features = [];
    let entry = {};
    
    if (Array.isArray(data)) {
      const rawFeats = data[0];
      features = Array.isArray(rawFeats) ? rawFeats : rawFeats.features || [];
      entry = data[1] || {};
    } else {
      features = data.features || [];
      entry = data.entry || data;
    }

    return projectFeatures(features, entry, isoformId);
  };
}

export function projectToIsoformAdapter(data, options = {}) {
  const isoformId = options.isoformId || 'P10636-8';
  return projectTo(isoformId)(data);
}
