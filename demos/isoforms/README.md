# Isoform support: spike demo (hackathon project F8)

This is the working spike for F8. It is a **starting point for the team, not
code to merge as it is**: the adapter is plain JavaScript with no tests, and
`demos/` is not a folder the repo builds, lints or tests. Port the logic into
`src/utils/isoform-map.ts` with tests (Milestone 1), then into a built-in
adapter (Milestone 2), as the F8 brief describes.

## Run it

You need an internet connection (the viewer loads from jsDelivr and the data
from UniProt and the Proteins API) and any static web server. From the repo
root:

```sh
cd demos/isoforms
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open:

- http://localhost:8000/?acc=P05067 : APP, 10 isoform rows
- http://localhost:8000/?acc=P10636 : tau, 8 rows
- http://localhost:8000/?acc=P42771 : CDKN2A, 3 rows (its 2 External ARF isoforms are skipped)
- http://localhost:8000/gold.html : tau-441 (Tau-F, `P10636-8`) with canonical annotations projected onto it; P301L lands at 301

Expand the **Isoforms** row (or **Canonical annotations on Tau-F**) to see
the tracks. Opening the HTML file directly (`file://`) does not work.

The rows are thin: the pages load the published `protvista-uniprot@5.0.0-beta.5`,
which ignores `rendering.height`. Zoom in to read them.

## Files

| File | What it is |
| --- | --- |
| `isoforms-adapter.js` | The spike logic. `isoformEdits(entry)` joins each isoform's `sequenceIds` to the VAR_SEQ features; `uniprotIsoforms(entry)` is the escape-hatch adapter that returns one full-length feature per isoform with gaps where it differs; `canonicalToIsoformMap()` and `projectTo(isoformId)` project canonical features onto one isoform. |
| `main.js` | Isoform-rows page script: registers `uniprot-isoforms` through `viewer.adapters`, then sets a config with an isoforms track, the VAR_SEQ track and domains. `?acc=` picks the protein (default P05067). |
| `gold.js` | Tau-441 page script: registers `project-to-isoform` and shows repeats, regions, variants and modified residues from `/features/P10636` in Tau-F numbering. |
| `index.html`, `gold.html` | Pages adapted from `starter-kit/index.html`. An import map points the scripts' `import 'protvista-uniprot'` at the jsDelivr build, so there is no bundling step. |

Offline copies of the data, for tests, are in
[`src/__fixtures__/isoforms/`](../../src/__fixtures__/isoforms/) (see its
`PROVENANCE.md`).
