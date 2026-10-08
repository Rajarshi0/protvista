// F9 Milestone 2. Live join: Proteins API variation + AlphaMissense (via the AFDB prediction's amAnnotationsUrl).
// Page-level custom adapters, registered in live.html with `viewer.adapters = {...}` before config-src is set.
const LB = 0.34, LP = 0.564;
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
export const amColour = s => s < LB ? mix('#3457b9', '#d7d7d7', s / LB) : s <= LP ? '#d7d7d7' : mix('#d7d7d7', '#ca1615', (s - LP) / (1 - LP));

export async function variationAlphaMissense(variation, prediction) {
  const { sequence, features } = variation ?? {};
  if (!features) return null;
  const pred = Array.isArray(prediction) ? prediction.find(p => p.sequence === sequence) : null;
  const am = new Map();
  if (pred?.amAnnotationsUrl) {
    const text = await (await fetch(pred.amAnnotationsUrl)).text();
    // The AM CSV has CRLF line endings: splitting on '\n' alone leaves amClass as "LBen\r".
    for (const line of text.split(/\r?\n/).slice(1)) {
      const [key, score, cls] = line.split(',');
      if (key) am.set(key, [+score, cls]);
    }
  }
  let scored = 0, missense = 0;
  const variants = features.map(f => {
    const pos = +f.begin, wt = f.wildType, alt = f.alternativeSequence;
    const ok = f.consequenceType === 'missense' && wt && alt && sequence[pos - 1] === wt;
    if (f.consequenceType === 'missense') missense++;
    const hit = ok ? am.get(`${wt}${pos}${alt}`) : undefined;
    if (hit) scored++;
    return {
      ...f, start: pos, variant: alt || '*',
      xrefNames: (f.xrefs ?? []).map(x => x.name),
      hasPredictions: !!f.predictions?.length,
      amScore: hit?.[0] ?? null, amClass: hit?.[1] ?? 'no prediction',
      color: hit ? amColour(hit[0]) : '#bdbdbd', size: hit ? undefined : 3,
    };
  });
  console.info(`AlphaMissense: ${scored} of ${missense} missense records scored`);
  return { sequence, variants };
}

// Disease density split by where the label comes from; distinct (position, alt) per residue.
export function variationCountsByProvenance(variation) {
  const { sequence, features } = variation ?? {};
  if (!sequence || !features) return null;
  const series = {
    'ClinVar P/LP': { color: '#b2182b', sets: new Map() },
    'curated (MIM) disease': { color: '#5e3c99', sets: new Map() },
    'TCGA tissue label': { color: '#e08214', sets: new Map() },
  };
  const add = (k, pos, alt) => { const m = series[k].sets; (m.get(pos) ?? m.set(pos, new Set()).get(pos)).add(alt); };
  for (const f of features) {
    const pos = +f.begin, alt = f.alternativeSequence ?? '*';
    if (pos < 1 || pos > sequence.length) continue;
    if ((f.clinicalSignificances ?? []).some(c => /pathogenic/i.test(c.type) && !/benign/i.test(c.type) && c.sources?.includes('ClinVar'))) add('ClinVar P/LP', pos, alt);
    for (const a of f.association ?? []) {
      if (!a.disease) continue;
      if ((a.description ?? '').startsWith('From tissue')) add('TCGA tissue label', pos, alt);
      else if ((a.dbReferences ?? []).some(r => r.name === 'MIM')) add('curated (MIM) disease', pos, alt);
    }
  }
  const out = Object.entries(series).map(([name, { color, sets }]) => ({
    name, color, values: Array.from({ length: sequence.length }, (_, i) => ({ position: i + 1, value: sets.get(i + 1)?.size ?? 0 })),
  }));
  const max = Math.max(1, ...out.flatMap(s => s.values.map(v => v.value)));
  return out.map(s => ({ ...s, range: [0, max] }));
}
