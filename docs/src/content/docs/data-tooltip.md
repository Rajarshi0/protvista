---
title: Authoring dataTooltip
---

`dataTooltip` controls the per-datapoint tooltip shown when a user clicks a feature on a track. It has three authoring forms, listed here from least to most expressive. Pick the simplest one that works — the rendering pipeline is the same for all three.

All three forms run through the same renderer: every field value is HTML-escaped at the leaf, link `href`s are routed through a scheme allowlist (`http:`, `https:`, `mailto:`, and root-relative forms such as `/…`, `#…` and `?…`; `javascript:`, `data:` and bare relative paths are dropped), and rich / interactive tooltips are not a config concern. If you need a custom React panel, evidence badges, taxonomy lookups, or any other stateful UI, listen for the Nightingale `change` event on the element and mount your own overlay, setting the `notooltip` attribute on `<protvista-uniprot>` to suppress the built-in popover.

When a track has no `dataTooltip` at all, the resolver falls back to a per-kind default if one exists, and otherwise synthesizes a compact Markdoc tooltip from adapted payload fields such as `type`, `description`, position, variant details, significance, score, xrefs, evidences, and remaining scalar fields. Configs that don't author a tooltip therefore still get a useful safety-net tooltip out of the box.

## Bare-string form

A one-line Markdoc template. The YAML value is a string, so no quoting with nested maps needed. Shorthand for `{ kind: markdown, template: "…" }`. Fields on the datapoint are in scope as `$field`.

```yaml
tracks:
  - id: signal
    label: Signal peptide
    kind: features
    filter: SIGNAL
    data: features
    dataTooltip: '**Signal peptide** {% $begin %}–{% $end %}'
```

## `kind: fields` form

A declarative list of labelled rows. Each entry renders as `<h5>label</h5><p>value</p>`. Use this when the tooltip is a flat property sheet without prose or conditional content.

`path` is a dotted path against the item (e.g. `association.0.name`). Missing or empty values drop out silently rather than rendering an empty row. The value at `path` is coerced to string, HTML-escaped, and wrapped in `<p>` at the leaf. There is no per-field render hook; when you need rich, interactive, or stateful tooltips (xref badges, evidence icons, taxonomy lookups, React components, …), own the overlay in the host instead — see [React host integration](/protvista/react-integration).

```yaml
tracks:
  - id: compbias
    label: Compositional bias
    kind: features
    filter: COMPBIAS
    data: features
    dataTooltip:
      kind: fields
      fields:
        - { path: type, label: Type }
        - { path: description, label: Description }
        - { path: begin, label: Start }
        - { path: end, label: End }
```

## `kind: markdown` form

A full Markdoc template. Use this when the tooltip needs prose or conditional fragments. Field interpolation uses `{% $field %}`; flow control uses Markdoc's `{% if %}` / `{% else %}` / `{% /if %}`.

```yaml
tracks:
  - id: domain
    label: Domain
    kind: features
    filter: DOMAIN
    data: features
    dataTooltip:
      kind: markdown
      template: |
        ### {% $description %}
        **Position:** {% $begin %}–{% $end %}
        {% if $score %}**Score:** {% $score %}{% /if %}
```

## Links from a field

Markdoc cannot put a variable into an ordinary link's destination, so a field that holds a URL — a `url` column in your own file, say — becomes a link with the `{% link %}` tag:

```yaml
dataTooltip:
  kind: markdown
  template: |
    PMID {% $pmid %}: {% link href=$url %}read on PubMed{% /link %}
```

The self-closing form, `{% link href=$url /%}`, uses the URL itself as the link text. The URL goes through the same allowlist as every other link: only an absolute `http:` / `https:` / `mailto:` URL or a root-relative one (`/…`, `#…`, `?…`) becomes a link. Anything else — `javascript:`, a bare relative path like `docs/x.html`, or a feature whose `url` is empty or missing — renders the text alone, with no link. Links open in the same tab.

## Fields from your own file

Any column of your own CSV or TSV file, or any key of your JSON records, is in scope as `$column` in a template and as a `path` in a `fields` list — not only the documented feature fields. See [Style and annotate each feature from your file](/protvista/your-data#style-and-annotate-each-feature-from-your-file). Name columns like identifiers (`gene_name`, `p-value`): a template cannot reference a name with a space in it, a `fields` path cannot reach one with a dot in it, and `$ctx` always means the tooltip context, never a column called `ctx`.

## When to leave `dataTooltip` off

For every track in the default config, no `dataTooltip` is set. Each semantic `kind` carries a sensible tooltip default — authors who just want the canonical UniProt look get it for free. Only set `dataTooltip` when you want a track-specific override, or when you're authoring a track that doesn't match an existing kind's default.

## Line graphs

A line graph has no per-feature datapoint to template, so `dataTooltip` does not apply to it. Clicking a line graph opens a fixed tooltip instead: the clicked position, then each series' value there.

_Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)._
