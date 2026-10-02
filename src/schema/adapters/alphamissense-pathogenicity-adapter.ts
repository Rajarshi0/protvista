import type { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import type { AdapterFunction } from '../types.js';

// from color scale B:0,H:0.1132,V:0.2264,L:0.3395,A:0.4527,l:0.5895,h:0.7264,p:0.8632,P:1
const certainlyBenign = 0;
const benign = 0.1132;
const veryLikelyBenign = 0.2264;
const likelyBenign = 0.3395;
const ambiguous = 0.4527;
const likelyAmbiguous = 0.5895;
const likelyPathogenic = 0.7264;
const pathogenic = 0.8632;
const certainlyPathogenic = 1;

export const rowSplitter = /\s*\n\s*/;
export const cellSplitter = /^(.)(\d+)(.),(.+),(\w+)$/;

const pathogenicityCategories = [
  { min: certainlyBenign, max: benign, code: 'H' },
  { min: benign, max: veryLikelyBenign, code: 'V' },
  { min: veryLikelyBenign, max: likelyBenign, code: 'L' },
  { min: likelyBenign, max: ambiguous, code: 'A' },
  { min: ambiguous, max: likelyAmbiguous, code: 'l' },
  { min: likelyAmbiguous, max: likelyPathogenic, code: 'h' },
  { min: likelyPathogenic, max: pathogenic, code: 'p' },
  { min: pathogenic, max: certainlyPathogenic, code: 'P' },
];

const getPathogenicityCode = (score) => {
  for (const { min, max, code } of pathogenicityCategories) {
    if (score >= min && score < max) {
      return code;
    }
  }
};

type Row = {
  wildType: string;
  position: number;
  mutated: string;
  pathogenicityScore: number;
  pathogenicityLabel: string;
};

const parseCSV = (rawText: string): string => {
  const positions: Array<Array<Row>> = [];
  for (const [i, row] of rawText.split(rowSplitter).entries()) {
    if (i === 0 || !row) {
      continue;
    }
    const match = row.match(cellSplitter);
    if (!match) {
      continue;
    }
    const [
      ,
      wildType,
      positionString,
      mutated,
      pathogenicityScore,
      pathogenicityLabel,
    ] = match;
    const position = +positionString;
    const index = position - 1;
    if (!positions[index]) {
      positions[index] = [];
    }
    positions[index].push({
      wildType,
      position,
      mutated,
      pathogenicityScore: +pathogenicityScore,
      pathogenicityLabel,
    });
  }

  const out = [];
  for (const position of positions) {
    // maximum
    // const value = Math.max(
    //   ...position.map((variation) => variation.pathogenicityScore)
    // );
    // average
    const value =
      position.reduce(
        (acc, variation) => acc + +variation.pathogenicityScore,
        0
      ) / position.length;
    const letter = getPathogenicityCode(value);
    out.push(letter);
  }

  return out.join('');
};

/**
 * Fetch and parse the AlphaMissense annotations the prediction payload points
 * at.
 *
 * Throws on failure rather than logging and returning nothing. This is a
 * second request the loader cannot see, so its outcome has to leave through
 * the adapter: a throw reaches the loader's per-track catch and is routed
 * like any other track failure — a badge, the event, and (this being a
 * provider source) a Retry, since an outage here is usually transient.
 * Unchecked, an error page's body went on to `parseCSV` as if it were data.
 */
const loadAndParseAnnotations = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `AlphaMissense pathogenicity data unavailable (HTTP ${response.status}) at ${url}`
    );
  }
  return parseCSV(await response.text());
};

type PartialProtein = {
  sequence: {
    sequence: string;
  };
};

export const alphamissensePathogenicityAdapter: AdapterFunction = async (
  raw,
  proteinRaw
) => {
  const data = raw as AlphaFoldPayload;
  const protein = proteinRaw as PartialProtein;
  const alphaFoldSequenceMatch = data?.filter(
    ({ sequence, amAnnotationsUrl }) =>
      protein.sequence.sequence === sequence && amAnnotationsUrl
  );
  if (alphaFoldSequenceMatch.length === 1) {
    const heatmapData = await loadAndParseAnnotations(
      alphaFoldSequenceMatch[0].amAnnotationsUrl
    );
    return heatmapData;
  } else if (alphaFoldSequenceMatch.length > 1) {
    console.warn(
      `Found more than one matches (${alphaFoldSequenceMatch.length}) for AlphaMissense pathogenicity score against protein sequence: ${protein.sequence}`
    );
  }
};
