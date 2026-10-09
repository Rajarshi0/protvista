import { isoformEdits, IsoformEdit } from '../../utils/isoform-map.js';

function fmtSeq(seq: string): string {
  if (seq.length > 10) return `${seq.slice(0, 10)}… (${seq.length} aa)`;
  return seq;
}

function formatEdit(edit: IsoformEdit): string {
  const range = edit.start === edit.end ? `${edit.start}` : `${edit.start}-${edit.end}`;
  if (edit.replacement === '') return `${range}: missing`;
  const isInsertion = edit.replacement.length > edit.original.length;
  const insText = isInsertion ? ' (insertion)' : '';
  return `${range}: ${fmtSeq(edit.original)} → ${fmtSeq(edit.replacement)}${insText}`;
}

function formatName(name: string): string {
  if (/^\d+$/.test(name)) return `isoform ${name}`;
  return name;
}

export function uniprotIsoformsAdapter(data: any) {
  // Handle single object or array (multi-source adapter payload)
  const entry = Array.isArray(data) ? data[0] : data;
  
  if (!entry || !entry.sequence || !entry.sequence.value) return [];
  
  const canonicalLength = entry.sequence.value.length;
  const isoforms = isoformEdits(entry);

  const externals = isoforms.filter((i) => i.external);
  const extString = externals.length > 0
    ? `; not shown (External): ` + externals.map((i) => `${i.id} (${formatName(i.name)})`).join(', ')
    : '';

  return isoforms
    .filter((i) => !i.external)
    .map((isoform) => {
      const formattedName = formatName(isoform.name);
      const label = formattedName ? `${isoform.id} (${formattedName})` : isoform.id;
      let description = label;

      if (isoform.canonical) {
        description += `: canonical sequence${extString}`;
      } else {
        const editNotes = isoform.edits.map(formatEdit);
        if (isoform.unresolved.length > 0) {
          editNotes.push(`edits not in the entry: ${isoform.unresolved.join(', ')}`);
        }
        if (editNotes.length === 0) {
          description += `: no edits listed`;
        } else {
          description += `: ` + editNotes.join('; ');
        }
      }

      const fragments: Array<{ start: number; end: number }> = [];
      const residuesToHighlight: Array<{ position: number; name: string }> = [];
      let current = 1;

      for (const edit of isoform.edits) {
        if (edit.replacement === '') {
          // Deletion: cut a gap
          if (edit.start > current) {
            fragments.push({ start: current, end: edit.start - 1 });
          }
          current = edit.end + 1;
        } else {
          // Replacement or Insertion: highlight covered canonical positions
          const name = formatEdit(edit);
          for (let p = edit.start; p <= edit.end; p++) {
            residuesToHighlight.push({ position: p, name });
          }
        }
      }
      if (current <= canonicalLength) {
        fragments.push({ start: current, end: canonicalLength });
      }

      const feature: any = {
        accession: isoform.id,
        description,
        color: isoform.canonical ? '#0053d6' : '#888888',
        start: 1,
        end: canonicalLength,
        locations: [{ fragments }]
      };

      if (residuesToHighlight.length > 0) {
        feature.residuesToHighlight = residuesToHighlight;
      }

      return feature;
    });
}
