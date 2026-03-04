import { MusicService, MusicTrack, MusicArtist } from '@/lib/music/types';
import { sectionColors, sectionMeta } from '@/lib/tokens';
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
import { findWikidataIdsBySpotifyIds, findWikidataIdsByNames, getInfluences } from './wikidata';
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
const MIN_TRACKS_PER_ORBIT = 15;

// --- Helpers ---

/** Keep only one track per artist within a playlist */
function dedupeByArtist(tracks: MusicTrack[]): MusicTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const key = t.artist?.toLowerCase() ?? t.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pad an orbit's tracks to at least MIN_TRACKS_PER_ORBIT using genre search */
async function padOrbitTracks(
  musicService: MusicService,
  tracks: MusicTrack[],
  userGenres: string[],
  userTrackIds: Set<string>,
): Promise<MusicTrack[]> {
  if (tracks.length >= MIN_TRACKS_PER_ORBIT) return tracks;

  const existingIds = new Set(tracks.map(t => t.id));
  const needed = MIN_TRACKS_PER_ORBIT - tracks.length;

  try {
    const extra = await musicService.discoverByGenres(userGenres.slice(0, 5), new Set([...userTrackIds, ...existingIds]), needed);
    return [...tracks, ...extra].slice(0, Math.max(MIN_TRACKS_PER_ORBIT, tracks.length));
  } catch {
    return tracks;
  }
}

function makeOrbit(
  id: OrbitId,
  tracks: MusicTrack[],
  artists: DiscoveredArtist[],
  confidence: number,
): DiscoveryOrbit {
  const meta = sectionMeta[id as keyof typeof sectionMeta];
  const color = sectionColors[id as keyof typeof sectionColors];
  return {
    id,
    label: meta?.label ?? id,
    description: meta?.tagline ?? '',
    color: { name: id, from: color?.bg ?? '#F0F0F0', to: color?.accent ?? '#888888' },
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

// --- Resolve artists to tracks via MusicService ---

async function resolveArtistsToTracks(
  musicService: MusicService,
  artists: ArtistNode[],
  limit: number,
): Promise<{ tracks: MusicTrack[]; discovered: DiscoveredArtist[] }> {
  const tracks: MusicTrack[] = [];
  const discovered: DiscoveredArtist[] = [];
  const seen = new Set<string>();

  for (const artist of artists.slice(0, limit)) {
    try {
      const results = await musicService.searchTracksByArtist(artist.name, 5);
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
): Promise<{ tracks: MusicTrack[]; discovered: DiscoveredArtist[] }> {
  const tracks: MusicTrack[] = [];
  const discovered: DiscoveredArtist[] = [];

  for (const co of coOccurrences.slice(0, limit)) {
    tracks.push({
      id: co.trackId,
      name: co.trackName,
      artist: co.artistName,
      artistId: '',
      album: '',
      albumId: '',
      imageUrl: co.albumImageUrl ?? '',
      externalUrl: `https://open.spotify.com/track/${co.trackId}`,
      uri: co.trackUri,
      service: 'spotify',
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
  musicService: MusicService,
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

  // Phase 1: Fetch listening data
  progress = updateProgress(progress, 0, 'loading');
  emit();

  let shortTermTracks: MusicTrack[];
  let allArtists: { shortTerm: MusicArtist[]; mediumTerm: MusicArtist[]; longTerm: MusicArtist[] };
  let userTrackIds: Set<string>;
  let userArtistIds: Set<string>;

  try {
    const [tracks, artists] = await Promise.all([
      musicService.getTopTracks('short', 50),
      musicService.getTopArtistsAllRanges(),
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

  // Phase 2: Run signals in parallel
  progress = updateProgress(progress, 1, 'loading');
  progress = updateProgress(progress, 2, 'loading');
  progress = updateProgress(progress, 3, 'loading');
  emit();

  interface WikidataResult {
    edges: InfluenceEdge[];
    blindspots: ArtistNode[];
    rootArtists: ArtistNode[];
  }

  const isDeezer = musicService.service === 'deezer';

  const [wikidataResult, playlistResult, frontierResult] = await Promise.all([
    // Signal 1: Wikidata influences
    (async (): Promise<WikidataResult | null> => {
      try {
        const allArtistIds = [
          ...allArtists.shortTerm.map((a) => a.id),
          ...allArtists.mediumTerm.map((a) => a.id),
          ...allArtists.longTerm.map((a) => a.id),
        ];
        const uniqueIds = Array.from(new Set(allArtistIds));

        // Spotify: use Spotify IDs for precise matching
        // Deezer: use artist names for label-based matching
        let wikidataMap: Map<string, string>;
        if (isDeezer) {
          const allNames = [
            ...allArtists.shortTerm.map((a) => a.name),
            ...allArtists.mediumTerm.map((a) => a.name),
            ...allArtists.longTerm.map((a) => a.name),
          ];
          const uniqueNames = Array.from(new Set(allNames));
          wikidataMap = await findWikidataIdsByNames(uniqueNames);
        } else {
          wikidataMap = await findWikidataIdsBySpotifyIds(uniqueIds);
        }

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

    // Signal 2: Playlist co-occurrence (Spotify only — Deezer has no playlist search API)
    (async (): Promise<CoOccurrence[] | null> => {
      if (isDeezer) {
        progress = updateProgress(progress, 2, 'done', 'Using genre search');
        emit();
        return null;
      }
      try {
        const coOccurrences = await minePlaylistCoOccurrences(
          musicService,
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

    // Signal 3: Taste frontier
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

  // Collect user genres once for padding
  const userGenres = Array.from(new Set([
    ...allArtists.shortTerm.flatMap((a) => a.genres),
    ...allArtists.mediumTerm.flatMap((a) => a.genres),
    ...allArtists.longTerm.flatMap((a) => a.genres),
  ]));

  // Orbit 1: Your Roots — Artists who influenced user's favorites
  if (wikidataResult && wikidataResult.rootArtists.length > 0) {
    const { tracks, discovered } = await resolveArtistsToTracks(musicService, wikidataResult.rootArtists, 20);
    const padded = await padOrbitTracks(musicService, tracks, userGenres, userTrackIds);
    const confidence = Math.min(1, wikidataResult.rootArtists.length / 10);
    orbits.push(makeOrbit('roots', padded, discovered, confidence));
  }

  // Orbit 2: Your Edges — Top tracks from frontier artists (new interests)
  if (frontierResult && frontierResult.shortTermOnly.length > 0) {
    try {
      const edgeTracks: MusicTrack[] = [];
      const edgeArtists: DiscoveredArtist[] = [];
      const seen = new Set<string>();

      const frontierArtists = frontierResult.shortTermOnly.slice(0, 12);
      for (const artist of frontierArtists) {
        const tracks = await musicService.searchTracksByArtist(artist.name, 5);
        for (const track of tracks) {
          if (!seen.has(track.id) && !userTrackIds.has(track.id)) {
            seen.add(track.id);
            edgeTracks.push(track);
          }
        }
        edgeArtists.push({
          spotifyId: artist.id,
          name: artist.name,
          source: 'frontier' as const,
          score: FRONTIER_BOOST,
        });
      }

      if (edgeTracks.length > 0) {
        const padded = await padOrbitTracks(musicService, edgeTracks, userGenres, userTrackIds);
        const confidence = Math.min(1, padded.length / 15);
        orbits.push(makeOrbit('edges', padded, edgeArtists, confidence));
      }
    } catch {
      // Edges fail gracefully
    }
  }

  // Orbit 3: Your Crowd
  if (playlistResult && playlistResult.length > 0) {
    const strongMatches = playlistResult.filter((co) => co.count >= 2);
    const toUse = strongMatches.length >= 5 ? strongMatches : playlistResult;
    const { tracks, discovered } = await resolveCoOccurrencesToTracks(toUse, 30);
    const padded = await padOrbitTracks(musicService, tracks, userGenres, userTrackIds);
    const confidence = Math.min(1, strongMatches.length / 15);
    orbits.push(makeOrbit('crowd', padded, discovered, confidence));
  } else if (isDeezer) {
    try {
      const uniqueGenres = userGenres.slice(0, 5);
      if (uniqueGenres.length > 0) {
        const crowdTracks = await musicService.discoverByGenres(uniqueGenres, userTrackIds, 25);
        if (crowdTracks.length > 0) {
          orbits.push(makeOrbit('crowd', crowdTracks, [], 0.4));
        }
      }
    } catch {
      // Crowd fails gracefully for Deezer
    }
  }

  // Orbit 4: Your Blindspot — High PageRank artists user never listened to
  if (wikidataResult && wikidataResult.blindspots.length > 0) {
    const { tracks, discovered } = await resolveArtistsToTracks(musicService, wikidataResult.blindspots, 20);
    const padded = await padOrbitTracks(musicService, tracks, userGenres, userTrackIds);
    const confidence = Math.min(1, wikidataResult.blindspots.length / 10);
    orbits.push(makeOrbit('blindspot', padded, discovered, confidence));
  }

  // Orbit 5: Deep Work — Instrumental/ambient versions of genres user likes
  try {
    const ambientTerms = ['instrumental', 'ambient', 'lo-fi', 'chillhop', 'study'];
    const deepWorkQueries = userGenres
      .slice(0, 4)
      .map(g => `${g} instrumental`)
      .concat(ambientTerms);

    const dwTracks: MusicTrack[] = [];
    const seen = new Set<string>();

    for (const query of deepWorkQueries) {
      if (dwTracks.length >= 20) break;
      const results = await musicService.discoverByGenres([query], userTrackIds, 8);
      for (const t of results) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          dwTracks.push(t);
        }
      }
    }

    if (dwTracks.length > 0) {
      const padded = await padOrbitTracks(musicService, dwTracks, ['ambient', 'lo-fi', 'instrumental', 'chillhop'], userTrackIds);
      orbits.push(makeOrbit('deepwork', padded, [], 0.5));
    }
  } catch {
    // Deep work fails gracefully
  }

  // Orbit 6: Wildcard — Random genre the user has never explored
  try {
    const userGenreSet = new Set(userGenres);

    const wildcardGenres = [
      'afrobeats', 'bossa nova', 'k-pop', 'amapiano', 'reggaeton',
      'shoegaze', 'city pop', 'afrofuturism', 'dub', 'highlife',
      'tropicalia', 'cumbia', 'grime', 'baile funk', 'j-pop',
      'dancehall', 'bolero', 'ethio-jazz', 'desert blues', 'kuduro',
    ];

    const unexplored = wildcardGenres.filter(g => !userGenreSet.has(g));
    const pick = unexplored[Math.floor(Math.random() * unexplored.length)] ?? 'world music';

    const wcTracks = await musicService.discoverByGenres([pick], userTrackIds, 20);

    if (wcTracks.length > 0) {
      const wildcardOrbit = makeOrbit('wildcard', wcTracks, [], 0.4);
      wildcardOrbit.description = `Today's left turn: ${pick}`;
      orbits.push(wildcardOrbit);
    }
  } catch {
    // Wildcard fails gracefully
  }

  // Graceful degradation: if no orbits, create a single "Discover" via genre search
  if (orbits.length === 0) {
    const allGenres = [
      ...allArtists.shortTerm.flatMap((a) => a.genres),
      ...allArtists.mediumTerm.flatMap((a) => a.genres),
    ];
    const uniqueGenres = Array.from(new Set(allGenres)).slice(0, 5);

    try {
      const fallbackTracks = await musicService.discoverByGenres(uniqueGenres, userTrackIds, 30);
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
