/**
 * Template-variable helpers (`src/schema/variables.ts`).
 *
 * Every `{token}` in a data URL resolves against one merged dictionary
 * fed by three sources, lowest precedence first:
 *
 *   1. the config's top-level `variables:` block (shared baseline);
 *   2. the host element's `data-*` attributes (per mount);
 *   3. the named `accession` attribute (alias for `data-accession`;
 *      wins on conflict).
 *
 * These are pure functions, so precedence, the token grammar, encoding,
 * and the unresolved-token report are all pinned here without a DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  ACCESSION_PATTERN,
  dataAttributeFor,
  mergeVariables,
  referencedTokens,
  substituteTemplate,
  templateTokens,
} from '../variables.js';
import type { NormalizedConfig } from '../normalize.js';

describe('templateTokens', () => {
  it('returns every token name in first-appearance order', () => {
    expect(
      templateTokens('https://api.example.org/{species}/{build}/features/{accession}')
    ).toEqual(['species', 'build', 'accession']);
  });

  it('de-duplicates a token that appears more than once', () => {
    expect(templateTokens('/{accession}/x/{accession}?q={species}')).toEqual([
      'accession',
      'species',
    ]);
  });

  it('accepts JS-identifier-ish names: letters, digits, underscore', () => {
    expect(templateTokens('/{datasetId}/{build_2}/{X}')).toEqual([
      'datasetId',
      'build_2',
      'X',
    ]);
  });

  it('ignores braces that do not match the token grammar', () => {
    // Dashes would collide with the `data-foo-bar` → `dataset.fooBar`
    // camelCase translation, a leading digit is not an identifier, and an
    // empty pair is not a token. All stay literal text.
    expect(templateTokens('/{foo-bar}/{1x}/{}/{ spaced }')).toEqual([]);
  });

  it('returns an empty list for a URL with no tokens', () => {
    expect(templateTokens('https://example.org/static.json')).toEqual([]);
  });
});

describe('mergeVariables — precedence', () => {
  it('config variables are the baseline', () => {
    const vars = mergeVariables({
      configVariables: { species: 'human', build: 'v2024.12' },
    });
    expect({ ...vars }).toEqual({ species: 'human', build: 'v2024.12' });
  });

  it('a data-* attribute overrides the same key in config variables', () => {
    const vars = mergeVariables({
      configVariables: { species: 'human', build: 'v2024.12' },
      dataset: { species: 'mouse' },
    });
    expect(vars.species).toBe('mouse');
    // Keys only one source defines survive the merge.
    expect(vars.build).toBe('v2024.12');
  });

  it('the named accession attribute wins over data-accession', () => {
    const vars = mergeVariables({
      dataset: { accession: 'B' },
      accession: 'A',
    });
    expect(vars.accession).toBe('A');
  });

  it('the named accession attribute wins over variables.accession', () => {
    const vars = mergeVariables({
      configVariables: { accession: 'C' },
      dataset: { accession: 'B' },
      accession: 'A',
    });
    expect(vars.accession).toBe('A');
  });

  it('an unset named accession does not shadow data-accession', () => {
    expect(
      mergeVariables({ dataset: { accession: 'B' }, accession: undefined })
        .accession
    ).toBe('B');
  });

  it('an empty data-* value counts as defined', () => {
    const vars = mergeVariables({
      configVariables: { species: 'human' },
      dataset: { species: '' },
    });
    expect(vars.species).toBe('');
  });

  it('skips undefined dataset entries', () => {
    const vars = mergeVariables({
      configVariables: { species: 'human' },
      dataset: { species: undefined },
    });
    expect(vars.species).toBe('human');
  });

  it('reads a real DOMStringMap (data-kebab-name → camelCase key)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-species', 'human');
    el.setAttribute('data-dataset-id', 'ds-1');
    const vars = mergeVariables({ dataset: el.dataset });
    expect(vars.species).toBe('human');
    expect(vars.datasetId).toBe('ds-1');
  });

  it('returns a null-prototype dictionary', () => {
    const vars = mergeVariables({});
    expect(Object.getPrototypeOf(vars)).toBeNull();
  });
});

describe('substituteTemplate', () => {
  it('substitutes {accession} exactly as before for a valid accession', () => {
    expect(
      substituteTemplate('https://www.ebi.ac.uk/proteins/api/features/{accession}', {
        accession: 'P05067',
      })
    ).toEqual({ url: 'https://www.ebi.ac.uk/proteins/api/features/P05067' });
  });

  it('substitutes every token in a multi-variable URL', () => {
    expect(
      substituteTemplate(
        'https://api.example.org/{species}/{build}/features/{accession}',
        { species: 'human', build: 'v2024.12', accession: 'P05067' }
      )
    ).toEqual({
      url: 'https://api.example.org/human/v2024.12/features/P05067',
    });
  });

  it('replaces every occurrence of a repeated token', () => {
    expect(
      substituteTemplate('/{accession}/x/{accession}', { accession: 'P05067' })
    ).toEqual({ url: '/P05067/x/P05067' });
  });

  it('leaves a URL without tokens untouched', () => {
    expect(substituteTemplate('./features.csv', {})).toEqual({
      url: './features.csv',
    });
  });

  it('leaves non-grammar braces as literal text', () => {
    expect(substituteTemplate('/{foo-bar}/{species}', { species: 'h' })).toEqual({
      url: '/{foo-bar}/h',
    });
  });

  describe('injection safety', () => {
    it('URL-encodes path separators so a value cannot add a path segment', () => {
      expect(
        substituteTemplate('https://api.example.org/{species}/features', {
          species: 'human/../admin',
        })
      ).toEqual({ url: 'https://api.example.org/human%2F..%2Fadmin/features' });
    });

    it.each([
      ['?', '%3F'],
      ['#', '%23'],
      ['&', '%26'],
      ['%', '%25'],
      [' ', '%20'],
      ['\n', '%0A'],
    ])('encodes %j as %s', (raw, encoded) => {
      expect(
        substituteTemplate('/x/{build}', { build: `a${raw}b` })
      ).toEqual({ url: `/x/a${encoded}b` });
    });

    it('does not double-decode an already-encoded value', () => {
      expect(
        substituteTemplate('/{build}', { build: 'P05067%20injected%2Furl' })
      ).toEqual({ url: '/P05067%2520injected%252Furl' });
    });

    it('keeps the accession character gate: an invalid accession collapses to empty', () => {
      // Today's behaviour, preserved: anything outside ACCESSION_PATTERN
      // is treated as attacker-controlled and substituted as ''.
      expect(
        substituteTemplate('https://e.org/{accession}', {
          accession: 'P05067/../x',
        })
      ).toEqual({ url: 'https://e.org/' });
      expect(
        substituteTemplate('https://e.org/{accession}', {
          accession: 'P05067%20injected%2Furl',
        })
      ).toEqual({ url: 'https://e.org/' });
    });

    it('substitutes in a single pass: a value containing {token} text stays literal', () => {
      expect(substituteTemplate('/{a}/{b}', { a: '{b}', b: 'x' })).toEqual({
        url: '/%7Bb%7D/x',
      });
    });

    it.each(['.', '..'])(
      'refuses a value of exactly %j: the URL parser would treat it as a dot-segment',
      (value) => {
        // encodeURIComponent leaves '.' alone, and '%2E%2E' is a dot-segment
        // to the URL parser too, so encoding cannot help — the value is refused.
        expect(
          substituteTemplate('https://e.org/public/{dataset}/data', {
            dataset: value,
          })
        ).toEqual({ invalid: ['dataset'] });
      }
    );

    it.each(['...', '.a', 'a..b', 'v2024.12'])('accepts a dotted value %j', (value) => {
      expect(substituteTemplate('/{build}', { build: value })).toEqual({
        url: `/${value}`,
      });
    });

    it.each([
      ['a lone high surrogate', 'ab\uD83D'],
      ['a lone low surrogate', '\uDC00'],
    ])('refuses %s (malformed Unicode) rather than throwing', (_, value) => {
      expect(substituteTemplate('/{species}/{build}', { species: value, build: 'b' })).toEqual({
        invalid: ['species'],
      });
    });

    it('lists every invalid token, once, in template order', () => {
      expect(
        substituteTemplate('/{a}/{b}/{a}/{c}', { a: '..', b: 'ok', c: '.' })
      ).toEqual({ invalid: ['a', 'c'] });
    });

    it('leaves an unsafe accession to the accession gate (collapses to empty)', () => {
      expect(substituteTemplate('/x/{accession}', { accession: '..' })).toEqual({
        url: '/x/',
      });
      expect(
        substituteTemplate('/x/{accession}', { accession: '\uD83D' })
      ).toEqual({ url: '/x/' });
    });

    it('ACCESSION_PATTERN accepts real and test-shaped accessions', () => {
      expect(ACCESSION_PATTERN.test('P05067')).toBe(true);
      expect(ACCESSION_PATTERN.test('A0A024R161')).toBe(true);
      expect(ACCESSION_PATTERN.test('TEST-01')).toBe(true);
      expect(ACCESSION_PATTERN.test('P05067?x=1')).toBe(false);
    });
  });

  describe('unresolved tokens', () => {
    it('reports every token missing from the dictionary', () => {
      expect(
        substituteTemplate('/{species}/{build}/{accession}', {
          accession: 'P05067',
        })
      ).toEqual({ unresolved: ['species', 'build'] });
    });

    it('does not resolve a token from Object.prototype', () => {
      expect(
        substituteTemplate('/{constructor}/{toString}', mergeVariables({}))
      ).toEqual({ unresolved: ['constructor', 'toString'] });
    });

    it('reports unresolved tokens before invalid ones', () => {
      expect(
        substituteTemplate('/{species}/{build}', { species: '..' })
      ).toEqual({ unresolved: ['build'] });
    });

    it('treats an empty-string value as resolved', () => {
      expect(substituteTemplate('/a/{species}/b', { species: '' })).toEqual({
        url: '/a//b',
      });
    });
  });
});

describe('dataAttributeFor', () => {
  it.each([
    ['species', 'data-species'],
    ['datasetId', 'data-dataset-id'],
    ['refBuildV2', 'data-ref-build-v2'],
    ['Species', 'data--species'],
    ['snake_case', 'data-snake_case'],
  ])('%s is supplied by %s', (token, attribute) => {
    expect(dataAttributeFor(token)).toBe(attribute);
  });

  it('round-trips through a real DOMStringMap', () => {
    const el = document.createElement('div');
    for (const token of ['species', 'datasetId', 'Species']) {
      el.setAttribute(dataAttributeFor(token), 'x');
      expect(el.dataset[token]).toBe('x');
    }
  });
});

describe('referencedTokens', () => {
  const config = (urls: Array<string | string[] | undefined>): NormalizedConfig => ({
    version: '1.0',
    sources: {},
    defaults: { rendering: {} },
    rows: [
      {
        id: 'G',
        label: 'G',
        component: 'nightingale-track-canvas',
        rendering: {},
        tracks: urls.map((url, i) => ({
          id: `t${i}`,
          label: `t${i}`,
          component: 'nightingale-track-canvas',
          rendering: {},
          data: [url === undefined ? { from: 'custom' } : { from: 'url', url }],
        })),
      },
    ],
  });

  it('collects tokens from string and array URLs across tracks', () => {
    const tokens = referencedTokens(
      config([
        'https://e.org/{species}/{accession}',
        ['https://e.org/{build}', 'https://e.org/{accession}'],
        undefined,
      ])
    );
    expect([...tokens].sort()).toEqual(['accession', 'build', 'species']);
  });

  it('is empty when no URL carries a token', () => {
    expect(referencedTokens(config(['./x.csv', undefined])).size).toBe(0);
  });
});
