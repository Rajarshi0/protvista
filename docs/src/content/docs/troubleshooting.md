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
  }
});
```

### Phases

| `phase` | Fires when | Useful `context` |
| --- | --- | --- |
| `config` | The config fails to parse or validate, or it loads with warnings. `detail.issues` lists what's wrong, and a warning's issue has `severity: 'warning'`. | — |
| `sequence` | No usable sequence was found for the accession. | `accession`, plus (on a fetch failure) `errorKind` / `status` / `url` |
| `track-fetch` | A track's data failed in a way that breaks it — a network error, a 5xx response, an unparseable body, a malformed file the decoder rejected, or a `from: file` path that 404'd. A 4xx from a *provider endpoint* is treated as "missing, not broken" and does *not* fire this event. | `groupId`, `trackId`, `url`, `status`, `errorKind` |
| `set-track-data` | Misuse of the `setTrackData()` programmatic API. | `groupId`, `trackId` |

### The `context` object

Every field is optional; the reporter fills in what's relevant to the phase.
`accession` is always set when the element has one. For `track-fetch`,
`errorKind` is one of:

- `network` — unreachable (offline, blocked, DNS, CORS, or timeout);
- `http` — the server answered with a 5xx, or a `from: file` path answered 4xx
  (`status` is set). A 4xx from a provider endpoint is treated as "missing, not
  broken", so it does not fire a `track-fetch` event;
- `parse` — a successful response whose body couldn't be parsed;
- `adapter` — the body arrived, but the decoder, the shape validator or the
  named adapter threw on it. The badge and the event carry the thrown message
  verbatim, which names your file and the offending row.

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

The viewer says so on screen: a `from: file` path that 404s shows a `⚠` badge
reading "`./hotspots.csv` could not be found (HTTP 404) — check the path is
relative to the page." A track that stays empty with no badge really did load
and really is empty.

### A data file is malformed

A file that loads but can't be decoded shows a `⚠` badge carrying the decoder's
own message — `./hits.csv (parsed as CSV): row 3, column "start": expected a
number, got "abc"` — and fires a `track-fetch` event with `errorKind:
'adapter'` and the identical text. The rest of the viewer keeps working; only
that one track degrades. No Retry is offered, because re-running the same
decoder over the same bytes gives the same answer: fix the file.

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
adapter expected; `adapter` means the decoder rejected the records themselves.
Confirm the URL in a browser tab, and check it returns the
[shape the adapter expects](/protvista/adapter-reference). (A 4xx such as 404
from a *provider endpoint* is treated as "no data for this track" and is hidden
rather than reported as an error. From a `from: file` source it is reported —
there a 404 can only mean the path is wrong.)

## Where to go next

- [Load your own data](/protvista/your-data) — data shapes and the path gotcha.
- [Escape hatches](/protvista/escape-hatches) — custom adapters and error handling.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
