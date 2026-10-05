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
  const { phase, severity, message, source, context } = event.detail;

  // `message` is the text the badge or panel shows, so the simplest useful
  // listener is one line and needs no `switch` at all.
  console.warn(`[protvista] ${phase}: ${message}`, source ?? '');

  if (phase === 'config' && severity === 'error') {
    console.error('The config was rejected:', event.detail.issues);
  } else if (phase === 'track-fetch') {
    // `trackId` is absent when a collapsed group's combined view failed.
    const where = context.trackId
      ? `${context.groupId}/${context.trackId}`
      : context.groupId;
    console.warn(`Track ${where} failed`);
  }
});
```

### `detail`

| Field | What it holds |
| --- | --- |
| `phase` | Which part of the pipeline failed — see the table below. |
| `severity` | `'error'` or `'warning'` — see [Where a failure shows up](#where-a-failure-shows-up). A warning names something that loaded, but not as written: a config warning, a `theme:` colour that could not be resolved, a component with no renderer. |
| `message` | One line: the text the `⚠` badge or the alert panel shows, without the `[protvista]` tag the console line starts with. For a malformed file or a track that could not draw its data, this is what the decoder or the component threw, naming your file and the offending row. |
| `source` | The URL or path the failure came from, when it had one. Absent for an inline, `custom` or `setTrackData()` source. |
| `issues` | For `config`, the `ValidationIssue[]`. For `track-data` and `tooltip-field-miss`, one issue with `severity: 'warning'` whose `code` says what was found and whose `path` names the track. `[]` otherwise. |
| `context` | Identifiers for the failure — see [The `context` object](#the-context-object). |

### Phases

| `phase` | Fires when | Useful `context` |
| --- | --- | --- |
| `config` | The config fails to parse or validate, or it loads with warnings. `detail.severity` says which. `detail.issues` lists what's wrong when the validator raised it, and a warning's issue has `severity: 'warning'`; a warning raised after validation (an unresolvable `theme:` colour, a component with no renderer) has empty `issues`. | — |
| `sequence` | No usable sequence was found for the accession. Never fires for a [`sequence:`](/protvista/sequence-only) config, which fetches no entry; a problem with its sequence is a `config` error. | `accession`, plus (on a fetch failure) `errorKind` / `status` / `url` |
| `track-fetch` | A track's data failed in a way that breaks it — a network error, a 5xx response, an unparseable body, a malformed file the decoder rejected, a 4xx on a path or URL to your own data, or a payload the track could not draw. A 4xx from a *provider endpoint* is treated as "missing, not broken" and does *not* fire this event. | `groupId`, `trackId`, `url`, `status`, `errorKind` |
| `set-track-data` | Misuse of the `setTrackData()` programmatic API. | `groupId`, `trackId` |
| `track-data` | A bring-your-own-data track loaded and renders as written, but something in its data is worth knowing: rows whose coordinates fall outside the protein's sequence (the UniProt entry's, or your `sequence:`) — a start below 1, or a position past the last residue — or, for a feature file, columns that were ignored (`tooltipContent`, `locations`, `residuesToHighlight`, names like `toString`), `shape` values that were ignored because they name a JavaScript built-in (`valueOf`, `constructor`, …), or `color` / `fill` values the canvas cannot paint. `detail.issues` holds one issue with `severity: 'warning'` and `code` set to `coordinate-out-of-range`, `data-field-ignored` or `unpaintable-color`. | `groupId`, `trackId`, `url` (file and URL tracks) |
| `tooltip-field-miss` | A track's authored `dataTooltip` references a field that none of the track's records carries, so that part of every tooltip is blank. The track still renders. Fires once per track per load, listing every such field. `detail.issues` holds one issue with `code: 'tooltip-field-miss'` and `severity: 'warning'`. | `groupId`, `trackId`, `fields` |

### Where a failure shows up

Every failure in the viewer — a config that won't validate, a sequence that
won't load, a file that won't parse — is described by two facts and routed by
them: how **severe** it is, and whether it is scoped to the whole **viewer** or
to one **track**. A row may also name a **phase**, and a phase row may be
narrowed again by a **code** saying what was found: for `track-data`, the
`code` of the event's issue; on the viewer, a URL template left unfetched
(`url-variable-unresolved`), a component with no renderer
(`unrendered-component`) or a `theme:` colour that didn't resolve
(`theme-color-ignored`). The table below is the whole rule. It lives as data in
`src/errors/router.ts` and is drift-tested against this page, so the two cannot
disagree.

| Severity | Scope | Phase | Code | Console | `protvista-error` | Alert panel | Row badge | Visitor notice | Author mode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `error` | viewer | any | any | yes | yes | always | — | no | yes |
| `error` | track | any | any | yes | yes | under `strict` | yes | no | yes |
| `warning` | viewer | `set-track-data` | any | yes | yes | under `strict` | — | no | yes |
| `warning` | viewer | `config` | `unrendered-component` | yes | yes | never | — | viewer | yes |
| `warning` | viewer | `config` | `theme-color-ignored` | yes | yes | never | — | no | yes |
| `warning` | viewer | `track-fetch` | `url-variable-unresolved` | yes | yes | never | — | viewer | yes |
| `warning` | viewer | any | any | yes | yes | never | — | no | yes |
| `warning` | track | `track-data` | `coordinate-out-of-range` | yes | yes | never | no | track | yes |
| `warning` | track | `track-data` | `unpaintable-color` | yes | yes | never | no | track | yes |
| `warning` | track | `track-data` | `data-field-ignored` | yes | yes | never | no | no | yes |
| `warning` | track | `track-data` | any | yes | yes | never | no | no | yes |
| `warning` | track | `tooltip-field-miss` | any | yes | yes | never | no | no | yes |
| `warning` | track | any | any | yes | yes | under `strict` | yes | no | yes |
| `info` | viewer | any | any | yes | no | never | — | no | no |
| `info` | track | any | any | yes | no | never | no | no | no |

Reading it:

- A **viewer-scoped error** leaves nothing to render past it — no config, or no
  sequence — so the panel replaces the viewer whether or not `strict` is set.
- A **track-scoped** failure leaves the rest of the viewer working, so the row
  carries it as a `⚠` badge. `strict` promotes the batch to a single aggregated
  panel; without `strict` the badges stand alone.
- A **viewer-scoped warning** names something legal that loaded as written — a
  config warning, or a `theme:` field that could not be resolved. It never
  raises the panel, even under `strict`: hiding a working viewer behind a notice
  about something that worked is not a louder failure, just a less useful one.
  Two of them change what is on screen, so they also carry a **visitor
  notice** on the viewer: a track whose data URL was never fetched (an
  undefined `{variable}`), and a component with no renderer. A `theme:` colour
  that didn't resolve leaves the default colours in place and nothing missing,
  so it has none.
- The one exception is a rejected **`setTrackData()`** call, which `strict` does
  promote. The rows above are read most-specific-first, so a row naming a
  `phase` wins over the `any` row for the same severity and scope. A config
  warning describes something that happened as written; an ignored API call
  describes something the caller asked for that did not happen, which is what
  `strict` exists to make loud.
- A **`track-data`** warning — rows whose coordinates fall outside the
  sequence, a column of your file that was ignored, a colour the canvas cannot
  paint — goes the other way for a track. The rows loaded and render as
  written, so it takes neither the `⚠` badge nor the panel: a badge would mark
  a working row as broken. Where the visitor would otherwise be misled —
  features not drawn in full, colours not painted — the track gets a quieter
  **visitor notice** instead. An ignored column changes nothing drawn, so it
  has none.
- A **`tooltip-field-miss`** warning is the same for the same reason: every
  record renders, and only the track's tooltip template names a field the data
  never has. No badge and no panel; the event and the console line carry it.
- **`info`** is an expected absence, not a failure: a provider endpoint
  answering 404 for an entity with no data of this kind, or a `from: custom`
  track nobody injected data into. It gets a console line and no user surface.
- **Author mode** lists everything the `protvista-error` event carries — every
  error and every warning, never `info` — so its column is the event's.

A **Retry** control appears on whichever surface carried the failure, and only
when retrying could plausibly change the answer: a network error or a 5xx may
be transient, and a path or URL to your own data that 404s is something *you*
can fix — correct it or drop the file into place, then Retry reloads that one
track instead of the whole page. A built-in provider adapter that throws gets a
Retry too: some make requests of their own (the AlphaFold confidence and
AlphaMissense tracks each fetch a second file), so their failures can be as
temporary as a 5xx. A
malformed file, a malformed `setTrackData()` payload, an unregistered adapter
name and a payload the track could not draw all get no Retry: they would fail
the same way again with no action available in between.

### The `context` object

Every field is optional; the reporter fills in what's relevant to the phase.
`accession` is always set when the element has one. For `track-fetch`,
`errorKind` is one of:

- `network` — unreachable (offline, blocked, DNS, CORS, or timeout);
- `http` — the server answered with a 5xx, or a path or URL to your own data
  answered 4xx (`status` is set). A 4xx from a provider endpoint is treated as
  "missing, not broken", so it does not fire a `track-fetch` event;
- `parse` — a successful response whose body couldn't be parsed;
- `adapter` — the body arrived, but the decoder, the shape validator or the
  named adapter threw on it. For your own file, the badge and the event carry
  the thrown message verbatim, which names your file and the offending row; for
  a provider adapter, they name the URL the data came from;
- `render` — the payload was built, and the track itself rejected it on
  handover (a line graph handed feature records, say). `trackId` is absent when
  the rejected payload was a collapsed group's combined view rather than one
  track's.

## Common problems

### Nothing renders at all

The viewer needs a protein: an `accession` (the attribute, or `accession:` in
the config) for a UniProt entry, or a [`sequence:`](/protvista/sequence-only)
for your own. With neither, it shows the config panel with one issue,
`missing-protein`: "Nothing to show: set 'accession:' (a UniProt entry) or
'sequence:' (your own protein), or the element's accession attribute." Set one
of them. A wrong accession shows the "No UniProt entry found" panel instead.

While the first load is in flight you see a spinner, and screen readers hear
"Loading protein data…" — so a region that stays *blank* is not a slow load.
Check that `suspend` is not still on the element.

### A track shows up empty

Almost always a **path** issue with a file-backed track. `data: ./hotspots.csv`
is resolved relative to the **hosting page**, not the config file — so the
browser may be looking in the wrong place. Serve the page from the same
directory as the data, or use an absolute URL. See the path note in
[Load your own data](/protvista/your-data#a-path-gotcha-to-know).

The viewer says so on screen. A relative path that 404s shows a `⚠` badge
reading "`./hotspots.csv` could not be found (HTTP 404) — check the path is
relative to the page." An absolute URL, or the `{ url: … }` form, that 404s
reads "… could not be found (HTTP 404) — check the URL." A JSON file whose
top level is not an array — `{ "features": [...] }` rather than `[...]` — shows
a badge too. So a track that stays empty with no badge really did load and
really is empty.

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

To check a file before you host it, load it in the
[playground](/protvista/playground/) with **Load data file…**. The same message
is listed there, naming your file.

When the header is the problem because the file uses a different separator
from the one its format implies — a semicolon export from Excel, a tab file
named `.csv`, a comma file named `.tsv` — the message names the separator the
header seems to use and the fix:

```
./hits.csv (parsed as CSV): missing required header column "type". Header must contain type, start, end, description[, score]. The header looks tab-separated — read it as TSV: set `format: tsv` (or rename the file to .tsv).
```

`format:` always works, because it wins over the extension; a rename is
offered only when the file's extension matches the format it was read as (it
does not help if an explicit `format:` also pins that reading). No `format:`
reads semicolons, so for those save the sheet from Excel as "Text (Tab
delimited)" and read it as TSV, or re-export it comma-separated and read it as
CSV. The viewer never switches separator by itself: only the message changes.

### A tooltip is missing rows or shows blanks

A field a tooltip names that a record does not have renders as nothing: a
`fields` row drops out, and a `{% $field %}` in a template renders empty. That
is normal for a field only some records carry. When **no** record on the track
has it, the name is almost always wrong — a typo, a different capitalisation,
or a column your file calls something else — so the console gets one line per
track naming every such field:

```
[protvista-uniprot] Track domains/hits: dataTooltip references unknown fields: pvalue, Gene
```

The same text fires a `tooltip-field-miss` event (`context.fields` lists the
names), and the [playground](/protvista/playground/) lists it as a warning. The
names a template can use are the record's own: the provider adapter's output,
or the column headers of your file — see
[Fields from your own file](/protvista/data-tooltip#fields-from-your-own-file).
A field that is present but empty — a blank cell in a column of your own — is
not missing; see
[When a field is missing](/protvista/data-tooltip#when-a-field-is-missing) for
the few columns where it is.

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
  (`18.5`). The file is rejected when it loads, as a
  [malformed file](#a-data-file-is-malformed): the track renders empty and its
  `⚠` badge names the row, for example
  `./x.csv (parsed as CSV): row 3: end (4) is before start (5).`

A `track-data` warning reads like this:

```
./hits.csv (parsed as CSV): 12 of 340 rows fall outside P05067 (770 residues); first: row 7, end 812. Coordinates must be 1-based positions on this protein's canonical sequence — check for 0-based coordinates (start 0) or isoform numbering.
```

With a [`sequence:`](/protvista/sequence-only) config the check runs against
your sequence, and the message names its FASTA header (or "your sequence")
where the accession would be: `… fall outside my construct v2 (240 residues) …`.

### Features are all black, or show a ?

A feature whose `type` ProtVista doesn't recognise — `HOTSPOT`, or `BED` for
every record in a `.bed` file — draws as a black rectangle, with nothing but a
console log to say why. A `shape` the canvas track can't draw, misspelt or not,
draws as a question mark. Set `rendering.color` and `rendering.shape` on the
track; [Feature type and shape vocabulary](/protvista/type-and-shape-vocabulary)
lists the recognised types and draws every valid shape.

### The config is rejected

A `config`-phase error carries `detail.issues` describing each problem. Validate
your config as you write it in the [playground](/protvista/playground/) (and
check your data files there with **Load data file…**), or point
your editor at the schema for inline checking — see
[Author a config](/protvista/configure#editor-autocomplete).

### "needs UniProt data", or "both 'accession:' and 'sequence:'"

These come from a [`sequence:`](/protvista/sequence-only) config, which shows
your own protein with no UniProt entry behind it.

- `needs-accession` — a track can't work without a UniProt entry: a data URL
  with `{accession}`, an AlphaFold or AlphaMissense kind, or a label that links
  to an `{accession}` URL. Point the track at your own file, inline data or a
  `from: custom` source, or remove it. A config that `extends:` the UniProt
  default gets one of these per inherited track, plus a summary: start from a
  blank config instead.
- `accession-and-sequence` — the config sets both, or the element's
  `accession` attribute is set on a `sequence:` config. Keep one.
- `invalid-sequence` / `cannot-resolve-sequence` — the sequence itself is not
  one protein (several FASTA records, a character outside A–Z, no residues),
  or the FASTA file could not be fetched. The message names the file and,
  for a bad residue, its position.

### A URL track fails to load

Look at `errorKind`: `network` usually means CORS or connectivity (the data
server must allow cross-origin requests from your page); `http` with a `status`
means the server returned a 5xx; `parse` means the body could not be parsed at
all, and the message carries the parser's own complaint (where in the body it
gave up); `adapter` means the decoder rejected the records themselves.
Confirm the URL in a browser tab, and check it returns the
[shape the adapter expects](/protvista/adapter-reference). (A 4xx such as 404
from a *provider endpoint* is treated as "no data for this track" and is hidden
rather than reported as an error. From a `from: file` source — with a format or
an explicit `adapter:` — or any URL with a declared `format`, it is reported:
there a 404 can only mean the path or URL is wrong.)

## Where to go next

- [Load your own data](/protvista/your-data) — data shapes and the path gotcha.
- [Escape hatches](/protvista/escape-hatches) — custom adapters and error handling.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
