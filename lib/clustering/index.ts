import { TrackWithFeatures } from '../spotify/types';
import { kMeans } from './kmeans';
import { getVibeNames } from './vibeNames';
import { vibeColors } from '../tokens';

export interface VibeCluster {
  id: number;
  label: string;
  description: string;
  color: { name: string; from: string; to: string };
  tracks: TrackWithFeatures[];
  centroid: {
    energy: number;
    valence: number;
    danceability: number;
    acousticness: number;
    tempo: number;
    instrumentalness: number;
  };
}

function normalizeTempo(tempo: number): number {
  return Math.max(0, Math.min(1, (tempo - 60) / 140));
}

export function buildVibeMap(tracks: TrackWithFeatures[], k = 6): VibeCluster[] {
  const featureVectors = tracks.map((t) => [
    t.features.energy,
    t.features.valence,
    t.features.danceability,
    t.features.acousticness,
    normalizeTempo(t.features.tempo),
    t.features.instrumentalness,
  ]);

  const { clusters } = kMeans(featureVectors, k);

  const centroidFeatures = clusters.map((c) => ({
    energy: c.centroid[0],
    valence: c.centroid[1],
    danceability: c.centroid[2],
    acousticness: c.centroid[3],
    tempo: c.centroid[4] * 140 + 60,
    instrumentalness: c.centroid[5],
  }));

  const names = getVibeNames(centroidFeatures);

  return clusters.map((cluster, i) => ({
    id: i,
    label: names[i].label,
    description: names[i].description,
    color: vibeColors[i % vibeColors.length],
    tracks: cluster.indices.map((idx) => tracks[idx]),
    centroid: centroidFeatures[i],
  }));
}
