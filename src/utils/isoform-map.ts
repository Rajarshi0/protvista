export interface IsoformEdit {
  featureId: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
}

export interface Isoform {
  id: string;
  name: string;
  status: 'Displayed' | 'Described' | 'External' | 'Not described';
  canonical: boolean;
  external: boolean;
  edits: IsoformEdit[];
  unresolved: string[];
}

export interface PositionMap {
  canonicalToIsoform: (pos: number) => number | null;
  isoformToCanonical: (pos: number) => number | null;
  isoformLength: number;
}

export function isoformEdits(entry: any): Isoform[] {
  const comment = (entry.comments || []).find((c: any) => c.commentType === 'ALTERNATIVE PRODUCTS');
  if (!comment) return [];

  const vspMap = new Map<string, any>(
    (entry.features || [])
      .filter((f: any) => f.type === 'Alternative sequence')
      .map((f: any) => [f.featureId, f])
  );

  return comment.isoforms.map((isoform: any) => {
    const id = isoform.isoformIds[0];
    const status = isoform.isoformSequenceStatus;
    const external = status === 'External';
    const canonical = status === 'Displayed';
    const name = isoform.name?.value || isoform.name || '';

    const edits: IsoformEdit[] = [];
    const unresolved: string[] = [];

    if (!external && isoform.sequenceIds) {
      for (const seqId of isoform.sequenceIds) {
        const feature = vspMap.get(seqId);
        if (feature) {
          const start = feature.location.start.value;
          const end = feature.location.end.value;
          // FIX: originalSequence lives inside alternativeSequence!
          const original = feature.alternativeSequence?.originalSequence ?? '';
          const replacement = feature.alternativeSequence?.alternativeSequences?.[0] ?? '';
          edits.push({ featureId: seqId, start, end, original, replacement });
        } else {
          unresolved.push(seqId);
        }
      }
    }

    edits.sort((a, b) => a.start - b.start);
    return { id, name, status, canonical, external, edits, unresolved };
  });
}

export function buildIsoform(canonical: string, edits: IsoformEdit[]): string {
  let result = canonical;
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (const edit of sorted) {
    const prefix = result.slice(0, edit.start - 1);
    const suffix = result.slice(edit.end);
    result = prefix + edit.replacement + suffix;
  }
  return result;
}

export function canonicalToIsoformMap(
  canonicalLength: number,
  edits: IsoformEdit[]
): PositionMap {
  const canToIso: Array<number | null> = [null];
  const isoToCan: Array<number | null> = [null];
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let next = 0;
  let pos = 1;
  while (pos <= canonicalLength) {
    const edit = sorted[next];
    if (edit && pos === edit.start) {
      for (; pos <= edit.end; pos += 1) canToIso.push(null);
      for (let i = 0; i < edit.replacement.length; i += 1) isoToCan.push(null);
      next += 1;
    } else {
      canToIso.push(isoToCan.length);
      isoToCan.push(pos);
      pos += 1;
    }
  }
  const lookup = (table: Array<number | null>) => (p: number) =>
    Number.isInteger(p) && p > 0 && p < table.length ? table[p] : null;
  return {
    canonicalToIsoform: lookup(canToIso),
    isoformToCanonical: lookup(isoToCan),
    isoformLength: isoToCan.length - 1,
  };
}

export function isoformPositionMap(entry: any, isoformId: string): PositionMap | null {
  const isoforms = isoformEdits(entry);
  const isoform = isoforms.find(i => i.id === isoformId);
  if (!isoform || isoform.external) return null;
  return canonicalToIsoformMap(entry.sequence.length, isoform.edits);
}
