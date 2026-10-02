import type { AlphaFoldPayload } from '@nightingale-elements/nightingale-structure';

import type { AdapterFunction } from '../types.js';

type AlphafoldConfidencePayload = {
  residueNumber: Array<number>;
  confidenceScore: Array<number>;
  confidenceCategory: Array<string>;
};

const getConfidenceURLFromPayload = (af: AlphaFoldPayload[number]) =>
  af.cifUrl?.replace('-model', '-confidence').replace('.cif', '.json');

/**
 * Fetch the per-residue confidence file the prediction payload points at.
 *
 * Throws on failure rather than logging and returning nothing. This is a
 * second request the loader cannot see, so its outcome has to leave through
 * the adapter: a throw reaches the loader's per-track catch and is routed
 * like any other track failure — a badge, the event, and (this being a
 * provider source) a Retry, since an outage here is usually transient.
 */
const loadConfidence = async (
  url: string
): Promise<AlphafoldConfidencePayload> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `AlphaFold confidence data unavailable (HTTP ${response.status}) at ${url}`
    );
  }
  return await response.json();
};

type PartialProtein = {
  sequence: {
    sequence: string;
  };
};

export const alphafoldConfidenceAdapter: AdapterFunction = async (
  raw,
  proteinRaw
) => {
  const data = raw as AlphaFoldPayload;
  const protein = proteinRaw as PartialProtein;
  const alphaFoldSequenceMatch = data?.filter(
    ({ sequence }) => protein.sequence.sequence === sequence
  );
  if (alphaFoldSequenceMatch.length === 1) {
    const confidenceUrl = getConfidenceURLFromPayload(
      alphaFoldSequenceMatch[0]
    );
    if (!confidenceUrl) {
      return;
    }
    const confidenceData = await loadConfidence(confidenceUrl);
    return confidenceData?.confidenceCategory.join('');
  } else if (alphaFoldSequenceMatch.length > 1) {
    console.warn(
      `Found more than one matches (${alphaFoldSequenceMatch.length}) for AlphaFold confidence adapter against protein sequence: ${protein.sequence}`
    );
  }
};
