export interface IsoformEdit {
  start: number;
  end: number;
  alternativeSequence: string;
}

export function isoformEdits(entry: any): Record<string, IsoformEdit[]> {
  const editsByIsoform: Record<string, IsoformEdit[]> = {};
  
  const altProducts = entry.comments?.find((c: any) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!altProducts) return editsByIsoform;

  const varSeqs = entry.features?.filter((f: any) => f.type === 'Alternative sequence') || [];

  altProducts.isoforms.forEach((isoform: any) => {
    const isoformId = isoform.isoformIds[0];
    editsByIsoform[isoformId] = [];

    // Skip "External" isoforms like ARF
    if (isoform.sequenceIds && !isoform.sequenceIds.includes('External')) {
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
  });

  return editsByIsoform;
}

export function buildIsoform(canonical: string, edits: IsoformEdit[]): string {
  // Sort edits descending so applying them doesn't shift upcoming indices
  const sortedEdits = [...edits].sort((a, b) => b.start - a.start);
  let sequence = canonical;

  for (const edit of sortedEdits) {
    const replacement = edit.alternativeSequence === 'Missing' ? '' : edit.alternativeSequence;
    sequence = sequence.slice(0, edit.start - 1) + replacement + sequence.slice(edit.end);
  }

  return sequence;
}

export function canonicalToIsoformMap(canonicalLength: number, edits: IsoformEdit[]) {
  const canToIso: (number | null)[] = new Array(canonicalLength + 1).fill(null);
  
  let lengthDiff = 0;
  for (const edit of edits) {
    const altLen = edit.alternativeSequence === 'Missing' ? 0 : edit.alternativeSequence.length;
    lengthDiff += altLen - (edit.end - edit.start + 1);
  }
  
  const isoToCan: (number | null)[] = new Array(canonicalLength + lengthDiff + 1).fill(null);
  
  let canPos = 1;
  let isoPos = 1;
  const sortedEdits = [...edits].sort((a, b) => a.start - b.start);
  let editIdx = 0;

  while (canPos <= canonicalLength) {
    const currentEdit = editIdx < sortedEdits.length ? sortedEdits[editIdx] : null;

    if (currentEdit && canPos >= currentEdit.start && canPos <= currentEdit.end) {
      canToIso[canPos] = null; // Deleted or replaced canonical residue has no direct mapping
      canPos++;
      
      if (canPos > currentEdit.end) {
        const altSeq = currentEdit.alternativeSequence === 'Missing' ? '' : currentEdit.alternativeSequence;
        for (let i = 0; i < altSeq.length; i++) {
          isoToCan[isoPos] = null; // Inserted isoform residues have no canonical mapping
          isoPos++;
        }
        editIdx++;
      }
    } else {
      canToIso[canPos] = isoPos;
      isoToCan[isoPos] = canPos;
      canPos++;
      isoPos++;
    }
  }

  return {
    canonicalToIsoform: (pos: number) => (pos > 0 && pos < canToIso.length ? canToIso[pos] : null),
    isoformToCanonical: (pos: number) => (pos > 0 && pos < isoToCan.length ? isoToCan[pos] : null)
  };
}
