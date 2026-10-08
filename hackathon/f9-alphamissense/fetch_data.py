#!/usr/bin/env python3
"""Download the public F9 inputs for one or more UniProt accessions into data/.

    python3 fetch_data.py                    # P60484 (PTEN), P04637 (TP53), P07550 (ADRB2)
    python3 fetch_data.py P38398 --force     # any accession; --force re-downloads

For each accession it writes:
    data/proteins-{acc}.json                  Proteins API variation (can take ~20 s)
    data/afpred-{acc}.json                    AlphaFold DB prediction (holds amAnnotationsUrl)
    data/AF-{acc}-F1-aa-substitutions.csv     AlphaMissense scores, from amAnnotationsUrl

Standard library only. data/ is git-ignored: the variation JSON contains
NCI-TCGA / COSMIC rows that must not be redistributed, so never commit it.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_ACCESSIONS = ['P60484', 'P04637', 'P07550']
VARIATION_URL = 'https://www.ebi.ac.uk/proteins/api/variation/{acc}'
PREDICTION_URL = 'https://alphafold.ebi.ac.uk/api/prediction/{acc}'
HERE = os.path.dirname(os.path.abspath(__file__))


def download(url, path, accept, force):
    if os.path.exists(path) and not force:
        print(f'  have  {os.path.relpath(path, HERE)} ({os.path.getsize(path):,} bytes)')
        return
    req = urllib.request.Request(url, headers={'Accept': accept, 'User-Agent': 'protvista-hackathon-f9/1.0'})
    for attempt in (1, 2, 3):
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            break
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 3 or (isinstance(e, urllib.error.HTTPError) and e.code == 404):
                raise SystemExit(f'  FAILED {url}: {e}')
            print(f'  retry {url} ({e})')
            time.sleep(3 * attempt)
    tmp = path + '.part'
    with open(tmp, 'wb') as f:
        f.write(body)
    os.replace(tmp, path)
    print(f'  wrote {os.path.relpath(path, HERE)} ({len(body):,} bytes, {time.time() - t0:.1f} s)')


def fetch(acc, out, force):
    print(acc)
    var_path = os.path.join(out, f'proteins-{acc}.json')
    pred_path = os.path.join(out, f'afpred-{acc}.json')
    download(VARIATION_URL.format(acc=acc), var_path, 'application/json', force)
    download(PREDICTION_URL.format(acc=acc), pred_path, 'application/json', force)

    sequence = json.load(open(var_path)).get('sequence')
    predictions = json.load(open(pred_path))
    if isinstance(predictions, dict):
        predictions = [predictions]
    urls = [p['amAnnotationsUrl'] for p in predictions if p.get('amAnnotationsUrl')]
    if not urls:
        print(f'  no amAnnotationsUrl in the AlphaFold DB prediction for {acc}: no AlphaMissense data')
    for p in predictions:
        if p.get('amAnnotationsUrl') and p.get('sequence') != sequence:
            print(f"  warning: {p.get('entryId')} sequence differs from the UniProt sequence; join.py would mis-match positions")
    for url in urls:
        # Keep the file name from the URL (AF-{acc}-F1-...): big proteins can have several fragments.
        download(url, os.path.join(out, url.rsplit('/', 1)[-1]), 'text/csv', force)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('accessions', nargs='*', default=DEFAULT_ACCESSIONS, help='UniProt accessions (default: %(default)s)')
    ap.add_argument('--out', default=os.path.join(HERE, 'data'), help='output folder (default: data/ next to this script)')
    ap.add_argument('--force', action='store_true', help='download again even if the file exists')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for acc in args.accessions:
        fetch(acc.strip().upper(), args.out, args.force)
    print('Done. Do not commit data/ (COSMIC rows; see README.md).')


if __name__ == '__main__':
    sys.exit(main())
