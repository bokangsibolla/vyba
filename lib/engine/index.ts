import { SpotifyTrack, SpotifyArtist } from '@/lib/spotify/types';
import {
  getTopTracks,
  getAllTimeRangeArtists,
  searchTracksByArtist,
  discoverByGenres,
} from '@/lib/spotify/api';
import { orbitColors, orbitMeta } from '@/lib/tokens';
import {
  DiscoveryOrbit,
  EngineState,
  SignalProgress,
  OrbitId,
  InfluenceEdge,
  ArtistNode,
  CoOccurrence,
  TasteFrontier,
  DiscoveredArtist,
} from './types';
import { findWikidataIdsBySpotifyIds, getInfluences } from './wikidata';
import { getBlindspots } from './pagerank';
import { minePlaylistCoOccurrences } from './playlistMining';
import { detectTasteFrontier, getEmergingGenres } from './frontier';
import { getCached, setCache, CACHE_TTL, getCacheKey } from './cache';

// --- Score weights ---
const WEIGHTS = {
  wikidata: 0.35,
  playlist: 0.45,
  frontier: 0.20,
} as const;

const FRONTIER_BOOST = 1.5;

// --- Helpers ---

function makeOrbit(
  id: OrbitId,
  tracks: SpotifyTrack[],
  artists: DiscoveredArtist[],
  confidence: number,
): DiscoveryOrbit {
  return {
    id,
    label: orbitMeta[id].label,
    description: orbitMeta[id].description,
    color: orbitColors[id],
    tracks,
    artists,
    confidence: Math.min(1, Math.max(0, confidence)),
    status: tracks.length > 0 ? 'ready' : 'error',
  };
}

function initialProgress(): SignalProgress[] {
  return [
    { label: 'Your listening history', status: 'pending' },
    { label: 'Musical influences', status: 'pending' },
    { label: 'Playlist connections', status: 'pending' },
    { label: 'Taste direction', status: 'pending' },
  ];
}

function updateProgress(
  progress: SignalProgress[],
  index: number,
  status: SignalProgress['status'],
  detail?: string,
): SignalProgress[] {
  return progress.map((p, i) =>
    i === index ? { ...p, status, detail } : p,
  );
}

// --- Resolve artists to Spotify tracks ---

async function resolveArtistsToTracks(
  token: string,
  artists: ArtistNode[],
  limit: number,
): Promise<{ tracks: SpotifyTrack[]; discovered: DiscoveredArtist[] }> {
  const tracks: SpotifyTrack[] = [];
  const discovered: DiscoveredArtist[] = [];
  const seen = new Set<string>();

  for (const artist of artists.slice(0, limit)) {
    try {
      const results = await searchTracksByArtist(token, artist.name, 3);
      for (const track of results) {
        if (!seen.has(track.id)) {
          seen.add(track.id);
          tracks.push(track);
        }
      }
      discovered.push({
        spotifyId: artist.spotifyId ?? '',
        name: artist.name,
        wikidataId: artist.wikidataId,
        source: 'wikidata',
        score: artist.pageRank,
      });
    } catch {
      // Skip individual artist failures
    }
  }

  return { tracks, discovered };
}

async function resolveCoOccurrencesToTracks(
  coOccurrences: CoOccurrence[],
  limit: number,
): Promise<{ tracks: SpotifyTrack[]; discovered: DiscoveredArtist[] }> {
  const tracks: SpotifyTrack[] = [];
  const discovered: DiscoveredArtist[] = [];

  for (const co of coOccurrences.slice(0, limit)) {
    tracks.push({
      id: co.trackId,
      name: co.trackName,
      artists: [{ id: '', name: co.artistName }],
      album: {
        id: '',
        name: '',
        images: co.albumImageUrl ? [{ url: co.albumImageUrl, width: 300, height: 300 }] : [],
      },
      uri: co.trackUri,
      preview_url: null,
      external_urls: { spotify: `https://open.spotify.com/track/${co.trackId}` },
    });
    discovered.push({
      spotifyId: '',
      name: co.artistName,
      source: 'playlist',
      score: co.count / Math.max(1, co.sourcePlaylistCount),
    });
  }

  return { tracks, discovered };
}

// --- Main engine ---

export async function runDiscoveryEngine(
  token: string,
  onProgress: (state: EngineState) => void,
): Promise<DiscoveryOrbit[]> {
  let progress = initialProgress();

  const emit = (orbits: DiscoveryOrbit[] = []) => {
    onProgress({
      orbits,
      isLoading: true,
      progress: [...progress],
    });
  };

  emit();

  // Phase 1: Fetch Spotify data
  progress = updateProgress(progress, 0, 'loading');
  emit();

  let shortTermTracks: SpotifyTrack[];
  let allArtists: { shortTerm: SpotifyArtist[]; mediumTerm: SpotifyArtist[]; longTerm: SpotifyArtist[] };
  let userTrackIds: Set<string>;
  let userArtistIds: Set<string>;

  try {
    const [tracks, artists] = await Promise.all([
      getTopTracks(token, 'short_term', 50),
      getAllTimeRangeArtists(token),
    ]);

    shortTermTracks = tracks;
    allArtists = artists;

    // Build user ID sets
    userTrackIds = new Set(shortTermTracks.map((t) => t.id));
    userArtistIds = new Set([
      ...allArtists.shortTerm.map((a) => a.id),
      ...allArtists.mediumTerm.map((a) => a.id),
      ...allArtists.longTerm.map((a) => a.id),
    ]);

    progress = updateProgress(progress, 0, 'done', `${shortTermTracks.length} tracks loaded`);
    emit();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load listening data';
    progress = updateProgress(progress, 0, 'error', message);
    onProgress({ orbits: [], isLoading: false, progress, error: message });
    return [];
  }

  // Phase 2: Run 3 signals in parallel
  progress = updateProgress(progress, 1, 'loading');
  progress = updateProgress(progress, 2, 'loading');
  progress = updateProgress(progress, 3, 'loading');
  emit();

  // Signal results — collected via return values to avoid closure narrowing issues
  interface WikidataResult {
    edges: InfluenceEdge[];
    blindspots: ArtistNode[];
    rootArtists: ArtistNode[];
  }

  const [wikidataResult, playlistResult, frontierResult] = await Promise.all([
    // Signal 1: Wikidata influences
    (async (): Promise<WikidataResult | null> => {
      try {
        const allSpotifyArtistIds = [
          ...allArtists.shortTerm.map((a) => a.id),
          ...allArtists.mediumTerm.map((a) => a.id),
          ...allArtists.longTerm.map((a) => a.id),
        ];
        const uniqueIds = Array.from(new Set(allSpotifyArtistIds));

        const wikidataMap = await findWikidataIdsBySpotifyIds(uniqueIds);
        const wikidataIds = Array.from(wikidataMap.values());

        if (wikidataIds.length === 0) {
          progress = updateProgress(progress, 1, 'done', 'No Wikidata matches');
          emit();
          return null;
        }

        const edges = await getInfluences(wikidataIds);
        const userWikidataIds = new Set(wikidataIds);
        const blindspots = getBlindspots(edges, userWikidataIds, 20);

        const rootEdges = edges.filter((e) => e.direction === 'influenced_by');
        const rootNodeIds = new Set(rootEdges.map((e) => e.toId));
        const rootArtists = Array.from(rootNodeIds)
          .filter((id) => !userWikidataIds.has(id))
          .map((id) => {
            const edge = rootEdges.find((e) => e.toId === id)!;
            return {
              wikidataId: id,
              name: edge.toName,
              spotifyId: edge.toSpotifyId,
              pageRank: 0,
              isUserArtist: false,
            };
          })
          .slice(0, 15);

        progress = updateProgress(progress, 1, 'done', `${edges.length} connections found`);
        emit();
        return { edges, blindspots, rootArtists };
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Wikidata unavailable';
        progress = updateProgress(progress, 1, 'error', detail);
        emit();
        return null;
      }
    })(),

    // Signal 2: Playlist co-occurrence
    (async (): Promise<CoOccurrence[] | null> => {
      try {
        const coOccurrences = await minePlaylistCoOccurrences(
          token,
          shortTermTracks,
          userTrackIds,
          30,
        );
        progress = updateProgress(progress, 2, 'done', `${coOccurrences.length} co-occurrences`);
        emit();
        return coOccurrences;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Playlist mining failed';
        progress = updateProgress(progress, 2, 'error', detail);
        emit();
        return null;
      }
    })(),

    // Signal 3: Taste frontier (synchronous, wrapped in async)
    (async (): Promise<TasteFrontier | null> => {
      try {
        const frontier = detectTasteFrontier(
          allArtists.shortTerm,
          allArtists.mediumTerm,
          allArtists.longTerm,
        );
        const detail = frontier.evolving
          ? `${frontier.shortTermOnly.length} new interests detected`
          : 'Stable taste profile';
        progress = updateProgress(progress, 3, 'done', detail);
        emit();
        return frontier;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Frontier detection failed';
        progress = updateProgress(progress, 3, 'error', detail);
        emit();
        return null;
      }
    })(),
  ]);

  // Phase 3: Build orbits
  const orbits: DiscoveryOrbit[] = [];
  const emergingGenres = frontierResult ? new Set(getEmergingGenres(frontierResult)) : new Set<string>();

  // Orbit 1: Your Roots — Artists who influenced user's favorites
  if (wikidataResult && wikidataResult.rootArtists.length > 0) {
    const { tracks, discovered } = await resolveArtistsToTracks(token, wikidataResult.rootArtists, 15);
    const confidence = Math.min(1, wikidataResult.rootArtists.length / 10);
    orbits.push(makeOrbit('roots', tracks, discovered, confidence));
  }

  // Orbit 2: Your Edges — Tracks matching frontier genres
  if (frontierResult && frontierResult.evolving) {
    const edgeGenres = frontierResult.frontierGenres.slice(0, 5);
    try {
      const edgeTracks = await discoverByGenres(token, edgeGenres, userTrackIds, 25);
      const edgeArtists: DiscoveredArtist[] = edgeTracks.map((t) => ({
        spotifyId: t.artists[0]?.id ?? '',
        name: t.artists[0]?.name ?? 'Unknown',
        source: 'frontier' as const,
        score: emergingGenres.size > 0 ? FRONTIER_BOOST : 1,
      }));
      const confidence = Math.min(1, edgeTracks.length / 15);
      orbits.push(makeOrbit('edges', edgeTracks, edgeArtists, confidence));
    } catch {
      // Edges fail gracefully
    }
  } else if (frontierResult) {
    // Non-evolving: use medium-term genre underrepresentation
    const mediumGenres = new Set(
      allArtists.mediumTerm.flatMap((a) => a.genres),
    );
    const underrepresented = Array.from(mediumGenres)
      .filter((g) => !frontierResult.coreGenres.includes(g))
      .slice(0, 5);
    if (underrepresented.length > 0) {
      try {
        const edgeTracks = await discoverByGenres(token, underrepresented, userTrackIds, 20);
        const edgeArtists: DiscoveredArtist[] = edgeTracks.map((t) => ({
          spotifyId: t.artists[0]?.id ?? '',
          name: t.artists[0]?.name ?? 'Unknown',
          source: 'frontier' as const,
          score: 1,
        }));
        orbits.push(makeOrbit('edges', edgeTracks, edgeArtists, 0.5));
      } catch {
        // Edges fail gracefully
      }
    }
  }

  // Orbit 3: Your Crowd — Top co-occurring tracks from playlist mining
  if (playlistResult && playlistResult.length > 0) {
    const { tracks, discovered } = await resolveCoOccurrencesToTracks(playlistResult, 25);
    const confidence = Math.min(1, playlistResult.length / 20);
    orbits.push(makeOrbit('crowd', tracks, discovered, confidence));
  }

  // Orbit 4: Your Blindspot — High PageRank artists user never listened to
  if (wikidataResult && wikidataResult.blindspots.length > 0) {
    const { tracks, discovered } = await resolveArtistsToTracks(token, wikidataResult.blindspots, 15);
    const confidence = Math.min(1, wikidataResult.blindspots.length / 10);
    orbits.push(makeOrbit('blindspot', tracks, discovered, confidence));
  }

  // Graceful degradation: if no orbits, create a single "Discover" via genre search
  if (orbits.length === 0) {
    const allGenres = [
      ...allArtists.shortTerm.flatMap((a) => a.genres),
      ...allArtists.mediumTerm.flatMap((a) => a.genres),
    ];
    const uniqueGenres = Array.from(new Set(allGenres)).slice(0, 5);

    try {
      const fallbackTracks = await discoverByGenres(token, uniqueGenres, userTrackIds, 30);
      orbits.push(makeOrbit('edges', fallbackTracks, [], 0.3));
    } catch {
      // Complete failure — return empty
    }
  }

  // Final state
  onProgress({
    orbits,
    isLoading: false,
    progress,
  });

  return orbits;
}
