export const uniprotIsoforms = (entry) => {
  // Extract the actual entry from Nightingale's wrapper
  const data = Array.isArray(entry) ? entry[0] : entry;
  if (!data || !data.sequence) return [];

  const canonicalLength = data.sequence.length;
  const altProducts = data.comments?.find(c => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!altProducts) return [];

  const varSeqs = data.features?.filter(f => f.type === 'Alternative sequence') || [];
  const features = [];

  altProducts.isoforms.forEach(isoform => {
    const isoformId = isoform.isoformIds[0];
    
    // Requirement: Skip "External" isoforms like ARF in CDKN2A
    if (isoform.sequenceIds && isoform.sequenceIds.includes('External')) return; 

    const isCanonical = isoform.isoformSequenceStatus === "Displayed";
    let tooltipNotes = [];
    let missingRegions = []; // Store deletions to create visual gaps

    if (isoform.sequenceIds) {
      isoform.sequenceIds.forEach(seqId => {
        const f = varSeqs.find(v => v.featureId === seqId);
        if (f) {
          const start = f.location.start.value;
          const end = f.location.end.value;
          const altSeq = f.alternativeSequence;
          
          if (altSeq) {
            tooltipNotes.push(`${start}: changed to ${altSeq}`);
          } else {
            tooltipNotes.push(`${start}-${end}: missing`);
            missingRegions.push({start, end});
          }
        }
      });
    }

    // Sort missing regions to properly slice the sequence bar
    missingRegions.sort((a, b) => a.start - b.start);
    const fragments = [];
    let currentStart = 1;

    missingRegions.forEach(reg => {
      if (reg.start > currentStart) {
        fragments.push({ start: currentStart, end: reg.start - 1 });
      }
      currentStart = reg.end + 1; // Jump over the missing region
    });
    // Add the final fragment if there's sequence left after the last deletion
    if (currentStart <= canonicalLength) {
      fragments.push({ start: currentStart, end: canonicalLength });
    }

    const description = isCanonical 
        ? "Canonical" 
        : `${isoformId}: ` + (tooltipNotes.length > 0 ? tooltipNotes.join("; ") : "No explicit edits");

    // Nightingale expects segmented features to be inside locations > fragments
    features.push({
      accession: isoformId,
      description: description,
      locations: [{ fragments: fragments }],
      color: isCanonical ? "#0053d6" : "#888888" // Canonical is blue, variants are grey
    });
  });

  return features;
};
