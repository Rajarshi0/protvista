import { describe, test, expect } from 'vitest';

import {
  colorConfig,
  getFilteredVariants,
  VariantsForFilter,
} from '../filter-config.js';

const transformedVariantPositions = [
  {
    variants: [
      {
        accession: 'A',
        association: [{ disease: true }],
        begin: 1,
        end: 1,
        start: 1,
        tooltipContent: '',
        sourceType: 'source',
        variant: 'V',
        protvistaFeatureId: 'id1',
        xrefNames: [],
        type: 'VARIANT',
        wildType: 'A',
        alternativeSequence: 'V',
        consequenceType: 'disease',
        clinicalSignificances: [
          {
            type: 'Variant of uncertain significance',
            sources: ['Ensembl'],
          },
        ],
        xrefs: [],
        hasPredictions: false,
      },
      {
        accession: 'B',
        association: [{ disease: false }],
        begin: 1,
        end: 1,
        start: 1,
        tooltipContent: '',
        sourceType: 'source',
        variant: 'D',
        protvistaFeatureId: 'id2',
        xrefNames: [],
        type: 'VARIANT',
        wildType: 'A',
        alternativeSequence: 'D',
        consequenceType: 'disease',
        xrefs: [],
        hasPredictions: false,
      },
    ],
  },
  {
    variants: [
      {
        accession: 'C',
        begin: 2,
        end: 2,
        start: 2,
        tooltipContent: '',
        sourceType: 'source',
        variant: 'V',
        protvistaFeatureId: 'id1',
        xrefNames: [],
        type: 'VARIANT',
        wildType: 'A',
        alternativeSequence: 'V',
        consequenceType: 'disease',
        xrefs: [],
        // Uncertain takes precedence over predicted.
        clinicalSignificances: [
          {
            type: 'Variant of uncertain significance',
            sources: ['ClinVar'],
          },
        ],
        hasPredictions: true,
      },
    ],
  },
  {
    variants: [
      {
        accession: 'D',
        begin: 3,
        end: 3,
        start: 3,
        tooltipContent: '',
        sourceType: 'source',
        variant: 'V',
        protvistaFeatureId: 'id1',
        xrefNames: [],
        type: 'VARIANT',
        wildType: 'A',
        alternativeSequence: 'V',
        consequenceType: 'disease',
        siftScore: 0.5,
        xrefs: [],
        hasPredictions: true,
      },
    ],
  },
  {
    variants: [
      {
        accession: 'E',
        begin: 4,
        end: 4,
        start: 4,
        tooltipContent: '',
        sourceType: 'source',
        variant: 'V',
        protvistaFeatureId: 'id4',
        xrefNames: [],
        type: 'VARIANT',
        wildType: 'A',
        alternativeSequence: 'V',
        consequenceType: 'disease',
        clinicalSignificances: [],
        xrefs: [],
        hasPredictions: false,
      },
    ],
  },
] as unknown as VariantsForFilter;

describe('Variation filter config', () => {
  test('it should filter according to the callback function', () => {
    const filteredVariants = getFilteredVariants(
      transformedVariantPositions,
      (variant) => variant.accession === 'A'
    );
    expect(filteredVariants).toEqual([
      {
        variants: [transformedVariantPositions[0].variants[0]],
      },
      {
        variants: [],
      },
      {
        variants: [],
      },
      {
        variants: [],
      },
    ]);
  });

  test('it should get the right colour for disease', () => {
    const firstVariant = colorConfig(
      transformedVariantPositions[0].variants[0]
    );
    expect(firstVariant).toEqual('#990000');
  });

  test('it should get the right colour for non disease', () => {
    const secondVariant = colorConfig(
      transformedVariantPositions[0].variants[1]
    );
    expect(secondVariant).toEqual('#99cc00');
  });

  test('it should get the right colour for uncertain', () => {
    const thirdVariant = colorConfig(
      transformedVariantPositions[1].variants[0]
    );
    expect(thirdVariant).toEqual('#009e73');
  });

  test('it should get the right colour for predicted', () => {
    const fourthVariant = colorConfig(
      transformedVariantPositions[2].variants[0]
    );
    expect(fourthVariant).toEqual('#4c8acd');
  });

  test('it should get the right colour for other', () => {
    const fifthVariant = colorConfig(
      transformedVariantPositions[3].variants[0]
    );
    expect(fifthVariant).toEqual('#009e73');
  });
});
