/**
 * Loader contract tests.
 *
 * Covers:
 *   - all three input forms (object, JSON string, YAML string);
 *   - content-based format detection;
 *   - explicit `format` override;
 *   - successful round-trip to `NormalizedConfig`;
 *   - `ConfigValidationError` on semantic failure (with issues);
 *   - `SyntaxError` propagation from the underlying parser;
 *   - rejection of `!!js/function` (constraint C4);
 *   - rejection of a document with no content.
 *
 * YAML tests rely on `js-yaml` being installed. They are `it.runIf`-
 * gated on its presence so the file still collects on a fresh
 * install where the package tree is incomplete; normal CI always
 * has it resolved.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadConfig, loadConfigWithSource } from '../load.js';
import { ConfigValidationError } from '../errors.js';
import { createRegistry } from '../registry.js';

const minimalValidObject = () => ({
  rows: [
    {
      id: 'DOMAINS',
      tracks: [{ id: 'domain', kind: 'features', data: 'features' }],
    },
  ],
  sources: { features: 'https://example.org/features' },
});

const minimalValidJson = () => JSON.stringify(minimalValidObject());

const minimalValidYaml = () => `
rows:
  - id: DOMAINS
    tracks:
      - id: domain
        kind: features
        data: features
sources:
  features: https://example.org/features
`.trim();

// ─────────────────────────────────────────────────────────────
// Object input
// ─────────────────────────────────────────────────────────────

describe('loadConfig — object input', () => {
  it('accepts an object and returns a NormalizedConfig', async () => {
    const normalized = await loadConfig(minimalValidObject());
    expect(normalized.version).toBe('1.0');
    expect(normalized.rows).toHaveLength(1);
    expect(normalized.rows[0].id).toBe('DOMAINS');
    expect(normalized.rows[0].tracks[0].component).toBe(
      'nightingale-track-canvas'
    );
  });

  it('uses a caller-provided registry', async () => {
    const registry = createRegistry();
    const normalized = await loadConfig(minimalValidObject(), { registry });
    expect(normalized.rows[0].tracks[0].kind).toBe('features');
  });

  it('throws ConfigValidationError on invalid input', async () => {
    const bad = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'not-a-kind', data: 'missingKey' }],
        },
      ],
    };
    await expect(loadConfig(bad)).rejects.toThrow(ConfigValidationError);
  });

  it('ConfigValidationError carries an `issues[]` array', async () => {
    const bad = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'not-a-kind', data: 'missingKey' }],
        },
      ],
    };
    try {
      await loadConfig(bad);
      throw new Error('expected loadConfig to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const cve = err as ConfigValidationError;
      expect(cve.issues.length).toBeGreaterThan(0);
      expect(cve.issues.some((i) => i.code === 'unknown-semantic-kind')).toBe(
        true
      );
      expect(cve.issues.some((i) => i.code === 'unknown-source-key')).toBe(
        true
      );
    }
  });

  it('error message lists every issue', async () => {
    const bad = {
      rows: [
        {
          id: 'X',
          tracks: [{ id: 'y', kind: 'not-a-kind', data: 'missingKey' }],
        },
      ],
    };
    try {
      await loadConfig(bad);
    } catch (err) {
      const cve = err as ConfigValidationError;
      expect(cve.message).toMatch(/Config validation failed \(\d+ issues?\)/);
      expect(cve.message).toContain('unknown-semantic-kind');
      expect(cve.message).toContain('unknown-source-key');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// JSON string input
// ─────────────────────────────────────────────────────────────

describe('loadConfig — JSON string input', () => {
  it('parses a valid JSON string', async () => {
    const normalized = await loadConfig(minimalValidJson());
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });

  it('propagates SyntaxError from malformed JSON', async () => {
    await expect(loadConfig('{ not json }')).rejects.toThrow(SyntaxError);
  });

  it('detects JSON from leading `{`', async () => {
    const normalized = await loadConfig(`   ${minimalValidJson()}`);
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });

  it('respects explicit format: "json"', async () => {
    const normalized = await loadConfig(minimalValidJson(), { format: 'json' });
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });
});

// ─────────────────────────────────────────────────────────────
// YAML string input
// ─────────────────────────────────────────────────────────────

describe('loadConfig — YAML string input', () => {
  it('parses a valid YAML string', async () => {
    const normalized = await loadConfig(minimalValidYaml());
    expect(normalized.rows[0].id).toBe('DOMAINS');
    expect(normalized.sources.features).toBe(
      'https://example.org/features'
    );
  });

  it('detects YAML when the leading char is not { or [', async () => {
    // Same content as the JSON test but lacks braces → YAML path.
    const normalized = await loadConfig(minimalValidYaml());
    expect(normalized.rows[0].tracks[0].kind).toBe('features');
  });

  it('respects explicit format: "yaml"', async () => {
    const normalized = await loadConfig(minimalValidYaml(), {
      format: 'yaml',
    });
    expect(normalized.rows[0].id).toBe('DOMAINS');
  });

  it('YAML round-trips: JSON → YAML → JSON has identical normalized output', async () => {
    const fromJson = await loadConfig(minimalValidJson());
    const fromYaml = await loadConfig(minimalValidYaml());
    expect(fromYaml).toEqual(fromJson);
  });

  // Constraint C4: `CORE_SCHEMA` carries no `!!js/*` tags, so a config
  // cannot construct arbitrary JS objects. This is a security boundary,
  // so assert it rather than trusting the schema argument stays put.
  it('rejects the `!!js/function` tag', async () => {
    await expect(
      loadConfig("rows: !!js/function 'function () { return 1; }'")
    ).rejects.toThrow();
  });

  // A document with no content is version-dependent in js-yaml (4.x
  // returns undefined/null, 5.x throws), so `parseYaml` pins it.
  it('rejects a blank document', async () => {
    await expect(loadConfig('')).rejects.toThrow(SyntaxError);
  });

  it('rejects a whitespace-only document', async () => {
    await expect(loadConfig('   \n\n  ')).rejects.toThrow(SyntaxError);
  });

  it('rejects a comments-only document', async () => {
    await expect(
      loadConfig('# just a comment\n# and another')
    ).rejects.toThrow(SyntaxError);
  });

  it('treats a bare `---` as a document, not as empty', async () => {
    // Parses to `null`, which is a valid parse but an invalid config —
    // so it must fail validation, not YAML syntax.
    await expect(loadConfig('---')).rejects.toThrow(ConfigValidationError);
  });
});

// ─────────────────────────────────────────────────────────────
// Invalid input types
// ─────────────────────────────────────────────────────────────

describe('loadConfig — invalid input type', () => {
  it('throws TypeError on number input', async () => {
    await expect(loadConfig(42 as unknown)).rejects.toThrow(TypeError);
  });

  it('throws TypeError on null input', async () => {
    await expect(loadConfig(null as unknown)).rejects.toThrow(TypeError);
  });
});

// ─────────────────────────────────────────────────────────────
// Warnings on a config that still loads
// ─────────────────────────────────────────────────────────────

describe('loadConfigWithSource — warnings', () => {
  const overridingConfig = {
    accession: 'P05067',
    rows: [
      {
        id: 'X',
        tracks: [
          {
            id: 'y',
            kind: 'features',
            data: { from: 'file', url: './hits.tsv', format: 'csv' },
          },
        ],
      },
    ],
  };

  it('returns the issues a valid config still raised', async () => {
    // Warnings used to be dropped here, so nothing downstream could reach
    // them: not the console, not `protvista-error`, not the ⚠ badge, not CI.
    const loaded = await loadConfigWithSource(overridingConfig);
    expect(loaded.issues.map((i) => i.code)).toEqual([
      'format-overrides-extension',
    ]);
    expect(loaded.issues[0].severity).toBe('warning');
  });

  it('returns no issues for a clean config', async () => {
    const loaded = await loadConfigWithSource(minimalValidObject());
    expect(loaded.issues).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Runtime variables
// ─────────────────────────────────────────────────────────────

describe('loadConfigWithSource — runtime variables', () => {
  const templated = {
    accession: 'P05067',
    sources: { features: 'https://e.org/{species}/{build}/{accession}' },
    rows: [
      {
        id: 'X',
        tracks: [{ id: 'y', kind: 'features', data: 'features' }],
      },
    ],
  };

  it('warns about tokens defined nowhere, and still loads', async () => {
    const loaded = await loadConfigWithSource(templated);
    expect(loaded.issues.map((i) => i.code)).toEqual([
      'missing-variable',
      'missing-variable',
    ]);
    expect(loaded.config.rows).toHaveLength(1);
  });

  it('does not warn about tokens the caller supplies at runtime', async () => {
    const loaded = await loadConfigWithSource(templated, {
      variables: { species: 'mouse', build: 'v1' },
    });
    expect(loaded.issues).toEqual([]);
  });

  it('does not inject runtime variable values into the config', async () => {
    // Only the *names* matter at validation time — values are read at
    // fetch time, so a later data-* change takes effect.
    const loaded = await loadConfigWithSource(templated, {
      variables: { species: 'mouse', build: 'v1' },
    });
    expect(loaded.config.variables).toBeUndefined();
    expect(loaded.authored.variables).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Sequence-only mode (`sequence:`)
// ─────────────────────────────────────────────────────────────

describe('loadConfigWithSource — sequence mode', () => {
  const rows = [
    {
      id: 'g',
      tracks: [
        {
          id: 't',
          kind: 'features',
          data: { from: 'inline', inlineData: [{ start: 1, end: 3 }] },
        },
      ],
    },
  ];
  const FASTA = '>my construct v2\nMKTAY\nIAKQR\n';
  const issuesOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      return (err as ConfigValidationError).issues;
    }
    throw new Error('expected a ConfigValidationError');
  };

  it('resolves an inline sequence onto the normalized config', async () => {
    const { config } = await loadConfigWithSource({ sequence: FASTA, rows });
    expect(config.sequence).toEqual({
      residues: 'MKTAYIAKQR',
      header: 'my construct v2',
    });
    expect(config.accession).toBeUndefined();
  });

  it('fetches a referenced file once, with its path, and keeps the path authored', async () => {
    const sequenceFetcher = vi.fn(async () => FASTA);
    const { config, authored } = await loadConfigWithSource(
      { sequence: './protein.fasta', rows },
      { sequenceFetcher }
    );
    expect(sequenceFetcher).toHaveBeenCalledTimes(1);
    expect(sequenceFetcher).toHaveBeenCalledWith('./protein.fasta');
    expect(config.sequence?.residues).toBe('MKTAYIAKQR');
    // `getConfig()` exports the path, not the residues.
    expect(authored.sequence).toBe('./protein.fasta');
  });

  it('never fetches for a config that fails validation', async () => {
    const sequenceFetcher = vi.fn(async () => FASTA);
    const issues = await issuesOf(
      loadConfigWithSource(
        { sequence: './protein.fasta', accession: 'P05067', rows },
        { sequenceFetcher }
      )
    );
    expect(issues.map((i) => i.code)).toEqual(['accession-and-sequence']);
    expect(sequenceFetcher).not.toHaveBeenCalled();
  });

  it('turns a fetcher failure into cannot-resolve-sequence', async () => {
    const issues = await issuesOf(
      loadConfigWithSource(
        { sequence: './protein.fasta', rows },
        {
          sequenceFetcher: async () => {
            throw new Error('HTTP 404 Not Found');
          },
        }
      )
    );
    expect(issues).toEqual([
      {
        path: '/sequence',
        code: 'cannot-resolve-sequence',
        message:
          "Could not load the sequence file './protein.fasta': HTTP 404 Not Found.",
      },
    ]);
  });

  it('names the status of a 404 through the default fetcher', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({ ok: false, status: 404, statusText: 'Not Found' }) as Response
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const issues = await issuesOf(
        loadConfigWithSource({ sequence: './missing.fasta', rows })
      );
      expect(fetchMock).toHaveBeenCalledWith('./missing.fasta');
      expect(issues.map((i) => [i.code, i.message])).toEqual([
        [
          'cannot-resolve-sequence',
          "Could not load the sequence file './missing.fasta': HTTP 404 Not Found.",
        ],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never lets a raw TypeError through for a relative path under Node', async () => {
    // Node's fetch can't resolve a page-relative URL; no `sequenceFetcher`.
    const issues = await issuesOf(
      loadConfigWithSource({ sequence: './protein.fasta', rows })
    );
    expect(issues.map((i) => i.code)).toEqual(['cannot-resolve-sequence']);
    expect(issues[0].message).toContain("'./protein.fasta'");
  });

  it('rejects a multi-record file as invalid-sequence', async () => {
    const issues = await issuesOf(
      loadConfigWithSource(
        { sequence: './two.fasta', rows },
        { sequenceFetcher: async () => '>a\nMKT\n>b\nMKT\n' }
      )
    );
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['/sequence', 'invalid-sequence'],
    ]);
    expect(issues[0].message).toBe(
      "./two.fasta (parsed as FASTA): contains 2 records; the viewer shows one protein. Keep a single '>' record."
    );
  });

  it('does not inject a host accession, and says the host supplied it', async () => {
    const issues = await issuesOf(
      loadConfigWithSource({ sequence: FASTA, rows }, { accession: 'P05067' })
    );
    expect(issues).toEqual([
      {
        path: '/',
        code: 'accession-and-sequence',
        message:
          "An accession ('P05067') was supplied by the host (the element's accession attribute), but this config declares 'sequence:'. Use 'accession:' to show a UniProt entry, or 'sequence:' to show your own protein — not both. Remove the attribute, or the 'sequence:'.",
      },
    ]);
  });

  it('adds a start-from-blank summary when extended tracks need UniProt', async () => {
    const base = {
      sources: {
        features: 'https://www.ebi.ac.uk/proteins/api/features/{accession}',
      },
      rows: [
        { id: 'a', tracks: [{ id: 'x', kind: 'features', data: 'features' }] },
        { id: 'b', tracks: [{ id: 'y', kind: 'features', data: 'features' }] },
      ],
    };
    const issues = await issuesOf(
      loadConfigWithSource(
        { extends: 'base', sequence: FASTA, rows },
        { extendsResolver: { base } }
      )
    );
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['a/x', 'needs-accession'],
      ['b/y', 'needs-accession'],
      ['/extends', 'needs-accession'],
    ]);
    expect(issues[2].message).toBe(
      "2 tracks inherited through 'extends:' need UniProt data. 'sequence:' can't build on the UniProt default config — start from a blank config instead."
    );
  });

  it('reports missing-protein alone for a protein-less default config', async () => {
    const { default: defaultConfigYaml } =
      await import('../../default-config.yaml?raw');
    const issues = await issuesOf(
      loadConfigWithSource(defaultConfigYaml, { requireProtein: true })
    );
    expect(issues).toEqual([
      {
        path: '/',
        code: 'missing-protein',
        message:
          "Nothing to show: set 'accession:' (a UniProt entry) or 'sequence:' (your own protein), or the element's accession attribute.",
      },
    ]);
  });

  it('accepts a protein-less template without requireProtein', async () => {
    const { config } = await loadConfigWithSource({ rows });
    expect(config.accession).toBeUndefined();
    expect(config.sequence).toBeUndefined();
  });
});
