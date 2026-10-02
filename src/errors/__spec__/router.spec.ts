/**
 * The routing table: its own behaviour, its agreement with the published
 * documentation, and the matrix of failure classes that has to reach it.
 *
 * Three things are pinned here, each guarding a different way the old
 * ad-hoc routing went wrong:
 *
 *   1. **Totality and the table itself.** Routing used to be a conditional at
 *      each failure site, so a new failure class could simply not be routed —
 *      and several weren't. The table covers every (severity, scope) pair, so
 *      a report cannot fall through.
 *   2. **Drift against the docs.** The table is published in
 *      `docs/src/content/docs/troubleshooting.md`. A table a reader can't trust
 *      is worse than no table, so the doc is parsed and compared.
 *   3. **No second channel.** Failure sites must not call `console.*` or
 *      render surfaces themselves — that is how the "best message only reaches
 *      the console" problem got in. The sources are scanned for it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ROUTING_TABLE,
  routeFailure,
  ruleFor,
  scopeAxis,
  type FailureReport,
  type FailureSeverity,
} from '../router.js';

// Vitest runs from the repo root, so resolve paths from cwd.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const SEVERITIES: FailureSeverity[] = ['error', 'warning', 'info'];
const SCOPES = ['viewer', 'track'] as const;

/** A minimal report of a given severity and scope. */
const report = (
  severity: FailureSeverity,
  scope: 'viewer' | 'track',
  extra: Partial<FailureReport> = {}
): FailureReport => ({
  severity,
  // A phase with no qualified row of its own, so the unqualified rows are what
  // the general cases below exercise.
  phase: 'track-fetch',
  scope: scope === 'viewer' ? 'viewer' : { trackKey: 'g-y' },
  message: 'something went wrong',
  consoleLevel: 'warn',
  ...extra,
});

describe('the routing table is total', () => {
  it('covers every (severity, scope) pair with exactly one unqualified row', () => {
    // Totality lives in the unqualified rows: they are the fallback every
    // report lands on. A phase-qualified row is an override on top, so it must
    // not be the only row for its pair — otherwise some other phase with that
    // severity and scope would have nothing to match.
    const unqualified = ROUTING_TABLE.filter((r) => r.phase === undefined);
    const seen = unqualified.map((r) => `${r.severity}/${r.scope}`);
    const expected = SEVERITIES.flatMap((s) => SCOPES.map((sc) => `${s}/${sc}`));
    expect([...seen].sort()).toEqual([...expected].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives a phase-qualified row precedence over its unqualified pair', () => {
    const qualified = ROUTING_TABLE.filter((r) => r.phase !== undefined);
    expect(qualified.length).toBeGreaterThan(0);
    for (const rule of qualified) {
      const picked = ruleFor(
        report(rule.severity, rule.scope, { phase: rule.phase })
      );
      expect(picked).toBe(rule);
      // …and a different phase with the same severity and scope still gets the
      // unqualified row, so the override is narrow.
      const other = ruleFor(
        report(rule.severity, rule.scope, { phase: 'sequence' })
      );
      expect(other.phase).toBeUndefined();
    }
  });

  it('never qualifies a row without also keeping its unqualified pair', () => {
    for (const rule of ROUTING_TABLE.filter((r) => r.phase !== undefined)) {
      const fallback = ROUTING_TABLE.find(
        (r) =>
          r.phase === undefined &&
          r.severity === rule.severity &&
          r.scope === rule.scope
      );
      expect(fallback, `${rule.severity}/${rule.scope}`).toBeDefined();
    }
  });

  it('resolves a rule for every pair, strict or not', () => {
    for (const severity of SEVERITIES) {
      for (const scope of SCOPES) {
        expect(ruleFor(report(severity, scope))).toBeDefined();
        for (const strict of [false, true]) {
          expect(() =>
            routeFailure(report(severity, scope), { strict })
          ).not.toThrow();
        }
      }
    }
  });

  it('gives every rule a rationale (the table is documentation too)', () => {
    for (const rule of ROUTING_TABLE) {
      expect(rule.rationale.length).toBeGreaterThan(20);
    }
  });

  it('never badges a viewer-scoped failure (there is no row to badge)', () => {
    for (const rule of ROUTING_TABLE.filter((r) => r.scope === 'viewer')) {
      expect(rule.badge).toBe(false);
    }
  });

  it('reads a track scope off the key, a viewer scope off the literal', () => {
    expect(scopeAxis('viewer')).toBe('viewer');
    expect(scopeAxis({ trackKey: 'g-y' })).toBe('track');
  });
});

describe('strict is read in exactly one place', () => {
  it('promotes track-scoped failures to the panel only under strict', () => {
    for (const severity of ['error', 'warning'] as const) {
      const lax = routeFailure(report(severity, 'track'), { strict: false });
      const strict = routeFailure(report(severity, 'track'), { strict: true });
      expect(lax.panel).toBe(false);
      expect(strict.panel).toBe(true);
      // The badge is not a strict-only surface: the row says so either way.
      expect(lax.badge).toBe(true);
      expect(strict.badge).toBe(true);
    }
  });

  it('panels a viewer-scoped error with or without strict', () => {
    for (const strict of [false, true]) {
      expect(routeFailure(report('error', 'viewer'), { strict }).panel).toBe(
        true
      );
    }
  });

  it('never panels a viewer-scoped warning, even under strict', () => {
    // A warning names something legal that loaded as written. Raising the
    // panel would hide a working viewer behind a notice about a non-problem.
    expect(routeFailure(report('warning', 'viewer'), { strict: true }).panel).toBe(
      false
    );
  });

  it('keeps info off every user surface, strict or not', () => {
    for (const scope of SCOPES) {
      for (const strict of [false, true]) {
        const channels = routeFailure(report('info', scope), { strict });
        expect(channels.event).toBe(false);
        expect(channels.panel).toBe(false);
        expect(channels.badge).toBe(false);
        expect(channels.retry).toBe(false);
        // …but the developer channel always carries it.
        expect(channels.console).not.toBeNull();
      }
    }
  });

  it('keeps a track-data warning to the event and console, even under strict', () => {
    // The row loaded and renders as written — coordinates outside the
    // sequence, a column the decoder ignored, an unpaintable colour — so no
    // surface may mark it broken.
    for (const strict of [false, true]) {
      const channels = routeFailure(
        report('warning', 'track', { phase: 'track-data' }),
        { strict }
      );
      expect(channels.event).toBe(true);
      expect(channels.panel).toBe(false);
      expect(channels.badge).toBe(false);
      expect(channels.console).toBe('warn');
    }
  });
});

describe('retry follows recoverability, and only where surfaced', () => {
  it('offers Retry for a recoverable failure on its surface', () => {
    const badge = routeFailure(
      report('error', 'track', { recoverable: true }),
      { strict: false }
    );
    expect(badge.badge).toBe(true);
    expect(badge.retry).toBe(true);

    const panel = routeFailure(
      report('error', 'viewer', { recoverable: true }),
      { strict: false }
    );
    expect(panel.panel).toBe(true);
    expect(panel.retry).toBe(true);
  });

  it('offers none for a deterministic failure', () => {
    for (const scope of SCOPES) {
      expect(
        routeFailure(report('error', scope, { recoverable: false }), {
          strict: false,
        }).retry
      ).toBe(false);
    }
  });

  it('offers none where nothing is surfaced to carry it', () => {
    // A recoverable `info` is a contradiction, but the table should not
    // produce a Retry hanging off a surface that does not exist.
    expect(
      routeFailure(report('info', 'track', { recoverable: true }), {
        strict: false,
      }).retry
    ).toBe(false);
  });
});

describe('the published routing table matches the implementation', () => {
  const doc = read('docs/src/content/docs/troubleshooting.md');

  /** Rows of the "Where a failure shows up" table, as `|`-split cells. */
  const docRows = (() => {
    const section = doc.split('### Where a failure shows up')[1];
    if (!section) throw new Error('routing table section not found in the doc');
    return section
      .split('\n')
      .filter((l) => /^\|/.test(l))
      // Drop the header and its `| --- |` separator.
      .slice(2)
      .map((l) =>
        l
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim().replace(/`/g, ''))
      );
  })();

  it('publishes one row per rule, in the same order', () => {
    expect(docRows).toHaveLength(ROUTING_TABLE.length);
    expect(docRows.map(([sev, scope, phase]) => `${sev}/${scope}/${phase}`)).toEqual(
      ROUTING_TABLE.map((r) => `${r.severity}/${r.scope}/${r.phase ?? 'any'}`)
    );
  });

  it('publishes the same channels each rule routes to', () => {
    const yesNo = (v: boolean) => (v ? 'yes' : 'no');
    // The badge column is written `—` for a viewer scope, where the question
    // does not apply.
    const badgeCell = (rule: (typeof ROUTING_TABLE)[number]) =>
      rule.scope === 'viewer' ? '—' : yesNo(rule.badge);
    const panelCell = (rule: (typeof ROUTING_TABLE)[number]) =>
      ({ always: 'always', strict: 'under strict', never: 'never' })[rule.panel];

    ROUTING_TABLE.forEach((rule, i) => {
      const [, , , consoleCell, eventCell, panel, badge] = docRows[i];
      const where = `${rule.severity}/${rule.scope}`;
      // Every routed failure reaches the console; the table says so per row
      // so a reader never has to infer it.
      expect(consoleCell, `${where} console`).toBe('yes');
      expect(eventCell, `${where} event`).toBe(yesNo(rule.event));
      expect(panel, `${where} panel`).toBe(panelCell(rule));
      expect(badge, `${where} badge`).toBe(badgeCell(rule));
    });
  });
});

/**
 * Strip comments so the scans below read code, not prose. The guards are about
 * what the module *does*; a comment explaining why a channel moved must not
 * read as that channel still being there.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('failure sites report rather than route', () => {
  const sources = {
    'src/protvista-uniprot.ts': code(read('src/protvista-uniprot.ts')),
    'src/load-data.ts': code(read('src/load-data.ts')),
  };

  /** Every `console.x(` / `console[x](` call in a source. */
  const consoleCalls = (src: string) => [
    ...src.matchAll(/\bconsole\s*(?:\.\w+|\[[^\]]+\])\s*\(/g),
  ].map((m) => m[0]);

  it('leaves the loader with no console channel of its own', () => {
    // The loader renders nothing and has no surfaces, so a console call there
    // would be a second, unrouted channel — which is precisely how a
    // malformed data file used to reach only a developer with the console
    // open. (Adapters keep their own per-row diagnostics; those degrade a
    // row rather than failing a track, and are out of this pipeline.)
    expect(consoleCalls(sources['src/load-data.ts'])).toEqual([]);
  });

  it('makes exactly one console call in the component, inside the router seam', () => {
    const calls = consoleCalls(sources['src/protvista-uniprot.ts']);
    // Every failure class now routes, so there is one `console` call in the
    // whole module and it is indexed by the channel the router returned.
    expect(calls).toEqual(['console[channels.console](']);
    expect(sources['src/protvista-uniprot.ts']).toContain(
      'console[channels.console](report.message'
    );
  });

  it('dispatches protvista-error from the seam only', () => {
    const dispatches = [
      ...sources['src/protvista-uniprot.ts'].matchAll(/'protvista-error'/g),
    ];
    expect(dispatches).toHaveLength(1);
  });

  it('keeps the loader free of surfaces and of the event', () => {
    expect(sources['src/load-data.ts']).not.toContain('protvista-error');
    expect(sources['src/load-data.ts']).not.toContain('dispatchEvent');
  });

  it('raises the alert panel only from the two routed paths', () => {
    // `_report`'s routed promotion, plus `_syncTrackPanel`, the one aggregate
    // over every failing track — which both the per-track correlation pass and
    // the render-handover failure hand their routed answer to, and which
    // re-asks the router (`_route`) about the rest of the set. Any further
    // caller is a site deciding for itself.
    const raises = [
      ...sources['src/protvista-uniprot.ts'].matchAll(
        /this\._setMountError\(/g
      ),
    ];
    expect(raises).toHaveLength(2);
    // Each one is reached only behind a routed decision, never a `strict` read:
    // the block enclosing the call — the nearest line above it that is
    // indented less — must be an `if` on the router's answer. Checking that
    // the guard strings occur *somewhere* in the file passed with either one
    // left unguarded.
    const lines = sources['src/protvista-uniprot.ts'].split('\n');
    const indent = (line: string) => line.length - line.trimStart().length;
    const guards = lines.flatMap((line, i) => {
      if (!line.includes('this._setMountError(')) return [];
      const depth = indent(line);
      let j = i - 1;
      while (j >= 0 && (lines[j].trim() === '' || indent(lines[j]) >= depth)) j--;
      return [lines[j].trim()];
    });
    expect(guards).toHaveLength(2);
    for (const guard of guards) {
      expect(guard).toMatch(/^(?:\} else )?if \((?:channels\.panel|wanted)\b/);
    }
    // `wanted` is the router's answer over the whole set, not a local flag.
    expect(sources['src/protvista-uniprot.ts']).toContain(
      'const wanted = routed.some((c) => c.panel);'
    );
  });

  it('reads config.strict in exactly one place', () => {
    const reads = [
      ...sources['src/protvista-uniprot.ts'].matchAll(
        /config[?]?\.strict/g
      ),
    ];
    expect(reads).toHaveLength(1);
    expect(sources['src/protvista-uniprot.ts']).toContain(
      'strict: this.config?.strict ?? false'
    );
  });
});
