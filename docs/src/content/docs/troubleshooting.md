---
title: Troubleshoot errors
---

When something doesn't load, ProtVista tells you in two places: the browser
console, and a single `protvista-error` event you can listen for. This page
covers both, plus the most common causes.

## The `protvista-error` event

The element emits one bubbling `protvista-error` event for every problem, so a
single listener covers all of them. Switch on `detail.phase`:

```js
const viewer = document.querySelector('protvista-uniprot');

viewer.addEventListener('protvista-error', (event) => {
  const { phase, issues, context } = event.detail;

  if (phase === 'config') {
    const errors = issues.filter((i) => i.severity !== 'warning');
    if (errors.length) console.error('Config problem:', errors);
    else console.warn('Config loaded with warnings:', issues);
  } else if (phase === 'track-fetch') {
    console.warn(
      `Track ${context.groupId}/${context.trackId} failed`,
      context.status ? `(HTTP ${context.status})` : `(${context.errorKind})`,
    );
  } else if (phase === 'track-data') {
    console.warn(issues[0].message);
  }
});
```

### Phases

| `phase` | Fires when | Useful `context` |
| --- | --- | --- |
| `config` | The config fails to parse or validate, or it loads with warnings. `detail.issues` lists what's wrong, and a warning's issue has `severity: 'warning'`. | — |
| `sequence` | No usable sequence was found for the accession. | `accession`, plus (on a fetch failure) `errorKind` / `status` / `url` |
| `track-fetch` | A track's URL failed in a way that breaks it — a network error, a 5xx response, or an unparseable body. A 4xx is treated as "missing, not broken" and does *not* fire this event. | `groupId`, `trackId`, `url`, `status`, `errorKind` |
| `set-track-data` | Misuse of the `setTrackData()` programmatic API. | `groupId`, `trackId` |
| `track-data` | A bring-your-own-data track has rows whose coordinates fall outside the entry's sequence — a start below 1, or a position past the last residue. The track still renders; `detail.issues` holds one issue with `code: 'coordinate-out-of-range'` and `severity: 'warning'`. | `groupId`, `trackId`, `url` (file and URL tracks) |

### The `context` object

Every field is optional; the reporter fills in what's relevant to the phase.
`accession` is always set when the element has one. For `track-fetch`,
`errorKind` is one of:

- `network` — unreachable (offline, blocked, DNS, CORS, or timeout);
- `http` — the server answered with a 5xx (`status` is set). A 4xx is treated as
  "missing, not broken", so it does not fire a `track-fetch` event;
- `parse` — a successful response whose body couldn't be parsed.

## Common problems

### Nothing renders at all

The viewer gates its whole pipeline on a truthy `accession`, and fetches that
sequence first. If `accession` is missing or wrong, even fully local data won't
show. Set a valid `accession` (e.g. `P05067`).

### A track shows up empty

Almost always a **path** issue with a file-backed track. `data: ./hotspots.csv`
is resolved relative to the **hosting page**, not the config file — so the
browser may be looking in the wrong place. Serve the page from the same
directory as the data, or use an absolute URL. See the path note in
[Load your own data](/protvista/your-data#a-path-gotcha-to-know).

### Common coordinate mistakes

ProtVista expects 1-based, inclusive positions on the entry's canonical
sequence. Three mistakes account for most wrong-looking tracks:

- **0-based coordinates** (BED habits, Python ranges). A `start` of 0 is the
  giveaway, and every feature is shifted by one. ProtVista reports this as a
  `track-data` warning but never shifts your data for you. BED files are the
  exception: they are 0-based by definition and converted automatically.
- **Isoform numbering.** Positions from another isoform can run past the
  canonical sequence's last residue. This is also reported as a `track-data`
  warning, naming the first row that falls outside.
- **Inverted intervals** (`end` before `start`) and fractional coordinates
  (`18.5`). The file is rejected when it loads, and the track renders empty.
  The console warning's attached error names the row, for example
  `./x.csv (parsed as CSV): row 3: end (4) is before start (5).`

A `track-data` warning reads like this:

```
./hits.csv (parsed as CSV): 12 of 340 rows fall outside P05067 (770 residues); first: row 7, end 812. Coordinates must be 1-based positions on this protein's canonical sequence — check for 0-based coordinates (start 0) or isoform numbering.
```

### Features are all black, or show a ?

A feature whose `type` ProtVista doesn't recognise — `HOTSPOT`, or `BED` for
every record in a `.bed` file — draws as a black rectangle, with nothing but a
console log to say why. A `shape` the canvas track can't draw, misspelt or not,
draws as a question mark. Set `rendering.color` and `rendering.shape` on the
track; [Feature type and shape vocabulary](/protvista/type-and-shape-vocabulary)
lists the recognised types and draws every valid shape.

### The config is rejected

A `config`-phase error carries `detail.issues` describing each problem. Validate
your config as you write it in the [playground](/protvista/playground/), or point
your editor at the schema for inline checking — see
[Author a config](/protvista/configure#editor-autocomplete).

### A URL track fails to load

Look at `errorKind`: `network` usually means CORS or connectivity (the data
server must allow cross-origin requests from your page); `http` with a `status`
means the server returned a 5xx; `parse` means the body wasn't the shape the
adapter expected. Confirm the URL in a browser tab, and check it returns the
[shape the adapter expects](/protvista/adapter-reference). (A 4xx such as 404 is treated as
"no data for this track" and is hidden rather than reported as an error.)

## Where to go next

- [Load your own data](/protvista/your-data) — data shapes and the path gotcha.
- [Escape hatches](/protvista/escape-hatches) — custom adapters and error handling.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
