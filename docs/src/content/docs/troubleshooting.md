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
  const { phase, message, source, issues, context } = event.detail;

  // `message` is the same one-liner the badge or panel shows, so the simplest
  // useful listener is one line and needs no `switch` at all.
  console.warn(`[protvista] ${phase}: ${message}`, source ?? '');

  if (phase === 'config') {
    const errors = issues.filter((i) => i.severity !== 'warning');
    if (errors.length) console.error('Config problem:', errors);
  } else if (phase === 'track-fetch') {
    console.warn(`Track ${context.groupId}/${context.trackId} failed`);
  }
});
```

### `detail`

| Field | What it holds |
| --- | --- |
| `phase` | Which part of the pipeline failed — see the table below. |
| `message` | One line, the same text the `⚠` badge or the alert panel shows. For a malformed file or a track that could not draw its data, this is what the decoder or the component threw, naming your file and the offending row. |
| `source` | The URL or path the failure came from, when it had one. Absent for an inline, `custom` or `setTrackData()` source. |
| `issues` | For `config`, the `ValidationIssue[]`; `[]` otherwise. |
| `context` | Identifiers for the failure — see [The `context` object](#the-context-object). |

### Phases

| `phase` | Fires when | Useful `context` |
| --- | --- | --- |
| `config` | The config fails to parse or validate, or it loads with warnings. `detail.issues` lists what's wrong, and a warning's issue has `severity: 'warning'`. | — |
| `sequence` | No usable sequence was found for the accession. | `accession`, plus (on a fetch failure) `errorKind` / `status` / `url` |
| `track-fetch` | A track's data failed in a way that breaks it — a network error, a 5xx response, an unparseable body, a malformed file the decoder rejected, a `from: file` path that 404'd, or a payload the track could not draw. A 4xx from a *provider endpoint* is treated as "missing, not broken" and does *not* fire this event. | `groupId`, `trackId`, `url`, `status`, `errorKind` |
| `set-track-data` | Misuse of the `setTrackData()` programmatic API. | `groupId`, `trackId` |

### Where a failure shows up

Every failure in the viewer — a config that won't validate, a sequence that
won't load, a file that won't parse — is described by two facts and routed by
them: how **severe** it is, and whether it is scoped to the whole **viewer** or
to one **track**. The table below is the whole rule. It lives as data in
`src/errors/router.ts` and is drift-tested against this page, so the two cannot
disagree.

| Severity | Scope | Console | `protvista-error` | Alert panel | Row badge |
| --- | --- | --- | --- | --- | --- |
| `error` | viewer | yes | yes | always | — |
| `error` | track | yes | yes | under `strict` | yes |
| `warning` | viewer | yes | yes | never | — |
| `warning` | track | yes | yes | under `strict` | yes |
| `info` | viewer | yes | no | never | — |
| `info` | track | yes | no | never | no |

Reading it:

- A **viewer-scoped error** leaves nothing to render past it — no config, or no
  sequence — so the panel replaces the viewer whether or not `strict` is set.
- A **track-scoped** failure leaves the rest of the viewer working, so the row
  carries it as a `⚠` badge. `strict` promotes the batch to a single aggregated
  panel; without `strict` the badges stand alone.
- A **viewer-scoped warning** names something legal that loaded as written (a
  config warning, a misused `setTrackData()` call). It never raises the panel,
  even under `strict` — hiding a working viewer behind a notice about something
  that worked is not a louder failure, just a less useful one.
- **`info`** is an expected absence, not a failure: a provider endpoint
  answering 404 for an entity with no data of this kind, or a `from: custom`
  track nobody injected data into. It gets a console line and no user surface.

A **Retry** control appears on whichever surface carried the failure, and only
when retrying could change the answer: a network error or a 5xx may be
transient, while a 4xx, a malformed file and an adapter that threw will fail
the same way again.

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
  verbatim, which names your file and the offending row;
- `render` — the payload was built, and the track itself rejected it on
  handover (a line graph handed feature records, say). `trackId` is absent when
  the rejected payload was a collapsed group's combined view rather than one
  track's.

## Common problems

### Nothing renders at all

The viewer gates its whole pipeline on a truthy `accession`, and fetches that
sequence first. If `accession` is missing or wrong, even fully local data won't
show. Set a valid `accession` (e.g. `P05067`).

While that first load is in flight you see a spinner, and screen readers hear
"Loading protein data…" — so a region that stays *blank* is not a slow load.
Check that `accession` is set, and that `suspend` is not still on the element.

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

### A track is empty but its data looks right

If `errorKind` is `render`, the data loaded and parsed — the track just could
not draw it. That is a shape mismatch rather than a content problem: a line
graph handed feature records, or a `setTrackData()` payload that does not match
the record contract for the track's `kind`. The badge carries what the
component threw, and the other tracks are unaffected. See
[Load your own data](/protvista/your-data) for the shape each kind expects.

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
