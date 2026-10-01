/**
 * Byte-identity guard + generator for the feature type and shape vocabulary
 * page, mirroring `adapter-reference-publishing.spec.ts`.
 *
 * Normal run: asserts the checked-in
 * `docs/src/content/docs/type-and-shape-vocabulary.md` is byte-identical to
 * what the renderer produces from the installed Nightingale packages. A
 * Nightingale bump that changes a default, adds a type or changes what the
 * canvas draws fails with a "run `pnpm vocabulary:sync`" message.
 *
 * With `UPDATE_FEATURE_VOCABULARY=1` (the `pnpm vocabulary:sync` script), it
 * writes the page instead of asserting — this is the generator.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  FEATURE_SHAPES,
  isPaintableColor,
  type NightingaleVocabulary,
} from '../feature-vocabulary.js';
import {
  renderFeatureVocabularyMarkdown,
  FEATURE_VOCABULARY_MD_PATH,
} from '../render-feature-vocabulary.js';
import { loadNightingaleVocabulary } from './nightingale-vocabulary.js';

const mdPath = resolve(process.cwd(), FEATURE_VOCABULARY_MD_PATH);
const UPDATE = Boolean(process.env.UPDATE_FEATURE_VOCABULARY);

describe('feature type and shape vocabulary — generated page', () => {
  let vocab: NightingaleVocabulary;
  let markdown: string;

  beforeAll(async () => {
    vocab = await loadNightingaleVocabulary();
    markdown = renderFeatureVocabularyMarkdown(vocab);
  });

  if (UPDATE) {
    it('regenerates the checked-in page (UPDATE_FEATURE_VOCABULARY)', () => {
      writeFileSync(mdPath, markdown);
    });
    return;
  }

  it('type-and-shape-vocabulary.md is byte-identical to the renderer', () => {
    const onDisk = readFileSync(mdPath, 'utf8');
    expect(
      onDisk,
      'type-and-shape-vocabulary.md drifted from Nightingale — run `pnpm vocabulary:sync`'
    ).toBe(markdown);
  });

  it('every default shape is one the page lists', () => {
    const listed = new Set<string>(FEATURE_SHAPES);
    const unlisted = Object.entries(vocab.types)
      .filter(([, t]) => !listed.has(t.shape))
      .map(([code, t]) => `${code}: ${t.shape}`);
    expect(unlisted).toEqual([]);
  });

  it('every default colour is paintable', () => {
    const broken = Object.entries(vocab.types)
      .filter(([, t]) => !isPaintableColor(t.color))
      .map(([code, t]) => `${code}: ${t.color}`);
    expect(
      broken,
      'Nightingale ships an invalid default colour — bump @nightingale-elements/* to the release that fixes it'
    ).toEqual([]);
  });
});
