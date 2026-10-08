export const isoformEdits = (entry: any): Record<string, any[]> => {
  const editsByIsoform: Record<string, any[]> = {};
  const altProducts = entry.comments?.find((c: any) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!altProducts) return editsByIsoform;

  const varSeqs = entry.features?.filter((f: any) => f.type === 'Alternative sequence') || [];

  altProducts.isoforms.forEach((isoform: any) => {
    const isoformId = isoform.isoformIds[0];
    editsByIsoform[isoformId] = [];

    if (isoform.isoformSequenceStatus !== 'External') {
      if (isoform.sequenceIds) {
        isoform.sequenceIds.forEach((seqId: string) => {
          const feature = varSeqs.find((f: any) => f.featureId === seqId);
          if (feature) {
            editsByIsoform[isoformId].push({
              start: feature.location.start.value,
              end: feature.location.end.value,
              alternativeSequence: feature.alternativeSequence || 'Missing',
            });
          }
        });
      }
    }
  });
  return editsByIsoform;
};

export const uniprotIsoformsAdapter = (data: any) => {
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || !entry.sequence) return [];

  const canonicalLength = entry.sequence.length;
  const altProducts = entry.comments?.find((c: any) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!altProducts) return [];

  const editsMap = isoformEdits(entry);
  const features: any[] = [];

  altProducts.isoforms.forEach((isoform: any) => {
    const isoformId = isoform.isoformIds[0];
    
    // The correct Uniprot API check for External isoforms
    if (isoform.isoformSequenceStatus === 'External') return;

    const isCanonical = isoform.isoformSequenceStatus === "Displayed";
    const edits = editsMap[isoformId] || [];
    let tooltipNotes: string[] = [];
    let missingRegions: {start: number, end: number}[] = [];

    edits.forEach((edit: any) => {
      if (edit.alternativeSequence === 'Missing') {
        tooltipNotes.push(`${edit.start}-${edit.end}: missing`);
        missingRegions.push({ start: edit.start, end: edit.end });
      } else {
        tooltipNotes.push(`${edit.start}: changed to ${edit.alternativeSequence}`);
      }
    });

    missingRegions.sort((a: any, b: any) => a.start - b.start);
    const fragments: any[] = [];
    let currentStart = 1;

    missingRegions.forEach((reg: any) => {
      if (reg.start > currentStart) {
        fragments.push({ start: currentStart, end: reg.start - 1 });
      }
      currentStart = reg.end + 1;
    });
    
    if (currentStart <= canonicalLength) {
      fragments.push({ start: currentStart, end: canonicalLength });
    }

    const description = isCanonical
      ? "Canonical"
      : `${isoformId}: ` + (tooltipNotes.length > 0 ? tooltipNotes.join("; ") : "No explicit edits");

    features.push({
      accession: isoformId,
      description: description,
      locations: [{ fragments: fragments }],
      color: isCanonical ? "#0053d6" : "#888888"
    });
  });

  return features;
};
