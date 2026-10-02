import type { AdapterFunction } from '../types.js';

type ProteomicsPtm = {
  accession: string;
  entryName: string;
  sequence: string;
  sequenceChecksum: string;
  taxid: number;
  features: ProteomicsPtmFeature[];
};

type ProteomicsPtmFeature = {
  type: string;
  begin: string;
  end: string;
  xrefs: Xref[];
  evidences: Evidence[];
  peptide: string;
  unique: boolean;
  ptms: PTM[];
};

type Evidence = {
  code: string;
  source: Source;
};

type Source = {
  id: string;
  url: string;
};

type Xref = {
  name: string;
  id: string;
  url: string;
};

export type PTM = {
  name: string;
  position: number;
  sources: string[];
  dbReferences: DBReference[];
};

type DBReference = {
  id: string;
  properties: { [key: string]: string };
};

enum ConfidenceScoreColors {
  Gold = '#c39b00',
  Silver = '#8194a1',
  Bronze = '#a65708',
}

/**
 * One `MOD_RES_LS` marker per modification at `absolutePosition`. Each marker
 * passes through the API's `ptms` entries for that modification, unchanged,
 * and carries the `confidenceScore` its colour is computed from: `null` when
 * the entries report no score, or a mixture (which is also warned about).
 */
const convertPtmExchangePtms = (ptms: PTM[], absolutePosition: number) => {
  const groupPtmsByModification: Record<string, PTM[]> = {};
  for (const ptm of ptms) {
    if (groupPtmsByModification[ptm.name]) {
      groupPtmsByModification[ptm.name].push(ptm);
    } else {
      groupPtmsByModification[ptm.name] = [ptm];
    }
  }

  return Object.values(groupPtmsByModification).map((groupedPtms) => {
    const confidenceScores = new Set(
      groupedPtms.flatMap(({ dbReferences }) =>
        dbReferences?.map(({ properties }) => properties['Confidence score'])
      )
    );
    let confidenceScore: string | null = null;
    if (confidenceScores.size) {
      if (confidenceScores.size > 1) {
        console.warn(
          `PTMeXchange PTM has a mixture of confidence scores: ${Array.from(
            confidenceScores
          )}`
        );
      } else {
        // A missing property (or `dbReferences`) reads as `undefined` here.
        [confidenceScore = null] = confidenceScores;
      }
    }

    return {
      source: 'PTMeXchange',
      type: 'MOD_RES_LS',
      start: absolutePosition,
      end: absolutePosition,
      shape: 'triangle',
      color:
        (confidenceScore && ConfidenceScoreColors[confidenceScore]) || 'black',
      ptms: groupedPtms,
      confidenceScore,
    };
  });
};

export const proteomicsPtmAdapter: AdapterFunction = (raw) => {
  const data = raw as ProteomicsPtm;
  if (data) {
    const { features } = data;

    const absolutePositionToPtms: Record<number, { ptms: PTM[]; aa: string }> =
      {};

    if (features) {
      for (const feature of features) {
        for (const ptm of feature.ptms) {
          const absolutePosition = +feature.begin + ptm.position - 1;
          if (!Number.isFinite(absolutePosition)) {
            console.warn(
              `Encountered infinite number: +feature.begin + ptm.position - 1 = ${+feature.begin} + ${
                ptm.position
              } - 1`
            );
            continue;
          }
          const aa = feature.peptide[ptm.position - 1];
          if (absolutePosition in absolutePositionToPtms) {
            if (absolutePositionToPtms[absolutePosition].aa !== aa) {
              console.warn(
                `One PTM has different amino acid values: [${absolutePositionToPtms[absolutePosition].aa}, ${aa}]`
              );
            } else {
              absolutePositionToPtms[absolutePosition].ptms.push(ptm);
            }
          } else {
            absolutePositionToPtms[absolutePosition] = { ptms: [ptm], aa };
          }
        }
      }

      return Object.entries(absolutePositionToPtms)
        .map(([absolutePosition, { ptms }]) =>
          convertPtmExchangePtms(ptms, +absolutePosition)
        )
        .flat();
    }
  }
  return [];
};
