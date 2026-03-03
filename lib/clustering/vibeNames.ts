interface CentroidFeatures {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  tempo: number;
  instrumentalness: number;
}

interface VibeName {
  label: string;
  description: string;
}

const VIBES: { label: string; description: string; score: (f: CentroidFeatures) => number }[] = [
  {
    label: 'golden hour',
    description: 'Warm, feel-good, windows-down energy',
    score: (f) => f.energy * 0.4 + f.valence * 0.6 - f.acousticness * 0.2,
  },
  {
    label: 'night drive',
    description: 'Dark, moody, cruising alone at 2am',
    score: (f) =>
      f.energy * 0.5 + (1 - f.valence) * 0.5 + (f.tempo > 100 ? 0.2 : 0) - f.acousticness * 0.3,
  },
  {
    label: 'slow morning',
    description: 'Quiet, acoustic, coffee in hand',
    score: (f) => f.acousticness * 0.5 + (1 - f.energy) * 0.3 + (1 - f.danceability) * 0.2,
  },
  {
    label: 'main character',
    description: 'You against the world, cinematic confidence',
    score: (f) => f.energy * 0.4 + f.valence * 0.3 + f.danceability * 0.3,
  },
  {
    label: 'deep focus',
    description: 'Instrumental, hypnotic, locked in',
    score: (f) => f.instrumentalness * 0.5 + (1 - f.valence) * 0.3 + (1 - f.energy) * 0.2,
  },
  {
    label: 'the comedown',
    description: 'Melancholy, beautiful, sitting with your thoughts',
    score: (f) => (1 - f.valence) * 0.5 + (1 - f.energy) * 0.3 + f.acousticness * 0.2,
  },
  {
    label: 'basement party',
    description: 'Heavy bass, high energy, bodies moving',
    score: (f) => f.danceability * 0.4 + f.energy * 0.4 + (f.tempo > 120 ? 0.2 : 0),
  },
  {
    label: 'lost in translation',
    description: 'Eclectic, worldly, hard to pin down',
    score: (f) => Math.abs(f.energy - 0.5) * -1 + 0.5 + Math.abs(f.valence - 0.5) * -1 + 0.5,
  },
  {
    label: 'after midnight',
    description: 'Intimate, electronic, headphones-only',
    score: (f) =>
      (1 - f.acousticness) * 0.3 +
      (1 - f.valence) * 0.3 +
      f.energy * 0.2 +
      f.instrumentalness * 0.2,
  },
  {
    label: 'sunday ritual',
    description: 'Easy, familiar, comfort listening',
    score: (f) =>
      f.valence * 0.3 + (1 - f.energy) * 0.3 + f.acousticness * 0.2 + f.danceability * 0.2,
  },
];

export function getVibeName(centroid: CentroidFeatures): VibeName {
  const scored = VIBES.map((v) => ({ ...v, finalScore: v.score(centroid) }));
  scored.sort((a, b) => b.finalScore - a.finalScore);
  return { label: scored[0].label, description: scored[0].description };
}

export function getVibeNames(centroids: CentroidFeatures[]): VibeName[] {
  const used = new Set<string>();
  const results: VibeName[] = [];

  for (const centroid of centroids) {
    const scored = VIBES.map((v) => ({ ...v, finalScore: v.score(centroid) }));
    scored.sort((a, b) => b.finalScore - a.finalScore);
    const pick = scored.find((v) => !used.has(v.label)) || scored[0];
    used.add(pick.label);
    results.push({ label: pick.label, description: pick.description });
  }

  return results;
}
