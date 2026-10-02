import type { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import type { AdapterFunction } from '../types.js';
import {
  cellSplitter,
  rowSplitter,
} from './alphamissense-pathogenicity-adapter.js';

const parseCSV = (rawText: string): Array<Record<string, string>> => {
  const data = [];

  for (const [i, row] of rawText.split(rowSplitter).entries()) {
    if (i === 0 || !row) {
      continue;
    }
    const [, , positionString, mutated, pathogenicityScore] =
      row.match(cellSplitter);

    data.push({
      xValue: +positionString,
      yValue: mutated,
      score: +pathogenicityScore,
    });
  }
  return data;
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
const loadAndParseAnnotations = async (
  url: string
): Promise<Array<Record<string, string>>> => {
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

export const alphamissenseHeatmapAdapter: AdapterFunction = async (
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
      `Found more than one matches (${alphaFoldSequenceMatch.length}) for AlphaMissense pathogenicity against protein sequence: ${protein.sequence}`
    );
  }
};
