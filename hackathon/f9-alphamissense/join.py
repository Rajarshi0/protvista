#!/usr/bin/env python3
"""F9 Milestone 1: Proteins API variation + AlphaMissense -> files the stock viewer can draw.

    python3 join.py P60484                       # reads data/proteins-P60484.json and
                                                 # data/AF-P60484-F1-aa-substitutions.csv, writes to data/
    python3 join.py P60484 data/proteins-P60484.json data/AF-P60484-F1-aa-substitutions.csv data/

Writes, into the output folder:
    {acc}-variants-am.json       the Proteins API payload with color, size, amScore and amClass on every feature
    {acc}-agreement.csv          one feature per scored variant with a ClinVar-sourced P/LP or B/LB label
    {acc}-density-{kind}.csv     distinct (position, alt) per residue: clinvar_plp, curated_mim, tcga_tissue

The output is built from the variation JSON, so it carries the same COSMIC rows:
keep it in data/ (git-ignored) and never commit it.
"""
import json, csv, sys, os, collections
LB, LP = 0.34, 0.564  # published AM thresholds
def lerp(c1, c2, t):
    a = [int(c1[i:i+2], 16) for i in (1, 3, 5)]; b = [int(c2[i:i+2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(a, b))
def am_colour(s):  # alphamissense-ramp end points: blue / grey / red
    if s < LB: return lerp('#3457b9', '#d7d7d7', s / LB)
    if s <= LP: return '#d7d7d7'
    return lerp('#d7d7d7', '#ca1615', (s - LP) / (1 - LP))
def sig(v, kinds, src='ClinVar'):
    return any(c['type'] in kinds and src in (c.get('sources') or []) for c in v.get('clinicalSignificances') or [])
P, B = ('Pathogenic', 'Likely pathogenic'), ('Benign', 'Likely benign')

here = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) == 2:
    acc = sys.argv[1]; data = os.path.join(here, 'data')
    varfile, amfile, out = f'{data}/proteins-{acc}.json', f'{data}/AF-{acc}-F1-aa-substitutions.csv', data
elif len(sys.argv) == 5:
    acc, varfile, amfile, out = sys.argv[1:5]
else:
    sys.exit(__doc__)
d = json.load(open(varfile)); seq = d['sequence']
am = {r['protein_variant']: (float(r['am_pathogenicity']), r['am_class']) for r in csv.DictReader(open(amfile, newline=''))}
L = len(seq); stats = collections.Counter()
agree_rows = []; dens = {k: collections.defaultdict(set) for k in ('clinvar_plp', 'curated_mim', 'tcga_tissue')}
for v in d['features']:
    b = int(v['begin']); wt, alt = v.get('wildType'), v.get('alternativeSequence')
    hit = None
    if v.get('consequenceType') == 'missense':
        stats['missense'] += 1
        if wt and alt and b <= L and seq[b-1] == wt:  # wildType must match the sequence, else leave unscored
            hit = am.get(f'{wt}{b}{alt}')              # the exact substitution, not the per-residue average
    if hit:
        stats['scored'] += 1
        v['amScore'], v['amClass'] = hit
        v['color'] = am_colour(hit[0])
    else:
        v['amScore'], v['amClass'] = None, 'no prediction'
        v['color'] = '#bdbdbd'  # small grey dot, not removal
        v['size'] = 3
    # agreement: ClinVar-sourced significance only, scored missense only
    if hit:
        s = hit[0]; p, bn = sig(v, P), sig(v, B)
        if p and not bn:
            cat = ('Agree: pathogenic', '#b2182b') if s > LP else (('AM disagrees: likely benign', '#f4a582') if s < LB else ('AM ambiguous', '#999999'))
        elif bn and not p:
            cat = ('Agree: benign', '#2166ac') if s < LB else (('AM disagrees: likely pathogenic', '#92c5de') if s > LP else ('AM ambiguous', '#999999'))
        else: cat = None
        if cat:
            agree_rows.append({'type': 'VARIANT', 'start': b, 'end': b, 'description': f"{wt}{b}{alt}: {cat[0]} (AM {s:.3f}, ClinVar {'P/LP' if p else 'B/LB'})", 'color': cat[1]})
            stats[cat[0]] += 1
    # density by label provenance, distinct (pos, alt)
    if sig(v, P): dens['clinvar_plp'][b].add(alt)
    for a in v.get('association') or []:
        if not a.get('disease'): continue
        if (a.get('description') or '').startswith('From tissue'): dens['tcga_tissue'][b].add(alt)
        elif any(r.get('name') == 'MIM' for r in a.get('dbReferences') or []): dens['curated_mim'][b].add(alt)
os.makedirs(out, exist_ok=True)
json.dump(d, open(f'{out}/{acc}-variants-am.json', 'w'))
with open(f'{out}/{acc}-agreement.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, ['type', 'start', 'end', 'description', 'color']); w.writeheader(); w.writerows(agree_rows)
for k, m in dens.items():
    with open(f'{out}/{acc}-density-{k}.csv', 'w') as f:
        f.write('position,value\n'); [f.write(f'{i},{len(m.get(i, ()))}\n') for i in range(1, L + 1)]
print(acc, dict(stats))
