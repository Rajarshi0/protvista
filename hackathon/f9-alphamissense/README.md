# F9 hackathon: variation meets AlphaMissense

Starter scripts and pages for hackathon project F9. They put each observed variant (from the Proteins API) next to the AlphaMissense (AM) score for that exact substitution.

> **AlphaMissense predictions are not validated for clinical use.** Show that on screen in anything you demo.
> AlphaMissense data: Cheng et al., *Science* 2023, CC BY 4.0, served by AlphaFold DB. Licence and disclaimer: https://github.com/google-deepmind/alphamissense

## Quick start

From this folder (`hackathon/f9-alphamissense/`), using Python 3 with no extra packages:

```sh
python3 fetch_data.py                  # PTEN P60484, TP53 P04637, ADRB2 P07550 into data/ (~35 s)
python3 join.py P60484                 # writes data/P60484-variants-am.json and friends
python3 join.py P04637
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open:

- http://localhost:8000/ (Milestone 1: the `join.py` output in the stock viewer, `config-P60484.yaml`)
- http://localhost:8000/live.html?acc=P60484 and `?acc=P04637` (Milestone 2: the same join done live in the browser)

`join.py` prints its totals. With data downloaded on 8 Oct 2026:

```
P60484 {'missense': 1839, 'scored': 1767, 'Agree: pathogenic': 253, 'AM disagrees: likely benign': 5, 'AM ambiguous': 5, 'Agree: benign': 11, 'AM disagrees: likely pathogenic': 1}
P04637 {'missense': 2433, 'scored': 2269, 'Agree: benign': 140, 'AM disagrees: likely pathogenic': 10, 'AM ambiguous': 19, 'AM disagrees: likely benign': 14, 'Agree: pathogenic': 326}
```

The live data changes over time, so expect small drifts.

The pages load the viewer from jsDelivr (`protvista-uniprot@5.0.0-beta.5`, the build the Starter Kit pins), so they need internet access. The live page also calls the EBI APIs.

## Files

| File | What it does |
| --- | --- |
| `fetch_data.py` | Downloads the public inputs for any accessions (default P60484 P04637 P07550) into `data/`: `proteins-{acc}.json` (Proteins API variation, `https://www.ebi.ac.uk/proteins/api/variation/{acc}`, can take ~20 s), `afpred-{acc}.json` (AlphaFold DB prediction, `https://alphafold.ebi.ac.uk/api/prediction/{acc}`) and the AM CSV named by its `amAnnotationsUrl`, e.g. `AF-{acc}-F1-aa-substitutions.csv`. Existing files are kept; use `--force` to download again. Standard library only. |
| `join.py` | Milestone 1. Looks up `WT+position+ALT` in the AM CSV for every missense record whose `wildType` matches `sequence[pos-1]`. Writes `{acc}-variants-am.json` (the Proteins API payload with `color`, `size`, `amScore` and `amClass` on each feature; unscored dots become small grey dots), `{acc}-agreement.csv` (ClinVar-sourced P/LP or B/LB against AM, one coloured feature per variant) and three `{acc}-density-*.csv` line graphs (ClinVar P/LP, curated MIM disease, TCGA tissue labels). `python3 join.py ACC` uses `data/`; the long form `python3 join.py ACC VARIATION.json AM.csv OUTDIR` also works. |
| `agree.py` | Prints how often AM calls a variant likely pathogenic (> 0.564), split by where the variant's label comes from (default dot colours, any-source vs ClinVar-sourced significance). `python3 agree.py [ACC ...]`. |
| `index.html` + `config-P60484.yaml` | Milestone 1 reference: today's Variants track, the AM-coloured Variants track (from `join.py` output, with a `dataTooltip` showing the score and label source), the agreement track and the three density line graphs. `index.html?acc=X` loads `config-X.yaml`; for TP53, copy the config to `config-P04637.yaml` and change the accession and file names. |
| `variation-am.js` | Milestone 2 custom adapters. `variation-alphamissense` joins `[variation, alphafoldPrediction]` live, fetching the AM CSV from `amAnnotationsUrl` and checking that the prediction's sequence matches. `variation-counts-provenance` returns three disease-density series for a `kind: variant-counts` track. `amColour` is the colour ramp. |
| `live.html` + `live-P60484.yaml`, `live-P04637.yaml` | Milestone 2 page. Registers the adapters with `viewer.adapters = {...}` **before** setting `config-src`, then loads `live-{acc}.yaml` for `?acc=`. It logs "AlphaMissense: N of M missense records scored" to the console. There is no `live-P07550.yaml` yet: making one config work for any `?acc=` is part of Milestone 2. |
| `.gitignore` | Keeps `data/` out of git. |

The colours follow the published AM thresholds: likely benign below 0.34 (blue `#3457b9`), ambiguous 0.34 to 0.564 (grey `#d7d7d7`), likely pathogenic above 0.564 (red `#ca1615`), the same ramp as the built-in `alphamissense-ramp`.

The built-in AlphaMissense heatmap isn't in `config-P60484.yaml`: it only wires up inside a group whose id is `ALPHAMISSENSE_PATHOGENICITY` (#324). To compare against it, look at the default UniProt config (for example the Starter Kit's `recipes/extend-uniprot.yaml`).

## Never commit the downloaded data (COSMIC)

The Proteins API variation JSON includes `NCI-TCGA Cosmic` rows, which have restrictive redistribution terms. Everything `join.py` writes is built from that payload, and `{acc}-variants-am.json` is a full copy of it. So:

- Keep all downloaded and generated files in `data/`. It is git-ignored; don't force-add it, and don't move the files somewhere that isn't ignored.
- Commit scripts, configs and pages only. Anyone can recreate the data with `fetch_data.py`.
- If you need example data in a PR or recipe, keep only ClinVar and UniProt rows, and include the AlphaMissense CC BY 4.0 attribution.

## Gotchas

- The AM CSV has CRLF line endings. `variation-am.js` splits on `/\r?\n/`; splitting on `'\n'` leaves `amClass` as `"LBen\r"`.
- Large proteins are split into several AlphaFold fragments, so always go through `amAnnotationsUrl`; don't build the `-F1` URL yourself.
- The variation call for TP53 is about 14 MB and can take 20 s or more. BRCA1 (P38398) is 56 MB: download it with `fetch_data.py` and use it from `data/`, never live in a demo.
- Leave `filterUI` off the AM-coloured track. Its legend describes today's colours, not the AM ones.
