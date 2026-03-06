import { MusicService, MusicTrack, MusicArtist } from '@/lib/music/types';
import { getSimilarArtists, getArtistTags, LastfmTag } from '@/lib/lastfm';
import { sectionColors, sectionMeta } from '@/lib/tokens';
import {
  DiscoveryOrbit,
  EngineState,
  SignalProgress,
  OrbitId,
} from './types';

const TARGET_PER_ORBIT = 15;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeOrbit(id: OrbitId, tracks: MusicTrack[], description?: string): DiscoveryOrbit {
  const meta = sectionMeta[id as keyof typeof sectionMeta];
  const color = sectionColors[id as keyof typeof sectionColors];
  return {
    id,
    label: meta?.label ?? id,
    description: description ?? meta?.tagline ?? '',
    color: { name: id, from: color?.bg ?? '#F0F0F0', to: color?.accent ?? '#888888' },
    tracks,
    artists: [],
    confidence: Math.min(1, tracks.length / 15),
    status: tracks.length > 0 ? 'ready' : 'error',
  };
}

// ============================
// Mathematical model types
// ============================

/** A discovered artist with a computed relevance score */
interface ScoredArtist {
  name: string;
  /** Composite score: combines similarity + multi-seed boost */
  score: number;
  /** How many of the user's top artists independently led to this discovery */
  seedCount: number;
  /** Max similarity from any single seed */
  maxSimilarity: number;
  /** Which seed artists led here */
  seedArtists: string[];
  /** Last.fm tags (genres/moods) */
  tags: string[];
}

/** A track with its parent artist's scoring metadata */
interface ScoredTrack {
  track: MusicTrack;
  artistScore: number;
  tags: string[];
  cluster: number; // which genre cluster this belongs to
}

// ============================
// Genre clustering
// ============================

/** Jaccard similarity between two tag sets */
function tagSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Simple greedy clustering: assign each artist to the most similar existing cluster,
 * or create a new cluster if similarity is below threshold.
 */
function clusterByTags(
  artists: ScoredArtist[],
  maxClusters: number,
  threshold = 0.15,
): Map<number, ScoredArtist[]> {
  const clusters = new Map<number, { centroidTags: string[]; artists: ScoredArtist[] }>();
  let nextId = 0;

  for (const artist of artists) {
    if (artist.tags.length === 0) {
      // No tags — assign to the cluster with closest score
      let bestCluster = 0;
      let bestScore = -1;
      for (const [id, cluster] of clusters) {
        const avgScore = cluster.artists.reduce((s, a) => s + a.score, 0) / cluster.artists.length;
        const scoreDiff = 1 - Math.abs(avgScore - artist.score);
        if (scoreDiff > bestScore) {
          bestScore = scoreDiff;
          bestCluster = id;
        }
      }
      if (clusters.size > 0) {
        clusters.get(bestCluster)!.artists.push(artist);
      } else {
        clusters.set(nextId, { centroidTags: [], artists: [artist] });
        nextId++;
      }
      continue;
    }

    // Find most similar cluster
    let bestCluster = -1;
    let bestSim = -1;
    for (const [id, cluster] of clusters) {
      const sim = tagSimilarity(artist.tags, cluster.centroidTags);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = id;
      }
    }

    if (bestSim >= threshold && bestCluster >= 0) {
      const cluster = clusters.get(bestCluster)!;
      cluster.artists.push(artist);
      // Update centroid: union of all tags
      const tagSet = new Set(cluster.centroidTags);
      for (const t of artist.tags) tagSet.add(t);
      cluster.centroidTags = Array.from(tagSet);
    } else if (clusters.size < maxClusters) {
      clusters.set(nextId, { centroidTags: [...artist.tags], artists: [artist] });
      nextId++;
    } else {
      // Max clusters reached — assign to closest
      if (bestCluster >= 0) {
        clusters.get(bestCluster)!.artists.push(artist);
      }
    }
  }

  // Convert to simple map
  const result = new Map<number, ScoredArtist[]>();
  for (const [id, cluster] of clusters) {
    result.set(id, cluster.artists);
  }
  return result;
}

// ============================
// Main engine
// ============================

export async function runDiscoveryEngine(
  musicService: MusicService,
  onProgress: (state: EngineState) => void,
): Promise<DiscoveryOrbit[]> {
  const diag: string[] = [];

  const progress: SignalProgress[] = [
    { label: 'Reading your music', status: 'pending' },
    { label: 'Finding similar artists', status: 'pending' },
    { label: 'Analyzing genres and moods', status: 'pending' },
    { label: 'Building your playlists', status: 'pending' },
  ];

  const emit = (orbits: DiscoveryOrbit[] = []) => {
    onProgress({ orbits, isLoading: true, progress: [...progress] });
  };

  const setStep = (i: number, status: SignalProgress['status'], detail?: string) => {
    progress[i] = { ...progress[i], status, detail };
    emit();
  };

  const fail = (msg: string): DiscoveryOrbit[] => {
    const fullMsg = msg + '\n\nDiagnostics:\n' + diag.join('\n');
    onProgress({ orbits: [], isLoading: false, progress, error: fullMsg });
    return [];
  };

  emit();

  // ============================
  // Step 1: Build user taste profile
  // ============================
  setStep(0, 'loading');

  const knownNames = new Set<string>();
  const knownTrackIds = new Set<string>();
  const topArtistNames: string[] = [];
  const userGenres: string[] = [];

  for (const range of ['short', 'medium', 'long'] as const) {
    try {
      const artists = await musicService.getTopArtists(range, 50);
      diag.push(`${range} artists: ${artists.length}`);
      for (const a of artists) {
        const lower = a.name.toLowerCase();
        if (!knownNames.has(lower)) {
          topArtistNames.push(a.name);
        }
        knownNames.add(lower);
        for (const g of (a.genres ?? [])) {
          userGenres.push(g.toLowerCase());
        }
      }
    } catch (e) {
      diag.push(`${range} artists FAILED: ${e instanceof Error ? e.message : e}`);
    }

    try {
      const tracks = await musicService.getTopTracks(range, 50);
      for (const t of tracks) {
        knownTrackIds.add(t.id);
        knownNames.add(t.artist.toLowerCase());
      }
    } catch { /* non-critical */ }
  }

  diag.push(`known artists: ${knownNames.size}, user genres: ${userGenres.length}`);

  if (topArtistNames.length === 0) {
    setStep(0, 'error');
    return fail('No listening data found.');
  }

  setStep(0, 'done');

  // ============================
  // Step 2: Discover new artists via Last.fm
  // Multi-seed scoring: artists found via multiple seeds get boosted
  // Formula: score = maxSimilarity × (1 + 0.15 × (seedCount - 1))
  // ============================
  setStep(1, 'loading');

  const seedArtists = topArtistNames.slice(0, 25);

  // Accumulate: artist name → { similarities from each seed }
  const rawDiscoveries = new Map<string, { sims: number[]; seeds: string[] }>();
  let lastfmSuccesses = 0;

  for (let i = 0; i < seedArtists.length; i += 4) {
    const batch = seedArtists.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(name => getSimilarArtists(name, 50))
    );

    for (let j = 0; j < batch.length; j++) {
      const seedName = batch[j];
      const similar = results[j];
      if (similar.length > 0) {
        lastfmSuccesses++;
        for (const s of similar) {
          const lower = s.name.toLowerCase();
          if (knownNames.has(lower)) continue;
          const sim = parseFloat(s.match) || 0;
          const existing = rawDiscoveries.get(lower);
          if (existing) {
            existing.sims.push(sim);
            existing.seeds.push(seedName);
          } else {
            rawDiscoveries.set(lower, { sims: [sim], seeds: [seedName] });
          }
        }
      }
    }

    setStep(1, 'loading', `${rawDiscoveries.size} new artists`);
  }

  diag.push(`Last.fm: ${lastfmSuccesses} ok, ${rawDiscoveries.size} raw discoveries`);

  if (rawDiscoveries.size === 0) {
    setStep(1, 'error');
    return fail('Last.fm returned no similar artists. Check LASTFM_API_KEY.');
  }

  // Compute multi-seed scores
  const scoredArtists: ScoredArtist[] = [];
  for (const [name, data] of rawDiscoveries) {
    const maxSim = Math.max(...data.sims);
    const seedCount = data.seeds.length;
    // Multi-seed boost: convergent evidence from multiple top artists
    const score = maxSim * (1 + 0.15 * (seedCount - 1));
    scoredArtists.push({
      name,
      score: Math.min(score, 1.5), // cap at 1.5
      seedCount,
      maxSimilarity: maxSim,
      seedArtists: data.seeds,
      tags: [], // filled in next step
    });
  }

  // Sort by score descending
  scoredArtists.sort((a, b) => b.score - a.score);

  const multiSeedCount = scoredArtists.filter(a => a.seedCount > 1).length;
  diag.push(`multi-seed artists (appeared from 2+ seeds): ${multiSeedCount}`);
  diag.push(`top scored: ${scoredArtists.slice(0, 3).map(a => `${a.name} (${a.score.toFixed(2)}, ${a.seedCount} seeds)`).join(', ')}`);

  setStep(1, 'done', `${scoredArtists.length} artists scored`);

  // ============================
  // Step 3: Get tags for top discovered artists + cluster by genre
  // ============================
  setStep(2, 'loading');

  // Only fetch tags for the top ~80 artists (enough for 5 playlists of 15)
  const toTag = scoredArtists.slice(0, 80);

  for (let i = 0; i < toTag.length; i += 5) {
    const batch = toTag.slice(i, i + 5);
    const tagResults = await Promise.all(
      batch.map(a => getArtistTags(a.name))
    );
    for (let j = 0; j < batch.length; j++) {
      batch[j].tags = tagResults[j]
        .filter(t => t.count > 20) // only significant tags
        .map(t => t.name);
    }
    setStep(2, 'loading', `${Math.min(i + 5, toTag.length)} of ${toTag.length} tagged`);
  }

  // Cluster artists by genre/mood tags
  const clusters = clusterByTags(toTag, 8);
  diag.push(`genre clusters: ${clusters.size}`);
  for (const [id, artists] of clusters) {
    const topTags = artists.flatMap(a => a.tags).slice(0, 5);
    diag.push(`  cluster ${id}: ${artists.length} artists [${topTags.join(', ')}]`);
  }

  setStep(2, 'done', `${clusters.size} genre clusters`);

  // ============================
  // Step 4: Search Spotify + build coherent playlists
  // Each playlist draws from 1-2 genre clusters for coherence
  // ============================
  setStep(3, 'loading');

  // Sort clusters by total score (strongest cluster first = "warm signal")
  const sortedClusters = Array.from(clusters.entries())
    .map(([id, artists]) => ({
      id,
      artists,
      totalScore: artists.reduce((s, a) => s + a.score, 0),
      avgScore: artists.reduce((s, a) => s + a.score, 0) / artists.length,
    }))
    .sort((a, b) => b.totalScore - a.totalScore);

  const orbitIds: OrbitId[] = ['warmsignal', 'softdrift', 'nightdrive', 'otherside', 'static'];
  const orbits: DiscoveryOrbit[] = [];
  const globalSeenTrackIds = new Set<string>();
  const globalSeenArtists = new Set<string>();

  // Assign clusters to orbits
  // Strategy: strongest clusters → first orbits (warm signal),
  // weakest → last orbits (static/adventurous)
  for (let orbitIdx = 0; orbitIdx < orbitIds.length; orbitIdx++) {
    const orbitId = orbitIds[orbitIdx];

    // Pick artists for this orbit from the appropriate cluster(s)
    let orbitArtists: ScoredArtist[] = [];
    if (orbitIdx < sortedClusters.length) {
      orbitArtists = [...sortedClusters[orbitIdx].artists];
    } else {
      // Not enough clusters — pull remaining artists
      const remaining = toTag.filter(a =>
        !globalSeenArtists.has(a.name.toLowerCase())
      );
      orbitArtists = remaining.slice(0, 20);
    }

    // Sort by score within cluster, but add randomness
    // Use softmax-like sampling: P(artist) ∝ e^(score × temperature)
    // Higher temperature = more exploration
    const temperature = 1.5 + orbitIdx * 0.5; // more randomness for later orbits
    orbitArtists.sort((a, b) => {
      const noiseA = Math.random() * temperature * 0.3;
      const noiseB = Math.random() * temperature * 0.3;
      return (b.score + noiseB) - (a.score + noiseA);
    });

    // Search Spotify for tracks by these artists
    const orbitTracks: MusicTrack[] = [];
    const artistsToSearch = orbitArtists.slice(0, 25);

    for (let i = 0; i < artistsToSearch.length; i += 3) {
      if (orbitTracks.length >= TARGET_PER_ORBIT) break;

      const batch = artistsToSearch.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(a => musicService.searchTracks(`artist:"${a.name}"`))
      );

      for (let j = 0; j < batch.length; j++) {
        if (orbitTracks.length >= TARGET_PER_ORBIT) break;
        const result = results[j];
        if (result.status !== 'fulfilled' || result.value.length === 0) continue;

        const candidates = result.value.filter(t =>
          !globalSeenTrackIds.has(t.id) &&
          !knownTrackIds.has(t.id) &&
          !knownNames.has(t.artist.toLowerCase()) &&
          !globalSeenArtists.has(t.artist.toLowerCase())
        );
        if (candidates.length === 0) continue;

        // Pick a non-obvious track: skip the first result (most popular),
        // sample from deeper results
        const deepCuts = candidates.slice(1);
        const pick = deepCuts.length > 0 ? pickRandom(deepCuts)! : candidates[0];

        globalSeenTrackIds.add(pick.id);
        globalSeenArtists.add(pick.artist.toLowerCase());
        orbitTracks.push(pick);
      }
    }

    if (orbitTracks.length >= 5) {
      orbits.push(makeOrbit(orbitId, shuffle(orbitTracks)));
    }

    setStep(3, 'loading', `${orbits.length} playlists built`);
  }

  if (orbits.length === 0) {
    setStep(3, 'error');
    return fail('Not enough tracks to build playlists.');
  }

  setStep(3, 'done', `${orbits.length} playlists`);

  const totalTracks = orbits.reduce((s, o) => s + o.tracks.length, 0);
  console.log('[vyba] Done:', orbits.length, 'playlists,', totalTracks, 'tracks');
  diag.push(`final: ${orbits.length} playlists, ${totalTracks} tracks`);

  onProgress({ orbits, isLoading: false, progress });
  return orbits;
}
