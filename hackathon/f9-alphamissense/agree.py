#!/usr/bin/env python3
"""How often AM calls a variant likely pathogenic (> 0.564), split by where its label comes from.

    python3 agree.py                 # P60484 and P04637
    python3 agree.py P07550          # any accession already in data/ (run fetch_data.py first)

Reads data/proteins-{acc}.json and data/AF-{acc}-F1-aa-substitutions.csv. Prints only.
"""
import json, csv, sys, os, collections
data = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
for acc in sys.argv[1:] or ['P60484', 'P04637']:
    d = json.load(open(f'{data}/proteins-{acc}.json')); seq = d['sequence']; feats = d['features']
    am = {r['protein_variant']: float(r['am_pathogenicity']) for r in csv.DictReader(open(f'{data}/AF-{acc}-F1-aa-substitutions.csv', newline=''))}
    def amscore(v):
        if v.get('consequenceType') != 'missense': return None
        wt, alt, b = v.get('wildType'), v.get('alternativeSequence'), int(v['begin'])
        if not wt or not alt or b > len(seq) or seq[b-1] != wt: return None
        return am.get(f'{wt}{b}{alt}')
    rows = [(v, amscore(v)) for v in feats]
    rows = [(v, s) for v, s in rows if s is not None]
    def frac(name, pred):
        sel = [s for v, s in rows if pred(v)]
        n = len(sel); hi = sum(s > 0.564 for s in sel)
        print(f'  {name:55s} n={n:5d}  AM>0.564: {100*hi/max(n,1):4.0f}%')
    P = lambda v, src=None: any(c['type'] in ('Pathogenic', 'Likely pathogenic') and (src is None or src in (c.get('sources') or [])) for c in v.get('clinicalSignificances') or [])
    B = lambda v, src=None: any(c['type'] in ('Benign', 'Likely benign') and (src is None or src in (c.get('sources') or [])) for c in v.get('clinicalSignificances') or [])
    dis = lambda v: any(a.get('disease') for a in v.get('association') or [])
    nondis = lambda v: any(a.get('disease') is False for a in v.get('association') or [])
    cvx = lambda v: any(x['name'].lower() == 'clinvar' for x in v.get('xrefs') or [])
    print(acc, 'scored missense records', len(rows))
    frac('default red dot (association.disease)', dis)
    frac('default red dot AND ClinVar provenance filter', lambda v: dis(v) and cvx(v))
    # Same order as colorConfig in src/filter-config.ts: a disease association makes a dot red first.
    frac('default green dot (only disease===false associations)', lambda v: nondis(v) and not dis(v))
    frac('sig P/LP any source', P)
    frac('sig P/LP ClinVar-sourced', lambda v: P(v, 'ClinVar'))
    frac('sig B/LB any source', B)
    frac('sig B/LB ClinVar-sourced', lambda v: B(v, 'ClinVar'))
    frac('red dot but NOT ClinVar P/LP', lambda v: dis(v) and not P(v, 'ClinVar'))
    # what kinds of disease association the scored records carry
    c = collections.Counter()
    for v, s in rows:
        for a in v.get('association') or []:
            if a.get('disease'): c['tissue' if (a.get('description') or '').startswith('From tissue') else ('MIM' if any(r.get('name') == 'MIM' for r in a.get('dbReferences') or []) else 'other')] += 1
    print('  disease association kinds', dict(c))
