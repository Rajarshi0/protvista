/**
 * The playground's live-validation contract: a good config yields no
 * diagnostics; a syntactically broken one yields a single `syntax`
 * error; a semantically invalid one surfaces the validator's own issue
 * codes (so the editor and `src/schema/validate.ts` never drift).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseConfigText } from '../../schema/parse.js';
import {
  computeDiagnostics,
  lintConfig,
  memoizedExtendsFetcher,
} from '../lint.js';

const VALID = `accession: P05067
rows:
  - id: MY_ANNOTATIONS
    tracks:
      - id: sites
        kind: features
        data:
          from: inline
          inlineData:
            - type: BINDING
              start: 45
              end: 52
`;

describe('computeDiagnostics', () => {
  it('reports nothing for a blank editor', async () => {
    expect(await computeDiagnostics('')).toEqual([]);
    expect(await computeDiagnostics('   \n  ')).toEqual([]);
  });

  it('reports nothing for a valid config', async () => {
    expect(await computeDiagnostics(VALID)).toEqual([]);
  });

  it('reports a single syntax error for malformed YAML at an in-range, non-zero offset', async () => {
    // First line parses; the error is the unterminated flow sequence on
    // line 2, so `offsetFromParseError` (js-yaml's `mark.position`) must
    // report a real offset past the first line — not a hardcoded 0.
    const text = 'good: 1\nbad: [unterminated';
    const diagnostics = await computeDiagnostics(text);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('syntax');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].from).toBeGreaterThan(0);
    expect(diagnostics[0].to).toBeGreaterThanOrEqual(diagnostics[0].from);
    expect(diagnostics[0].to).toBeLessThanOrEqual(text.length);
  });

  it('surfaces the validator code for an unknown track kind', async () => {
    const bad = `accession: P05067
rows:
  - id: MY_ROW
    tracks:
      - id: t
        kind: notakind
        data:
          from: inline
          inlineData: []
`;
    const diagnostics = await computeDiagnostics(bad);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.map((d) => d.code)).toContain('unknown-semantic-kind');
    // The offending path is carried through for the side error list.
    expect(diagnostics.some((d) => d.message.includes('notakind') || d.path)).toBe(
      true
    );
  });

  it('does not crash when an id contains regex metacharacters', async () => {
    // `id: "a(b"` is schema-valid, so the semantic pass runs and emits an
    // issue whose `path` carries the id. That id once reached `new RegExp`
    // in locate() unescaped — an unbalanced `(` threw SyntaxError and
    // rejected the whole promise. It must now be escaped, not throw.
    const bad = `rows:
  - id: MY_ROW
    tracks:
      - id: "a(b"
        kind: features
        data: nope
`;
    const diagnostics = await computeDiagnostics(bad);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.from).toBeGreaterThanOrEqual(0);
      expect(diagnostic.to).toBeLessThanOrEqual(bad.length);
    }
  });

  it('injects the supplied accession so a {accession}-only config validates', async () => {
    // A config that uses {accession} placeholders but declares no
    // accession of its own (like the canonical default config).
    const text = `sources:
  features: https://example.org/features/{accession}
rows:
  - id: DOMAINS
    tracks:
      - id: domain
        kind: features
        data: features
`;
    // No accession → the missing-accession rule fires.
    const without = await computeDiagnostics(text);
    expect(without.map((d) => d.code)).toContain('missing-accession');
    // With the playground's accession injected → clean.
    expect(await computeDiagnostics(text, 'P05067')).toEqual([]);
  });

  it('carries a warning through as a warning', async () => {
    // `format-overrides-extension` names something legal. Mapping every
    // issue to `severity: 'error'` told the author in the gutter that a
    // config which loads fine does not — and held the preview back.
    const text = `accession: P05067
rows:
  - id: MY_ANNOTATIONS
    tracks:
      - id: sites
        kind: features
        data:
          from: file
          url: ./hits.tsv
          format: csv
`;
    const diagnostics = await computeDiagnostics(text);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('format-overrides-extension');
    expect(diagnostics[0].severity).toBe('warning');
  });
});

describe('lintConfig — sequence mode', () => {
  const SEQUENCE = `sequence: |
  >my construct v2
  MKTAYIAKQRQISFVKSHFSRQ
rows:
  - id: sites
    kind: features
    label: Sites on {accession}
    data:
      from: inline
      inlineData:
        - type: BINDING
          start: 4
          end: 9
`;

  it('validates a sequence config without the default accession', async () => {
    // The page always has an accession to offer; injecting it here would
    // turn a clean sequence config into "both".
    expect(await lintConfig(SEQUENCE, 'P05067')).toMatchObject({
      diagnostics: [],
      declaresSequence: true,
      ownSequence: '>my construct v2\nMKTAYIAKQRQISFVKSHFSRQ\n',
    });
    expect(await computeDiagnostics(SEQUENCE, 'P05067')).toEqual([]);
  });

  it('says an accession config declares no sequence', async () => {
    const { declaresSequence, ownSequence } = await lintConfig(
      VALID,
      'P05067'
    );
    expect(declaresSequence).toBe(false);
    expect(ownSequence).toBeUndefined();
  });

  it('reads a sequence inherited through extends:', async () => {
    // The element merges the base before it looks for `sequence:`, so the
    // page must too, or it hands the preview its accession ("both").
    const CHILD = `extends: https://lab.example/base.yaml
rows:
  - id: sites
    kind: features
    label: Sites on {accession}
    data:
      from: inline
      inlineData:
        - { type: BINDING, start: 4, end: 9 }
`;
    const fetched: string[] = [];
    const lint = (base: string | Error) =>
      lintConfig(CHILD, 'P05067', {
        extendsFetcher: async (url) => {
          fetched.push(url);
          if (base instanceof Error) throw base;
          return base;
        },
      });

    // Validated as the sequence config it becomes: `{accession}` in a label
    // is the header there, not a missing accession.
    const merged = await lint('sequence: |\n  >base\n  MKTAYIAKQR\nrows: []\n');
    expect(merged).toMatchObject({ diagnostics: [], declaresSequence: true });
    // The parsed config is still the editor text's own, without the base's.
    expect(merged.parsed).not.toHaveProperty('sequence');
    expect(fetched).toEqual(['https://lab.example/base.yaml']);
    // A base with no sequence, or one that can't be fetched, says no.
    expect((await lint('rows: []\n')).declaresSequence).toBe(false);
    expect((await lint(new Error('offline'))).declaresSequence).toBe(false);
    // A config with no `extends:` fetches nothing.
    fetched.length = 0;
    await lintConfig(VALID, 'P05067', {
      extendsFetcher: async (url) => {
        fetched.push(url);
        return '';
      },
    });
    expect(fetched).toEqual([]);
  });

  it('still reports an accession written beside the sequence', async () => {
    const { diagnostics } = await lintConfig(
      `accession: P05067\n${SEQUENCE}`,
      'P05067'
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['accession-and-sequence']);
  });
});

describe('memoizedExtendsFetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a base once across lints, and retries one that failed', async () => {
    const BASE = 'sequence: MKTAYIAKQR\nrows: []\n';
    const CHILD = 'extends: https://lab.example/base.yaml\nrows: []\n';
    let fail = true;
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return BASE;
    });
    const extendsFetcher = memoizedExtendsFetcher(fetcher);
    const lint = () => lintConfig(CHILD, 'P05067', { extendsFetcher });

    expect((await lint()).declaresSequence).toBe(false);
    fail = false;
    expect((await lint()).declaresSequence).toBe(true);
    expect((await lint()).declaresSequence).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('defaults to the size-capped global fetch', async () => {
    const fetchFn = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => 'rows: []\n',
        }) as unknown as Response
    );
    vi.stubGlobal('fetch', fetchFn);
    const extendsFetcher = memoizedExtendsFetcher();

    expect(await extendsFetcher('./base.yaml')).toBe('rows: []\n');
    expect(await extendsFetcher('./base.yaml')).toBe('rows: []\n');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('lintConfig', () => {
  it('returns the config it parsed, without the injected accession', async () => {
    const text = VALID.replace('accession: P05067\n', '');
    const result = await lintConfig(text, 'P05067');
    expect(result.diagnostics).toEqual([]);
    expect(result.parsed).toEqual(await parseConfigText(text));
    expect(result.parsed).not.toHaveProperty('accession');
  });

  it('returns no config for a blank or broken editor', async () => {
    expect(await lintConfig('  \n')).toEqual({
      diagnostics: [],
      declaresSequence: false,
    });
    const broken = await lintConfig('rows: [\n');
    expect(broken.diagnostics[0].code).toBe('syntax');
    expect(broken).not.toHaveProperty('parsed');
  });
});
