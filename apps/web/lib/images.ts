import type { ImageCandidate } from './parser';

export interface BestImage {
  url: string;
  width: number | null;
  height: number | null;
  score: number;
}

export function pickBestImage(candidates: ImageCandidate[]): BestImage | null {
  if (!candidates.length) return null;

  const scored = candidates.map((candidate, index) => {
    const base = candidate.scoreModifier;
    const penalty = candidate.url.includes('logo') || candidate.url.includes('sprite') ? 0.4 : 0;
    return {
      url: candidate.url,
      width: null,
      height: null,
      score: base - penalty - index * 0.01,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}
