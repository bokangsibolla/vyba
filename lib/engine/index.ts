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

/** Pad an orbit's tracks to at least MIN_TRACKS_PER_ORBIT using multiple strategies */
async function padOrbitTracks(
  musicService: MusicService,
  tracks: MusicTrack[],
  userArtistNames: string[],
  userTrackIds: Set<string>,
): Promise<MusicTrack[]> {
  if (tracks.length >= MIN_TRACKS_PER_ORBIT) return tracks;

  const result = [...tracks];
  const existingIds = new Set(tracks.map(t => t.id));
  const exclude = new Set([...userTrackIds, ...existingIds]);

  // Strategy 1: Search for more tracks by artists already in the orbit
  const orbitArtists = Array.from(new Set(tracks.map(t => t.artist)));
  for (const artist of orbitArtists) {
    if (result.length >= MIN_TRACKS_PER_ORBIT) break;
    try {
      const more = await musicService.searchTracksByArtist(artist, 5);
      for (const t of more) {
        if (!exclude.has(t.id) && result.length < MIN_TRACKS_PER_ORBIT) {
          exclude.add(t.id);
          result.push(t);
        }
      }
    } catch { /* skip */ }
  }

  // Strategy 2: Search for tracks by user's favorite artists (shuffled)
  if (result.length < MIN_TRACKS_PER_ORBIT) {
    const shuffled = [...userArtistNames].sort(() => Math.random() - 0.5);
    for (const artist of shuffled.slice(0, 10)) {
      if (result.length >= MIN_TRACKS_PER_ORBIT) break;
      try {
        const more = await musicService.searchTracksByArtist(artist, 3);
        for (const t of more) {
          if (!exclude.has(t.id) && result.length < MIN_TRACKS_PER_ORBIT) {
            exclude.add(t.id);
            result.push(t);
          }
        }
      } catch { /* skip */ }
    }
  }

  return result;
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

  // Collect user artist names for reliable padding
  const userArtistNames = Array.from(new Set([
    ...allArtists.longTerm.map((a) => a.name),
    ...allArtists.mediumTerm.map((a) => a.name),
    ...allArtists.shortTerm.map((a) => a.name),
  ]));

  const userGenres = Array.from(new Set([
    ...allArtists.shortTerm.flatMap((a) => a.genres),
    ...allArtists.mediumTerm.flatMap((a) => a.genres),
    ...allArtists.longTerm.flatMap((a) => a.genres),
  ]));

  // Helper: build an orbit from artist search (reliable fallback)
  async function buildOrbitFromArtists(
    artists: string[],
    excludeIds: Set<string>,
    target: number,
  ): Promise<MusicTrack[]> {
    const tracks: MusicTrack[] = [];
    const seen = new Set<string>();
    for (const name of artists) {
      if (tracks.length >= target) break;
      try {
        const results = await musicService.searchTracksByArtist(name, 5);
        for (const t of results) {
          if (!seen.has(t.id) && !excludeIds.has(t.id)) {
            seen.add(t.id);
            tracks.push(t);
          }
        }
      } catch { /* skip */ }
    }
    return tracks;
  }

  // Orbit 1: Your Roots — Artists who influenced user's favorites
  {
    let rootTracks: MusicTrack[] = [];
    let rootDiscovered: DiscoveredArtist[] = [];
    if (wikidataResult && wikidataResult.rootArtists.length > 0) {
      const { tracks, discovered } = await resolveArtistsToTracks(musicService, wikidataResult.rootArtists, 20);
      rootTracks = tracks;
      rootDiscovered = discovered;
    }
    // Fallback: use long-term artists (the user's roots)
    if (rootTracks.length < MIN_TRACKS_PER_ORBIT) {
      const longTermNames = allArtists.longTerm.map(a => a.name);
      rootTracks = await padOrbitTracks(musicService, rootTracks, longTermNames, userTrackIds);
    }
    if (rootTracks.length > 0) {
      orbits.push(makeOrbit('roots', rootTracks, rootDiscovered, Math.min(1, rootTracks.length / 15)));
    }
  }

  // Orbit 2: Your Edges — Top tracks from frontier artists (new interests)
  {
    const edgeTracks: MusicTrack[] = [];
    const edgeArtists: DiscoveredArtist[] = [];
    const seen = new Set<string>();

    if (frontierResult && frontierResult.shortTermOnly.length > 0) {
      const frontierArtists = frontierResult.shortTermOnly.slice(0, 12);
      for (const artist of frontierArtists) {
        try {
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
        } catch { /* skip */ }
      }
    }
    // Fallback: use short-term artists (recent listening = edges)
    const shortTermNames = allArtists.shortTerm.map(a => a.name);
    const paddedEdges = await padOrbitTracks(musicService, edgeTracks, shortTermNames, userTrackIds);
    if (paddedEdges.length > 0) {
      orbits.push(makeOrbit('edges', paddedEdges, edgeArtists, Math.min(1, paddedEdges.length / 15)));
    }
  }

  // Orbit 3: Your Crowd
  {
    let crowdTracks: MusicTrack[] = [];
    let crowdDiscovered: DiscoveredArtist[] = [];
    if (playlistResult && playlistResult.length > 0) {
      const strongMatches = playlistResult.filter((co) => co.count >= 2);
      const toUse = strongMatches.length >= 5 ? strongMatches : playlistResult;
      const { tracks, discovered } = await resolveCoOccurrencesToTracks(toUse, 30);
      crowdTracks = tracks;
      crowdDiscovered = discovered;
    }
    // Fallback: use medium-term artists (the user's crowd)
    const mediumTermNames = allArtists.mediumTerm.map(a => a.name);
    const paddedCrowd = await padOrbitTracks(musicService, crowdTracks, mediumTermNames, userTrackIds);
    if (paddedCrowd.length > 0) {
      orbits.push(makeOrbit('crowd', paddedCrowd, crowdDiscovered, Math.min(1, paddedCrowd.length / 15)));
    }
  }

  // Orbit 4: Your Blindspot — High PageRank artists user never listened to
  {
    let blindTracks: MusicTrack[] = [];
    let blindDiscovered: DiscoveredArtist[] = [];
    if (wikidataResult && wikidataResult.blindspots.length > 0) {
      const { tracks, discovered } = await resolveArtistsToTracks(musicService, wikidataResult.blindspots, 20);
      blindTracks = tracks;
      blindDiscovered = discovered;
    }
    // Fallback: search for popular tracks in user's genres they haven't heard
    if (blindTracks.length < MIN_TRACKS_PER_ORBIT) {
      const searchTerms = userGenres.slice(0, 5).map(g => `${g} popular`);
      for (const term of searchTerms) {
        if (blindTracks.length >= MIN_TRACKS_PER_ORBIT) break;
        try {
          const results = await musicService.searchTracks(term, 10);
          for (const t of results) {
            if (!userTrackIds.has(t.id) && !blindTracks.some(bt => bt.id === t.id)) {
              blindTracks.push(t);
            }
          }
        } catch { /* skip */ }
      }
    }
    if (blindTracks.length > 0) {
      orbits.push(makeOrbit('blindspot', blindTracks, blindDiscovered, Math.min(1, blindTracks.length / 15)));
    }
  }

  // Orbit 5: Deep Work — Instrumental/ambient from user's taste
  {
    const dwTracks: MusicTrack[] = [];
    const seen = new Set<string>();

    // Search for instrumental versions of user's favorite artists
    for (const artist of userArtistNames.slice(0, 5)) {
      if (dwTracks.length >= 20) break;
      try {
        const results = await musicService.searchTracks(`${artist} instrumental`, 5);
        for (const t of results) {
          if (!seen.has(t.id) && !userTrackIds.has(t.id)) {
            seen.add(t.id);
            dwTracks.push(t);
          }
        }
      } catch { /* skip */ }
    }

    // Also search ambient/lo-fi terms
    const ambientTerms = ['lo-fi beats', 'ambient instrumental', 'chillhop', 'study music', 'piano ambient'];
    for (const term of ambientTerms) {
      if (dwTracks.length >= 20) break;
      try {
        const results = await musicService.searchTracks(term, 5);
        for (const t of results) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            dwTracks.push(t);
          }
        }
      } catch { /* skip */ }
    }

    if (dwTracks.length > 0) {
      orbits.push(makeOrbit('deepwork', dwTracks, [], 0.5));
    }
  }

  // Orbit 6: Wildcard — Random genre the user has never explored
  {
    const userGenreSet = new Set(userGenres);

    const wildcardGenres = [
      'afrobeats', 'bossa nova', 'k-pop', 'amapiano', 'reggaeton',
      'shoegaze', 'city pop', 'afrofuturism', 'dub', 'highlife',
      'tropicalia', 'cumbia', 'grime', 'baile funk', 'j-pop',
      'dancehall', 'bolero', 'ethio-jazz', 'desert blues', 'kuduro',
    ];

    const unexplored = wildcardGenres.filter(g => !userGenreSet.has(g));
    const pick = unexplored[Math.floor(Math.random() * unexplored.length)] ?? 'world music';

    // Use searchTracks directly — more reliable than genre: filter
    let wcTracks: MusicTrack[] = [];
    try {
      wcTracks = await musicService.searchTracks(pick, 20);
      wcTracks = wcTracks.filter(t => !userTrackIds.has(t.id));
    } catch { /* skip */ }

    if (wcTracks.length > 0) {
      const wildcardOrbit = makeOrbit('wildcard', wcTracks, [], 0.4);
      wildcardOrbit.description = `Today's left turn: ${pick}`;
      orbits.push(wildcardOrbit);
    }
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
