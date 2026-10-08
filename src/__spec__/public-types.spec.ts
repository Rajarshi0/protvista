/**
 * The package's public typings, checked by `tsc` (this file is in the
 * `test:types` program) and by vitest's `expectTypeOf`: what a TypeScript
 * consumer imports from `protvista-uniprot` and `protvista-uniprot/react`.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { JSX } from 'react';

import type {
  AdapterFunction,
  FeatureSource,
  ProcessedStructureData,
  ProtvistaChangeEventDetail,
  ProtvistaTrackOrigin,
  ProtvistaViewerConfig,
  TooltipSpec,
} from '../index.js';
import type {} from '../react.js';
import type ProtvistaUniprot from '../protvista-uniprot.js';

type Intrinsic = JSX.IntrinsicElements;

describe('public typings', () => {
  it('exports the change-event detail with the track origin', () => {
    expectTypeOf<ProtvistaChangeEventDetail['track']>().toEqualTypeOf<
      ProtvistaTrackOrigin | undefined
    >();
    expectTypeOf<ProtvistaTrackOrigin['kind']>().toEqualTypeOf<string | null>();
    expectTypeOf<FeatureSource['trackId']>().toEqualTypeOf<string>();
  });

  it('types zoom/pan with the keys Nightingale sends', () => {
    expectTypeOf<ProtvistaChangeEventDetail['display-start']>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<ProtvistaChangeEventDetail>().not.toHaveProperty(
      'displaystart'
    );
  });

  it('exports the config, adapter, tooltip and structure types', () => {
    expectTypeOf<ProcessedStructureData['id']>().toEqualTypeOf<string>();
    expectTypeOf<AdapterFunction>().toBeFunction();
    expectTypeOf<ProtvistaViewerConfig>().toBeObject();
    expectTypeOf<TooltipSpec['kind']>().toEqualTypeOf<'fields' | 'markdown'>();
  });

  it('exposes the documented attributes as public properties', () => {
    expectTypeOf<ProtvistaUniprot['notooltip']>().toEqualTypeOf<
      boolean | undefined
    >();
    expectTypeOf<ProtvistaUniprot['suspend']>().toEqualTypeOf<
      boolean | undefined
    >();
    expectTypeOf<
      HTMLElementTagNameMap['protvista-uniprot']
    >().toEqualTypeOf<ProtvistaUniprot>();
  });

  it('declares both elements for React JSX with attribute spellings', () => {
    const viewer: Intrinsic['protvista-uniprot'] = {
      accession: 'P05067',
      notooltip: true,
      suspend: true,
      'config-src': './config.yaml',
      'no-persist-layout': true,
      'quiet-notices': true,
      'show-warnings': true,
    };
    const structure: Intrinsic['protvista-uniprot-structure'] = {
      accession: 'P05067',
      'no-table': true,
      'color-theme': 'alphafold',
      'selected-id': 'AF-P05067-F1',
    };
    expectTypeOf(viewer).toMatchTypeOf<{ accession?: string }>();
    expectTypeOf(structure).toMatchTypeOf<{ 'no-table'?: boolean }>();
  });
});
